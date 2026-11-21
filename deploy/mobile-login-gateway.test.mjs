import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createMobileLoginGateway, gatewayRoute } from './mobile-login-gateway.mjs'

test('mobile translation requests route to the plant API; mobile authentication stays on auth API', async () => {
  assert.deepEqual(gatewayRoute('/api/mobile/translations'), {
    port: 3000,
    path: '/api/mobile/translations',
  })
  assert.deepEqual(gatewayRoute('/api/mobile/password'), {
    port: 3001,
    path: '/api/mobile/password',
  })

  const makeUpstream = (service) => createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ service, path: req.url }))
  })
  const auth = makeUpstream('auth')
  const plant = makeUpstream('plant')
  await Promise.all([
    new Promise((resolve) => auth.listen(0, '127.0.0.1', resolve)),
    new Promise((resolve) => plant.listen(0, '127.0.0.1', resolve)),
  ])
  const gateway = createMobileLoginGateway({
    authPort: auth.address().port,
    plantPort: plant.address().port,
  }, { trace: false })
  await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve))

  try {
    const base = `http://127.0.0.1:${gateway.address().port}`
    const translation = await fetch(`${base}/api/mobile/translations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale: 'zh', entries: [] }),
    })
    assert.deepEqual(await translation.json(), {
      service: 'plant',
      path: '/api/mobile/translations',
    })

    const login = await fetch(`${base}/api/mobile/password`)
    assert.deepEqual(await login.json(), {
      service: 'auth',
      path: '/api/mobile/password',
    })
  } finally {
    await Promise.all([
      new Promise((resolve) => gateway.close(resolve)),
      new Promise((resolve) => auth.close(resolve)),
      new Promise((resolve) => plant.close(resolve)),
    ])
  }
})
