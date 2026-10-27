import { createTestAuth } from './test-postgres.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createAuth, LOGIN_ERROR, digest } from './auth.mjs'
test('all roles enforce status, log denials and permanently revoke old sessions', async () => {
  const auth = await createTestAuth()
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
      assert.equal((await auth.session(active.token)).id, user.id)
      for (const status of ['Inactive', 'Suspended']) {
        await auth.setStatus(user.id, status, 'admin', 'admin-ip')
        assert.equal(await auth.session(active.token), null)
        const blocked = await auth.login(email, 'correct password value', role)
        assert.deepEqual(blocked, { error: LOGIN_ERROR, status: 401 })
        assert.equal((await auth.login(email, 'wrong', role)).error, LOGIN_ERROR)
        await auth.setStatus(user.id, 'Active', 'admin', 'admin-ip')
        assert.equal(await auth.session(active.token), null)
      }
      assert.ok((await auth.login(email, 'correct password value', role)).token)
    }
    assert.equal((await auth.login('unknown@example.com', 'wrong', 'unknown')).error, LOGIN_ERROR)
    assert.equal(
      (
        await auth.db
          .prepare("SELECT COUNT(*) AS n FROM auth_events WHERE reason='account_blocked'")
          .get()
      ).n,
      6,
    )
    await assert.rejects(async () => await auth.db.prepare("UPDATE users SET status='Other'").run())
    await assert.rejects(async () => await auth.db.prepare('UPDATE users SET status=NULL').run())
    assert.ok(
      (
        await auth.db.prepare('SELECT password_hash FROM users LIMIT 1').get()
      ).password_hash.includes(':'),
    )
  } finally {
    await auth.db.close()
  }
})
test('password change, expiry, direct database disable and throttling', async () => {
  const auth = await createTestAuth()
  try {
    const user = await auth.createUser({
      name: 'Test',
      email: 'test@example.com',
      role: 'Administrator',
      password: 'first password value',
    })
    const login = await auth.login(user.email, 'first password value', 'ip')
    await auth.changePassword(user.id, 'replacement password value')
    assert.equal(await auth.session(login.token), null)
    assert.equal((await auth.login(user.email, 'first password value', 'ip')).status, 401)
    const next = await auth.login(user.email, 'replacement password value', 'ip')
    assert.equal(next.user.mustChangePassword, false)
    await auth.db
      .prepare('UPDATE sessions SET expires_at=0 WHERE token_hash=?')
      .run(digest(next.token))
    assert.equal(await auth.session(next.token), null)
    const third = await auth.login(user.email, 'replacement password value', 'ip')
    await auth.db.prepare("UPDATE users SET status='Inactive' WHERE id=?").run(user.id)
    assert.equal(await auth.session(third.token), null)
    assert.equal(
      (await auth.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').get(user.id)).n,
      0,
    )
    for (let i = 0; i < 30; i++) await auth.event(null, 'limited', 'login_attempt')
    assert.equal(
      (await auth.login(user.email, 'replacement password value', 'limited')).status,
      429,
    )
  } finally {
    await auth.db.close()
  }
})

test('explicit email administrator bootstrap preserves existing users and never returns credentials',async()=>{
 const {createEmailAdministrator}=await import('./create-admin.mjs')
 const auth=await createTestAuth()
 try{
  const botanist=await auth.createUser({name:'Existing fixture',email:'existing@example.invalid',role:'Botanist',password:'existing-fixture-password',mustChangePassword:false})
  const before=await auth.byId(botanist.id)
  let delivered,attempts=0
  const result=await createEmailAdministrator({auth,email:'owner@example.invalid',name:'Project Administrator',origin:'http://localhost:5173',deliver:async value=>{attempts++;delivered=value}})
  assert.equal(result.delivery,'sent');assert.equal(attempts,1)
  assert.equal(result.user.role,'Administrator');assert.equal(result.user.mustChangePassword,true)
  assert.equal(JSON.stringify(result).includes(delivered.temporaryPassword),false)
  assert.equal((await auth.login('owner@example.invalid',delivered.temporaryPassword,'fixture')).user.mustChangePassword,true)
  assert.deepEqual(await auth.byId(botanist.id),before)
  await assert.rejects(createEmailAdministrator({auth,email:'another@example.invalid',name:'Other',origin:'http://localhost:5173',deliver:async()=>{attempts++}}),/already exists/)
  assert.equal(attempts,1)
 }finally{await auth.db.close()}
})
