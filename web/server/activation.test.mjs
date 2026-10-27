import { createTestAuth } from './test-postgres.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createAuth } from './auth.mjs'
import { createActivation } from './activation.mjs'
import { adminRequest } from './operations.mjs'
const body = {
  name: 'Invited Botanist',
  username: 'new.botanist',
  email: 'new@example.invalid',
  role: 'Botanist',
}
test('administrator provisions temporary password; first change is mandatory before RBAC access', async () => {
  const { permitted } = await import('../../shared/rbac.cjs')
  const auth = await createTestAuth()
  let sent
  try {
    const service = createActivation({
      auth,
      origin: 'https://site.example.invalid',
      deliver: async (value) => {
        sent = value
      },
    })
    const created = await service.invite(body, 'admin', 'test')
    assert.equal(created.status, 201)
    assert.equal(created.user.status, 'Active')
    assert.equal(created.user.mustChangePassword, true)
    assert.ok(sent.temporaryPassword.length >= 20)
    assert.equal(sent.loginUrl, 'https://site.example.invalid/')
    assert.notEqual((await auth.byId(created.user.id)).password_hash, sent.temporaryPassword)
    assert.equal(JSON.stringify(created).includes(sent.temporaryPassword), false)
    assert.equal(
      JSON.stringify(await auth.db.prepare('SELECT * FROM auth_events').all()).includes(
        sent.temporaryPassword,
      ),
      false,
    )
    const initial = await auth.login(body.email, sent.temporaryPassword, 'initial')
    assert.ok(initial.token)
    assert.equal(permitted(initial.user, 'plants.create'), false)
    assert.equal(
      (
        await auth.login(body.email, sent.temporaryPassword, 'mobile', {
          roles: ['Botanist'],
          requirePermanent: true,
        })
      ).status,
      401,
    )
    assert.equal(await auth.changePassword(created.user.id, sent.temporaryPassword), false)
    assert.equal((await auth.byId(created.user.id)).must_change_password, 1)
    assert.equal(await auth.resetPassword(created.user.id, 'bypass-password-value'), false)
    assert.equal(await auth.changePassword(created.user.id, 'chosen-new-password'), true)
    assert.equal(await auth.session(initial.token), null)
    assert.equal((await auth.login(body.email, sent.temporaryPassword, 'old')).status, 401)
    const permanent = await auth.login(body.email, 'chosen-new-password', 'new')
    assert.equal(permanent.user.mustChangePassword, false)
    assert.equal(permitted(permanent.user, 'plants.create'), true)
    assert.equal((await auth.db.prepare('SELECT COUNT(*) AS n FROM activation_tokens WHERE used=0').get()).n, 0)
    assert.equal((await service.confirm({ password: 'without-temporary-password' })).status, 410)
  } finally {
    await auth.db.close()
  }
})
test('missing delivery creates nothing; failed delivery keeps first-change restrictions and permits retry', async () => {
  const auth = await createTestAuth()
  try {
    assert.equal(
      (
        await createActivation({ auth, origin: 'https://example.invalid', deliver: null }).invite(
          body,
          'admin',
          'test',
        )
      ).status,
      503,
    )
    assert.equal(await auth.byEmail(body.email), undefined)
    const failed = createActivation({
      auth,
      origin: 'https://example.invalid',
      deliver: async () => {
        throw Error('provider error')
      },
    })
    const result = await failed.invite(body, 'admin', 'test')
    assert.equal(result.delivery, 'failed')
    assert.equal(result.user.mustChangePassword, true)
    assert.equal(
      (await failed.invite(await auth.byId(result.user.id), 'admin', 'test', result.user.id))
        .status,
      202,
    )
    assert.equal((await auth.db.prepare('SELECT COUNT(*) AS n FROM activation_tokens WHERE used=0').get()).n, 1)
  } finally {
    await auth.db.close()
  }
})
test('resend rotates temporary password and sessions but cannot reset completed or blocked staff', async () => {
  const auth = await createTestAuth()
  let sent
  try {
    const service = createActivation({
      auth,
      origin: 'https://example.invalid',
      deliver: async (value) => {
        sent = value
      },
    })
    const created = await service.invite(body, 'admin', 'test')
    const old = sent.temporaryPassword
    const session = await auth.login(body.email, old, 'old-session')
    assert.equal((await service.invite(body, 'admin', 'test', created.user.id)).status, 201)
    assert.notEqual(old, sent.temporaryPassword)
    assert.equal(await auth.session(session.token), null)
    assert.equal((await auth.login(body.email, old, 'old-password')).status, 401)
    assert.ok((await auth.login(body.email, sent.temporaryPassword, 'replacement')).token)
    await auth.changePassword(created.user.id, 'permanent-password')
    assert.equal((await service.invite(body, 'admin', 'test', created.user.id)).status, 409)
    await auth.setStatus(created.user.id, 'Suspended', 'admin', 'test')
    assert.equal((await service.invite(body, 'admin', 'test', created.user.id)).status, 409)
  } finally {
    await auth.db.close()
  }
})
test('legacy pending account is preserved until administrator issues its temporary password', async () => {
  const { digest } = await import('./auth.mjs')
  const auth = await createTestAuth()
  let sent
  try {
    await auth.db
      .prepare(
        "INSERT INTO users(id,name,username,email,role,status,password_hash,must_change_password) VALUES('legacy',?,?,?,?, 'Pending Activation',NULL,0)",
      )
      .run(body.name, body.username, body.email, body.role)
    await auth.db
      .prepare('INSERT INTO activation_tokens VALUES(?,?,?,0)')
      .run(digest('old-link'), 'legacy', Date.now() + 10000)
    const service = createActivation({
      auth,
      origin: 'https://example.invalid',
      deliver: async (value) => {
        sent = value
      },
    })
    assert.equal(
      (await service.confirm({ token: 'old-link', password: 'bypass-password' })).status,
      410,
    )
    assert.equal((await auth.byId('legacy')).status, 'Pending Activation')
    const result = await service.invite(await auth.byId('legacy'), 'admin', 'test', 'legacy')
    assert.equal(result.user.id, 'legacy')
    assert.equal(result.user.mustChangePassword, true)
    assert.equal((await auth.db.prepare('SELECT used FROM activation_tokens').get()).used, 1)
    assert.ok((await auth.login(body.email, sent.temporaryPassword, 'legacy')).token)
  } finally {
    await auth.db.close()
  }
})
test('Visitor administration uses Visitor table without permitting staff promotion', async () => {
  const auth = await createTestAuth()
  try {
    const created = await auth.createVisitor({
        name: 'Visitor',
        email: 'visitor@example.invalid',
        password: 'visitor-test-password',
      }),
      login = await auth.login('visitor@example.invalid', 'visitor-test-password', 'test')
    const base = {
      auth,
      user: { id: 'admin' },
      ip: 'test',
      activation: null,
      path: `/api/admin/users/${created.user.id}`,
      method: 'PATCH',
    }
    assert.equal(
      (
        await adminRequest({
          ...base,
          body: {
            name: 'Visitor',
            email: 'visitor@example.invalid',
            role: 'Administrator',
            status: 'Active',
          },
        })
      ).status,
      400,
    )
    assert.equal(
      (
        await adminRequest({
          ...base,
          body: {
            name: 'Visitor',
            email: 'visitor@example.invalid',
            role: 'Visitor',
            status: 'Suspended',
          },
        })
      ).status,
      200,
    )
    assert.equal(await auth.session(login.token), null)
  } finally {
    await auth.db.close()
  }
})
test('activation diagnostic rejects missing/placeholders and never reveals configured values', async () => {
  const { activationConfiguration } = await import('./activation-configuration.mjs')
  const result = activationConfiguration({
    EMAILJS_SERVICE_ID: 'private-service',
    EMAILJS_PUBLIC_KEY: 'private-public',
    EMAILJS_TEMPLATE_ID: 'YOUR_TEMPLATE',
  })
  assert.equal(result.ready, false)
  assert.deepEqual(result.invalid, ['EMAILJS_TEMPLATE_ID'])
  assert.equal(JSON.stringify(result).includes('private-'), false)
  assert.deepEqual(activationConfiguration({}).missing, [
    'EMAILJS_SERVICE_ID',
    'EMAILJS_PUBLIC_KEY',
    'EMAILJS_TEMPLATE_ID',
  ])
})
test('invitation abuse limit rejects delivery before rotating tokens or creating accounts', async () => {
  const auth = await createTestAuth()
  let sends = 0
  try {
    const service = createActivation({
      auth,
      origin: 'https://example.invalid',
      deliver: async () => {
        sends++
      },
    })
    const created = await service.invite(body, 'admin', 'test')
    assert.equal(created.status, 201)
    for (let i = 0; i < 19; i++)
      await auth.event(created.user.id, 'test', 'invitation_created', 'admin')
    const before = (await auth.db.prepare('SELECT COUNT(*) AS n FROM activation_tokens').get()).n
    assert.equal((await service.invite(body, 'admin', 'test', created.user.id)).status, 429)
    assert.equal(sends, 1)
    assert.equal(
      (await auth.db.prepare('SELECT COUNT(*) AS n FROM activation_tokens').get()).n,
      before,
    )
  } finally {
    await auth.db.close()
  }
})
test('startup and diagnostics share public fallback without reusing OTP or overriding server settings', async () => {
  const { emailSettings } = await import('./activation-configuration.mjs')
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const folder = mkdtempSync(join(tmpdir(), 'niah-email-config-'))
  try {
    const file = join(folder, 'mobile.env')
    writeFileSync(
      file,
      'EXPO_PUBLIC_EMAILJS_SERVICE_ID=fallback-service\nEXPO_PUBLIC_EMAILJS_PUBLIC_KEY=fallback-public\nEXPO_PUBLIC_EMAILJS_OTP_TEMPLATE_ID=otp-only\nEXPO_PUBLIC_EMAILJS_PRIVATE_KEY=must-not-copy\n',
    )
    const effective = emailSettings(
      { EMAILJS_SERVICE_ID: 'server-service' },
      file,
      join(folder, 'no-staff.env'),
    )
    assert.equal(effective.EMAILJS_SERVICE_ID, 'server-service')
    assert.equal(effective.EMAILJS_PUBLIC_KEY, 'fallback-public')
    assert.equal(effective.EMAILJS_TEMPLATE_ID, undefined)
    assert.equal(effective.EMAILJS_PRIVATE_KEY, undefined)
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
})
test('EmailJS errors expose only safe actionable categories, never provider text or secrets', async () => {
  const { temporaryPasswordDelivery } = await import('./activation.mjs')
  const env = {
    EMAILJS_SERVICE_ID: 'service_test',
    EMAILJS_TEMPLATE_ID: 'template_test',
    EMAILJS_PUBLIC_KEY: 'public_test',
  }
  for (const [status, text, expected] of [
    [403, 'API requests are disabled for non-browser applications', 'server_disabled'],
    [401, 'private secret provider text', 'unauthorized'],
    [412, 'mail provider error', 'mail_service'],
    [429, 'quota', 'limit'],
    [400, 'bad template', 'configuration'],
    [503, 'unavailable', 'provider'],
  ]) {
    const deliver = temporaryPasswordDelivery(env, async () => new Response(text, { status }))
    await assert.rejects(
      () =>
        deliver({
          email: 'nobody@example.invalid',
          name: 'Test',
          role: 'Botanist',
          temporaryPassword: 'do-not-log',
          loginUrl: 'https://example.invalid',
        }),
      (error) =>
        error.deliveryCode === expected &&
        !error.message.includes(text) &&
        !error.message.includes('do-not-log'),
    )
  }
  const auth = await createTestAuth()
  try {
    const deliver = temporaryPasswordDelivery(
      env,
      async () =>
        new Response('API requests are disabled for non-browser applications', { status: 403 }),
    )
    const result = await createActivation({
      auth,
      deliver,
      origin: 'https://example.invalid',
    }).invite(body, 'admin', 'test')
    assert.equal(result.delivery, 'failed')
    assert.match(result.message, /Enable non-browser API requests/)
    assert.ok(
      await auth.db
        .prepare("SELECT 1 FROM auth_events WHERE reason='staff_email_failure_server_disabled'")
        .get(),
    )
  } finally {
    await auth.db.close()
  }
})
