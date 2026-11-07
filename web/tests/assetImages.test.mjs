import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import * as vue from 'vue'
import ts from 'typescript'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import * as images from '../src/services/assetImages.ts'
import * as cardMapping from '../src/services/plantCardMapping.ts'
import { mapSpeciesContract } from '../src/services/plantIntegration.ts'
const js = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const load = path => readFileSync(new URL(path, import.meta.url), 'utf8')

test('asset URL mapping accepts only explicit same-origin assets and canonicalizes the gateway', () => {
  for (const path of ['/api/assets/fixture-id', '/api/data/assets/fixture-id'])
    assert.equal(images.webAssetUrl(path), '/api/data/assets/fixture-id')
  for (const path of [undefined, '', 'https://external.invalid/a', '//external.invalid/a', 'data:image/jpeg,x',
    '/api/assets/../private', '/api/assets/%2e%2e', '/api/assets/a?token=x', '/api/assets/a#x', '/api/assets/a/b'])
    assert.equal(images.webAssetUrl(path), '')
  assert.equal(images.assetUrlFromId('approved-fixture'), '/api/data/assets/approved-fixture')
  assert.equal(images.assetUrlFromId('../private'), '')
  assert.equal(mapSpeciesContract({ species_id: 1, image_url: '/api/assets/fixture' }).imageUrl, '/api/data/assets/fixture')
})

test('plant thumbnails use only supplied preview IDs and exclude pending/private evidence guesses', () => {
  assert.deepEqual(images.plantThumbnailImages({ plant_image_asset_id: 'photo', rbac_status: 'Approved' }), [{ path: '/api/data/assets/photo' }])
  // Public projections omit status but include only an authorized preview ID.
  assert.deepEqual(images.plantThumbnailImages({ plant_image_asset_id: 'photo' }), [{ path: '/api/data/assets/photo' }])
  for (const status of ['Pending Review', 'Draft', 'Rejected', 'Correction Required', 'Flagged'])
    assert.deepEqual(images.plantThumbnailImages({ plant_image_asset_id: 'photo', rbac_status: status }), [])
  assert.deepEqual(images.plantThumbnailImages({ assets: [{ id: 'private' }], image_url: '/api/assets/species' }), [])
  assert.deepEqual(images.plantThumbnailImages({ plant_image_asset_id: '../private' }), [])
})

test('species fallback stays outside reference galleries and reference images take priority', () => {
  const fallback = images.speciesImageSelection([], '/api/assets/plant-preview')
  assert.equal(fallback.image, '/api/data/assets/plant-preview'); assert.deepEqual(fallback.images, [])
  const selected = images.speciesImageSelection([
    { id: 'reference', content_type: 'image/jpeg' }, { id: 'second', content_type: 'image/png' },
    { id: 'document', content_type: 'application/pdf' }, { id: '../invalid', content_type: 'image/jpeg' },
  ], '/api/assets/plant-preview')
  assert.equal(selected.image, '/api/data/assets/reference')
  assert.deepEqual(selected.images.map(x => x.path), ['/api/data/assets/reference', '/api/data/assets/second'])
  assert.equal(images.speciesImageSelection([], 'https://external.invalid/a').image, undefined)
})

test('actual Vite configuration routes asset paths to Plant API while preserving unrelated authentication paths', () => {
  const exports = {}
  const source = load('../vite.config.ts').replaceAll('import.meta.url', JSON.stringify(new URL('../vite.config.ts', import.meta.url).href))
  vm.runInNewContext(js(source), { exports, require(name) {
    if (name === 'node:url') return { URL, fileURLToPath: value => new URL(value).pathname }
    if (name === 'vite') return { defineConfig: value => value }
    return () => ({})
  } })
  const proxies = exports.default.server.proxy
  const resolve = path => {
    const entry = Object.entries(proxies).find(([key]) => key.startsWith('^') ? new RegExp(key).test(path) : path.startsWith(key))
    const config = typeof entry[1] === 'string' ? { target: entry[1] } : entry[1]
    return { target: config.target, path: config.rewrite ? config.rewrite(path) : path }
  }
  for (const path of ['/api/assets/a', '/api/assets?plant_id=1', '/api/data/assets/a']) {
    const route = resolve(path)
    assert.equal(route.target, 'http://127.0.0.1:3000')
    assert.equal(route.path, path.replace('/api/data/', '/api/'))
  }
  for (const path of ['/api/auth/me', '/api/auth/login', '/api/mobile/me', '/api/assets-unrelated'])
    assert.equal(resolve(path).target, 'http://127.0.0.1:3001')
})

test('knowledge refresh retains plant thumbnails and separates preview fallback from reference galleries', async () => {
  const plants = vue.reactive([]), records = vue.reactive([]), calls = [], exports = {}
  vm.runInNewContext(js(load('../src/services/knowledge.ts')), { exports, require(name) {
    if (name === 'vue') return vue
    if (name.endsWith('/assetImages')) return images
    if (name.endsWith('/plantCardMapping')) return cardMapping
    if (name.endsWith('/plants')) return { plants }
    if (name.endsWith('/plantRecords')) return { plantRecords: records }
    if (name.includes('usePrototypeSession')) return { refreshSession: async () => null }
    if (name.endsWith('/plantApi')) return { plantApi: async path => {
      calls.push(path)
      if (path.startsWith('/species?')) return { species: [
        { species_id: '1', scientific_name: 'Fixture one', image_url: '/api/assets/preview' },
        { species_id: '2', scientific_name: 'Fixture two', image_url: '/api/assets/fallback' },
      ] }
      if (path === '/plants') return { plants: [
        { plant_id: '1', species_id: '1', plant_image_asset_id: 'plant-photo', rbac_status: 'Approved', observed_at: '2026-11-05T03:00:00Z', zone: 'Approved zone', latest_approved: { heightCm: 42, lifeStage: 'Mature' } },
        { plant_id: '2', species_id: '2', rbac_status: 'Pending Review', latitude: null, longitude: null, registered_at: '2026-11-05' },
      ] }
      return { assets: path.endsWith('=1') ? [] : [{ id: 'official', content_type: 'image/jpeg' }] }
    } }
    throw Error(name)
  } })
  await exports.refreshKnowledge()
  assert.equal(exports.knowledgeError.value, '')
  assert.equal(plants[0].image, '/api/data/assets/preview'); assert.equal(plants[0].images.length, 0)
  assert.equal(plants[1].image, '/api/data/assets/official')
  assert.equal(records[0].images[0].path, '/api/data/assets/plant-photo')
  assert.equal(records[1].images.length, 0)
  assert.equal(records[0].latestApproved.heightCm, 42)
  assert.equal(records[0].location.zone, 'Approved zone')
  assert.equal(records[1].latestApproved.date, '')
  assert.ok(Number.isNaN(records[1].location.latitude))
  assert.ok(calls.every(path => !path.includes('/observations')))
})

function nodes(value) {
  const out = []
  function visit(n) {
    if (Array.isArray(n)) return n.forEach(visit)
    if (!n || typeof n !== 'object') return
    out.push(n); if (Array.isArray(n.children)) visit(n.children)
  }
  visit(value); return out
}
test('plant card replaces missing/broken images with a placeholder and accepts a new authorized thumbnail', async () => {
  const { descriptor } = parse(load('../src/components/PlantRecordCard.vue'))
  const script = compileScript(descriptor, { id: 'image-card' })
  const template = compileTemplate({ source: descriptor.template.content, filename: 'PlantRecordCard.vue', id: 'image-card', compilerOptions: { bindingMetadata: script.bindings } })
  const scope = vue.effectScope(), exports = {}
  const loggedIn = vue.ref(false), role = vue.ref(null)
  const props = vue.reactive({ compact: false, plant: { plantId: '1', speciesSlug: '1', images: [], location: {}, latestApproved: {}, qr: {} } })
  const context = { exports, require(name) {
    if (name === 'vue') return { ...vue, resolveComponent: value => value }
    if (name === 'vue-i18n') return { useI18n: () => ({ t: x => x, te: () => false, locale: vue.ref('en') }) }
    if (name.endsWith('/assetImages')) return images
    if (name.endsWith('/plantCardMapping')) return cardMapping
    if (name.endsWith('/plants')) return { plants: [] }
    if (name.includes('usePrototypeSession')) return { usePrototypeSession: () => ({ isLoggedIn: loggedIn, userRole: role }) }
    throw Error(name)
  } }
  try {
    vm.runInNewContext(`(function(){${js(script.content)}})()`, context)
    const state = scope.run(() => exports.default.setup(props, { expose() {} }))
    vm.runInNewContext(`(function(){${js(template.code)}})()`, context)
    const render = () => nodes(exports.render({}, [], props, vue.proxyRefs(state), {}, {}))
    assert.equal(render().filter(n => n.type === 'h3' && n.children === '1').length, 1)
    assert.ok(!render().some(n => n.type === 'span' && n.children === '1'))
    assert.equal(render().find(n => n.props?.class === 'learn-more').props.to, '/plant/1')
    assert.ok(!render().some(n => n.type === 'span' && String(n.props?.class).includes('review-status')))
    for (const status of cardMapping.plantReviewStatuses) {
      props.plant.reviewStatus = status; await vue.nextTick()
      assert.ok(render().some(n => n.type === 'span' && n.children === status))
      const image = render().find(n => n.props?.class === 'record-image')
      assert.ok(nodes(image).some(n => n.type === 'span' && n.children === status))
      const heading = render().find(n => n.props?.class === 'record-heading')
      assert.ok(!nodes(heading).some(n => n.type === 'span' && n.children === status))
    }
    props.plant.reviewStatus = 'Draft'; await vue.nextTick()
    assert.ok(!render().some(n => n.type === 'span' && n.children === 'Draft'))
    Object.assign(props.plant, { location: { zone: 'Approved zone' }, latestApproved: { heightCm: 42, lifeStage: 'Mature', date: '2026-11-05T03:00:00Z' } })
    loggedIn.value = true; role.value = 'conservation-officer'; await vue.nextTick()
    assert.equal(state.canViewStaffPlantData.value, true)
    for (const value of ['42 cm', 'Mature', 'Approved zone']) assert.ok(render().some(n => n.children === value))
    role.value = 'admin'; await vue.nextTick()
    assert.equal(state.canViewStaffPlantData.value, false)
    assert.ok(!render().some(n => n.children === 'Approved zone'))
    loggedIn.value = false; role.value = null; await vue.nextTick()
    Object.assign(props.plant, { location: {}, latestApproved: {} })
    assert.ok(render().some(n => n.children === '—'))
    assert.match(descriptor.styles[0].content, /flex-wrap:\s*wrap/)
    assert.match(descriptor.styles[0].content, /overflow-wrap:\s*anywhere/)
    assert.match(descriptor.styles[0].content, /\.record-image\s*\{[^}]*position:\s*relative/s)
    assert.match(descriptor.styles[0].content, /\.review-status\s*\{[^}]*position:\s*absolute;[^}]*top:\s*10px;[^}]*right:\s*10px;[^}]*max-width:\s*calc\(100% - 20px\)/s)
    props.plant.reviewStatus = 'Pending Review'; await vue.nextTick()
    assert.ok(render().some(n => n.props?.class === 'record-placeholder'))
    assert.ok(nodes(render().find(n => n.props?.class === 'record-image')).some(n => n.children === 'Pending Review'))
    props.plant.images = [{ path: '/api/data/assets/first' }]; await vue.nextTick()
    const img = render().find(n => n.type === 'img'); assert.equal(img.props.src, '/api/data/assets/first')
    img.props.onError({ currentTarget: { getAttribute: () => img.props.src } }); await vue.nextTick()
    assert.ok(!render().some(n => n.type === 'img')); assert.ok(render().some(n => n.props?.class === 'record-placeholder'))
    assert.ok(nodes(render().find(n => n.props?.class === 'record-image')).some(n => n.children === 'Pending Review'))
    props.plant.images = [{ path: '/api/assets/new' }]; await vue.nextTick()
    assert.equal(render().find(n => n.type === 'img').props.src, '/api/data/assets/new')
  } finally { scope.stop() }
})

test('direct species-plants navigation maps actual API thumbnails without a preloaded knowledge catalogue', async () => {
  const { descriptor } = parse(load('../src/views/SpeciesPlantsView.vue'))
  const script = compileScript(descriptor, { id: 'species-thumbnails' })
  const exports = {}, scope = vue.effectScope(), calls = []
  const context = { exports, console, fetch: async url => {
    calls.push(url)
    return Response.json(url === '/api/species' ? { species: [
      { species_id: '1', scientific_name: 'Fixture', common_name: 'Fixture', image_url: '/api/assets/preview' },
    ] } : { plants: [
      { plant_id: '1', species_id: '1', rbac_status: 'Approved', plant_image_asset_id: 'plant-photo', observed_at: '2026-11-05T03:00:00Z', zone: 'Approved zone', latest_approved: { heightCm: 42, lifeStage: 'Mature' } },
      { plant_id: '2', species_id: '1', rbac_status: 'Pending Review', registered_at: '2026-11-05', latitude: null, latest_submission: { heightCm: 99, lifeStage: 'Young', zone: 'Pending zone' } },
    ] })
  }, require(name) {
    if (name === 'vue') return vue
    if (name === 'vue-router') return { useRoute: () => vue.reactive({ params: { slug: '1' } }) }
    if (name === 'vue-i18n') return { useI18n: () => ({ t: x => x, te: () => false }) }
    if (name.endsWith('/assetImages')) return images
    if (name.endsWith('/plantCardMapping')) return cardMapping
    if (name.endsWith('/plants')) return { plants: [] }
    if (name.endsWith('/plantId')) return { formatPlantId: id => `PL${String(id).padStart(3, '0')}` }
    if (name.includes('usePrototypeSession')) return { usePrototypeSession: () => ({ isLoggedIn: vue.ref(false), userRole: vue.ref(null) }) }
    if (name.endsWith('.vue')) return {}
    throw Error(name)
  } }
  try {
    vm.runInNewContext(js(script.content), context)
    const state = scope.run(() => exports.default.setup({}, { expose() {} }))
    for (let i = 0; i < 8; i++) { await vue.nextTick(); await new Promise(setImmediate) }
    assert.equal(state.loadError.value, '')
    assert.equal(state.selectedSpecies.value.image, '/api/data/assets/preview')
    assert.equal(state.selectedSpecies.value.images, undefined)
    assert.equal(state.speciesPlants.value[0].images[0].path, '/api/data/assets/plant-photo')
    assert.equal(state.speciesPlants.value[1].images.length, 0)
    assert.equal(state.speciesPlants.value[0].latestApproved.heightCm, 42)
    assert.equal(state.speciesPlants.value[0].latestApproved.lifeStage, 'Mature')
    assert.equal(state.speciesPlants.value[0].location.zone, 'Approved zone')
    assert.equal(state.speciesPlants.value[0].latestApproved.date, '2026-11-05T03:00:00Z')
    assert.equal(state.speciesPlants.value[1].reviewStatus, 'Pending Review')
    assert.equal(state.speciesPlants.value[1].latestApproved.date, '')
    assert.ok(Number.isNaN(state.speciesPlants.value[1].latestApproved.heightCm))
    assert.ok(Number.isNaN(state.speciesPlants.value[1].location.latitude))
    assert.deepEqual(calls, ['/api/species', '/api/plants'])
  } finally { scope.stop() }
})
