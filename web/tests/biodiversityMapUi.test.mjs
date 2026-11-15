import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { parse, compileScript, compileTemplate, compileStyle } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as vue from 'vue'
import * as integration from '../src/services/plantIntegration.ts'

const read = path => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')
const { descriptor } = parse(read('views/conservation/BiodiversityMapView.vue'))
const script = compileScript(descriptor, { id: 'map-ui' })
const template = compileTemplate({ source: descriptor.template.content, filename: 'BiodiversityMapView.vue', id: 'map-ui', compilerOptions: { bindingMetadata: script.bindings } })
assert.deepEqual(template.errors, [])
const transpile = code => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const plants = [
  { plant_id: 18, species_id: 4, rbac_status: 'Pending Review', registered_at: '2026-11-05T03:44:00Z', latitude: 0, longitude: 0, accuracy_m: 0 },
  { plant_id: 19, species_id: 5, rbac_status: 'Flagged', registered_at: null, latitude: null, longitude: null },
  { plant_id: 20, species_id: 4, rbac_status: 'Approved', registered_at: '2026-11-04T03:44:00Z', latitude: 1, longitude: 2 },
]
const species = [
  { species_id: 4, scientific_name: 'Shorea actualis', common_name: 'Actual meranti', conservation_status: 'Vulnerable' },
  { species_id: 5, scientific_name: 'Hopea actualis', common_name: 'Actual hopea', conservation_status: 'Least Concern' },
]
const nodes = root => {
  const result = []
  const walk = node => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (!node || typeof node !== 'object') return
    result.push(node)
    if (Array.isArray(node.children)) walk(node.children)
    else if (node.children?.default) walk(node.children.default())
  }
  walk(root); return result
}
const flush = async () => { for (let i = 0; i < 4; i++) { await vue.nextTick(); await new Promise(setImmediate) } }
function harness(language = 'en', options = {}) {
  const dictionary = JSON.parse(read(`locales/${language}.json`)), locale = vue.ref(language)
  const ct = (value, params = {}) => {
    const key = value.toLowerCase().replace(/[^a-z0-9]+/g, '')
    const text = dictionary.conservationText[key] ?? dictionary.conservationPages.observations.values[key] ?? dictionary.dashboardValues[key] ?? value
    return Object.entries(params).reduce((s, [key, value]) => s.replaceAll(`{${key}}`, String(value)), text)
  }
  const calls = [], fits = [], centers = [], destinations = [], mounted = [], cleanup = []
  const scope = vue.effectScope()
  const element = () => ({ className: '', textContent: '', appendChild() {}, addEventListener() {}, scrollIntoView() {}, classList: { toggle() {} } })
  const map = { fitBounds: (...args) => fits.push(args), setView: (...args) => centers.push(args), whenReady: fn => fn(), invalidateSize() {}, off() {}, remove() {} }
  const group = { addTo() { return this }, clearLayers() {} }
  const marker = () => ({ bindPopup() { return this }, on() { return this }, addTo() { return this }, openPopup() {}, getElement: element })
  const leaflet = { map: () => map, tileLayer: () => ({ addTo() {} }), layerGroup: () => group, marker, divIcon: value => value, latLngBounds: value => value }
  const route = vue.reactive({ query: {} }), exports = {}
  const context = {
    exports, console, Error, document: { createElement: element },
    ResizeObserver: class { observe() {} disconnect() {} },
    requestAnimationFrame: fn => { fn(); return 1 }, cancelAnimationFrame() {}, setTimeout: () => 1, clearTimeout() {},
    require(name) {
      if (name === 'vue') return { ...vue, onMounted: fn => mounted.push(fn), onBeforeUnmount: fn => cleanup.push(fn), resolveComponent: name => name, withDirectives: node => node }
      if (name === 'vue-router') return { useRoute: () => route, useRouter: () => ({ push: async destination => destinations.push(destination) }) }
      if (name.endsWith('useConservationText')) return { useConservationText: () => ({ ct, dt: value => value, locale }) }
      if (name.includes('leaflet.css')) return {}
      if (name === 'leaflet') return leaflet
      if (name.endsWith('plantIntegration')) return { ...integration, requestPlantApi: async url => {
        calls.push(url)
        if (options.failPlants && url === '/api/plants') throw Error('Plant read unavailable')
        return url === '/api/plants' ? { plants: options.plants ?? plants } : { species }
      } }
      if (name.endsWith('.vue')) return { name }
      throw Error(`Unexpected import ${name}`)
    },
  }
  vm.runInNewContext(`(function () { ${transpile(script.content)} })()`, context)
  const state = scope.run(() => exports.default.setup({}, { expose() {} }))
  vm.runInNewContext(`(function () { ${transpile(template.code)} })()`, context)
  return { state, calls, fits, centers, destinations, ct, locale,
    start: async () => { state.mapElement.value = element(); await mounted[0](); await flush() },
    render: () => exports.render({}, [], {}, vue.proxyRefs(state), {}, {}),
    stop: () => { cleanup.forEach(fn => fn()); scope.stop() },
  }
}
const table = h => nodes(h.render()).find(node => node.props?.class === 'mapped-records-table')
const summary = h => nodes(h.render()).find(node => node.props?.class === 'map-summary')

test('summary has three decorative icons, Plant records label and unchanged loaded/filtered count semantics', async () => {
  for (const language of ['en', 'ms', 'zh-CN']) {
    const h = harness(language)
    try {
      await h.state.loadPlants(); await flush()
      const cards = nodes(summary(h)).filter(node => node.type === 'article')
      assert.equal(cards.length, 3)
      assert.deepEqual(cards.map(card => nodes(card).find(node => node.type === 'small').children), [h.ct('Plant records'), h.ct('Mapped records'), h.ct('Species recorded')])
      assert.deepEqual(cards.map(card => nodes(card).find(node => node.type === 'strong').children), ['3', '2', '2'])
      assert.ok(cards.every(card => nodes(card).some(node => node.type === 'svg' && node.props['aria-hidden'] === 'true' && node.props.focusable === 'false')))
      h.state.search.value = 'PL018'
      assert.equal(h.state.filtered.value.length, 1); assert.equal(h.state.mappedPlants.value.length, 1)
      assert.equal(h.state.plants.value.length, 3); assert.equal(h.state.speciesRecorded.value, 2)
      assert.equal(h.state.unmappedPlantCount.value, 0)
    } finally { h.stop() }
  }
})

test('fit-bounds icon button keeps the real handler and fits only valid filtered coordinates without additional requests', async () => {
  const h = harness()
  try {
    await h.start()
    assert.equal(h.fits.length, 1)
    const button = nodes(h.render()).find(node => node.props?.class === 'fit-map-button')
    assert.ok(nodes(button).some(node => node.type === 'svg' && node.props['aria-hidden'] === 'true'))
    assert.ok(nodes(button).some(node => node.type === 'span' && node.children === h.ct('Fit visible plants')))
    assert.equal(button.props.onClick, h.state.fitVisiblePlants)
    h.state.statusFilter.value = 'Pending Review'; await flush()
    button.props.onClick()
    assert.equal(JSON.stringify(h.fits.at(-1)), JSON.stringify([[[0, 0]], { padding: [48, 48], maxZoom: 17 }]))
    assert.deepEqual(h.calls, ['/api/plants', '/api/species?scope=scientific'])
  } finally { h.stop() }
})

test('all eight columns stay aligned, Plant ID is displayed once, actions use raw IDs and registered dates are readable', async () => {
  const h = harness()
  try {
    await h.state.loadPlants(); await flush()
    const rendered = table(h)
    assert.equal(nodes(rendered).filter(node => node.type === 'th').length, 8)
    assert.equal(nodes(rendered).filter(node => node.type === 'col').length, 8)
    assert.ok(nodes(rendered).filter(node => node.type === 'th').every(node => node.props.scope === 'col'))
    const row = nodes(rendered).find(node => node.type === 'tr' && node.key === '18')
    const cells = nodes(row).filter(node => node.type === 'td')
    assert.equal(cells.length, 8)
    assert.equal(nodes(cells[0]).find(node => node.type === 'strong').children, 'PL018')
    assert.ok(!nodes(cells[0]).some(node => node.type === 'small' || node.children === '18'))
    assert.equal(cells[6].children, h.state.formatRegisteredAt(plants[0].registered_at))
    assert.notEqual(cells[6].children, plants[0].registered_at)
    assert.equal(h.state.plants.value[0].registeredAt, plants[0].registered_at)
    const link = nodes(cells[7]).find(node => node.type === 'RouterLink')
    assert.equal(link.props.to, '/plant/18')
    const renderedText = nodes(h.render()).map(node => typeof node.children === 'string' ? node.children : '').join(' ')
    assert.ok(!renderedText.includes('Client-side search and filters apply to the loaded list'))
    const scroll = nodes(h.render()).find(node => node.props?.class === 'table-scroll mapped-records-scroll')
    assert.equal(scroll.props.tabindex, '0'); assert.equal(scroll.props.role, 'region')
  } finally { h.stop() }
})

test('date formatting follows the Officer locale and handles unavailable/invalid dates without changing input values', () => {
  for (const language of ['en', 'ms', 'zh-CN']) {
    const h = harness(language)
    try {
      const raw = plants[0].registered_at
      assert.equal(h.state.formatRegisteredAt(raw), new Intl.DateTimeFormat(language === 'ms' ? 'ms-MY' : language, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(raw)))
      for (const value of [null, '', 'not-a-date']) assert.equal(h.state.formatRegisteredAt(value), h.ct('Unavailable'))
      assert.equal(plants[0].registered_at, raw)
    } finally { h.stop() }
  }
})

test('search and species/conservation/plant status filters retain combined behavior and unavailable locations stay unmapped', async () => {
  const h = harness()
  try {
    await h.state.loadPlants(); await flush()
    h.state.speciesFilter.value = '5'
    assert.equal(h.state.filtered.value.length, 1); assert.equal(h.state.mappedPlants.value.length, 0); assert.equal(h.state.unmappedPlantCount.value, 1)
    h.state.speciesFilter.value = '4'; h.state.conservationFilter.value = 'Vulnerable'; h.state.statusFilter.value = 'Pending Review'; h.state.search.value = '18'
    assert.equal(h.state.filtered.value.length, 1); assert.equal(h.state.filtered.value[0].id, '18')
    assert.equal(h.calls.length, 2)
  } finally { h.stop() }
})

test('loading, empty and error states stay truthful and no writes are introduced', async () => {
  const failed = harness('en', { failPlants: true }), empty = harness('en', { plants: [] })
  try {
    assert.ok(nodes(failed.render()).some(node => String(node.props?.class).includes('map-empty')))
    await failed.state.loadPlants(); await flush()
    assert.equal(failed.state.loadError.value, 'Plant read unavailable')
    await empty.state.loadPlants(); await flush()
    assert.equal(empty.state.filtered.value.length, 0)
    assert.ok(nodes(table(empty)).some(node => node.props?.colspan === '8'))
    assert.ok(failed.calls.every(url => url.startsWith('/api/')))
  } finally { failed.stop(); empty.stop() }
})

test('map cards/table preserve their palette and layout independently of shared Review Submissions badges', () => {
  const css = descriptor.styles[0].content
  assert.match(css, /\.map-summary\s*\{[^}]*display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); align-items: stretch/)
  assert.match(css, /\.map-summary article\s*\{ display: grid; grid-template-columns: 1.25rem minmax\(0, 1fr\); grid-template-rows: 1fr auto; align-items: center; gap: 6px/)
  assert.match(css, /\.map-summary strong\s*\{ grid-column: 1 \/ -1/)
  assert.match(css, /\.map-summary strong\s*\{[^}]*font-size: var\(--officer-number, 1.875rem\)/)
  assert.match(css, /@media \(max-width: 760px\)[^\n]*width: auto; max-width: none/)
  assert.match(css, /\.mapped-records-table\s*\{[^}]*min-width: 90rem; table-layout: auto; border-collapse: separate; border-spacing: 0/)
  assert.match(css, /\.mapped-records-table th\s*\{ background: #245443; color: #fff/)
  assert.match(css, /\.mapped-records-table td\s*\{ padding: 12px 14px; text-align: left; vertical-align: middle/)
  assert.match(css, /td.species-name-cell\s*\{ white-space: normal; overflow-wrap: normal; word-break: normal/)
  assert.match(css, /\.mapped-records-table \.action-group\s*\{ display: flex; flex-wrap: nowrap; align-items: center/)
  assert.match(css, /\.mapped-records-scroll\s*\{ min-width: 0; max-width: 100%; overflow-x: auto/)
  const review = read('views/conservation/ReviewSubmissionsView.vue')
  // Map retains its existing palette; Review Submissions intentionally uses the
  // shared workflow mapping, whose colors and fallbacks have dedicated tests.
  assert.match(css, /\.badge\.pending-review\s*\{\s*background: #e8eff2; color: #53727c;\s*\}/)
  assert.match(css, /\.badge\.flagged\s*\{\s*background: #f0eaf8; color: #69459a;\s*\}/)
  assert.match(review, /import\s*\{\s*workflowBadgeStyle\s*\}\s*from ['"]\.\.\/\.\.\/utils\/workflowBadge['"]/)
  assert.ok(review.includes(':style="workflowBadgeStyle(observation.status)"'))
  assert.match(css, /\.fit-map-button:focus-visible/)
  assert.equal(compileStyle({ source: css, id: 'data-v-map-ui', scoped: true }).errors.length, 0)
})
