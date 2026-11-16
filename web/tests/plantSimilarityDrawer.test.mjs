import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { parse, compileScript, compileTemplate, compileStyle } from '@vue/compiler-sfc'
import { monitoringLabels } from '../src/utils/officerMonitoringDisplay.ts'
import { assetUrlFromId } from '../src/services/assetImages.ts'
import { similarityBadgeStyle, similarityLabel } from '../src/utils/similarityBadge.ts'

const raw = '15a15a93-de1d-4936-be29-5ef6dddb64a6'
const fixture = () => ({ observationId: raw, rawObservationId: raw, plantId: 'PL015', sourceAssetId: 'source-selected', highestSimilarity: .97, status: 'available', candidates: [
  { rank: 1, plantId: 'PL014', observationId: '20df54d3-1111-4111-8111-111111111111', assetId: 'reference-one', scientificName: 'Species one', commonName: 'Common one', similarity: .97, distanceMeters: .8 },
  { rank: 2, plantId: 'PL008', observationId: '8', assetId: 'reference-two', scientificName: 'Species two', similarity: .68, distanceMeters: 0 },
] })
const js = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const read = path => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')
function nodes(root) { const out = []; function walk(node) { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object') return; out.push(node); if (Array.isArray(node.children)) walk(node.children) } walk(root); return out }
function text(node) { if (typeof node === 'string') return node; if (Array.isArray(node)) return node.map(text).join(' '); return node && typeof node === 'object' ? text(node.children) : '' }
class Element {
  constructor(dialog = false) { this.dialog = dialog; this.isConnected = true; this.style = { overflow: 'auto' } }
  closest(selector) { return this.dialog && selector.startsWith('dialog') ? this : null }
  focus() { this.focused = (this.focused || 0) + 1 }
}
function harness(path, props, document = { documentElement: new Element(), body: new Element(), addEventListener() {}, removeEventListener() {} }) {
  const { descriptor } = parse(read(path)), script = compileScript(descriptor, { id: 'drawer-test' })
  const template = compileTemplate({ source: descriptor.template.content, filename: path, id: 'drawer-test', compilerOptions: { bindingMetadata: script.bindings } })
  const mounted = [], cleanup = [], emitted = [], exports = {}, scope = vue.effectScope()
  const context = { exports, document, Element, HTMLElement: Element, require(name) {
    if (name === 'vue') return { ...vue, onMounted: fn => mounted.push(fn), onBeforeUnmount: fn => cleanup.push(fn) }
    if (name.endsWith('officerMonitoringDisplay')) return { monitoringLabels }
    if (name.endsWith('similarityBadge')) return { similarityBadgeStyle, similarityLabel }
    if (name.endsWith('assetImages')) return { assetUrlFromId }
    if (name.endsWith('useConservationText')) return { useConservationText: () => ({ ct: x => x }) }
    if (name.endsWith('.vue')) return { name }
    throw Error(name)
  } }
  vm.runInNewContext(`(function(){${js(script.content)}})()`, context)
  const reactive = vue.reactive(props), state = scope.run(() => exports.default.setup(reactive, { expose() {}, emit: event => emitted.push(event) }))
  vm.runInNewContext(`(function(){${js(template.code)}})()`, context)
  return { state, props: reactive, document, emitted, descriptor, mount: () => mounted.forEach(fn => fn()), render: () => exports.render({}, [], reactive, vue.proxyRefs(state), {}, {}), stop() { cleanup.forEach(fn => fn()); scope.stop() } }
}

test('drawer shows one compact source identity, exact protected photos and unchanged ranked metrics', async () => {
  const h = harness('components/conservation/PlantSimilarityDrawer.vue', { analysis: fixture() })
  try {
    const all = nodes(h.render()), identifiers = all.filter(n => n.type?.name?.endsWith('MonitoringIdentifier.vue'))
    assert.equal(identifiers[0].props.value, raw)
    assert.equal(identifiers[0].props.labels.get(raw), '15A15A93\u2026')
    assert.equal(identifiers[0].props['copy-label'], 'Copy full source observation ID')
    assert.equal(identifiers[0].props['feedback-duration'], 3000)
    assert.equal(identifiers.filter(n => n.props.value === raw).length, 1)
    const headingIcon = all.find(n => n.props?.class === 'similarity-heading-icon')
    assert.equal(headingIcon.props.width, '20')
    assert.equal(headingIcon.props.height, '20')
    assert.equal(headingIcon.props.fill, 'none')
    assert.ok(!text(all).includes('Source submission'))
    const images = all.filter(n => n.type === 'img')
    assert.deepEqual(images.map(n => n.props.src), ['/api/data/assets/source-selected', '/api/data/assets/reference-one', '/api/data/assets/reference-two'])
    assert.ok(images.every(n => n.props.decoding === 'async' && n.props.alt))
    assert.ok(images.slice(1).every(n => n.props.loading === 'lazy'))
    const rows = all.filter(n => n.type === 'li')
    assert.ok(text(rows[0]).includes('Species one') && text(rows[0]).includes('97%'))
    assert.ok(text(rows[1]).includes('Species two') && text(rows[1]).includes('68%'))
    assert.equal(all.filter(n => n.type === 'em').length, 2)
    assert.ok(text(all).includes('Recorded Distance to Top Visual Match'))
    assert.ok(text(all).includes('0.8 m') && text(all).includes('Very close recorded location'))
    assert.ok(text(all).includes('not identification confidence or proof of duplication'))
    assert.ok(text(all).includes('Conservation Officer decisions remain independent'))
    assert.equal(all.filter(n => n.type === 'a').length, 0)
    images[1].props.onError(); await vue.nextTick()
    assert.equal(nodes(h.render()).filter(n => n.type === 'img').length, 2)
    assert.ok(text(h.render()).includes('Species one') && text(h.render()).includes('97%'))
    assert.ok(text(h.render()).includes('Photo unavailable.'))
  } finally { h.stop() }
})

test('missing or invalid asset IDs never substitute another photograph', () => {
  const analysis = fixture(); delete analysis.sourceAssetId
  analysis.candidates[0].assetId = 'https://example.invalid/image'
  delete analysis.candidates[1].assetId
  const h = harness('components/conservation/PlantSimilarityDrawer.vue', { analysis })
  try {
    assert.equal(nodes(h.render()).filter(n => n.type === 'img').length, 0)
    assert.equal(nodes(h.render()).filter(n => n.props?.role === 'status' && n.children === 'Photo unavailable.').length, 3)
    assert.ok(text(h.render()).includes('Species one') && text(h.render()).includes('97%'))
  } finally { h.stop() }
})

test('raw score colors and labels agree before rounding; GPS formatting retains current boundaries', () => {
  const h = harness('components/conservation/PlantSimilarityDrawer.vue', { analysis: fixture() })
  try {
    for (const score of [0, .55, .69, .699, .70, .78, .89, .899, .90, .92, 1]) {
      h.props.analysis.highestSimilarity = score
      h.props.analysis.candidates[0].similarity = score
      const badges = nodes(h.render()).filter(n => n.props?.class === 'similarity-score-badge')
      assert.equal(badges[0].children, `${Math.round(score * 100)}%`)
      assert.deepEqual(badges[0].props.style, similarityBadgeStyle(score))
      assert.deepEqual(badges[1].props.style, similarityBadgeStyle(score))
      assert.equal(similarityLabel(score), score < .7 ? 'Low visual similarity' : score < .9 ? 'Moderate visual similarity' : 'High visual similarity')
    }
    for (const [distance, expected] of [[0, '0.0 m'], [.8, '0.8 m'], [10, '10 m'], [999, '999 m'], [1000, '1.0 km'], [undefined, 'Distance unavailable'], [-1, 'Distance unavailable']]) assert.equal(h.state.formatDistance(distance), expected)
    assert.equal(h.state.distanceLabel(9.9), 'Very close recorded location')
    assert.equal(h.state.distanceLabel(10), 'Nearby recorded location')
    assert.equal(h.state.distanceLabel(100), 'Different recorded location')
    assert.equal(h.state.distanceLabel(undefined), 'Location distance unavailable')
  } finally { h.stop() }
})

test('source and reference previews use exact URLs; native lightbox owns Escape/Tab and restores nested root locking and focus', async () => {
  const h = harness('components/conservation/PlantSimilarityDrawer.vue', { analysis: fixture() })
  const preview = harness('components/PlantPhotoLightbox.vue', { rootScrollLock: true }, h.document)
  const dialog = new Element(true); dialog.open = false; dialog.showModal = () => { dialog.open = true }; dialog.close = () => { dialog.open = false }
  preview.state.dialog.value = dialog; preview.state.closeButton.value = new Element()
  dialog.querySelectorAll = () => [preview.state.closeButton.value]
  dialog.contains = () => true
  h.state.lightbox.value = { open: preview.state.open, close: preview.state.close }
  h.state.closeButton.value = new Element()
  try {
    h.mount(); await vue.nextTick()
    assert.equal(h.document.documentElement.style.overflow, 'hidden')
    assert.equal(h.document.body.style.overflow, 'auto')
    for (const asset of ['source-selected', 'reference-one', 'reference-two']) {
      const trigger = new Element()
      h.state.openPhoto(asset, { currentTarget: trigger }, 'Comparison photo'); await new Promise(resolve => setImmediate(resolve))
      assert.equal(preview.state.dialog.value.open, true)
      assert.equal(preview.state.active.value.url, `/api/data/assets/${asset}`)
      assert.equal(h.document.body.style.overflow, 'auto')
      h.state.handleKeydown({ key: 'Tab', target: dialog })
      h.document.activeElement = preview.state.closeButton.value
      let wrapped = false, stopped = false
      preview.state.keydown({ key: 'Tab', preventDefault() { wrapped = true }, stopPropagation() { stopped = true } })
      assert.equal(wrapped, true); assert.equal(stopped, true)
      const escape = { key: 'Escape', target: dialog, defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }
      preview.state.keydown(escape)
      h.state.handleKeydown(escape)
      assert.equal(dialog.open, false)
      assert.equal(h.emitted.length, 0)
      assert.equal(trigger.focused, 1)
      assert.equal(h.document.documentElement.style.overflow, 'hidden')
    }
    h.state.handleKeydown({ key: 'Escape', preventDefault() {} })
    assert.deepEqual(h.emitted, ['close'])
  } finally { h.stop(); preview.stop() }
  assert.equal(h.document.documentElement.style.overflow, 'auto')
})

test('drawer wraps keyboard focus, preserves a parent modal root lock and has scoped responsive layout', async () => {
  const h = harness('components/conservation/PlantSimilarityDrawer.vue', { analysis: fixture() })
  const first = new Element(), last = new Element()
  h.state.drawer.value = { querySelector: () => null, querySelectorAll: () => [first, last], contains: () => true }
  h.state.closeButton.value = first
  h.document.documentElement.style.overflow = 'hidden'
  try {
    h.mount(); await vue.nextTick()
    let prevented = 0
    h.document.activeElement = last
    h.state.handleKeydown({ key: 'Tab', target: last, preventDefault() { prevented++ } })
    assert.equal(first.focused, 2)
    h.document.activeElement = first
    h.state.handleKeydown({ key: 'Tab', shiftKey: true, target: first, preventDefault() { prevented++ } })
    assert.equal(last.focused, 1); assert.equal(prevented, 2)
    const css = h.descriptor.styles[0].content
    assert.deepEqual(compileStyle({ source: css, id: 'data-v-drawer-test', scoped: true }).errors, [])
    assert.match(css, /width: min\(520px, 94vw\)/)
    assert.match(css, /min-height: 0; min-width: 0; overflow-y: auto/)
    assert.match(css, /@media \(max-width: 520px\)[\s\S]*width: 100%/)
    assert.match(css, /@media \(max-width: 520px\)[\s\S]*\.similarity-overview \{ grid-template-columns: 1fr/)
    assert.match(css, /grid-template-columns: 22px 64px minmax\(0, 1fr\) max-content/)
    assert.match(css, /\.candidate-score-description \{[^}]*clip-path: inset\(50%\)/)
    assert.match(css, /monitoring-id-line\) \{ white-space: nowrap; overflow-wrap: normal/)
  } finally { h.stop() }
  assert.equal(h.document.documentElement.style.overflow, 'hidden')
})
