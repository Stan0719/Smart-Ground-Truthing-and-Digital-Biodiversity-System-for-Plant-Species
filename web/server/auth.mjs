import { randomBytes, scrypt, pbkdf2, timingSafeEqual, createHash, randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { connectAuth } from './postgres.mjs'
import { createAccountInactivity } from './account-inactivity.mjs'

const derive = promisify(scrypt)
const derivePbkdf2 = promisify(pbkdf2)
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }
export const WEBSITE_ROLES = Object.freeze(['Administrator', 'Conservation Officer'])
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
export async function createAuth(database = connectAuth(), {
  now = Date.now,
  diagnostic = (entry) => {
    if (process.env.AUTH_DEBUG === '1') console.info(JSON.stringify(entry))
  },
} = {}) {
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
      .run(now(), userId, ip, reason, actor)
  const inactivity = createAccountInactivity({ db, event, now })
  const temporaryExpired=async(user)=>Boolean(user?.must_change_password&&await db.prepare('SELECT 1 FROM activation_tokens WHERE user_id=? AND used=0 AND expires_at<=?').get(user.id,now()))
  const byEmail = async (email) =>
    inactivity.apply((await db.prepare('SELECT * FROM users WHERE email=?').get(email)) ??
    (await db.prepare('SELECT * FROM visitors WHERE email=?').get(email)))
  const byId = async (id) =>
    inactivity.apply((await db.prepare('SELECT * FROM users WHERE id=?').get(id)) ??
    (await db.prepare('SELECT * FROM visitors WHERE id=?').get(id)))
  const sessionTable = (user) => (user.role === 'Visitor' ? 'visitor_sessions' : 'sessions')
  // These reasons stay in opt-in server logs; clients receive the same generic error.
  const accountDenial = async (current, expectedHash, requirements) => {
    if (!current) return 'account_missing'
    if ((await inactivity.apply(current))?.status !== 'Active') return 'account_inactive'
    if (current.status !== 'Active') return 'account_inactive'
    if (await temporaryExpired(current)) return 'temporary_password_expired'
    if (current.password_hash !== expectedHash) return 'credentials_changed'
    if ((requirements.role && current.role !== requirements.role) ||
        (requirements.roles && !requirements.roles.includes(current.role))) return 'role_denied'
    if (requirements.requirePermanent && current.must_change_password) return 'permanent_password_required'
    return null
  }

  return {
    db,
    byEmail,
    byId,
    lockAccountPolicy: inactivity.lock,
    recordReactivation: inactivity.reactivated,
    async createVisitor({ name, email, password }) {
      email = email.trim().toLowerCase()
      if (await byEmail(email))
        return { error: 'Unable to register this email. Contact the administrator.', status: 409 }
      const id = randomUUID(),
        hash = await hashPassword(password)
      if (await byEmail(email))
        return { error: 'Unable to register this email. Contact the administrator.', status: 409 }
      return db.transaction(async () => {
      await db
        .prepare('INSERT INTO visitors(id,name,email,password_hash) VALUES(?,?,?,?)')
        .run(id, name.trim(), email, hash)
      await event(id, null, 'account_created')
      return { user: publicUser(await byId(id)) }
      })
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
      return db.transaction(async () => {
      await db
        .prepare(
          'INSERT INTO users(id,name,username,email,role,password_hash,must_change_password) VALUES(?,?,?,?,?,?,?)',
        )
        .run(id, name, id, email.trim().toLowerCase(), role, hash, Number(mustChangePassword))
      await event(id, null, 'account_created')
      return publicUser(await db.prepare('SELECT * FROM users WHERE id=?').get(id))
      })
    },
    async login(email, password, ip, requirements = {}) {
      const report = (reason, stage) => {
        if (!/^[a-f0-9]{12}$/.test(requirements.reference ?? '')) return
        diagnostic({event:'password_verification', reference:requirements.reference,
          processId:process.pid, stage, reason})
      }

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
            .get(ip, now() - 15 * 60 * 1000)
        ).count
        if (count >= settings.login_limit) {
          await event(null, ip, 'throttled')
          return true
        }
        await event(null, ip, 'login_attempt')
        return false
      })
      if (limited) {
        report('rate_limited', 'verification')
        return { error: LOGIN_ERROR, status: 429 }
      }
      const user = await byEmail(email.trim().toLowerCase())
      const valid = await verify(password, user?.password_hash ?? dummy)
      // Reload after async verification: an admin may have disabled this account meanwhile.
      const current = user && (await byId(user.id))
      const denial = !current ? 'account_missing' : !valid ? 'password_mismatch'
        : await accountDenial(current, user.password_hash, requirements)
      report(denial ?? 'eligible', 'verification')
      if (denial) {
        await event(user?.id ?? null, ip, !valid ? 'invalid_credentials' : 'account_blocked')
        return { error: LOGIN_ERROR, status: 401 }
      }
      return db.transaction(async () => {
        await inactivity.lock()
        const table = current.role === 'Visitor' ? 'visitors' : 'users'
        const locked = await db
          .prepare(`SELECT * FROM ${table} WHERE id=? FOR UPDATE`)
          .get(current.id)
        const lockedDenial = await accountDenial(locked, user.password_hash, requirements)
        if (lockedDenial) {
          report(lockedDenial, 'locked_recheck')
          return { error: LOGIN_ERROR, status: 401 }
        }
        const token = randomBytes(32).toString('hex')
        await db
          .prepare(`INSERT INTO ${sessionTable(locked)} VALUES(?,?,?)`)
          .run(
            digest(token),
            locked.id,
            now() +
              (await db.prepare('SELECT session_hours FROM security_settings WHERE id=1').get())
                .session_hours *
                60 *
                60 *
                1000,
          )
        await db
          .prepare(`UPDATE ${table} SET last_login=? WHERE id=?`)
          .run(new Date(now()).toISOString(), locked.id)
        await event(locked.id, ip, 'authenticated')
        report('authenticated', 'session_created')
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
        .get(digest(token), now(), 'Active')
      const visitor = user
        ? null
        : await db
            .prepare(
              "SELECT v.* FROM visitor_sessions s JOIN visitors v ON v.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND v.status='Active'",
            )
            .get(digest(token), now())
      const checked = await inactivity.apply(user ?? visitor)
      if (!checked || checked.status !== 'Active') return null
      if(await temporaryExpired(user))return null
      return publicUser(checked)
    },
    async setStatus(id, status, actor, ip) {
      if (!['Active', 'Inactive', 'Suspended'].includes(status)) throw Error('Invalid status')
      return db.transaction(async () => {
        await inactivity.lock()
        const existing = await byId(id)
        if (!existing) return false
        const table = existing.role === 'Visitor' ? 'visitors' : 'users'
        const locked = await db.prepare(`SELECT * FROM ${table} WHERE id=? FOR UPDATE`).get(id)
        if (
          await db
            .prepare("SELECT 1 FROM auth_events WHERE user_id=? AND reason='account_archived'")
            .get(id)
        )
          return false
        const result = await db.prepare(`UPDATE ${table} SET status=? WHERE id=?`).run(status, id)
        if (result.changes) await inactivity.reactivated(id, locked.status, status, actor, ip)
        if (result.changes && locked.status !== status) await event(id, ip, `status_${status}`, actor)
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
