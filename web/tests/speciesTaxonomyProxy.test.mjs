import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { once } from 'node:events'
import vm from 'node:vm'
import ts from 'typescript'
import { createPlantApp } from '../../plant-conservation-backend/server.js'

// Evaluate the actual config with inert plugins: do not launch Vite or load .env.
const filename = new URL('../vite.config.ts', import.meta.url)
const exports = {}
vm.runInNewContext(ts.transpileModule(
  readFileSync(filename, 'utf8').replaceAll('import.meta.url', JSON.stringify(filename.href)),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText, { exports, require(name) {
  if (name === 'node:url') return { fileURLToPath, URL }
  if (name === 'vite') return { defineConfig: value => value }
  if (['@vitejs/plugin-vue', 'vite-plugin-vue-devtools'].includes(name)) return { __esModule: true, default: () => ({}) }
  throw Error(`Unexpected config import: ${name}`)
} })
const proxies = exports.default.server.proxy
// Vite selects the first matching prefix/regexp context in configuration order.
const resolveProxy = path => Object.entries(proxies).find(([context]) =>
  context.startsWith('^') ? new RegExp(context).test(path) : path.startsWith(context))

test('taxonomy reaches the plant backend before the auth fallback, with session forwarding unchanged', () => {
  for (const path of ['/api/taxonomy', '/api/taxonomy?filter=existing']) {
    const [context, options] = resolveProxy(path)
    assert.equal(context, '/api/taxonomy')
    assert.equal(options.target, 'http://127.0.0.1:3000')
    assert.equal(options.changeOrigin, false)
    for (const setting of ['rewrite', 'headers', 'cookieDomainRewrite', 'cookiePathRewrite', 'auth'])
      assert.equal(options[setting], undefined, setting)
  }
  assert.ok(Object.keys(proxies).indexOf('/api/taxonomy') < Object.keys(proxies).indexOf('/api'))
  for (const path of ['/api/auth/me', '/api/auth/login']) {
    const [context, options] = resolveProxy(path)
    assert.equal(context, '/api')
    assert.equal(options, 'http://127.0.0.1:3001')
  }
  for (const path of ['/api/species/photos/capabilities', '/api/assets', '/api/data/assets'])
    assert.equal(new URL(resolveProxy(path)[1].target).port, '3000')
})

test('the intended taxonomy route retains Officer-only access and accepts the existing cookie session', async t => {
  const officer = { id: 'officer', role: 'Conservation Officer', status: 'Active', mustChangePassword: false }
  const accounts = {
    officer,
    admin: { ...officer, role: 'Administrator' },
    bot: { ...officer, role: 'Botanist' },
    visitor: { ...officer, role: 'Visitor' },
    inactive: { ...officer, status: 'Disabled' },
    password: { ...officer, mustChangePassword: true },
  }
  const tokens = Object.fromEntries(Object.keys(accounts).map((key, index) => [key, String(index + 1).repeat(64)]))
  const genera = [{ genus_id: '7', genus_name: 'Shorea', family_name: 'Dipterocarpaceae' }]
  const statements = []
  const server = createPlantApp({
    pool: { query: async sql => { statements.push(sql); assert.match(sql, /^SELECT .*FROM genus /); return { rows: genera } },
      connect: () => assert.fail('taxonomy reads must not create/check out a photo-management transaction') },
    auth: { session: async token => accounts[Object.keys(tokens).find(key => tokens[key] === token)] || null,
      event: async () => {} },
  }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  const base = `http://127.0.0.1:${server.address().port}`
  const response = await fetch(`${base}/api/taxonomy`, { headers: { Cookie: `niah_session=${tokens.officer}` } })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { genera })
  const readCount = statements.length
  for (const role of [null, 'admin', 'bot', 'visitor', 'inactive', 'password']) {
    const denied = await fetch(`${base}/api/taxonomy`, {
      headers: tokens[role] ? { Authorization: `Bearer ${tokens[role]}` } : {},
    })
    assert.equal(denied.status, role === null ? 401 : 403, String(role))
    assert.equal(statements.length, readCount, 'denied taxonomy request reached storage')
  }
  assert.equal(statements.length, 1)
})
