// Loopback-only, explicitly enabled service-to-service authentication.
// Browser endpoints retain their cookie and Origin protections.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { digest, LOGIN_ERROR } from './auth.mjs'

export function createFaceServiceHandler({ auth, recovery, key, now = () => Date.now() }) {
  if (key && key.length < 32) throw Error('Face service key must contain at least 32 bytes')
  return async function handle(req, res) {
    const send = (status, value) => { res.writeHead(status); res.end(JSON.stringify(value)) }
    if (!key) return send(404, { error: 'Face account integration is not configured.' })
    if (req.method !== 'POST' || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return send(403, { error: 'Request rejected.' })
    if (req.headers['content-type'] !== 'application/json') return send(415, { error: 'JSON required.' })
    let raw = ''
    for await (const chunk of req) {
      raw += chunk
      if (Buffer.byteLength(raw) > 8192) return send(413, { error: 'Request too large.' })
    }
    const timestamp = req.headers['x-face-timestamp'] ?? ''
    const nonce = req.headers['x-face-nonce'] ?? ''
    const signature = req.headers['x-face-signature'] ?? ''
    if (!/^\d{10}$/.test(timestamp) || !/^[a-f0-9]{32}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(signature) || Math.abs(now()/1000-Number(timestamp)) > 30) return send(403, { error: 'Request rejected.' })
    const expected = createHmac('sha256', key).update(`${timestamp}\n${nonce}\n${req.url}\n${raw}`).digest()
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) return send(403, { error: 'Request rejected.' })
    auth.db.prepare('DELETE FROM face_service_nonces WHERE expires_at<?').run(now())
    if (!auth.db.prepare('INSERT OR IGNORE INTO face_service_nonces VALUES(?,?)').run(nonce, now()+60000).changes) return send(403, { error: 'Request rejected.' })
    let body
    try { body = JSON.parse(raw) } catch { return send(400, { error: 'Invalid request.' }) }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return send(400, { error: 'Invalid request.' })
    if (req.url === '/internal/face/health') return send(200, {accountService:'niah-web-auth'})
    const ip = req.socket.remoteAddress
    if (req.url === '/internal/face/recovery-request' || req.url === '/internal/face/recovery-confirm') {
      if(!recovery)return send(503,{error:'Password recovery is not configured.'})
      const {status,...result}=req.url.endsWith('request')?await recovery.request(body.email,ip):await recovery.confirm(body,ip)
      return send(status,result)
    }
    if (req.url === '/internal/face/register') {
      if(typeof body.name!=='string'||!body.name.trim()||body.name.length>100||typeof body.email!=='string'||body.email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)||typeof body.password!=='string'||body.password.length<15||body.password.length>128) return send(400,{error:'Use a valid name/email and a password with 15 to 128 characters.'})
      const result=await auth.createVisitor(body)
      return send(result.error?result.status:201,result.error?{error:result.error}:result)
    }
    if (req.url === '/internal/face/password') {
      if (typeof body.email !== 'string' || body.email.length > 254 || typeof body.password !== 'string' || body.password.length > 1024) return send(401, { error: LOGIN_ERROR })
      const result = await auth.login(body.email, body.password, ip, {roles:['Botanist','Visitor'],requirePermanent:true,reference:/^[a-f0-9]{12}$/.test(req.headers['x-face-request-id']??'')?req.headers['x-face-request-id']:undefined})
      return send(result.error ? result.status : 200, result.error ? {error:result.error} : result)
    }
    if (req.url === '/internal/face/issue') {
      if (typeof body.userId !== 'string' || body.userId.length > 100) return send(401, {error:LOGIN_ERROR})
      const result = auth.issueFaceSession(body.userId, ip)
      return send(result.error ? result.status : 200, result.error ? {error:result.error} : result)
    }
    if (typeof body.token !== 'string' || !/^[a-f0-9]{64}$/.test(body.token)) return send(401, {error:LOGIN_ERROR})
    if (req.url === '/internal/face/logout') {
      auth.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(body.token))
      auth.db.prepare('DELETE FROM visitor_sessions WHERE token_hash=?').run(digest(body.token))
      return send(200, {})
    }
    if (req.url === '/internal/face/revoke') {
      const user = auth.session(body.token)
      if (!user || !['Botanist','Visitor'].includes(user.role) || user.mustChangePassword) return send(401, {error:LOGIN_ERROR})
      auth.db.prepare(`DELETE FROM ${user.role==='Visitor'?'visitor_sessions':'sessions'} WHERE user_id=?`).run(user.id)
      return send(200, {})
    }
    if (req.url === '/internal/face/me') {
      const user = auth.session(body.token)
      if (!user || !['Botanist','Visitor'].includes(user.role) || user.mustChangePassword) return send(401, {error:LOGIN_ERROR})
      return send(200, {user})
    }
    return send(404, {error:'Not found.'})
  }
}
