import { createTestAuth } from './test-postgres.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createAuth } from './auth.mjs'
import { createRecovery } from './recovery.mjs'
test('Visitor registration persists hashed credentials, authenticates and revokes correctly', async () => {
  const auth = await createTestAuth()
  try {
    const created = await auth.createVisitor({
      name: 'Visitor',
      email: 'visitor@example.invalid',
      password: 'original-test-password',
    })
    assert.equal(created.user.role, 'Visitor')
    assert.equal(created.user.status, 'Active')
    assert.notEqual(
      (await auth.byEmail(created.user.email)).password_hash,
      'original-test-password',
    )
    const session = await auth.login(created.user.email, 'original-test-password', 'test', {
      roles: ['Botanist', 'Visitor'],
      requirePermanent: true,
    })
    assert.equal((await auth.session(session.token)).id, created.user.id)
    assert.equal((await auth.login(created.user.email, 'wrong', 'test')).status, 401)
    assert.equal(
      (
        await auth.createVisitor({
          name: 'Copy',
          email: created.user.email,
          password: 'another-test-password',
        })
      ).status,
      409,
    )
    await auth.db.prepare("UPDATE visitors SET status='Suspended'").run()
    assert.equal(await auth.session(session.token), null)
  } finally {
    await auth.db.close()
  }
})
test('server recovery expiry, attempts, single use, password update and session revocation', async () => {
  const auth = await createTestAuth()
  let now = Date.now(),
    delivered
  const recovery = createRecovery({
    auth,
    key: randomBytes(32),
    now: () => now,
    deliver: async (_email, _name, code) => {
      delivered = code
    },
  })
  try {
    await auth.createVisitor({
      name: 'Visitor',
      email: 'visitor@example.invalid',
      password: 'original-test-password',
    })
    const session = await auth.login('visitor@example.invalid', 'original-test-password', 'test')
    const request = await recovery.request('visitor@example.invalid', 'request-ip')
    assert.equal(request.status, 202)
    assert.equal('code' in request, false)
    assert.equal(
      (
        await recovery.confirm(
          {
            recoveryId: request.recoveryId,
            code: 'not-code',
            password: 'replacement-test-password',
          },
          'test',
        )
      ).status,
      400,
    )
    assert.equal(
      (
        await recovery.confirm(
          {
            recoveryId: request.recoveryId,
            code: delivered,
            password: 'replacement-test-password',
          },
          'test',
        )
      ).reset,
      true,
    )
    assert.equal(await auth.session(session.token), null)
    assert.equal(
      (await auth.login('visitor@example.invalid', 'original-test-password', 'test')).status,
      401,
    )
    assert.ok(
      (await auth.login('visitor@example.invalid', 'replacement-test-password', 'test')).token,
    )
    assert.equal(
      (
        await recovery.confirm(
          { recoveryId: request.recoveryId, code: delivered, password: 'replayed-test-password' },
          'test',
        )
      ).status,
      401,
    )
    const next = await recovery.request('visitor@example.invalid', 'request-ip')
    now += 300001
    assert.equal(
      (
        await recovery.confirm(
          { recoveryId: next.recoveryId, code: delivered, password: 'expired-test-password' },
          'test',
        )
      ).status,
      401,
    )
    const retry = await recovery.request('visitor@example.invalid', 'request-ip')
    const wrong = delivered === '000000' ? '111111' : '000000'
    for (let i = 0; i < 5; i++)
      assert.equal(
        (
          await recovery.confirm(
            { recoveryId: retry.recoveryId, code: wrong, password: 'replacement-test-password' },
            'test',
          )
        ).status,
        401,
      )
    assert.equal(
      (
        await recovery.confirm(
          { recoveryId: retry.recoveryId, code: delivered, password: 'replacement-test-password' },
          'test',
        )
      ).status,
      401,
    )
    const unknown = await recovery.request('unknown@example.invalid', 'other-ip')
    assert.equal(unknown.status, 202)
    assert.match(unknown.recoveryId, /^[a-f0-9]{32}$/)
    const unavailable = createRecovery({ auth, key: null, deliver: null })
    assert.equal((await unavailable.request('visitor@example.invalid', 'any')).status, 503)
  } finally {
    await auth.db.close()
  }
})
test('delivery failures do not claim delivery and blocked accounts cannot reset', async () => {
  const auth = await createTestAuth()
  let delivered
  try {
    const created = await auth.createVisitor({
      name: 'Visitor',
      email: 'visitor@example.invalid',
      password: 'original-test-password',
    })
    const failed = createRecovery({
      auth,
      key: randomBytes(32),
      deliver: async () => {
        throw Error('provider secret must not leak')
      },
    })
    const request = await failed.request(created.user.email, 'failure-ip')
    assert.equal(request.status, 202)
    assert.match(request.message, /not confirmed/)
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(
      (await auth.db.prepare('SELECT used FROM password_resets WHERE id=?').get(request.recoveryId))
        .used,
      1,
    )
    const live = createRecovery({
      auth,
      key: randomBytes(32),
      deliver: async (_email, _name, code) => {
        delivered = code
      },
    })
    const pending = await live.request(created.user.email, 'new-ip')
    await auth.db.prepare("UPDATE visitors SET status='Suspended' WHERE id=?").run(created.user.id)
    assert.equal(
      (
        await live.confirm(
          {
            recoveryId: pending.recoveryId,
            code: delivered,
            password: 'replacement-test-password',
          },
          'test',
        )
      ).status,
      401,
    )
  } finally {
    await auth.db.close()
  }
})
test('signed recovery HTTP returns a distinct recovery identifier and validates real session after reset', async () => {
  const { createServer } = await import('node:http'),
    { once } = await import('node:events'),
    { createHmac } = await import('node:crypto'),
    { createFaceServiceHandler } = await import('./face-service.mjs')
  const auth = await createTestAuth(),
    key = randomBytes(32)
  let code
  await auth.createVisitor({
    name: 'HTTP Visitor',
    email: 'http@example.invalid',
    password: 'original-test-password',
  })
  const recovery = createRecovery({
    auth,
    key,
    deliver: async (_email, _name, value) => {
      code = value
    },
  })
  const server = createServer(createFaceServiceHandler({ auth, key, recovery }))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const call = async (operation, body) => {
    const path = '/internal/face/' + operation,
      raw = JSON.stringify(body),
      timestamp = String(Math.floor(Date.now() / 1000)),
      nonce = randomBytes(16).toString('hex')
    const signature = createHmac('sha256', key)
      .update(`${timestamp}\n${nonce}\n${path}\n${raw}`)
      .digest('hex')
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Face-Timestamp': timestamp,
        'X-Face-Nonce': nonce,
        'X-Face-Signature': signature,
      },
      body: raw,
    })
    return { status: response.status, body: await response.json() }
  }
  try {
    const requested = await call('recovery-request', { email: 'http@example.invalid' })
    assert.equal(requested.status, 202)
    assert.match(requested.body.recoveryId, /^[a-f0-9]{32}$/)
    assert.equal(
      (
        await call('recovery-confirm', {
          recoveryId: requested.body.recoveryId,
          code,
          password: 'replacement-test-password',
        })
      ).status,
      200,
    )
    const signedIn = await call('password', {
      email: 'http@example.invalid',
      password: 'replacement-test-password',
    })
    assert.equal(signedIn.status, 200)
    assert.equal(signedIn.body.user.role, 'Visitor')
    assert.equal((await call('me', { token: signedIn.body.token })).status, 200)
    await call('logout', { token: signedIn.body.token })
    assert.equal((await call('me', { token: signedIn.body.token })).status, 401)
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await auth.db.close()
  }
})

test('private environment recovery key requires no file and rejects malformed key material', async()=>{
 const {recoveryConfig}=await import('./recovery-config.mjs')
 const hex='ab'.repeat(32)
 const result=recoveryConfig('unused-nonexistent-location/auth',{AUTH_RESET_KEY:hex})
 assert.equal(result.key.length,32)
 assert.equal(result.key.toString('hex'),hex)
 assert.throws(()=>recoveryConfig('unused-nonexistent-location/auth',{AUTH_RESET_KEY:'invalid'}),/exactly 32 bytes/)
})
