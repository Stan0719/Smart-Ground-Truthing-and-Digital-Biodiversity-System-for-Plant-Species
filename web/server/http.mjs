import { createServer } from 'node:http'
import { createFaceServiceHandler } from './face-service.mjs'
import { digest, LOGIN_ERROR } from './auth.mjs'
import { adminRequest } from './operations.mjs'
export function createAuthServer({ auth, recovery, staff, key = null, env = process.env }) {
  const faceHandler = createFaceServiceHandler({ auth, recovery, key })
  const origin = env.APP_ORIGIN ?? 'http://localhost:5173'
  const secure = env.NODE_ENV === 'production'
  if (secure && !origin.startsWith('https://'))
    throw new Error('Production APP_ORIGIN must use HTTPS')
  const allowedOrigins = new Set([origin])
  // Trust only the exact development URL supplied by the Codespaces environment.
  // An explicit APP_ORIGIN overrides automatic development origins.
  if (!secure && !env.APP_ORIGIN) {
    allowedOrigins.add('http://127.0.0.1:5173')
    const name = env.CODESPACE_NAME
    const domain = env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN
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
      if(path==='/health'&&req.method==='GET')return send(200,{service:'Niah Authentication API',ready:true,accountAdapter:Boolean(key)})
      if (path.startsWith('/internal/face/')) return await faceHandler(req, res)
      if (req.method !== 'GET' && !(path.startsWith('/api/mobile/')&&!req.headers.origin&&!req.headers.cookie) && !allowedOrigins.has(req.headers.origin)) {
        if (!secure) {
          console.warn(
            'Rejected website origin:',
            JSON.stringify(req.headers.origin ?? '(missing)'),
          )
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
      if(path.startsWith('/api/mobile/')){
        const mobileUser=user=>({...user,role:user.role==='Botanist'?'botanist':user.role==='Visitor'?'visitor':user.role==='Conservation Officer'?'conservation-officer':user.role})
        const mobileToken=/^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization||'')?.[1]
        if(path==='/api/mobile/password'&&req.method==='POST'){
          if(typeof body.email!=='string'||body.email.length>254||typeof body.password!=='string'||body.password.length>1024)return send(401,{error:LOGIN_ERROR})
          const result=await auth.login(body.email,body.password,ip,{roles:['Botanist','Visitor','Conservation Officer'],requirePermanent:true})
          return result.error?send(result.status,{error:result.error}):send(200,{token:result.token,user:mobileUser(result.user)})
        }
        if(path==='/api/mobile/recovery/request'&&req.method==='POST'&&recovery){const {status,...result}=await recovery.request(body.email,ip);return send(status,result)}
        if(path==='/api/mobile/recovery/confirm'&&req.method==='POST'&&recovery){const {status,...result}=await recovery.confirm(body,ip);return send(status,result)}
        const mobile=mobileToken&&await auth.session(mobileToken)
        if(!mobile||mobile.mustChangePassword||!['Botanist','Visitor','Conservation Officer'].includes(mobile.role))return send(401,{error:LOGIN_ERROR})
        if(path==='/api/mobile/me'&&['GET','POST'].includes(req.method))return send(200,{user:mobileUser(mobile)})
        if(path==='/api/mobile/logout'&&req.method==='POST'){await auth.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(mobileToken));await auth.db.prepare('DELETE FROM visitor_sessions WHERE token_hash=?').run(digest(mobileToken));return send(200,{})}
        return send(404,{error:'Not found.'})
      }
      if (path === '/api/auth/recovery/request' && req.method === 'POST') {
        const { status, ...result } = await recovery.request(body.email, ip)
        return send(status, result)
      }
      if (path === '/api/auth/recovery/confirm' && req.method === 'POST') {
        const { status, ...result } = await recovery.confirm(body, ip)
        return send(status, result)
      }
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
        await auth.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token))
        await auth.db.prepare('DELETE FROM visitor_sessions WHERE token_hash=?').run(digest(token))
        res.setHeader('Set-Cookie', cookie(result.token))
        return send(200, { user: result.user })
      }
      if (path === '/api/auth/logout' && req.method === 'POST') {
        await auth.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token))
        await auth.db.prepare('DELETE FROM visitor_sessions WHERE token_hash=?').run(digest(token))
        res.setHeader('Set-Cookie', cookie())
        return send(200, {})
      }
      const user = await auth.session(token)
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
      if (path.startsWith('/api/admin/')) {
        const { status, ...result } = await adminRequest({
          auth,
          activation: staff,
          recovery,
          path,
          method: req.method,
          body,
          user,
          ip,
        })
        return send(status, result)
      }
      send(404, { error: 'Not found.' })
    } catch (error) {
      if (error.status === 404) return send(404, { error: 'Account not found.' })
      if (error.code === '23505')
        return send(409, { error: 'An account with this email already exists.' })
      console.error('API request failed:', error.code ?? error.name)
      send(500, { error: 'Service unavailable. Please try again.' })
    }
  })

  server.requestTimeout = 15000
  return server
}
