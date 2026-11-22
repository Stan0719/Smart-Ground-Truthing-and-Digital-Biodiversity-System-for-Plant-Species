import { createTestAuth } from './test-postgres.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { adminRequest } from './operations.mjs'
test('security settings are constrained, persisted, audited and revoke sessions', async () => {
  const auth = await createTestAuth()
  try {
    const user = await auth.createUser({
      name: 'Admin',
      email: 'admin@example.invalid',
      role: 'Administrator',
      password: 'test-password-value',
      mustChangePassword: false,
    })
    const login = await auth.login(user.email, 'test-password-value', 'test')
    const args = {
      auth,
      activation: null,
      path: '/api/admin/settings',
      method: 'PATCH',
      user,
      ip: 'test',
    }
    assert.equal(
      (await adminRequest({ ...args, body: { session_hours: 0, login_limit: 30 } })).status,
      400,
    )
    assert.equal(
      (await adminRequest({ ...args, body: { session_hours: 4, login_limit: 10 } })).status,
      200,
    )
    assert.equal(await auth.session(login.token), null)
    const settings = (await adminRequest({ ...args, method: 'GET' })).settings
    assert.equal(settings.session_hours, 4)
    assert.equal(settings.login_limit, 10)
    const audit = await adminRequest({ ...args, path: '/api/admin/audit', method: 'GET' })
    assert.ok(
      audit.events.some((e) => e.reason === 'security_settings_changed' && e.actor_id === user.id),
    )
  } finally {
    await auth.db.close()
  }
})
test('delete archives staff and visitors, hides them after reload and blocks reactivation', async () => {
  const auth = await createTestAuth()
  try {
    const user = await auth.createUser({
      name: 'Admin',
      email: 'admin@example.invalid',
      role: 'Administrator',
      password: 'test-password-value',
      mustChangePassword: false,
    })
    const staff = await auth.createUser({
      name: 'Officer',
      email: 'officer@example.invalid',
      role: 'Conservation Officer',
      password: 'test-password-value',
      mustChangePassword: false,
    })
    await auth.createVisitor({
      name: 'Visitor',
      email: 'visitor@example.invalid',
      password: 'test-password-value',
    })
    const visitor = await auth.byEmail('visitor@example.invalid')
    const args = { auth, activation: null, user, ip: 'test', body: {} }
    for (const account of [staff, visitor]) {
      const login = await auth.login(account.email, 'test-password-value', 'test')
      assert.equal(
        (await adminRequest({ ...args, path: `/api/admin/users/${account.id}`, method: 'DELETE' }))
          .status,
        200,
      )
      assert.equal(await auth.session(login.token), null)
      assert.equal(await auth.byEmail(account.email), undefined)
      assert.equal((await auth.byId(account.id)).status, 'Inactive')
      assert.equal(
        (
          await adminRequest({
            ...args,
            path: `/api/admin/users/${account.id}/status`,
            method: 'PATCH',
            body: { status: 'Active' },
          })
        ).status,
        404,
      )
      assert.ok(
        await auth.db
          .prepare("SELECT 1 FROM auth_events WHERE user_id=? AND reason='account_archived'")
          .get(account.id),
      )
    }
    const list = await adminRequest({ ...args, path: '/api/admin/users', method: 'GET' })
    assert.deepEqual(
      list.users.map((u) => u.id),
      [user.id],
    )
    assert.equal(
      (await adminRequest({ ...args, path: `/api/admin/users/${user.id}`, method: 'DELETE' }))
        .status,
      400,
    )
  } finally {
    await auth.db.close()
  }
})

test('Admin account notifications follow successful changes and skip failed or unchanged operations', async () => {
  const auth = await createTestAuth()
  try {
    const admin = await auth.createUser({ name: 'Admin', email: 'admin@example.invalid', role: 'Administrator', password: 'test-password-value', mustChangePassword: false })
    const target = await auth.createUser({ name: 'Officer', email: 'officer@example.invalid', role: 'Conservation Officer', password: 'test-password-value', mustChangePassword: false })
    const events = []
    const args = { auth, user: admin, ip: 'test', adminNotifications: { accountEvent: async (event) => events.push(event) } }
    const securitySettings = { session_hours: 4, login_limit: 10 }
    assert.equal((await adminRequest({ ...args, path: '/api/admin/settings', method: 'PATCH', body: securitySettings })).status, 200)
    assert.equal(events.length, 1)
    assert.equal(events[0].action, 'security_settings_changed')
    assert.equal((await adminRequest({ ...args, path: '/api/admin/settings', method: 'PATCH', body: securitySettings })).status, 200)
    assert.equal(events.length, 1)
    assert.equal((await adminRequest({ ...args, path: `/api/admin/users/${target.id}/status`, method: 'PATCH', body: { status: 'Suspended' } })).status, 200)
    assert.equal(events.length, 2)
    assert.equal(events[1].action, 'staff_deactivated')
    assert.equal(events[1].accountName, 'Officer')
    assert.match(events[1].sourceKey, /^admin-account:status:/)
    assert.equal((await adminRequest({ ...args, path: `/api/admin/users/${target.id}/status`, method: 'PATCH', body: { status: 'Suspended' } })).status, 200)
    assert.equal(events.length, 2)
    assert.equal((await adminRequest({ ...args, path: `/api/admin/users/${target.id}/status`, method: 'PATCH', body: { status: 'Active' } })).status, 200)
    assert.equal(events.length, 3)
    assert.equal(events[2].action, 'staff_reactivated')
    assert.equal((await adminRequest({ ...args, path: `/api/admin/users/${target.id}/status`, method: 'PATCH', body: { status: 'invalid' } })).status, 400)
    assert.equal(events.length, 3)

    const unchanged = { name: 'Officer', email: 'officer@example.invalid', role: 'Conservation Officer', status: 'Active' }
    assert.equal((await adminRequest({ ...args, path: `/api/admin/users/${target.id}`, method: 'PATCH', body: unchanged })).status, 200)
    assert.equal(events.length, 3)
    assert.equal((await adminRequest({ ...args, path: `/api/admin/users/${target.id}`, method: 'PATCH', body: { ...unchanged, role: 'Botanist' } })).status, 200)
    assert.equal(events.length, 4)
    assert.equal(events[3].action, 'staff_role_changed')
    assert.deepEqual(events[3].changedFields, ['role'])

    const invitation = await adminRequest({ ...args, activation: { invite: async () => ({ status: 201, user: { id: 'new-officer', name: 'New Officer', role: 'Conservation Officer', status: 'Active' } }) }, path: '/api/admin/users', method: 'POST', body: {} })
    assert.equal(invitation.status, 201)
    assert.equal(events.length, 5)
    assert.equal(events[4].action, 'staff_created')
    assert.equal(await adminRequest({ ...args, activation: { invite: async () => ({ status: 400, error: 'invalid' }) }, path: '/api/admin/users', method: 'POST', body: {} }).then((result) => result.status), 400)
    assert.equal(events.length, 5)
  } finally { await auth.db.close() }
})
