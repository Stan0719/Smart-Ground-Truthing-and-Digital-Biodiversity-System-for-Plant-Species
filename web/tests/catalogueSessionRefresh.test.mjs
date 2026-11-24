import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { parse, compileScript } from '@vue/compiler-sfc'

const read = path => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')
const js = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const flush = async () => { for (let i = 0; i < 6; i++) { await vue.nextTick(); await new Promise(setImmediate) } }
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes }); return { promise, resolve } }
const officer = { id: 'fixture-officer', name: 'Fixture', role: 'Conservation Officer', status: 'Active', mustChangePassword: false }
function authHarness() {
  let response = () => Response.json({ user: officer })
  const auth = {}, prototype = {}, calls = []
  vm.runInNewContext(js(read('services/auth.ts')), { exports: auth, AbortSignal, fetch: async url => { calls.push(url); return response(url) } })
  vm.runInNewContext(js(read('composables/usePrototypeSession.ts')), { exports: prototype, require: name => name === 'vue' ? vue : auth })
  const { descriptor } = parse(read('components/NavigationBar.vue')), script = compileScript(descriptor, { id: 'session-navbar' })
  const scope = vue.effectScope(), exports = {}, route = vue.reactive({ path: '/species' })
  vm.runInNewContext(js(script.content), { exports, window: { removeEventListener() {} }, require(name) {
    if (name.replace(/\.ts$/, '').endsWith('databaseTranslation')) return { trackDatabaseTranslationFields() {}, configureDatabaseTranslation() {}, clearDatabaseTranslationTargets() {} }
    if (name === 'vue') return { ...vue, onMounted() {}, onBeforeUnmount() {} }
    if (name === 'vue-router') return { useRoute: () => route, useRouter: () => ({ push() {} }) }
    if (name === 'vue-i18n') return { useI18n: () => ({ t: x => x, locale: vue.ref('en') }) }
    if (name.endsWith('/globalSearch')) return { searchGlobalWebsite: async () => { throw Error('Unexpected search in session test') } }
    if (name.endsWith('/auth')) return auth
    if (name.includes('usePrototypeSession')) return prototype
    if (name.endsWith('.vue')) return {}
    throw Error(name)
  } })
  const navbar = scope.run(() => exports.default.setup({}, { expose() {} }))
  return { auth, prototype, navbar, calls, response: fn => { response = fn }, stop: () => scope.stop() }
}
for (const failure of ['network', '500', '403', 'invalid-json']) {
  test(`navbar retains display identity during ${failure}, blocks privileged navigation and recovers reactively`, async () => {
    const h = authHarness()
    try {
      await h.prototype.refreshSession()
      assert.equal(h.navbar.isLoggedIn.value, true)
      assert.ok(h.navbar.navItems.value.some(n => n.to === '/conservation-dashboard'))
      h.response(() => { if (failure === 'network') throw Error('Offline'); return failure === 'invalid-json' ? new Response('bad') : Response.json({}, { status: Number(failure) }) })
      await assert.rejects(h.prototype.refreshSession())
      assert.equal(h.navbar.isLoggedIn.value, true); assert.equal(h.navbar.username.value, 'Fixture')
      assert.equal(h.navbar.canUseProtectedSession.value, false)
      assert.equal(h.navbar.navItems.value.some(n => n.to === '/conservation-dashboard'), false)
      h.response(() => Response.json({ user: officer })); await h.auth.verifySession()
      assert.equal(h.navbar.canUseProtectedSession.value, true)
      assert.ok(h.navbar.navItems.value.some(n => n.to === '/conservation-dashboard'))
    } finally { h.stop() }
  })
}
test('confirmed 401, restrictions and explicit logout promptly remove navbar identity', async () => {
  const h = authHarness()
  try {
    await h.auth.verifySession()
    h.response(() => Response.json({}, { status: 401 })); await h.auth.verifySession()
    assert.equal(h.navbar.isLoggedIn.value, false)
    for (const user of [{ ...officer, status: 'Suspended' }, { ...officer, mustChangePassword: true }, { ...officer, role: 'Botanist' }]) {
      h.response(() => Response.json({ user })); await h.auth.verifySession()
      assert.equal(h.navbar.isLoggedIn.value, false); assert.equal(h.navbar.canUseProtectedSession.value, false)
    }
    h.response(() => Response.json({ user: officer })); await h.auth.verifySession()
    const wait = deferred(); h.response(() => wait.promise)
    const logout = h.auth.logout()
    assert.equal(h.navbar.isLoggedIn.value, false)
    wait.resolve(Response.json({})); await logout
    assert.equal(h.navbar.username.value, '')
  } finally { h.stop() }
})
function knowledgeHarness() {
  const exports = {}, plants = vue.reactive([]), records = vue.reactive([]), listeners = []
  let account = { user: officer, pending: false }, handler, calls = []
  const auth = { sessionSnapshot: () => account, subscribeSession: fn => { listeners.push(fn) } }
  const species = [{ species_id: 6, scientific_name: 'Canonical species', family_name: 'Family A' }]
  handler = async path => path.startsWith('/species?') ? { species } : path.startsWith('/plants') ? { plants: [] } : { assets: [] }
  vm.runInNewContext(js(read('services/knowledge.ts')), { exports, require(name) {
    if (name.replace(/\.ts$/, '').endsWith('databaseTranslation')) return { trackDatabaseTranslationFields() {}, configureDatabaseTranslation() {}, clearDatabaseTranslationTargets() {} }
    if (name === 'vue') return vue
    if (name.endsWith('/auth')) return auth
    if (name.endsWith('/plants')) return { plants }
    if (name.endsWith('/plantRecords')) return { plantRecords: records }
    if (name.endsWith('/plantCardMapping')) return { mapPlantCardMetadata: () => ({}) }
    if (name.endsWith('/assetImages')) return { plantThumbnailImages: () => [], speciesImageSelection: () => ({ images: [] }) }
    if (name.includes('usePrototypeSession')) return { refreshSession: async () => account.user }
    if (name.endsWith('/plantApi')) return { plantApi: path => { calls.push(path); return handler(path) } }
    throw Error(name)
  } })
  const scope = vue.effectScope(), activeFamily = vue.ref('Family A')
  scope.run(() => vue.watch(() => plants.map(s => s.family), options => { if (!options.includes(activeFamily.value)) activeFamily.value = '' }))
  return { exports, plants, species, records, calls, activeFamily, handler: fn => { handler = fn }, change(user, pending = false) { account = { user, pending }; listeners.forEach(fn => fn(user, pending)) }, stop: () => scope.stop() }
}
test('catalogue stays visible through slow refresh, coalesces requests and reconciles family only after publication', async () => {
  const h = knowledgeHarness()
  try {
    await h.exports.refreshKnowledge(); await flush()
    h.activeFamily.value = 'Family A'
    const wait = deferred(); h.handler(async path => { await wait.promise; return path.startsWith('/species?') ? { species: h.species } : path.startsWith('/plants') ? { plants: [] } : { assets: [] } })
    const first = h.exports.refreshKnowledge(), second = h.exports.refreshKnowledge()
    assert.equal(first, second); await flush()
    assert.equal(h.plants.length, 1); assert.equal(h.activeFamily.value, 'Family A')
    h.species[0].family_name = 'Family B'; wait.resolve(); await first; await flush()
    assert.equal(h.plants[0].family, 'Family B'); assert.equal(h.activeFamily.value, '')
  } finally { h.stop() }
})
test('catalogue recoverable failures preserve approved data; authorization errors and account switches clear it', async () => {
  const h = knowledgeHarness()
  try {
    await h.exports.refreshKnowledge(); await flush()
    h.handler(async () => { throw Error('Fixture unavailable') })
    await h.exports.refreshKnowledge(); assert.equal(h.plants.length, 1); assert.ok(h.exports.knowledgeError.value)
    h.handler(async () => { throw { status: 403 } })
    await h.exports.refreshKnowledge(); assert.equal(h.plants.length, 0)
    h.plants.push({ speciesId: 'old' }); h.change({ ...officer, id: 'another' })
    assert.equal(h.plants.length, 0)
  } finally { h.stop() }
})
test('late catalogue results cannot restore another account and guest reads retain their public scope', async () => {
  const h = knowledgeHarness()
  try {
    const wait = deferred(); h.handler(async path => { await wait.promise; return path.startsWith('/species?') ? { species: h.species } : path.startsWith('/plants') ? { plants: [] } : { assets: [] } })
    const old = h.exports.refreshKnowledge(); await flush(); h.change(null)
    wait.resolve(); await old; assert.equal(h.plants.length, 0)
    await h.exports.refreshKnowledge(); assert.ok(h.calls.includes('/plants?scope=public-web')); assert.ok(h.calls.includes('/species?scope=public'))
  } finally { h.stop() }
})

test('a verified catalogue refresh passes its current identity to the loader without a second session request', async () => {
  const auth = {}, helper = {}, calls = [], cleanups = []
  vm.runInNewContext(js(read('services/auth.ts')), { exports: auth, AbortSignal, fetch: async url => { calls.push(url); return Response.json({ user: officer }) } })
  vm.runInNewContext(js(read('composables/useCatalogueRefresh.ts')), { exports: helper, queueMicrotask, window: { removeEventListener() {} }, document: { removeEventListener() {} }, require: name => name === 'vue' ? { ...vue, onMounted() {}, onBeforeUnmount: fn => cleanups.push(fn) } : auth })
  let supplied = null
  const loader = helper.useCatalogueRefresh(async (current, user) => { assert.equal(current(), true); supplied = user }, () => {}, () => {})
  await loader.refresh(); await flush()
  assert.equal(supplied.id, officer.id)
  const before = calls.length
  await loader.refresh(); await flush()
  assert.equal(calls.length - before, 1)
  cleanups.forEach(fn => fn())
})

test('Plant API error status distinguishes denied catalogue reads from recoverable errors', async () => {
  const api = {}, responseHelper = {}
  vm.runInNewContext(js(read('services/apiResponse.ts')), { exports: responseHelper, Error })
  let status = 403
  vm.runInNewContext(js(read('services/plantApi.ts')), { exports: api, Error, AbortSignal, fetch: async () => Response.json({ error: 'Fixture' }, { status }), require: () => responseHelper })
  await assert.rejects(api.plantApi('/species'), error => error.status === 403)
  status = 500
  await assert.rejects(api.plantApi('/species'), error => error.status === 500)
})
