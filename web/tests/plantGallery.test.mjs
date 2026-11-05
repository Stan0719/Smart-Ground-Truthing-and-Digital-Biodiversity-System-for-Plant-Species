import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { createPlantGallery, groupGallery } from '../src/services/plantGallery.ts'
const asset = (id, observation = 'initial', origin = 'initial_registration', order = '0', extra = {}) => ({
  asset_id: id, content_type: 'image/jpeg', observation_id: observation, linkage: observation === null ? 'unlinked' : 'observation',
  effective_origin: origin, observation_date: null, observation_status: null, observation_revision: null, photo_order: order, ...extra,
})
const page = (assets, next = null, plant = '18') => Response.json({ plant_id: plant, assets, page: { limit: 20, has_more: next !== null, next_cursor: next } })
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes }); return { promise, resolve } }

test('multiple pages merge split registration/field groups, deduplicate assets and preserve numeric order', async () => {
  const calls = [], first = asset('two', 'initial', 'initial_registration', '2')
  const pages = [page([asset('ten', 'initial', 'initial_registration', '10'), first], 'nextPage'), page([
    first, asset('zero'), asset('field1', 'later', 'subsequent_observation'), asset('legacy', 'old', 'unknown', null), asset('unlinked', null, 'unknown', null),
  ])]
  const gallery = createPlantGallery({ transport: async (url, options) => { calls.push({ url, options }); return pages.shift() } })
  await gallery.load('18', false)
  assert.equal(gallery.state.complete, false); assert.equal(gallery.state.assets.length, 2)
  await gallery.load('18', false, true)
  assert.equal(gallery.state.complete, true); assert.equal(gallery.state.assets.length, 6)
  const groups = groupGallery(gallery.state.assets)
  assert.deepEqual(groups.find(g => g.origin === 'initial_registration').assets.map(a => a.id), ['zero', 'two', 'ten'])
  assert.equal(groups.find(g => g.origin === 'subsequent_observation').observationId, 'later')
  assert.equal(groups.filter(g => g.origin === 'unknown').length, 2)
  assert.equal(groups.find(g => g.key === 'unlinked').observationId, null)
  assert.match(calls[1].url, /cursor=nextPage/)
  assert.ok(calls.every(c => c.options.credentials === 'same-origin' && c.url.startsWith('/api/data/plants/18/gallery?limit=20')))
})

test('authorized dates sort field groups chronologically; unknown dates and fallback photos retain server order', async () => {
  const gallery = createPlantGallery({ transport: async () => page([
    asset('new', 'new', 'subsequent_observation', '9007199254740993', { observation_date: '2026-11-05T00:00:00Z', observation_status: 'Pending Review', observation_revision: 1 }),
    asset('undated', 'undated', 'subsequent_observation', null),
    asset('fallback-z', 'old', 'subsequent_observation', null, { observation_date: '2026-11-01T00:00:00Z' }),
    asset('fallback-a', 'old', 'subsequent_observation', null, { observation_date: '2026-11-01T00:00:00Z' }),
    asset('indexed', 'old', 'subsequent_observation', '2', { observation_date: '2026-11-01T00:00:00Z' }),
  ]) })
  await gallery.load('18', true)
  const groups = groupGallery(gallery.state.assets)
  assert.deepEqual(groups.map(g => g.observationId), ['old', 'undated', 'new'])
  assert.deepEqual(groups[0].assets.map(a => a.id), ['indexed', 'fallback-z', 'fallback-a'])
  assert.equal(groups[2].assets[0].photoOrder, '9007199254740993')
  assert.equal(groups[2].revision, '1')
})

test('repeated and cyclic cursors fail closed without parallel request loops', async () => {
  for (const cursors of [['one', 'one'], ['one', 'two', 'one']]) {
    let calls = 0
    const gallery = createPlantGallery({ transport: async () => { calls++; return page([], cursors.shift()) } })
    await gallery.load('18', false)
    while (gallery.state.hasMore) await gallery.load('18', false, true)
    assert.match(gallery.state.error, /repeated a cursor/); assert.ok(calls <= 3)
    assert.equal(gallery.state.complete, false)
  }
})

test('empty, loading and API failure states are explicit and do not reveal pending evidence', async () => {
  const pending = deferred(), gallery = createPlantGallery({ transport: async () => pending.promise })
  const work = gallery.load('18', false); assert.equal(gallery.state.loading, true)
  pending.resolve(page([])); await work
  assert.equal(gallery.state.complete, true); assert.deepEqual([...gallery.state.assets], [])
  for (const status of [401, 403, 404, 503]) {
    const failed = createPlantGallery({ transport: async () => new Response('', { status }) })
    await failed.load('18', false); assert.ok(failed.state.error); assert.equal(failed.state.complete, false)
    assert.equal(failed.state.assets.length, 0)
  }
})

test('unsafe IDs, wrong plant responses and unexpected private public metadata are rejected', async () => {
  const invalidPages = [
    page([asset('../private')]), page([asset('photo')], null, 'other-plant'),
    page([asset('pending', 'initial', 'initial_registration', '0', { observation_status: 'Pending Review', observation_revision: '1' })]),
    page([asset('unknown', null, 'initial_registration')]), page([asset('photo', 'initial', 'initial_registration', '-1')]),
  ]
  for (const response of invalidPages) {
    const gallery = createPlantGallery({ transport: async () => response }); await gallery.load('18', false)
    assert.ok(gallery.state.error); assert.equal(gallery.state.assets.length, 0)
  }
  const officer = createPlantGallery({ transport: async () => page([asset('pending', 'initial', 'initial_registration', '0', { observation_status: 'Pending Review', observation_revision: '1' })]) })
  await officer.load('18', true); assert.equal(officer.state.assets[0].status, 'Pending Review')
})

test('changed metadata or duplicate IDs with conflicting linkage require a fresh gallery', async () => {
  for (const second of [asset('photo', 'other', 'subsequent_observation'), asset('another', 'initial', 'unknown')]) {
    const pages = [page([asset('photo')], 'next'), page([second])]
    const gallery = createPlantGallery({ transport: async () => pages.shift() })
    await gallery.load('18', true); await gallery.load('18', true, true)
    assert.match(gallery.state.error, /metadata changed/); assert.equal(gallery.state.assets.length, 0)
  }
})

test('reset and route/account replacement abort pending work and reject late success or failure', async () => {
  for (const status of [200, 403]) {
    const old = deferred(); let signal
    const gallery = createPlantGallery({ transport: async (url, options) => {
      if (url.includes('/18/')) { signal = options.signal; return old.promise }
      return page([asset('current')], null, '19')
    } })
    const previous = gallery.load('18', true); gallery.reset(); assert.equal(signal.aborted, true)
    await gallery.load('19', false)
    old.resolve(status === 200 ? page([asset('private')]) : new Response('', { status }))
    await previous
    assert.equal(gallery.state.plantId, '19'); assert.deepEqual(gallery.state.assets.map(a => a.id), ['current'])
    assert.equal(gallery.state.error, '')
  }
})

const source = readFileSync(new URL('../src/components/PlantPhotoGallery.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source), script = compileScript(descriptor, { id: 'gallery' })
const template = compileTemplate({ source: descriptor.template.content, filename: 'PlantPhotoGallery.vue', id: 'gallery', compilerOptions: { bindingMetadata: script.bindings } })
const js = value => ts.transpileModule(value, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function nodes(value) { const out = []; function walk(n) { if (Array.isArray(n)) return n.forEach(walk); if (!n || typeof n !== 'object') return; out.push(n); if (Array.isArray(n.children)) walk(n.children) } walk(value); return out }
function component(groups = []) {
  const exports = {}, events = [], scope = vue.effectScope(), props = vue.reactive({ groups, loading: false, error: '', complete: true, hasMore: false })
  const context = { exports, require(name) {
    if (name === 'vue') return { ...vue, withDirectives: n => n }
    if (name.endsWith('useConservationText')) return { useConservationText: () => ({ ct: x => x }) }
    throw Error(name)
  } }
  vm.runInNewContext(`(function(){${js(script.content)}})()`, context)
  const state = scope.run(() => exports.default.setup(props, { expose() {}, emit: e => events.push(e) }))
  vm.runInNewContext(`(function(){${js(template.code)}})()`, context)
  return { props, events, render: () => nodes(exports.render({ $emit: e => events.push(e) }, [], props, vue.proxyRefs(state), {}, {})), stop: () => scope.stop() }
}
test('gallery renders three registration photos, accessible selection/navigation and broken-image placeholders', async () => {
  const gallery = createPlantGallery({ transport: async () => page([asset('one'), asset('two', 'initial', 'initial_registration', '2'), asset('three', 'initial', 'initial_registration', '3')]) })
  await gallery.load('18', false); const h = component(groupGallery(gallery.state.assets))
  try {
    assert.ok(h.render().some(n => n.type === 'h3' && text(n).includes('Initial Registration Photos')))
    let buttons = h.render().filter(n => n.type === 'button' && n.props?.['aria-pressed'] !== undefined)
    assert.equal(buttons.length, 3); assert.ok(buttons.every(n => n.props.type === 'button' && n.props['aria-label']))
    buttons[1].props.onClick(); await vue.nextTick()
    assert.equal(h.render().find(n => n.type === 'figure').children.find(n => n.type === 'img').props.src, '/api/data/assets/two')
    const img = h.render().find(n => n.type === 'figure').children.find(n => n.type === 'img')
    img.props.onError({ currentTarget: { getAttribute: () => img.props.src } }); await vue.nextTick()
    assert.ok(h.render().some(n => n.props?.class === 'photo-placeholder'))
    assert.ok(!h.render().some(n => n.type === 'img' && n.props.src === '/api/data/assets/two'))
    h.render().find(n => n.type === 'button' && n.props?.['aria-label'] === 'Next photo').props.onClick(); await vue.nextTick()
    assert.equal(h.render().find(n => n.type === 'figure').children.find(n => n.type === 'img').props.src, '/api/data/assets/three')
  } finally { h.stop() }
})
test('gallery shows empty/loading/error controls and no unauthorized date context', async () => {
  const h = component()
  try {
    assert.ok(h.render().some(n => n.children === 'No eligible plant photos are available.'))
    h.props.loading = true; assert.ok(h.render().some(n => n.props?.role === 'status' && n.children === 'Loading photos…'))
    h.props.loading = false; h.props.error = 'fixture failure'; assert.ok(h.render().some(n => n.props?.role === 'alert'))
    h.render().find(n => n.type === 'button' && n.children === 'Retry').props.onClick(); assert.deepEqual(h.events, ['retry'])
    h.props.error = ''; h.props.hasMore = true; h.props.complete = false
    h.render().find(n => n.type === 'button' && n.children === 'Load more photos').props.onClick(); assert.equal(h.events.at(-1), 'more')
    assert.ok(!h.render().some(n => n.type === 'time'))
  } finally { h.stop() }
})

function text(n) { return typeof n === 'string' ? n : Array.isArray(n) ? n.map(text).join('') : n && typeof n === 'object' ? text(n.children) : '' }
test('polished controls preserve selection, boundaries, counters and non-color selected indication', async () => {
  const gallery = createPlantGallery({ transport: async () => page([asset('one'), asset('two', 'initial', 'initial_registration', '2')]) })
  await gallery.load('18', false); const h = component(groupGallery(gallery.state.assets))
  const nav = label => h.render().find(n => n.type === 'button' && n.props?.['aria-label'] === label)
  try {
    assert.equal(nav('Previous photo').props.disabled, true)
    assert.match(text(h.render().find(n => n.props?.class === 'selected-counter')), /1.*of.*2/)
    nav('Next photo').props.onClick(); await vue.nextTick()
    assert.match(text(h.render().find(n => n.props?.class === 'selected-counter')), /2.*of.*2/)
    assert.equal(nav('Next photo').props.disabled, true)
    assert.equal(nav('Previous photo').props.disabled, false)
    assert.ok(h.render().some(n => n.type === 'svg' && n.props?.class === 'thumbnail-selected'))
    nav('Previous photo').props.onClick(); await vue.nextTick()
    assert.match(text(h.render().find(n => n.props?.class === 'selected-counter')), /1.*of.*2/)
    assert.ok(h.render().every(n => n.type !== 'button' || n.props.type === 'button'))
    assert.ok(h.render().filter(n => n.type === 'h4').every(n => !text(n).includes('initial')))
    assert.ok(h.render().some(n => n.type === 'details' && n.props?.class === 'observation-reference'))
  } finally { h.stop() }
})

test('image inspection loading is distinct from API loading and partial counts remain explicit', async () => {
  const gallery = createPlantGallery({ transport: async () => page([asset('one')], 'next') })
  await gallery.load('18', false); const h = component(groupGallery(gallery.state.assets))
  try {
    h.props.complete = false; h.props.hasMore = true
    assert.ok(h.render().some(n => text(n) === 'photos loaded'))
    assert.ok(h.render().some(n => text(n) === 'More photos are available. Counts show the photos loaded so far.'))
    assert.ok(h.render().some(n => n.props?.class === 'image-skeleton'))
    const img = h.render().find(n => n.type === 'figure').children.find(n => n.type === 'img')
    img.props.onLoad({ currentTarget: { getAttribute: () => img.props.src } }); await vue.nextTick()
    assert.ok(!h.render().some(n => n.props?.class === 'image-skeleton'))
    assert.match(h.render().find(n => n.type === 'img').props.class, /image-ready/)
    assert.ok(navDisabledForSinglePhoto(h))
  } finally { h.stop() }
})
function navDisabledForSinglePhoto(h) { return h.render().filter(n => n.type === 'button' && ['Next photo', 'Previous photo'].includes(n.props?.['aria-label'])).every(n => n.props.disabled) }

test('multiple observation groups keep authorized context secondary and do not merge photo sets', async () => {
  const gallery = createPlantGallery({ transport: async () => page([
    asset('one'), asset('field', 'field-id', 'subsequent_observation', '0', { observation_date: '2026-11-05T00:00:00Z', observation_status: 'Approved', observation_revision: 1 }),
    asset('old', null, 'unknown', null),
  ]) })
  await gallery.load('18', true); const h = component(groupGallery(gallery.state.assets))
  try {
    assert.equal(h.render().filter(n => n.type === 'article').length, 3)
    assert.equal(h.render().filter(n => n.type === 'figure').length, 3)
    assert.equal(h.render().filter(n => n.props?.class === 'photo-status').length, 1)
    assert.ok(h.render().filter(n => n.type === 'h4').every(n => !text(n).includes('field-id')))
    assert.ok(h.render().some(n => text(n) === 'Origin not verified'))
  } finally { h.stop() }
})

test('gallery layout bounds previews, keeps thumbnails internally scrollable and respects reduced motion', () => {
  const css = descriptor.styles[0].content
  assert.match(css, /max-width:\s*960px/)
  assert.match(css, /object-fit:\s*contain/)
  assert.doesNotMatch(css, /object-fit:\s*cover/)
  assert.match(css, /overflow-x:\s*auto/)
  assert.match(css, /flex:\s*0 0 80px/)
  assert.match(css, /min-height:\s*44px/)
  assert.match(css, /@media\s*\(max-width:\s*480px\)/)
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/)
  assert.match(css, /:focus-visible/)
  assert.match(css, /\.large-photo\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0/)
  assert.doesNotMatch(source, /class="nav-label"/)
})
