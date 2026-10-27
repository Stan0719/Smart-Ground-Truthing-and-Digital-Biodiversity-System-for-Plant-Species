import { randomBytes, scrypt, pbkdf2, timingSafeEqual, createHash, randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { connectAuth } from './postgres.mjs'

const derive = promisify(scrypt)
const derivePbkdf2 = promisify(pbkdf2)
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }
export const LOGIN_ERROR =
  'Unable to sign in. Check your email and password or contact the administrator.'
export const digest = (value) => createHash('sha256').update(value).digest('hex')
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const key = await derive(password, salt, 64, options)
  return `${salt}:${key.toString('hex')}`
}
async function verify(password, hash) {
  // Compatibility with the legacy PBKDF2 format. Existing hashes are
  // verified in place; changing a password still uses the current scrypt format.
  const legacy =
    typeof hash === 'string' && /^pbkdf2_sha256\$(\d+)\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(hash)
  if (legacy) {
    const iterations = Number(legacy[1])
    if (Number.isSafeInteger(iterations) && iterations >= 100000 && iterations <= 2000000) {
      const key = await derivePbkdf2(
        password,
        Buffer.from(legacy[2], 'hex'),
        iterations,
        32,
        'sha256',
      )
      return timingSafeEqual(key, Buffer.from(legacy[3], 'hex'))
    }
  }

  const valid = typeof hash === 'string' && /^[a-f0-9]{32}:[a-f0-9]{128}$/.test(hash)
  const [salt, encoded] = valid ? hash.split(':') : ['unsupported-legacy-hash', '00'.repeat(64)]
  const key = await derive(password, salt, 64, options)
  return timingSafeEqual(key, Buffer.from(encoded, 'hex')) && valid
}
export function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    mustChangePassword: Boolean(user.must_change_password),
    lastLogin: user.last_login ?? 'Never',
    initials: user.name
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0])
      .join('')
      .toUpperCase(),
  }
}
export async function createAuth(database = connectAuth()) {
  if (!database || typeof database !== 'object' || !database.prepare)
    throw new Error('SQLite paths are no longer supported. Supply a PostgreSQL database adapter.')
  const db = database
  try {
    if (!(await db.prepare('SELECT version FROM schema_migrations WHERE version=1').get()))
      throw Error('Missing authentication schema version.')
  } catch (error) {
    await db.close()
    throw new Error(
      'PostgreSQL authentication schema is not ready. Run npm run migrate:auth first.',
      { cause: error },
    )
  }
  const dummy = await hashPassword(randomBytes(32).toString('hex'))
  const event = async (userId, ip, reason, actor = null) =>
    await db
      .prepare('INSERT INTO auth_events(created_at,user_id,ip,reason,actor_id) VALUES(?,?,?,?,?)')
      .run(Date.now(), userId, ip, reason, actor)
  const temporaryExpired=async(user)=>Boolean(user?.must_change_password&&await db.prepare('SELECT 1 FROM activation_tokens WHERE user_id=? AND used=0 AND expires_at<=?').get(user.id,Date.now()))
  const byEmail = async (email) =>
    (await db.prepare('SELECT * FROM users WHERE email=?').get(email)) ??
    (await db.prepare('SELECT * FROM visitors WHERE email=?').get(email))
  const byId = async (id) =>
    (await db.prepare('SELECT * FROM users WHERE id=?').get(id)) ??
    (await db.prepare('SELECT * FROM visitors WHERE id=?').get(id))
  const sessionTable = (user) => (user.role === 'Visitor' ? 'visitor_sessions' : 'sessions')
  return {
    db,
    byEmail,
    byId,
    async createVisitor({ name, email, password }) {
      email = email.trim().toLowerCase()
      if (await byEmail(email))
        return { error: 'Unable to register this email. Contact the administrator.', status: 409 }
      const id = randomUUID(),
        hash = await hashPassword(password)
      if (await byEmail(email))
        return { error: 'Unable to register this email. Contact the administrator.', status: 409 }
      await db
        .prepare('INSERT INTO visitors(id,name,email,password_hash) VALUES(?,?,?,?)')
        .run(id, name.trim(), email, hash)
      return { user: publicUser(await byId(id)) }
    },
    async resetPassword(id, password) {
      const current = await byId(id)
      if (!current || current.status !== 'Active' || current.must_change_password) return false
      const hash = await hashPassword(password)
      const table = current.role === 'Visitor' ? 'visitors' : 'users'
      return db.transaction(async () => {
        const updated = await db
          .prepare(
            `UPDATE ${table} SET password_hash=?,must_change_password=0 WHERE id=? AND status='Active' AND must_change_password=0`,
          )
          .run(hash, id)
        await db.prepare(`DELETE FROM ${sessionTable(current)} WHERE user_id=?`).run(id)
        return Boolean(updated.changes)
      })
    },
    event,
    async createUser({ name, email, role, password, mustChangePassword = true }) {
      const id = randomUUID()
      const hash = await hashPassword(password)
      await db
        .prepare(
          'INSERT INTO users(id,name,username,email,role,password_hash,must_change_password) VALUES(?,?,?,?,?,?,?)',
        )
        .run(id, name, id, email.trim().toLowerCase(), role, hash, Number(mustChangePassword))
      return publicUser(await db.prepare('SELECT * FROM users WHERE id=?').get(id))
    },
    async login(email, password, ip, requirements = {}) {
      const limited = await db.transaction(async () => {
        await db.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get('login:' + ip)
        const settings = await db
          .prepare('SELECT login_limit FROM security_settings WHERE id=1')
          .get()
        const count = (
          await db
            .prepare(
              "SELECT COUNT(*) AS count FROM auth_events WHERE ip=? AND created_at>? AND reason LIKE 'login_%'",
            )
            .get(ip, Date.now() - 15 * 60 * 1000)
        ).count
        if (count >= settings.login_limit) {
          await event(null, ip, 'throttled')
          return true
        }
        await event(null, ip, 'login_attempt')
        return false
      })
      if (limited) return { error: LOGIN_ERROR, status: 429 }
      const user = await byEmail(email.trim().toLowerCase())
      const valid = await verify(password, user?.password_hash ?? dummy)
      // Reload after async verification: an admin may have disabled this account meanwhile.
      const current = user && (await byId(user.id))
      if (process.env.AUTH_DEBUG === '1' && requirements.reference)
        console.info(
          JSON.stringify({
            event: 'password_verification',
            reference: requirements.reference,
            accountFound: Boolean(current),
            role: current?.role,
            status: current?.status,
            mustChangePassword: Boolean(current?.must_change_password),
            passwordVerified: valid,
          }),
        )
      if (
        !valid ||
        !current ||
        current.status !== 'Active' ||
        (await temporaryExpired(current)) ||
        current.password_hash !== user.password_hash ||
        (requirements.role && current.role !== requirements.role) ||
        (requirements.roles && !requirements.roles.includes(current.role)) ||
        (requirements.requirePermanent && current.must_change_password)
      ) {
        await event(user?.id ?? null, ip, !valid ? 'invalid_credentials' : 'account_blocked')
        return { error: LOGIN_ERROR, status: 401 }
      }
      return db.transaction(async () => {
        const table = current.role === 'Visitor' ? 'visitors' : 'users'
        const locked = await db
          .prepare(`SELECT * FROM ${table} WHERE id=? FOR UPDATE`)
          .get(current.id)
        if (
          !locked ||
          locked.status !== 'Active' ||
          (await temporaryExpired(locked)) ||
          locked.password_hash !== user.password_hash ||
          (requirements.role && locked.role !== requirements.role) ||
          (requirements.roles && !requirements.roles.includes(locked.role)) ||
          (requirements.requirePermanent && locked.must_change_password)
        )
          return { error: LOGIN_ERROR, status: 401 }
        const token = randomBytes(32).toString('hex')
        await db
          .prepare(`INSERT INTO ${sessionTable(locked)} VALUES(?,?,?)`)
          .run(
            digest(token),
            locked.id,
            Date.now() +
              (await db.prepare('SELECT session_hours FROM security_settings WHERE id=1').get())
                .session_hours *
                60 *
                60 *
                1000,
          )
        await db
          .prepare(`UPDATE ${table} SET last_login=? WHERE id=?`)
          .run(new Date().toISOString(), locked.id)
        await event(locked.id, ip, 'authenticated')
        return { token, user: publicUser(locked) }
      })
    },
    async issueFaceSession(userId, ip) {
      return db.transaction(async () => {
        await db.prepare('SELECT pg_advisory_xact_lock(hashtext(?))').get('face-login:' + ip)
        const settings = await db
          .prepare('SELECT login_limit,session_hours FROM security_settings WHERE id=1')
          .get()
        const attempts = (
          await db
            .prepare(
              "SELECT COUNT(*) AS n FROM auth_events WHERE ip=? AND created_at>? AND reason='face_attempt'",
            )
            .get(ip, Date.now() - 15 * 60 * 1000)
        ).n
        if (attempts >= settings.login_limit) return { error: LOGIN_ERROR, status: 429 }
        await event(null, ip, 'face_attempt')
        const existing = await byId(userId)
        const table = existing?.role === 'Visitor' ? 'visitors' : 'users'
        const current = await db.prepare(`SELECT * FROM ${table} WHERE id=? FOR UPDATE`).get(userId)
        if (
          !current ||
          current.status !== 'Active' ||
          !['Botanist', 'Visitor'].includes(current.role) ||
          current.must_change_password
        ) {
          await event(current?.id ?? null, ip, 'face_account_blocked')
          return { error: LOGIN_ERROR, status: 401 }
        }
        const token = randomBytes(32).toString('hex')
        await db
          .prepare(`INSERT INTO ${sessionTable(current)} VALUES(?,?,?)`)
          .run(digest(token), current.id, Date.now() + settings.session_hours * 60 * 60 * 1000)
        await db
          .prepare(`UPDATE ${table} SET last_login=? WHERE id=?`)
          .run(new Date().toISOString(), current.id)
        await event(current.id, ip, 'face_authenticated')
        return { token, user: publicUser(current) }
      })
    },
    async session(token) {
      const user = await db
        .prepare(
          'SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.status=?',
        )
        .get(digest(token), Date.now(), 'Active')
      const visitor = user
        ? null
        : await db
            .prepare(
              "SELECT v.* FROM visitor_sessions s JOIN visitors v ON v.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND v.status='Active'",
            )
            .get(digest(token), Date.now())
      if(await temporaryExpired(user))return null
      return user ? publicUser(user) : visitor ? publicUser(visitor) : null
    },
    async setStatus(id, status, actor, ip) {
      if (!['Active', 'Inactive', 'Suspended'].includes(status)) throw Error('Invalid status')
      return db.transaction(async () => {
        const existing = await byId(id)
        if (!existing) return false
        const table = existing.role === 'Visitor' ? 'visitors' : 'users'
        await db.prepare(`SELECT id FROM ${table} WHERE id=? FOR UPDATE`).get(id)
        if (
          await db
            .prepare("SELECT 1 FROM auth_events WHERE user_id=? AND reason='account_archived'")
            .get(id)
        )
          return false
        const result = await db.prepare(`UPDATE ${table} SET status=? WHERE id=?`).run(status, id)
        if (result.changes) await event(id, ip, `status_${status}`, actor)
        return Boolean(result.changes)
      })
    },
    async changePassword(id, password) {
      const hash = await hashPassword(password)
      return db.transaction(async () => {
        const current = await byId(id)
        if (!current || current.status !== 'Active' || current.password_hash === hash || await temporaryExpired(current)) return false
        if (await verify(password, current.password_hash)) return false
        const table = current.role === 'Visitor' ? 'visitors' : 'users'
        const result = await db
          .prepare(
            `UPDATE ${table} SET password_hash=?,must_change_password=0 WHERE id=? AND status='Active' AND password_hash=?`,
          )
          .run(hash, id, current.password_hash)
        await db.prepare(`DELETE FROM ${sessionTable(current)} WHERE user_id=?`).run(id)
        if(result.changes)await db.prepare('UPDATE activation_tokens SET used=1 WHERE user_id=?').run(id)
        return Boolean(result.changes)
      })
    },
  }
}
