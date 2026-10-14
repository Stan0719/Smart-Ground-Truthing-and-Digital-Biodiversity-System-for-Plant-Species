import { createServer } from 'node:http'
import { mkdirSync, readFileSync } from 'node:fs'
import { recoveryConfig } from './recovery-config.mjs'
import { createRecovery, emailJsDelivery } from './recovery.mjs'
import { createFaceServiceHandler } from './face-service.mjs'
import { createAuth, digest, LOGIN_ERROR } from './auth.mjs'
import { fileURLToPath } from 'node:url'
mkdirSync(new URL('./data/', import.meta.url), { recursive: true, mode: 0o700 })
const auth = await createAuth(
  process.env.AUTH_DB ?? fileURLToPath(new URL('./data/auth.sqlite', import.meta.url)),
)
const resetConfiguration=recoveryConfig(process.env.AUTH_DB??fileURLToPath(new URL('./data/auth.sqlite',import.meta.url)))
const recovery = createRecovery({auth,deliver:emailJsDelivery(resetConfiguration.settings),key:resetConfiguration.key})
const faceHandler = createFaceServiceHandler({ auth, recovery, key: process.env.FACE_ACCOUNT_SERVICE_KEY_FILE ? readFileSync(process.env.FACE_ACCOUNT_SERVICE_KEY_FILE) : null })
const origin = process.env.APP_ORIGIN ?? 'http://localhost:5173'
const secure = process.env.NODE_ENV === 'production'
if (secure && !origin.startsWith('https://'))
  throw new Error('Production APP_ORIGIN must use HTTPS')
const allowedOrigins = new Set([origin])
// Trust only the exact development URL supplied by the Codespaces environment.
// An explicit APP_ORIGIN overrides automatic development origins.
if (!secure && !process.env.APP_ORIGIN) {
  allowedOrigins.add('http://127.0.0.1:5173')
  const name = process.env.CODESPACE_NAME
  const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN
  if (name && domain) allowedOrigins.add(`https://${name}-5173.${domain}`)
}
const cookie = (token = '') =>
  `niah_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token ? 28800 : 0}${secure ? '; Secure' : ''}`
const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  const send = (status, body) => {
    res.writeHead(status)
    res.end(JSON.stringify(body))
  }
  const path = new URL(req.url, 'http://localhost').pathname
  const ip = req.socket.remoteAddress ?? 'unknown'
  const token =
    /(?:^|;\s*)niah_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1] ?? ''
  try {
    if (path.startsWith('/internal/face/')) return await faceHandler(req, res)
    if (req.method !== 'GET' && !allowedOrigins.has(req.headers.origin)) {
      if (!secure) {
        console.warn('Rejected website origin:', JSON.stringify(req.headers.origin ?? '(missing)'))
      }
      return send(403, { error: 'Request rejected.' })
    }
    let body = {}
    if (req.method !== 'GET') {
      if (!req.headers['content-type']?.startsWith('application/json'))
        return send(415, { error: 'JSON required.' })
      let raw = ''
      for await (const chunk of req) {
        raw += chunk
        if (Buffer.byteLength(raw) > 8192) return send(413, { error: 'Request too large.' })
      }
      try {
        body = JSON.parse(raw || '{}')
      } catch {
        return send(400, { error: 'Invalid request.' })
      }
      if (!body || typeof body !== 'object' || Array.isArray(body))
        return send(400, { error: 'Invalid request.' })
    }
    if (path === '/api/auth/recovery/request' && req.method === 'POST') { const {status,...result}=await recovery.request(body.email,ip);return send(status,result) }
    if (path === '/api/auth/recovery/confirm' && req.method === 'POST') { const {status,...result}=await recovery.confirm(body,ip);return send(status,result) }
    if (path === '/api/auth/login' && req.method === 'POST') {
      if (
        typeof body.email !== 'string' ||
        body.email.length > 254 ||
        typeof body.password !== 'string' ||
        body.password.length > 1024
      )
        return send(401, { error: LOGIN_ERROR })
      const result = await auth.login(body.email, body.password, ip)
      if (result.error) return send(result.status, { error: result.error })
      // Rotate an existing browser session on login.
      auth.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token))
      auth.db.prepare('DELETE FROM visitor_sessions WHERE token_hash=?').run(digest(token))
      res.setHeader('Set-Cookie', cookie(result.token))
      return send(200, { user: result.user })
    }
    if (path === '/api/auth/logout' && req.method === 'POST') {
      auth.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token))
      auth.db.prepare('DELETE FROM visitor_sessions WHERE token_hash=?').run(digest(token))
      res.setHeader('Set-Cookie', cookie())
      return send(200, {})
    }
    const user = auth.session(token)
    if (!user) {
      res.setHeader('Set-Cookie', cookie())
      return send(401, { error: 'Please sign in again.' })
    }
    if (path === '/api/auth/me' && req.method === 'GET') return send(200, { user })
    if (path === '/api/auth/password' && req.method === 'POST') {
      if (
        typeof body.password !== 'string' ||
        body.password.length < 15 ||
        body.password.length > 128
      )
        return send(400, { error: 'Use a password with 15 to 128 characters.' })
      const updated = await auth.changePassword(user.id, body.password)
      res.setHeader('Set-Cookie', cookie())
      return send(updated ? 200 : 401, {})
    }
    if (user.mustChangePassword)
      return send(403, { error: 'Change your temporary password first.' })
    if (user.role !== 'Administrator') return send(403, { error: 'Access denied.' })
    if (path === '/api/admin/users' && req.method === 'GET') {
      const { publicUser } = await import('./auth.mjs')
      return send(200, {
        users: auth.db.prepare('SELECT * FROM users ORDER BY name').all().map(publicUser),
      })
    }
    if (path === '/api/admin/users' && req.method === 'POST') {
      if (
        typeof body.name !== 'string' ||
        !body.name.trim() ||
        body.name.length > 100 ||
        typeof body.email !== 'string' ||
        body.email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) ||
        !['Conservation Officer', 'Botanist'].includes(body.role)
      )
        return send(400, { error: 'Enter a valid name, email and role.' })
      const { randomBytes } = await import('node:crypto')
      const password = randomBytes(18).toString('base64url')
      const created = await auth.createUser({
        ...body,
        name: body.name.trim(),
        password,
        mustChangePassword: true,
      })
      auth.event(created.id, ip, 'account_created', user.id)
      return send(201, { user: { ...created, password } })
    }
    const accountMatch = /^\/api\/admin\/users\/([^/]+)$/.exec(path)
    if (accountMatch && ['PATCH', 'DELETE'].includes(req.method)) {
      const id = accountMatch[1]
      const target = auth.db.prepare('SELECT * FROM users WHERE id=?').get(id)
      if (!target) return send(404, { error: 'Account not found.' })
      if (req.method === 'DELETE') {
        if (id === user.id) return send(400, { error: 'You cannot delete your own account.' })
        auth.db.exec('BEGIN IMMEDIATE')
        try {
          auth.db.prepare('DELETE FROM sessions WHERE user_id=?').run(id)
          auth.db.prepare('DELETE FROM users WHERE id=?').run(id)
          auth.event(id, ip, 'account_deleted', user.id)
          auth.db.exec('COMMIT')
        } catch (error) {
          auth.db.exec('ROLLBACK')
          throw error
        }
        return send(200, {})
      }
      if (
        typeof body.name !== 'string' ||
        !body.name.trim() ||
        body.name.length > 100 ||
        typeof body.email !== 'string' ||
        body.email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) ||
        !['Administrator', 'Conservation Officer', 'Botanist'].includes(body.role) ||
        !['Active', 'Inactive', 'Suspended'].includes(body.status)
      ) {
        return send(400, { error: 'Enter a valid name, email, role and status.' })
      }
      if (id === user.id && (body.role !== target.role || body.status !== target.status))
        return send(400, { error: 'You cannot change your own role or status.' })
      auth.db.exec('BEGIN IMMEDIATE')
      try {
        auth.db
          .prepare('UPDATE users SET name=?,email=?,role=?,status=? WHERE id=?')
          .run(body.name.trim(), body.email.trim().toLowerCase(), body.role, body.status, id)
        // Permissions and identity changes also require a new login.
        if (target.role !== body.role || target.email !== body.email.trim().toLowerCase())
          auth.db.prepare('DELETE FROM sessions WHERE user_id=?').run(id)
        auth.event(id, ip, 'account_updated', user.id)
        if (target.status !== body.status) auth.event(id, ip, `status_${body.status}`, user.id)
        auth.db.exec('COMMIT')
      } catch (error) {
        auth.db.exec('ROLLBACK')
        throw error
      }
      return send(200, {})
    }
    const match = /^\/api\/admin\/users\/([^/]+)\/status$/.exec(path)
    if (match && req.method === 'PATCH') {
      if (!['Active', 'Inactive', 'Suspended'].includes(body.status))
        return send(400, { error: 'Invalid status.' })
      if (match[1] === user.id && body.status !== 'Active')
        return send(400, { error: 'Ask another administrator to disable your account.' })
      return send(auth.setStatus(match[1], body.status, user.id, ip) ? 200 : 404, {})
    }
    send(404, { error: 'Not found.' })
  } catch (error) {
    if (error.code === 'ERR_SQLITE_ERROR' && error.message.includes('UNIQUE'))
      return send(409, { error: 'An account with this email already exists.' })
    console.error('API request failed:', error.code ?? error.name)
    send(500, { error: 'Service unavailable. Please try again.' })
  }
})
server.requestTimeout = 15000
server.listen(Number(process.env.PORT ?? 3001), process.env.HOST ?? '127.0.0.1', () => {
  console.log('Authentication API running on port ' + server.address().port)
  if (!secure) console.log('Allowed website addresses:', [...allowedOrigins].join(', '))
})
