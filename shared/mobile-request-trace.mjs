import { randomBytes } from 'node:crypto'
const paths = new Set(['/api/mobile/password', '/api/mobile/change-password', '/api/mobile/health'])
// Fixed routes and allowlisted metadata only: never inspect query, headers or bodies.
export function traceMobileRequest(req, res, { component, enabled, emit }) {
  const path = String(req.url || '').split('?')[0]
  if (!paths.has(path)) return
  const supplied = req.headers['x-face-request-id']
  const reference = typeof supplied === 'string' && /^[a-f0-9]{12}$/.test(supplied)
    ? supplied : randomBytes(6).toString('hex')
  req.headers['x-face-request-id'] = reference
  res.setHeader('X-Request-ID', reference)
  if (!enabled) return
  const start = Date.now()
  const method = ['GET', 'POST', 'OPTIONS'].includes(req.method) ? req.method : 'OTHER'
  const record = (phase, status) => {
    try { emit({ event: 'mobile_transport', component, reference, path, method, phase,
      durationMs: Date.now() - start, ...(status ? { status } : {}) }) } catch { /* Observability must not change requests. */ }
  }
  record('received')
  res.once('finish', () => record('completed', res.statusCode))
  res.once('close', () => { if (!res.writableFinished) record('disconnected') })
}
