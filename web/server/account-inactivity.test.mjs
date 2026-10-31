import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { createAuth, digest } from './auth.mjs'
import { testDatabase } from './test-postgres.mjs'
import { createAuthServer } from './http.mjs'
import { adminRequest } from './operations.mjs'
import { createStaffInvitations } from './activation.mjs'
import { INACTIVITY_MS } from './account-inactivity.mjs'

const day = 24 * 60 * 60 * 1000
async function fixture(t) {
  let clock = Date.now()
  const auth = await createAuth(await testDatabase(), { now: () => clock })
  t.after(() => auth.db.close())
  const create = (key, role = 'Conservation Officer', mustChangePassword = false) => auth.createUser({ name: key, email: `${key}@example.invalid`, password: 'Synthetic permanent password!', role, mustChangePassword })
  const age = async (user, elapsed) => {
    await auth.db.prepare('UPDATE users SET last_login=? WHERE id=?').run(new Date(clock - elapsed).toISOString(), user.id)
    await auth.db.prepare("UPDATE auth_events SET created_at=? WHERE user_id=? AND reason IN ('account_created','authenticated')").run(clock - elapsed - day, user.id)
  }
  const count = async (id, reason) => Number((await auth.db.prepare('SELECT COUNT(*) AS n FROM auth_events WHERE user_id=? AND reason=?').get(id, reason)).n)
  return { auth, create, age, count, now: () => clock, advance: duration => { clock += duration } }
}

test('UTC inactivity: one millisecond below 30 days stays Active; exact boundary suspends once', async t => {
  const f = await fixture(t), user = await f.create('boundary')
  await f.age(user, INACTIVITY_MS - 1)
  assert.equal((await f.auth.byId(user.id)).status, 'Active')
  f.advance(1)
  assert.equal((await f.auth.byId(user.id)).status, 'Suspended')
  assert.equal((await f.auth.login(user.email, 'Synthetic permanent password!', 'boundary')).status, 401)
  await Promise.all(Array.from({ length: 4 }, () => f.auth.byId(user.id)))
  assert.equal(await f.count(user.id, 'automatic_inactivity_suspension'), 1)
})

test('protected session validation suspends inactivity and permanently revokes existing sessions', async t => {
  const f = await fixture(t), user = await f.create('session')
  const login = await f.auth.login(user.email, 'Synthetic permanent password!', 'session')
  assert.ok(login.token)
  await f.age(user, 31 * day)
  await f.auth.db.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=?').run(f.now() + 90 * day, digest(login.token))
  assert.equal(await f.auth.session(login.token), null)
  assert.equal((await f.auth.byId(user.id)).status, 'Suspended')
  assert.equal(Number((await f.auth.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').get(user.id)).n), 0)
  await f.auth.setStatus(user.id, 'Active', 'synthetic-admin', 'test')
  assert.equal(await f.auth.session(login.token), null)
})

test('never-logged-in staff and Visitors use server-side creation audit timestamps', async t => {
  const f = await fixture(t), user = await f.create('never')
  const visitor = await f.auth.createVisitor({ name: 'Never Visitor', email: 'never-visitor@example.invalid', password: 'Synthetic visitor password!' })
  f.advance(INACTIVITY_MS - 1)
  assert.equal((await f.auth.byId(user.id)).status, 'Active')
  assert.equal((await f.auth.byId(visitor.user.id)).status, 'Active')
  f.advance(1)
  assert.equal((await f.auth.byId(user.id)).status, 'Suspended')
  assert.equal((await f.auth.byId(visitor.user.id)).status, 'Suspended')
  assert.equal(await f.count(visitor.user.id, 'automatic_inactivity_suspension'), 1)
})

test('legacy unknown creation/login starts one durable grace window; failed login does not refresh it', async t => {
  const f = await fixture(t), user = await f.create('legacy-unknown')
  await f.auth.db.prepare('DELETE FROM auth_events WHERE user_id=?').run(user.id)
  await f.auth.db.prepare('UPDATE users SET last_login=? WHERE id=?').run('Never', user.id)
  assert.equal((await f.auth.byId(user.id)).status, 'Active')
  assert.equal((await f.auth.byId(user.id)).status, 'Active')
  assert.equal(await f.count(user.id, 'inactivity_grace_started'), 1)
  f.advance(29 * day)
  assert.equal((await f.auth.login(user.email, 'incorrect password', 'legacy-failed')).status, 401)
  f.advance(day)
  assert.equal((await f.auth.byId(user.id)).status, 'Suspended')
})

test('reactivation grants 30 fresh days without changing last login, role, password or reviving sessions', async t => {
  const f = await fixture(t), user = await f.create('reactivated')
  await f.age(user, 45 * day)
  const previous = await f.auth.byId(user.id)
  assert.equal(previous.status, 'Suspended')
  await f.auth.setStatus(user.id, 'Active', 'operator-id', 'test')
  f.advance(5 * day)
  await f.auth.setStatus(user.id, 'Active', 'operator-id', 'test')
  const next = await f.auth.byId(user.id)
  assert.equal(next.status, 'Active')
  assert.equal(next.last_login, previous.last_login)
  assert.equal(next.password_hash, previous.password_hash)
  assert.equal(next.role, previous.role)
  assert.equal(await f.count(user.id, 'account_reactivated'), 1)
  assert.equal(await f.count(user.id, 'status_Active'), 1)
  const audit = await f.auth.db.prepare("SELECT actor_id FROM auth_events WHERE user_id=? AND reason='account_reactivated'").get(user.id)
  assert.equal(audit.actor_id, 'operator-id')
  f.advance(INACTIVITY_MS - 5 * day - 1)
  assert.equal((await f.auth.byId(user.id)).status, 'Active')
  f.advance(1)
  assert.equal((await f.auth.byId(user.id)).status, 'Suspended')
})

test('only Administrator can reactivate through HTTP or the account service; self-suspension and Inactive selection are rejected', async t => {
  const f = await fixture(t), admin = await f.create('operator', 'Administrator'), officer = await f.create('officer'), bot = await f.create('bot', 'Botanist'), target = await f.create('target')
  const tokens = {}
  for (const user of [admin, officer, bot]) tokens[user.id] = (await f.auth.login(user.email, 'Synthetic permanent password!', user.id)).token
  await f.auth.setStatus(target.id, 'Suspended', admin.id, 'test')
  const server = createAuthServer({ auth: f.auth, env: { NODE_ENV: 'test' } }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const request = (id, token, status = 'Active') => fetch(`http://127.0.0.1:${server.address().port}/api/admin/users/${id}/status`, { method: 'PATCH', headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json', ...(token ? { Cookie: `niah_session=${token}` } : {}) }, body: JSON.stringify({ status }) })
  assert.equal((await request(target.id)).status, 401)
  assert.equal((await request(target.id, tokens[officer.id])).status, 403)
  assert.equal((await request(target.id, tokens[bot.id])).status, 401)
  for (const user of [officer, bot]) assert.equal((await adminRequest({ auth: f.auth, user, path: `/api/admin/users/${target.id}/status`, method: 'PATCH', body: { status: 'Active' } })).status, 403)
  assert.equal((await f.auth.byId(target.id)).status, 'Suspended')
  assert.equal((await request(target.id, tokens[admin.id])).status, 200)
  assert.equal((await f.auth.byId(target.id)).status, 'Active')
  assert.ok((await f.auth.login(target.email, 'Synthetic permanent password!', 'fresh-login')).token)
  assert.equal((await request(admin.id, tokens[admin.id], 'Suspended')).status, 400)
  assert.equal((await request(target.id, tokens[admin.id], 'Inactive')).status, 400)
  assert.equal((await f.auth.byId(admin.id)).status, 'Active')
})

test('full account edit reactivation records its operator and starts a fresh window', async t => {
  const f = await fixture(t), admin = await f.create('editor-admin', 'Administrator'), target = await f.create('edit-target')
  await f.age(target, 40 * day)
  assert.equal((await f.auth.byId(target.id)).status, 'Suspended')
  const edited = await adminRequest({ auth: f.auth, user: admin, ip: 'test', path: `/api/admin/users/${target.id}`, method: 'PATCH', body: { name: target.name, email: target.email, role: target.role, status: 'Active' } })
  assert.equal(edited.status, 200)
  assert.equal((await f.auth.byId(target.id)).status, 'Active')
  assert.equal(await f.count(target.id, 'account_reactivated'), 1)
  f.advance(INACTIVITY_MS - 1)
  assert.equal((await f.auth.byId(target.id)).status, 'Active')
})

test('temporary-password expiry, resend, forced change and subsequent inactivity remain compatible', async t => {
  const f = await fixture(t)
  let delivery
  const staff = createStaffInvitations({ auth: f.auth, origin: 'http://localhost:5173', now: f.now, deliver: async value => { delivery = value } })
  const issued = await staff.invite({ name: 'Temporary User', username: 'temporary-user', email: 'temporary@example.invalid', role: 'Botanist' }, 'operator', 'test')
  f.advance(31 * day)
  assert.equal((await f.auth.byId(issued.user.id)).status, 'Active')
  assert.equal((await f.auth.login(issued.user.email, delivery.temporaryPassword, 'expired')).status, 401)
  await staff.invite(await f.auth.byId(issued.user.id), 'operator', 'test', issued.user.id)
  const login = await f.auth.login(issued.user.email, delivery.temporaryPassword, 'resent')
  assert.ok(login.token)
  assert.equal(await f.auth.changePassword(issued.user.id, 'Replacement permanent password!'), true)
  assert.equal((await f.auth.byId(issued.user.id)).status, 'Active')
  f.advance(INACTIVITY_MS)
  assert.equal((await f.auth.byId(issued.user.id)).status, 'Suspended')
})

test('concurrent checks protect the final fully activated Administrator from lockout', async t => {
  const f = await fixture(t), first = await f.create('first-admin', 'Administrator'), second = await f.create('second-admin', 'Administrator')
  await f.age(first, 31 * day); await f.age(second, 31 * day)
  await Promise.all([f.auth.byId(first.id), f.auth.byId(second.id)])
  const rows = await f.auth.db.prepare("SELECT status FROM users WHERE role='Administrator'").all()
  assert.equal(rows.filter(row => row.status === 'Active').length, 1)
  assert.equal(rows.filter(row => row.status === 'Suspended').length, 1)
})

test('legacy Inactive records remain unchanged until an Administrator explicitly reactivates', async t => {
  const f = await fixture(t), target = await f.create('legacy-inactive')
  await f.auth.db.prepare("UPDATE users SET status='Inactive' WHERE id=?").run(target.id)
  f.advance(90 * day)
  assert.equal((await f.auth.byId(target.id)).status, 'Inactive')
  await f.auth.setStatus(target.id, 'Active', 'operator', 'test')
  assert.equal((await f.auth.byId(target.id)).status, 'Active')
})

test('dashboard status filter and edit options omit Inactive while retaining legacy display compatibility', () => {
  const source = readFileSync(new URL('../src/views/AdminUserManagementView.vue', import.meta.url), 'utf8')
  assert.match(source, /const statusOptions: UserStatus\[\] = \['Active', 'Suspended'\]/)
  assert.ok(source.includes('<option value="All statuses">'))
  assert.ok(!source.includes('<option>Inactive</option>'))
  assert.ok(source.includes('Legacy disabled') || source.includes('legacy disabled'))
})
