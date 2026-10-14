import { randomBytes, scrypt, timingSafeEqual, createHash, randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
const derive = promisify(scrypt)
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
  const [salt, encoded] = hash.split(':')
  const key = await derive(password, salt, 64, options)
  return timingSafeEqual(key, Buffer.from(encoded, 'hex'))
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
export async function createAuth(filename) {
  const db = new DatabaseSync(filename)
  db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'))
  const dummy = await hashPassword(randomBytes(32).toString('hex'))
  const event = (userId, ip, reason, actor = null) =>
    db
      .prepare('INSERT INTO auth_events(created_at,user_id,ip,reason,actor_id) VALUES(?,?,?,?,?)')
      .run(Date.now(), userId, ip, reason, actor)
  const byEmail = email => db.prepare('SELECT * FROM users WHERE email=?').get(email) ?? db.prepare('SELECT * FROM visitors WHERE email=?').get(email)
  const byId = id => db.prepare('SELECT * FROM users WHERE id=?').get(id) ?? db.prepare('SELECT * FROM visitors WHERE id=?').get(id)
  const sessionTable = user => user.role === 'Visitor' ? 'visitor_sessions' : 'sessions'
  return {
    db, byEmail, byId,
    async createVisitor({name,email,password}) {
      email=email.trim().toLowerCase()
      if(byEmail(email)) return {error:'Unable to register this email. Contact the administrator.',status:409}
      const id=randomUUID(),hash=await hashPassword(password)
      if(byEmail(email)) return {error:'Unable to register this email. Contact the administrator.',status:409}
      db.prepare('INSERT INTO visitors(id,name,email,password_hash) VALUES(?,?,?,?)').run(id,name.trim(),email,hash)
      return {user:publicUser(byId(id))}
    },
    async resetPassword(id, password) {
      const current=byId(id)
      if(!current || current.status!=='Active') return false
      const hash=await hashPassword(password)
      const table=current.role==='Visitor'?'visitors':'users'
      db.exec('BEGIN IMMEDIATE')
      try {
        const updated=db.prepare(`UPDATE ${table} SET password_hash=?,must_change_password=0 WHERE id=? AND status='Active'`).run(hash,id)
        db.prepare(`DELETE FROM ${sessionTable(current)} WHERE user_id=?`).run(id)
        db.exec('COMMIT');return Boolean(updated.changes)
      }catch(error){db.exec('ROLLBACK');throw error}
    },
    event,
    async createUser({ name, email, role, password, mustChangePassword = true }) {
      const id = randomUUID()
      const hash = await hashPassword(password)
      db.prepare(
        'INSERT INTO users(id,name,email,role,password_hash,must_change_password) VALUES(?,?,?,?,?,?)',
      ).run(id, name, email.trim().toLowerCase(), role, hash, Number(mustChangePassword))
      return publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id))
    },
    async login(email, password, ip, requirements = {}) {
      const count = db
        .prepare(
          "SELECT COUNT(*) AS count FROM auth_events WHERE ip=? AND created_at>? AND reason LIKE 'login_%'",
        )
        .get(ip, Date.now() - 15 * 60 * 1000).count
      if (count >= 30) {
        event(null, ip, 'throttled')
        return { error: LOGIN_ERROR, status: 429 }
      }
      // Record before the expensive hash so concurrent requests also count toward the limit.
      event(null, ip, 'login_attempt')
      const user = byEmail(email.trim().toLowerCase())
      const valid = await verify(password, user?.password_hash ?? dummy)
      // Reload after async verification: an admin may have disabled this account meanwhile.
      const current = user && byId(user.id)
      if (process.env.AUTH_DEBUG==='1' && requirements.reference) console.info(JSON.stringify({event:'password_verification',reference:requirements.reference,accountFound:Boolean(current),role:current?.role,status:current?.status,mustChangePassword:Boolean(current?.must_change_password),passwordVerified:valid}))
      if (
        !valid ||
        !current ||
        current.status !== 'Active' ||
        current.password_hash !== user.password_hash ||
        (requirements.role && current.role !== requirements.role) ||
        (requirements.roles && !requirements.roles.includes(current.role)) ||
        (requirements.requirePermanent && current.must_change_password)
      ) {
        event(user?.id ?? null, ip, !valid ? 'invalid_credentials' : 'account_blocked')
        return { error: LOGIN_ERROR, status: 401 }
      }
      const token = randomBytes(32).toString('hex')
      db.prepare(`INSERT INTO ${sessionTable(current)} VALUES(?,?,?)`).run(
        digest(token),
        current.id,
        Date.now() + 8 * 60 * 60 * 1000,
      )
      db.prepare(`UPDATE ${current.role==='Visitor'?'visitors':'users'} SET last_login=? WHERE id=?`).run(
        new Date().toISOString(),
        current.id,
      )
      event(current.id, ip, 'authenticated')
      return { token, user: publicUser(current) }
    },
    issueFaceSession(userId, ip) {
      const attempts = db.prepare("SELECT COUNT(*) AS n FROM auth_events WHERE ip=? AND created_at>? AND reason='face_attempt'").get(ip, Date.now()-15*60*1000).n
      if (attempts >= 30) return {error:LOGIN_ERROR,status:429}
      event(null, ip, 'face_attempt')
      const current = byId(userId)
      if (!current || current.status !== 'Active' || !['Botanist','Visitor'].includes(current.role) || current.must_change_password) {
        event(current?.id ?? null, ip, 'face_account_blocked')
        return { error: LOGIN_ERROR, status: 401 }
      }
      const token = randomBytes(32).toString('hex')
      db.prepare(`INSERT INTO ${sessionTable(current)} VALUES(?,?,?)`).run(digest(token), current.id, Date.now() + 8 * 60 * 60 * 1000)
      db.prepare(`UPDATE ${current.role==='Visitor'?'visitors':'users'} SET last_login=? WHERE id=?`).run(new Date().toISOString(), current.id)
      event(current.id, ip, 'face_authenticated')
      return { token, user: publicUser(current) }
    },
    session(token) {
      const user = db
        .prepare(
          'SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.status=?',
        )
        .get(digest(token), Date.now(), 'Active')
      const visitor = user ? null : db.prepare("SELECT v.* FROM visitor_sessions s JOIN visitors v ON v.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND v.status='Active'").get(digest(token),Date.now())
      return user ? publicUser(user) : visitor ? publicUser(visitor) : null
    },
    setStatus(id, status, actor, ip) {
      if (!['Active', 'Inactive', 'Suspended'].includes(status)) throw new Error('Invalid status')
      // Trigger revokes all sessions in this same database statement.
      const result = db.prepare('UPDATE users SET status=? WHERE id=?').run(status, id)
      if (result.changes) event(id, ip, `status_${status}`, actor)
      return Boolean(result.changes)
    },
    async changePassword(id, password) {
      const hash = await hashPassword(password)
      db.exec('BEGIN IMMEDIATE')
      try {
        const result = db
          .prepare(
            "UPDATE users SET password_hash=?,must_change_password=0 WHERE id=? AND status='Active'",
          )
          .run(hash, id)
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(id)
        db.exec('COMMIT')
        return Boolean(result.changes)
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
  }
}
