import test from 'node:test'
import assert from 'node:assert/strict'
import { createAuth, LOGIN_ERROR, digest } from './auth.mjs'
test('all roles enforce status, log denials and permanently revoke old sessions', async () => {
  const auth = await createAuth(':memory:')
  try {
    for (const role of ['Administrator', 'Conservation Officer', 'Botanist']) {
      const email = role.replaceAll(' ', '') + '@example.com'
      const user = await auth.createUser({
        name: role,
        email,
        role,
        password: 'correct password value',
        mustChangePassword: false,
      })
      const active = await auth.login(email, 'correct password value', role)
      assert.equal(auth.session(active.token).id, user.id)
      for (const status of ['Inactive', 'Suspended']) {
        auth.setStatus(user.id, status, 'admin', 'admin-ip')
        assert.equal(auth.session(active.token), null)
        const blocked = await auth.login(email, 'correct password value', role)
        assert.deepEqual(blocked, { error: LOGIN_ERROR, status: 401 })
        assert.equal((await auth.login(email, 'wrong', role)).error, LOGIN_ERROR)
        auth.setStatus(user.id, 'Active', 'admin', 'admin-ip')
        assert.equal(auth.session(active.token), null)
      }
      assert.ok((await auth.login(email, 'correct password value', role)).token)
    }
    assert.equal((await auth.login('unknown@example.com', 'wrong', 'unknown')).error, LOGIN_ERROR)
    assert.equal(
      auth.db.prepare("SELECT COUNT(*) AS n FROM auth_events WHERE reason='account_blocked'").get()
        .n,
      6,
    )
    assert.throws(() => auth.db.prepare("UPDATE users SET status='Other'").run())
    assert.throws(() => auth.db.prepare('UPDATE users SET status=NULL').run())
    assert.ok(
      auth.db.prepare('SELECT password_hash FROM users LIMIT 1').get().password_hash.includes(':'),
    )
  } finally {
    auth.db.close()
  }
})
test('password change, expiry, direct database disable and throttling', async () => {
  const auth = await createAuth(':memory:')
  try {
    const user = await auth.createUser({
      name: 'Test',
      email: 'test@example.com',
      role: 'Administrator',
      password: 'first password value',
    })
    const login = await auth.login(user.email, 'first password value', 'ip')
    await auth.changePassword(user.id, 'replacement password value')
    assert.equal(auth.session(login.token), null)
    assert.equal((await auth.login(user.email, 'first password value', 'ip')).status, 401)
    const next = await auth.login(user.email, 'replacement password value', 'ip')
    assert.equal(next.user.mustChangePassword, false)
    auth.db.prepare('UPDATE sessions SET expires_at=0 WHERE token_hash=?').run(digest(next.token))
    assert.equal(auth.session(next.token), null)
    const third = await auth.login(user.email, 'replacement password value', 'ip')
    auth.db.prepare("UPDATE users SET status='Inactive' WHERE id=?").run(user.id)
    assert.equal(auth.session(third.token), null)
    assert.equal(
      auth.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').get(user.id).n,
      0,
    )
    for (let i = 0; i < 30; i++) auth.event(null, 'limited', 'login_attempt')
    assert.equal(
      (await auth.login(user.email, 'replacement password value', 'limited')).status,
      429,
    )
  } finally {
    auth.db.close()
  }
})
