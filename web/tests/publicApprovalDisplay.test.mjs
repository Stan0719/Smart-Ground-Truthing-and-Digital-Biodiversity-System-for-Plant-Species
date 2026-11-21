import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { mapPlantCardMetadata } from '../src/services/plantCardMapping.ts'
import { plantThumbnailImages, webAssetUrl } from '../src/services/assetImages.ts'
import { formatPlantId } from '../src/utils/plantId.ts'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const js = value => ts.transpileModule(value, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const flush = async () => { for (let i = 0; i < 8; i++) { await vue.nextTick(); await new Promise(setImmediate) } }
const officer = { id: 'officer-a', role: 'Conservation Officer', status: 'Active', mustChangePassword: false }

function lifecycle() {
  const mounted = [], unmounted = [], listeners = new Set(), events = {}, timers = []
  let snapshot = { user: officer, pending: false }, unavailable = false
  const hooks = { ...vue, onMounted: fn => mounted.push(fn), onBeforeUnmount: fn => unmounted.push(fn) }
  const auth = {
    sessionSnapshot: () => snapshot,
    subscribeSession: fn => { listeners.add(fn); return () => listeners.delete(fn) },
    verifySession: async () => unavailable ? { status: 'unavailable' } : snapshot.user ? { status: 'authenticated', user: snapshot.user } : { status: 'unauthenticated' },
  }
  const context = {
    exports: {}, queueMicrotask,
    window: { addEventListener: (name, fn) => { events[name] = fn }, removeEventListener: name => { delete events[name] } },
    document: { visibilityState: 'visible', addEventListener: (name, fn) => { events[name] = fn }, removeEventListener: name => { delete events[name] } },
    setInterval: fn => { timers.push(fn); return 1 }, clearInterval: () => { timers.length = 0 },
    require: name => name === 'vue' ? hooks : auth,
  }
  vm.runInNewContext(js(read('../src/composables/useCatalogueRefresh.ts')), context)
  return { hooks, events, timers, helper: context.exports,
    mount: () => mounted.forEach(fn => fn()), stop: () => unmounted.forEach(fn => fn()),
    unavailable: () => { unavailable = true },
    change(user, pending = false) { snapshot = { user, pending }; for (const listener of listeners) listener(user, pending) },
  }
}

test('catalogue refreshes on focus/foreground/timer and clears stale account data before late responses', async () => {
  const h = lifecycle(), values = [], requests = []
  const loader = h.helper.useCatalogueRefresh(async current => {
    const response = await new Promise(resolve => requests.push(resolve))
    if (current()) values.splice(0, values.length, response)
  }, () => values.splice(0), () => {})
  h.mount(); await flush(); requests.shift()('approved-a'); await flush()
  assert.deepEqual(values, ['approved-a'])
  h.events.focus(); await flush()
  h.change({ ...officer, id: 'officer-b' }); assert.equal(values.length, 0)
  await flush(); requests.shift()('obsolete-a'); await flush()
  assert.equal(values.length, 0)
  requests.shift()('approved-b'); await flush()
  assert.deepEqual(values, ['approved-b'])
  h.events.visibilitychange(); await flush(); requests.shift()('approved-edit'); await flush()
  assert.deepEqual(values, ['approved-edit'])
  h.timers[0](); await flush(); requests.shift()('newer'); await flush()
  const pending = loader.refresh(); await flush(); h.stop(); requests.shift()('late-unmount'); await pending
  assert.equal(values.length, 0); assert.equal(h.timers.length, 0); assert.equal(Object.keys(h.events).length, 0)
})

test('temporary session unavailability and pending transitions clear authorized catalogue data without logging out', async () => {
  const h = lifecycle(), values = [], failures = []
  const loader = h.helper.useCatalogueRefresh(async () => { values.push('authorized') }, () => values.splice(0), () => failures.push('retry'))
  await loader.refresh(); assert.deepEqual(values, ['authorized'])
  h.change(officer, true); assert.equal(values.length, 0)
  h.unavailable(); await loader.refresh()
  assert.equal(values.length, 0); assert.ok(failures.length)
  h.stop()
})

test('route invalidation and overlapping refreshes never publish an obsolete catalogue response', async () => {
  const h = lifecycle(), requests = [], values = []
  const loader = h.helper.useCatalogueRefresh(async current => {
    const value = await new Promise(resolve => requests.push(resolve))
    if (current()) values.push(value)
  }, () => values.splice(0), () => {})
  const first = loader.refresh(); assert.equal(loader.refresh(), first)
  await flush(); const second = loader.reset(); await flush()
  requests.shift()('old-route'); await first; assert.equal(values.length, 0)
  requests.shift()('new-route'); await second; assert.deepEqual(values, ['new-route'])
  h.stop()
})

function speciesPlantsHarness(rows) {
  let failure = false, gate = null, status = 200
  const calls = []
  const lifecycleState = lifecycle(), exports = {}, route = vue.reactive({ params: { slug: '6' } })
  const scope = vue.effectScope(), loggedIn = vue.ref(true), role = vue.ref('conservation-officer')
  const canonical = { species_id: '6', scientific_name: 'Canonical species', common_name: 'Canonical common', genus_name: 'Canonical genus', description: 'Approved description' }
  const source = read('../src/views/SpeciesPlantsView.vue'), { descriptor } = parse(source)
  const script = compileScript(descriptor, { id: 'approval-list' })
  const template = compileTemplate({ source: descriptor.template.content, filename: 'SpeciesPlantsView.vue', id: 'approval-list', compilerOptions: { bindingMetadata: script.bindings } })
  const context = { exports, AbortSignal, fetch: async url => {
    calls.push(url)
    if (url.startsWith('/api/plants') && gate) await gate
    if (url.startsWith('/api/plants') && status !== 200) return Response.json({ error: 'Fixture denied' }, { status })
    if (failure && url.startsWith('/api/plants')) throw Error('Unavailable')
    return Response.json(url.startsWith('/api/species') ? { species: [canonical] } : { plants: rows })
  }, require(name) {
    if (name.replace(/\.ts$/, '').endsWith('databaseTranslation')) return { trackDatabaseTranslationFields() {}, configureDatabaseTranslation() {}, clearDatabaseTranslationTargets() {} }
    if (name === 'vue') return { ...lifecycleState.hooks, resolveComponent: name => name, withDirectives: value => value }
    if (name === 'vue-router') return { useRoute: () => route }
    if (name === 'vue-i18n') return { useI18n: () => ({ t: key => key, te: () => false }) }
    if (name.includes('useCatalogueRefresh')) return lifecycleState.helper
    if (name.includes('usePrototypeSession')) return { usePrototypeSession: () => ({ isLoggedIn: loggedIn, userRole: role }), refreshSession: async () => officer }
    if (name.endsWith('/plants')) return { plants: [] }
    if (name.endsWith('/assetImages')) return { plantThumbnailImages, webAssetUrl }
    if (name.endsWith('/plantCardMapping')) return { mapPlantCardMetadata }
    if (name.endsWith('/plantId')) return { formatPlantId }
    if (name.endsWith('.vue')) return {}
    throw Error(name)
  } }
  vm.runInNewContext(`(function(){${js(script.content)}})()`, context)
  const state = scope.run(() => exports.default.setup({}, { expose() {} }))
  vm.runInNewContext(`(function(){${js(template.code)}})()`, context)
  return { state, canonical, calls, route, lifecycle: lifecycleState, hold: promise => { gate = promise }, status: code => { status = code }, failPlants: () => { failure = true }, mount: lifecycleState.mount, stop: () => { lifecycleState.stop(); scope.stop() },
    render: () => exports.render({}, [], {}, vue.proxyRefs(state), {}, {}) }
}
const flat = value => {
  const result = []
  const walk = node => { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object') return; result.push(node); if (Array.isArray(node.children)) walk(node.children) }
  walk(value); return result
}

test('Species Plants uses canonical Species names and authoritative registration data; approved reload replaces values', async () => {
  const rows = [{ plant_id: 8, species_id: 6, scientific_name: 'Individual plant name', rbac_status: 'Approved',
    current_registration: { state: 'available', observation_id: 'registration', content: { heightCm: 10 } },
    latest_approved: { heightCm: 20 }, proposed_snapshot: { heightCm: 30 } }]
  const h = speciesPlantsHarness(rows)
  try {
    h.mount(); await flush()
    assert.equal(h.state.speciesPlants.value[0].speciesName, 'Canonical species')
    assert.equal(h.state.speciesPlants.value[0].latestApproved.heightCm, 10)
    rows[0].proposed_snapshot.heightCm = 40
    await h.state.loadPlants(); assert.equal(h.state.speciesPlants.value[0].latestApproved.heightCm, 10)
    rows[0].current_registration.content.heightCm = 30
    h.canonical.scientific_name = 'Approved new species name'
    await h.state.loadPlants()
    assert.equal(h.state.speciesPlants.value[0].latestApproved.heightCm, 30)
    assert.equal(h.state.speciesPlants.value[0].speciesName, 'Approved new species name')
  } finally { h.stop() }
})

test('capped plant list renders a loaded-records warning while retaining normal filtering', async () => {
  const rows = Array.from({ length: 500 }, (_, i) => ({ plant_id: i + 1, species_id: 6, rbac_status: 'Approved' }))
  const h = speciesPlantsHarness(rows)
  try {
    h.mount(); await flush()
    assert.equal(h.state.catalogueLimited.value, true)
    assert.ok(flat(h.render()).some(node => node.props?.role === 'status' && node.children === 'catalogueDisplay.plantsLimited'))
    h.state.searchQuery.value = 'PL008'
    assert.equal(h.state.filteredPlants.value.length, 1)
  } finally { h.stop() }
})

test('failed Plant list requests show Retry instead of claiming an empty catalogue', async () => {
  const h = speciesPlantsHarness([])
  try {
    h.failPlants(); h.mount(); await flush()
    assert.ok(h.state.loadError.value)
    const tree = flat(h.render())
    assert.ok(tree.some(node => node.props?.role === 'alert'))
    assert.ok(!tree.some(node => node.props?.class === 'empty-state' || node.children === 'species.records.count'))
    assert.ok(tree.some(node => node.type === 'button' && node.props?.onClick))
  } finally { h.stop() }
})

test('new display labels have matching complete EN/MS/ZH translations and all capped surfaces disclose limits', () => {
  const locales = ['en', 'ms', 'zh-CN'].map(lang => JSON.parse(read(`../src/locales/${lang}.json`)).catalogueDisplay)
  for (const labels of locales) {
    assert.deepEqual(Object.keys(labels).sort(), Object.keys(locales[0]).sort())
    for (const text of Object.values(labels)) assert.ok(typeof text === 'string' && text.trim() && !/^\?+$/.test(text))
  }
  for (const page of ['PlantsView', 'SpeciesPlantsView', 'SpeciesDetailView']) assert.match(read(`../src/views/${page}.vue`), /catalogueDisplay\.(speciesLimited|plantsLimited)/)
  const card = read('../src/components/PlantRecordCard.vue')
  assert.match(card, /catalogueDisplay\.approvedRegistration/)
  assert.doesNotMatch(card, /plantNames\.|scientificNames\./)
})

test('real session publication during initial verification reloads once for the verified identity', async () => {
  const hooks = { ...vue, onMounted() {}, onBeforeUnmount() {} }, authExports = {}, helperExports = {}, listeners = []
  let serverUser = officer, fetches = 0, loads = 0
  vm.runInNewContext(js(read('../src/services/auth.ts')), { exports: authExports, AbortSignal, fetch: async () => {
    fetches++; return Response.json({ user: serverUser })
  } })
  vm.runInNewContext(js(read('../src/composables/useCatalogueRefresh.ts')), {
    exports: helperExports, queueMicrotask, require: name => name === 'vue' ? hooks : authExports,
  })
  const loader = helperExports.useCatalogueRefresh(async () => { loads++; listeners.push(authExports.sessionSnapshot().user.id) }, () => {}, () => {})
  await loader.refresh(); await flush()
  assert.equal(loads, 1); assert.deepEqual(listeners, ['officer-a'])
  serverUser = { ...officer, id: 'officer-b' }
  await loader.refresh(); await flush()
  assert.equal(loads, 2); assert.deepEqual(listeners, ['officer-a', 'officer-b'])
  assert.ok(fetches <= 4)
})

test('shared knowledge accepts its own initial verified identity, then clears global data on session change', async () => {
  const exports = {}, plants = [], records = [], listeners = [], account = { user: null, pending: true }
  const auth = { sessionSnapshot: () => account, subscribeSession: fn => { listeners.push(fn); return () => {} } }
  vm.runInNewContext(js(read('../src/services/knowledge.ts')), { exports, require(name) {
    if (name.replace(/\.ts$/, '').endsWith('databaseTranslation')) return { trackDatabaseTranslationFields() {}, configureDatabaseTranslation() {}, clearDatabaseTranslationTargets() {} }
    if (name === 'vue') return vue
    if (name.endsWith('/auth')) return auth
    if (name.endsWith('/plants')) return { plants }
    if (name.endsWith('/plantRecords')) return { plantRecords: records }
    if (name.endsWith('/plantCardMapping')) return { mapPlantCardMetadata }
    if (name.endsWith('/assetImages')) return { plantThumbnailImages, speciesImageSelection: () => ({ images: [] }) }
    if (name.includes('usePrototypeSession')) return { refreshSession: async () => {
      account.user = officer; account.pending = false; listeners.forEach(fn => fn(officer, false)); return officer
    } }
    if (name.endsWith('/plantApi')) return { plantApi: async path => path.startsWith('/species?') ? { species: Array.from({ length: 200 }, (_, i) => ({ species_id: i + 1, scientific_name: `Approved ${i}` })) } : path === '/plants' ? { plants: [] } : { assets: [] } }
    throw Error(name)
  } })
  await exports.refreshKnowledge()
  assert.equal(plants.length, 200); assert.equal(exports.catalogueLimited.value, true)
  account.user = null; account.pending = true; listeners.forEach(fn => fn(null, true))
  assert.equal(plants.length, 0); assert.equal(records.length, 0); assert.equal(exports.catalogueLimited.value, false)
})

const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes }); return { promise, resolve } }
for (const trigger of ['focus', 'visibilitychange', 'timer']) {
  test(`Plant Records ${trigger} keeps the same cards mounted and updates only after the complete response`, async () => {
    const rows = [{ plant_id: 8, species_id: 6, rbac_status: 'Approved' }], h = speciesPlantsHarness(rows)
    try {
      assert.equal(h.state.isLoading.value, true)
      h.mount(); await flush()
      const cards = h.state.speciesPlants.value, header = h.state.selectedSpecies.value
      h.state.searchQuery.value = 'PL008'; h.state.lifeStageFilter.value = 'All'
      const wait = deferred(); h.hold(wait.promise)
      if (trigger === 'timer') h.lifecycle.timers[0]()
      else h.lifecycle.events[trigger]()
      await flush()
      assert.equal(h.state.isLoading.value, false)
      assert.equal(h.state.speciesPlants.value, cards); assert.equal(h.state.selectedSpecies.value, header)
      assert.equal(flat(h.render()).some(n => n.children === 'Loading plant records...'), false)
      const before = h.calls.length
      h.lifecycle.events.focus(); h.lifecycle.events.visibilitychange(); await flush()
      assert.equal(h.calls.length, before, 'overlapping events share the current refresh')
      rows.push({ plant_id: 9, species_id: 6, rbac_status: 'Approved' })
      wait.resolve(); await flush()
      assert.equal(h.state.speciesPlants.value.length, 2)
      assert.equal(h.state.searchQuery.value, 'PL008')
      assert.equal(h.state.filteredPlants.value.length, 1)
      assert.equal(h.lifecycle.events.resize, undefined); assert.equal(h.lifecycle.events.scroll, undefined)
    } finally { h.stop() }
  })
}
test('recoverable failures retain Plant cards; denials remove them and Retry remains available', async () => {
  const h = speciesPlantsHarness([{ plant_id: 8, species_id: 6, rbac_status: 'Approved' }])
  try {
    h.mount(); await flush(); const cards = h.state.speciesPlants.value
    h.status(500); await h.state.loadPlants()
    assert.equal(h.state.speciesPlants.value, cards); assert.ok(h.state.loadError.value)
    h.status(403); await h.state.loadPlants()
    assert.equal(h.state.speciesPlants.value.length, 0); assert.equal(h.state.selectedSpecies.value, null)
    assert.ok(flat(h.render()).some(n => n.props?.role === 'alert'))
  } finally { h.stop() }
})
test('route changes and account switches invalidate old Plant responses immediately', async () => {
  const h = speciesPlantsHarness([{ plant_id: 8, species_id: 6, rbac_status: 'Approved' }])
  try {
    h.mount(); await flush()
    const wait = deferred(); h.hold(wait.promise); const old = h.state.loadPlants(); await flush()
    h.route.params.slug = '7'
    assert.equal(h.state.speciesPlants.value.length, 0)
    await flush(); wait.resolve(); await old; await flush()
    assert.equal(h.state.selectedSpecies.value, null)
    h.route.params.slug = '6'; h.hold(null); await flush()
    assert.equal(h.state.speciesPlants.value.length, 1)
    h.lifecycle.change({ ...officer, id: 'new-account' }, true)
    assert.equal(h.state.speciesPlants.value.length, 0)
  } finally { h.stop() }
})
