import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { testPool } from './test-postgres.mjs'
import { postgresDatabase } from './postgres.mjs'
import { createAccountNameStorage } from './account-name-storage.mjs'
import { createDataEncryption, dataEncryptionFromEnvironment } from './data-encryption.mjs'
import { migrateAuth } from './migrate.mjs'
import { createAuth, hashPassword } from './auth.mjs'
import { createAuthServer } from './http.mjs'
import { createStaffInvitations } from './activation.mjs'
import { createRecovery } from './recovery.mjs'

async function fixture(t, provider) {
  const raw = await testPool(), writes = []
  const encryption = createDataEncryption({ activeKeyId: 'test', keys: { test: randomBytes(32).toString('base64') } })
  const pool = { ...raw, async connect() {
    const client = await raw.connect()
    return { ...client, async query(sql, values) {
      if (/^(INSERT INTO (users|visitors)|UPDATE (users|visitors) SET name)/i.test(sql)) writes.push({ sql, values: [...values] })
      return client.query(sql, values)
    } }
  } }
  const db = postgresDatabase(pool, 'plant_auth', { accountNames: createAccountNameStorage(provider ?? (() => encryption)) })
  await migrateAuth(db)
  t.after(() => db.close())
  return { raw, db, auth: await createAuth(db), encryption, writes }
}

test('actual staff/Visitor inserts encrypt names in bound parameters and PostgreSQL; reads preserve responses', async t => {
  const { raw, auth, writes } = await fixture(t)
  const staff = await auth.createUser({ name: 'Personal Name 蕨', email: 'staff@example.invalid', role: 'Conservation Officer', password: '  unchanged password  ', mustChangePassword: false })
  const visitor = await auth.createVisitor({ name: ' Visitor Name ', email: 'visitor@example.invalid', password: 'Visitor permanent password!' })
  for (const [table, id, expected] of [['users', staff.id, 'Personal Name 蕨'], ['visitors', visitor.user.id, 'Visitor Name']]) {
    const stored = (await raw.query(`SELECT * FROM plant_auth.${table} WHERE id=$1`, [id])).rows[0]
    assert.ok(stored.name.startsWith('niah:account-name:v2:'))
    assert.ok(!stored.name.includes(expected))
    const write = writes.find(row => row.values[0] === id)
    assert.equal(write.values[1], stored.name)
    assert.equal((await auth.byId(id)).name, expected)
    assert.equal((await auth.byEmail(stored.email)).name, expected)
    assert.notEqual(stored.password_hash, '  unchanged password  ')
  }
  const login = await auth.login(staff.email, '  unchanged password  ', 'synthetic-login')
  assert.ok(login.token)
  assert.equal(login.user.name, staff.name)
  assert.equal((await auth.session(login.token)).name, staff.name)
})

test('real HTTP account creation/edit/list/login/recovery decrypt names and keep authorization/contracts', async t => {
  const { raw, auth, writes } = await fixture(t)
  const admin = await auth.createUser({ name: 'Admin Name', email: 'admin@example.invalid', role: 'Administrator', password: 'Administrator password!', mustChangePassword: false })
  const staff = createStaffInvitations({ auth, origin: 'http://localhost:5173', deliver: async () => {} })
  let recoveryName, recoveryCode
  const recovery = createRecovery({ auth, key: randomBytes(32), deliver: async (_email, name, code) => { recoveryName = name; recoveryCode = code } })
  const server = createAuthServer({ auth, staff, recovery, env: { NODE_ENV: 'test' } }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const call = (path, method = 'GET', body, cookie = '') => fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
    method, headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json', Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const login = await call('/auth/login', 'POST', { email: admin.email, password: 'Administrator password!' })
  assert.equal(login.status, 200)
  assert.equal((await login.json()).user.name, 'Admin Name')
  const cookie = login.headers.get('set-cookie').split(';')[0]
  const created = await call('/admin/users', 'POST', { name: 'New Officer', username: 'new-officer', email: 'officer@example.invalid', role: 'Conservation Officer' }, cookie)
  assert.equal(created.status, 201)
  const user = (await created.json()).user
  assert.equal(user.name, 'New Officer')
  const edit = await call(`/admin/users/${user.id}`, 'PATCH', { name: 'Edited Officer', email: user.email, role: user.role, status: 'Active' }, cookie)
  assert.equal(edit.status, 200)
  const stored = (await raw.query('SELECT * FROM plant_auth.users WHERE id=$1', [user.id])).rows[0]
  assert.ok(stored.name.startsWith('niah:account-name:v2:'))
  assert.ok(!stored.name.includes('Edited Officer'))
  const update = writes.find(row => /^UPDATE/.test(row.sql))
  assert.equal(update.values[0], stored.name)
  const listed = await call('/admin/users', 'GET', undefined, cookie)
  assert.equal(listed.status, 200)
  assert.equal((await listed.json()).users.find(row => row.id === user.id).name, 'Edited Officer')
  assert.equal((await call('/admin/users')).status, 401)
  const registered = await call('/mobile/register', 'POST', { name: 'Mobile Visitor', email: 'mobile@example.invalid', password: 'Mobile visitor password!' })
  assert.equal(registered.status, 201)
  const visitor = (await registered.json()).user
  assert.equal(visitor.name, 'Mobile Visitor')
  assert.equal((await call(`/admin/users/${visitor.id}`, 'PATCH', { name: 'Edited Visitor', email: visitor.email, role: 'Visitor', status: 'Active' }, cookie)).status, 200)
  const storedVisitor = (await raw.query('SELECT name FROM plant_auth.visitors WHERE id=$1', [visitor.id])).rows[0].name
  assert.ok(storedVisitor.startsWith('niah:account-name:v2:'))
  assert.ok(!storedVisitor.includes('Edited Visitor'))
  const mobile = await call('/mobile/password', 'POST', { email: visitor.email, password: 'Mobile visitor password!' })
  assert.equal(mobile.status, 200)
  assert.equal((await mobile.json()).user.name, 'Edited Visitor')
  const requested = await call('/auth/recovery/request', 'POST', { email: admin.email })
  assert.equal(requested.status, 202)
  const recoveryId = (await requested.json()).recoveryId
  for (let i = 0; i < 20 && !recoveryCode; i++) await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(recoveryName, 'Admin Name')
  assert.ok(recoveryCode)
  const reset = await call('/auth/recovery/confirm', 'POST', { recoveryId, code: recoveryCode, password: 'New administrator password!' })
  assert.equal(reset.status, 200)
  assert.equal((await call('/auth/login', 'POST', { email: admin.email, password: 'New administrator password!' })).status, 200)
})

test('legacy plaintext records remain readable, and editing one encrypts only its name', async t => {
  const { raw, auth } = await fixture(t)
  const created = await auth.createUser({ name: 'Initial Name', email: 'legacy@example.invalid', role: 'Administrator', password: 'Legacy permanent password!', mustChangePassword: false })
  // Simulate an existing record directly in isolated PostgreSQL, never live data.
  await raw.query('UPDATE plant_auth.users SET name=$1 WHERE id=$2', ['Legacy Plaintext', created.id])
  assert.equal((await auth.byId(created.id)).name, 'Legacy Plaintext')
  assert.ok((await auth.login(created.email, 'Legacy permanent password!', 'legacy')).token)
  await auth.db.prepare('UPDATE users SET name=?,email=?,role=?,status=? WHERE id=?').run('Updated Legacy', created.email, 'Administrator', 'Active', created.id)
  const stored = (await raw.query('SELECT * FROM plant_auth.users WHERE id=$1', [created.id])).rows[0]
  assert.ok(stored.name.startsWith('niah:account-name:v2:'))
  assert.equal(stored.email, created.email)
  assert.equal(stored.role, 'Administrator')
  assert.equal((await auth.byId(created.id)).name, 'Updated Legacy')
})

test('wrong keys, corrupted ciphertext, record substitution and missing keys fail without data loss', async t => {
  const { raw, auth, db, encryption } = await fixture(t)
  const user = await auth.createUser({ name: 'Private Name', email: 'private@example.invalid', role: 'Administrator', password: 'Private password!', mustChangePassword: false })
  const stored = (await raw.query('SELECT name FROM plant_auth.users WHERE id=$1', [user.id])).rows[0].name
  const wrong = createAccountNameStorage(() => createDataEncryption({ activeKeyId: 'test', keys: { test: randomBytes(32).toString('base64') } }))
  assert.throws(() => wrong.read([{ id: user.id, role: user.role, name: stored }]), /could not be processed/)
  const wrongDb = postgresDatabase(raw, 'plant_auth', { accountNames: wrong })
  await assert.rejects(wrongDb.prepare('SELECT * FROM users WHERE id=?').get(user.id), /could not be processed/)
  const correct = createAccountNameStorage(() => encryption)
  assert.throws(() => correct.read([{ id: 'different', role: user.role, name: stored }]))
  assert.throws(() => correct.read([{ id: user.id, role: 'Visitor', name: stored }]))
  assert.throws(() => correct.read([{ id: user.id, role: user.role, name: stored.replace(':v2:', ':v99:') }]))
  const envelope = JSON.parse(stored.slice('niah:account-name:v2:'.length))
  const bytes = Buffer.from(envelope.ciphertext, 'base64'); bytes[0] ^= 1
  await raw.query('UPDATE plant_auth.users SET name=$1 WHERE id=$2', ['niah:account-name:v2:' + JSON.stringify({ ...envelope, ciphertext: bytes.toString('base64') }), user.id])
  await assert.rejects(auth.byId(user.id), /could not be processed/)
  const corrupt = (await raw.query('SELECT name FROM plant_auth.users WHERE id=$1', [user.id])).rows[0].name
  assert.notEqual(corrupt, stored)
  await assert.rejects(auth.login(user.email, 'Private password!', 'corrupt'))
  assert.equal((await raw.query('SELECT name FROM plant_auth.users WHERE id=$1', [user.id])).rows[0].name, corrupt)
  await assert.rejects(db.prepare('UPDATE users SET name=$1 WHERE id=$2 OR id=$3').run('Must Not Write', user.id, 'other'), /could not be processed/)
  await assert.rejects(db.prepare('UPDATE plant_auth.users SET name=$1 WHERE id=$2').run('Must Not Write', user.id), /could not be processed/)
  await assert.rejects(db.prepare('UPDATE users SET name=$1,email=$1 WHERE id=$2').run('Must Not Write', user.id), /could not be processed/)
  await assert.rejects(db.prepare('/* unsupported shape */ UPDATE users SET name=$1 WHERE id=$2').run('Must Not Write', user.id), /could not be processed/)
  await assert.rejects(db.prepare('INSERT INTO users VALUES($1,$2)').run('id', 'Must Not Write'), /could not be processed/)
  const missing = createAccountNameStorage(() => { throw Error('Missing secret') })
  assert.throws(() => missing.write('INSERT INTO users(id,name) VALUES($1,$2)', ['id', 'No plaintext fallback']), /could not be processed/)
  assert.throws(() => missing.read([{ id: user.id, role: user.role, name: stored }]), /could not be processed/)
  assert.equal(missing.read([{ id: 'legacy', role: 'Administrator', name: 'Legacy Name' }])[0].name, 'Legacy Name')
})

test('missing configured key prevents real backend writes before INSERT, without plaintext fallback', async t => {
  const { raw, auth } = await fixture(t, () => { throw Error('Missing secret') })
  await assert.rejects(auth.createVisitor({ name: 'Must Not Persist', email: 'missing@example.invalid', password: 'Visitor permanent password!' }), /could not be processed/)
  assert.equal((await raw.query('SELECT count(*) AS n FROM plant_auth.visitors')).rows[0].n, 0)
  const client = await raw.connect()
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL search_path TO plant_auth,pg_catalog')
    await client.query("INSERT INTO users(id,name,username,email,role,password_hash,must_change_password) VALUES($1,$2,$3,$4,$5,$6,0)", ['legacy-no-key', 'Legacy Without Key', 'legacy-no-key', 'legacy-no-key@example.invalid', 'Administrator', await hashPassword('Legacy no key password!')])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
  assert.equal((await auth.byId('legacy-no-key')).name, 'Legacy Without Key')
  assert.ok((await auth.login('legacy-no-key@example.invalid', 'Legacy no key password!', 'legacy-no-key')).token)
  await assert.rejects(auth.db.prepare('UPDATE users SET name=? WHERE id=?').run('Must Not Persist', 'legacy-no-key'), /could not be processed/)
  assert.equal((await raw.query('SELECT name FROM plant_auth.users WHERE id=$1', ['legacy-no-key'])).rows[0].name, 'Legacy Without Key')
})


test('missing backend keyring reports account failure, rolls back and never sends email', async t => {
  const { raw, auth } = await fixture(t, () => dataEncryptionFromEnvironment({}))
  let deliveries = 0
  const staff = createStaffInvitations({ auth, origin: 'https://example.invalid', deliver: async () => { deliveries++ } })
  const result = await staff.invite({ name: 'Synthetic', username: 'synthetic-keyless', email: 'synthetic-keyless@example.invalid', role: 'Botanist' }, 'operator', 'fixture')
  assert.equal(result.status, 503)
  assert.equal(result.code, 'account_encryption_unavailable')
  assert.match(result.error, /No account was created or changed/)
  assert.equal(deliveries, 0)
  assert.equal((await raw.query('SELECT COUNT(*)::int AS n FROM plant_auth.users')).rows[0].n, 0)
  assert.equal((await raw.query("SELECT COUNT(*)::int AS n FROM plant_auth.auth_events WHERE reason='invitation_created'")).rows[0].n, 0)
})
