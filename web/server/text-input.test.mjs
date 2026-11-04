import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { once } from 'node:events'
import { createAuthServer } from './http.mjs'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createTestAuth } from './test-postgres.mjs'
const require = createRequire(import.meta.url)
const { text, fieldContent, mountDomain } = require('../../plant-conservation-backend/domain.cjs')

test('isolated database: normal login, species and plant registration preserve text as data', async t => {
  const { createPlantDatabase } = require('../../plant-conservation-backend/test/postgres-fixture.cjs')
  const { createPlantApp } = require('../../plant-conservation-backend/server.js')
  const pool = await createPlantDatabase()
  const auth = await createTestAuth()
  t.after(async () => { await pool.end(); await auth.db.close() })
  const tokens = {}
  for (const role of ['Conservation Officer', 'Botanist']) {
    const email = role === 'Botanist' ? 'botanist@example.invalid' : 'officer@example.invalid'
    const password = '  unchanged test password  '
    await auth.createUser({ name: role, email, role, password, mustChangePassword: false })
    const result = await auth.login(email, password, email)
    assert.ok(result.token)
    tokens[role] = result.token
  }
  const server = createPlantApp({ pool, auth }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  const request = (path, role, body) => fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[role]}` },
    body: body ? JSON.stringify(body) : undefined,
  })
  const name = "钑?脳 Fern'); DROP TABLE species; --"
  const body = { scientific_name: ` ${name} `, common_name: ' Fern ', description: ' <script>test</script> ', visibility: 'public' }
  const created = await request('/species', 'Conservation Officer', body)
  assert.equal(created.status, 201)
  const { species_id } = await created.json()
  const stored = (await pool.query('SELECT * FROM species WHERE species_id=$1', [species_id])).rows[0]
  assert.equal(stored.scientific_name, name)
  assert.equal(stored.description, '<script>test</script>')
  assert.equal((await request('/species', 'Conservation Officer', { ...body, scientific_name: 'x'.repeat(201) })).status, 400)
  assert.equal((await request('/species', 'Botanist', body)).status, 403)
  const found = await request('/species?q=' + encodeURIComponent(name), 'Conservation Officer')
  assert.equal((await found.json()).species.length, 1)
  assert.equal((await request('/species?q=one&q=two', 'Conservation Officer')).status, 400)
  const plant = await request('/plants', 'Botanist', { species_id, latitude: 1, longitude: 2, client_key: 'synthetic-text-test', content: { heightCm: 12, healthStatus: ' Healthy ', lifeStage: ' Young ', morphology: ' Green leaves ', notes: ' Notes; -- preserved ' } })
  assert.equal(plant.status, 201)
  const observation = (await pool.query('SELECT content FROM plant_observation')).rows[0].content
  assert.equal(observation.notes, 'Notes; -- preserved')
})

test('ordinary text rejects empty, wrong types and excessive names; preserves Unicode and punctuation', () => {
  for (const value of ['', '   ', null, {}, [], 12, 'x'.repeat(201)]) {
    assert.throws(() => text(value, 200), { status: 400 })
  }
  assert.equal(text('  钑ㄧ被 脳 D. o鈥檅rienii (L.)  ', 200), '钑ㄧ被 脳 D. o鈥檅rienii (L.)')
  const content = fieldContent({ heightCm: 12, healthStatus: ' Healthy ', lifeStage: ' Mature ', morphology: ' Green leaves ', notes: '  A; B -- observed  ' })
  assert.equal(content.notes, 'A; B -- observed')
  assert.equal(content.morphology, 'Green leaves')
  assert.throws(() => fieldContent({ ...content, notes: {} }), { status: 400 })
  assert.throws(() => fieldContent({ ...content, notes: 'x'.repeat(4001) }), { status: 400 })
})

test('species create/update normalize text and bind SQL-looking names as parameters', async () => {
  const handlers = {}, queries = []
  const app = Object.fromEntries(['get', 'post', 'patch', 'delete'].map(method => [method, (path, ...chain) => { handlers[method + path] = chain.at(-1) }]))
  const pool = { async connect() { return { async query(sql, values) { queries.push({ sql, values }); return { rows: [{ species_id: 1 }] } }, release() {} } } }
  mountDomain(app, { pool, allow: () => () => {} })
  const name = "Fern'); DROP TABLE species; --"
  for (const method of ['post', 'patch']) {
    const body = { scientific_name: ` ${name} `, common_name: ' 钑?', description: ' Description ', habitat: ' Forest ', visibility: 'public' }
    await handlers[method + '/api/species' + (method === 'patch' ? '/:id' : '')]({ body, params: { id: '1' }, user: { id: 'test', role: 'Conservation Officer' } }, { status() { return this }, json() {} })
    assert.equal(body.scientific_name, name)
    assert.equal(body.description, 'Description')
    assert.equal(body.habitat, 'Forest')
  }
  const writes = queries.filter(q => /^(INSERT INTO species|UPDATE species)/.test(q.sql))
  assert.equal(writes.length, 2)
  for (const query of writes) {
    assert.equal(query.values[0], name)
    assert.ok(!query.sql.includes(name))
    assert.ok(query.sql.includes('$1'))
  }
})

test('HTTP rejects invalid emails/types before calling login or registration', async t => {
  const auth = { login() { assert.fail('Invalid input reached login') }, createVisitor() { assert.fail('Invalid input reached registration') } }
  const server = createAuthServer({ auth, env: { NODE_ENV: 'test' } })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) }))
  for (const path of ['/api/auth/login', '/api/mobile/password', '/api/mobile/register']) {
    for (const email of ['', 'invalid', 'a@@b.com', {}, ['a@b.com']]) {
      const result = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: 'POST', headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' }, body: JSON.stringify({ email, name: 'Test', password: 'unchanged password value' }) })
      assert.equal(result.status, path.endsWith('register') ? 400 : 401)
    }
  }
})

test('Vue interpolation escapes HTML-like text; reviewed species template uses interpolation', async () => {
  const payload = '<script>alert("test")</script>'
  const html = await renderToString(createSSRApp({ template: '<p>{{ description }}</p>', data: () => ({ description: payload }) }))
  assert.ok(html.includes('&lt;script&gt;'))
  assert.ok(!html.includes('<script>'))
  const source = readFileSync(new URL('../src/views/conservation/PlantSpeciesView.vue', import.meta.url), 'utf8')
  assert.ok(source.includes('{{ selected.description }}'))
  assert.ok(!source.includes('v-html'))
})

