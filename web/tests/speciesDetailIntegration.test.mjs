import { conservationBadgeStyle, conservationBadgePalette } from '../src/utils/conservationBadge.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as vue from 'vue'
import { createI18n } from 'vue-i18n'
import * as assets from '../src/services/assetImages.ts'
import * as cards from '../src/services/plantCardMapping.ts'
import { formatPlantId } from '../src/utils/plantId.ts'
const source = readFileSync(new URL('../src/views/SpeciesDetailView.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const script = compileScript(descriptor, { id: 'species-detail' })
const template = compileTemplate({ source: descriptor.template.content, filename: 'SpeciesDetailView.vue', id: 'species-detail', compilerOptions: { bindingMetadata: script.bindings } })
assert.equal(template.errors.length, 0)
const js = s => ts.transpileModule(s, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const officer = { id: 'officer', role: 'Conservation Officer', status: 'Active', mustChangePassword: false }
const species = { species_id: '201', common_name: 'API common', scientific_name: 'API scientific', genus_name: 'API genus', family_name: 'API family', description: 'API description', habitat: 'Restricted habitat', conservation_status: 'Vulnerable', image_url: '/api/assets/portrait', image_asset_id: 'other' }
const flush = async () => { for (let i = 0; i < 8; i++) { await vue.nextTick(); await new Promise(setImmediate) } }
function nodes(value) { const out = []; function walk(n) { if (Array.isArray(n)) return n.forEach(walk); if (!n || typeof n !== 'object') return; out.push(n); if (Array.isArray(n.children)) walk(n.children); else if (n.children?.default) walk(n.children.default()) } walk(value); return out }
function harness({ slug = '201', initial = null, handler, locale = 'en' } = {}) {
  const scope = vue.effectScope(), exports = {}, route = vue.reactive({ params: { slug } }), calls = [], listeners = new Set(), unmount = []
  let user = initial, pending = false
  const messages = JSON.parse(readFileSync(new URL(`../src/locales/${locale}.json`, import.meta.url), 'utf8'))
  const t = createI18n({ legacy: false, locale, messages: { [locale]: messages } }).global.t
  const body = { style: { overflow: 'auto' } }
  const context = { exports, document: { body }, window: { removeEventListener() {} }, clearInterval, require(name) {
    if (name === 'vue') return { ...vue, onMounted() {}, onBeforeUnmount(fn) { unmount.push(fn) }, resolveComponent: n => n }
    if (name === 'vue-router') return { useRoute: () => route }
    if (name === 'vue-i18n') return { useI18n: () => ({ t }) }
    if (name.endsWith('/auth')) return { currentUser: async () => user, sessionSnapshot: () => ({ user, pending }), subscribeSession: fn => { listeners.add(fn); return () => listeners.delete(fn) } }
    if (name.endsWith('/assetImages')) return assets
    if (name.endsWith('/plantCardMapping')) return cards
    if (name.endsWith('/plantId')) return { formatPlantId }
    if (name.endsWith('/plantIntegration')) return { requestPlantApi: async path => { calls.push(path); if (handler) return handler(path); if (path.includes('/species/')) return { species }; if (path.endsWith('/species')) return { species: [species] }; if (path.includes('/plants')) return { plants: [{ plant_id: 1, species_id: 201 }, { plant_id: 2, species_id: 202 }, { plant_id: 3, species_id: 201, rbac_status: 'Pending Review' }] }; return { assets: [{ id: 'gallery', content_type: 'image/jpeg' }] } } }
    if (name.endsWith('conservationBadge')) return { conservationBadgeStyle }
    if (name.endsWith('.vue')) return { name }
    throw Error(name)
  } }
  context.document.removeEventListener = () => {}
  vm.runInNewContext(`(function(){${js(script.content)}})()`, context)
  const state = scope.run(() => exports.default.setup({}, { expose() {} }))
  vm.runInNewContext(`(function(){${js(template.code)}})()`, context)
  return { state, calls, route, body, t, change(next, checking = false) { user = next; pending = checking; for (const fn of listeners) fn(user, pending) }, render: () => nodes(exports.render({}, [], {}, vue.proxyRefs(state), {}, {})), stop() { for (const fn of unmount) fn(); scope.stop() } }
}

test('Species Detail conservation badges use the shared palette and retain existing role visibility', async () => {
  for (const status of [...Object.keys(conservationBadgePalette), 'Unknown', null]) {
    const h = harness({ initial: officer, handler: async path => path.includes('/species/') ? { species: { ...species, conservation_status: status } } : path.includes('/plants') ? { plants: [] } : { assets: [] } })
    try {
      await flush(); const badge = h.render().find(n => n.props?.class === 'conservation-status')
      if (status) { assert.deepEqual(badge.props.style, conservationBadgeStyle(status)); assert.equal(badge.children, status) }
      else assert.equal(badge, undefined)
    } finally { h.stop() }
  }
  const h = harness()
  try { await flush(); assert.ok(!h.render().some(n => n.props?.class === 'conservation-status')) } finally { h.stop() }
})

test('numeric IDs bypass capped catalogue; real fields render once without prototype or restricted facts', async () => {
  const h = harness(); try { await flush()
    assert.equal(h.calls[0], '/api/data/species/201'); assert.ok(!h.calls.includes('/api/data/species'))
    const tree = h.render()
    for (const value of ['API common', 'API scientific', 'API family', 'API genus', 'API description']) assert.equal(tree.filter(n => n.children === value).length, 1, value)
    for (const value of ['Restricted habitat', 'Vulnerable', 'Uncategorized']) assert.ok(!tree.some(n => n.children === value))
    assert.equal(h.state.primaryImage.value, '/api/data/assets/portrait')
    assert.equal(h.state.linkedPlants.value.length, 1); assert.equal(h.state.linkedPlants.value[0].speciesId, '201')
    assert.ok(tree.some(n => n.props?.to === '/species/201/plants'))
    assert.ok(tree.some(n => n.props?.to === '/species'))
    assert.ok(tree.some(n => String(n.children).includes('plant record found in loaded results')))
  } finally { h.stop() }
})

test('generated legacy slugs verify full identity and never silently select another species', async () => {
  const h = harness({ slug: 'api-common-201' }); try { await flush(); assert.equal(h.state.selectedSpecies.value.id, '201') } finally { h.stop() }
  const wrong = harness({ slug: 'wrong-name-201' }); try { await flush(); assert.equal(wrong.state.selectedSpecies.value, null); assert.ok(wrong.state.loadError.value) } finally { wrong.stop() }
  const bare = harness({ slug: 'old-unresolvable-name' }); try { await flush(); assert.equal(bare.state.selectedSpecies.value, null); assert.ok(bare.state.loadError.value) } finally { bare.stop() }
})

test('missing optional fields stay absent and scientific name supplies heading fallback', async () => {
  const h = harness({ handler: async p => p.includes('/species/') ? { species: { species_id: '201', scientific_name: 'Only scientific' } } : p.includes('/plants') ? { plants: [] } : { assets: [] } })
  try { await flush(); assert.equal(h.state.displayName.value, 'Only scientific'); assert.equal(h.state.selectedSpecies.value.description, ''); assert.equal(h.state.primaryImage.value, ''); assert.ok(!h.render().some(n => n.type === 'button' && String(n.props?.class).includes('portrait-trigger'))) } finally { h.stop() }
})

test('scientific facts require active authorized role AND supplied API values; administrator gets no grant', async () => {
  for (const initial of [officer, { ...officer, role: 'Botanist' }, { ...officer, role: 'Administrator' }, { ...officer, mustChangePassword: true }]) {
    const h = harness({ initial }); try { await flush(); const allowed = ['Conservation Officer','Botanist'].includes(initial.role) && !initial.mustChangePassword; assert.equal(h.state.selectedSpecies.value.habitat, allowed ? 'Restricted habitat' : ''); assert.equal(h.render().some(n => n.children === 'Vulnerable'), allowed) } finally { h.stop() }
  }
})

test('logout clears facts and zoom immediately and stale staff responses cannot restore them', async () => {
  let release, delayed = false
  const h = harness({ initial: officer, handler: p => p.includes('/species/') ? delayed ? new Promise(r => { release = r }) : { species } : p.includes('/plants') ? { plants: [] } : { assets: [] } })
  try { await flush(); delayed = true; void h.state.loadSpecies(); await flush(); h.state.zoomImage.value = '/api/data/assets/portrait'; h.change(null, true)
    assert.equal(h.state.selectedSpecies.value, null); assert.equal(h.state.zoomImage.value, '')
    release({ species }); await flush(); assert.equal(h.state.selectedSpecies.value, null)
    delayed = false; h.change(null); await flush(); assert.equal(h.state.selectedSpecies.value.habitat, '')
  } finally { h.stop() }
})

test('route changes invalidate late details and mismatched API IDs fail closed', async () => {
  let release
  const h = harness({ handler: p => p.endsWith('/species/201') ? new Promise(r => { release = r }) : p.includes('/species/') ? { species: { ...species, species_id: '202' } } : p.includes('/plants') ? { plants: [] } : { assets: [] } })
  try { await flush(); h.route.params.slug = '202'; await flush(); release({ species }); await flush(); assert.equal(h.state.selectedSpecies.value.id, '202') } finally { h.stop() }
  const bad = harness({ handler: async () => ({ species: { ...species, species_id: '999' } }) }); try { await flush(); assert.equal(bad.state.selectedSpecies.value, null) } finally { bad.stop() }
})

test('portrait failure advances zoom, then closes and uses placeholder when all candidates fail', async () => {
  const h = harness(); try { await flush(); h.state.zoomImage.value = h.state.primaryImage.value; const count = h.calls.length; h.state.imageFailed(h.state.primaryImage.value); assert.equal(h.state.zoomImage.value, '/api/data/assets/gallery'); assert.equal(h.state.primaryImage.value, '/api/data/assets/gallery'); h.state.imageFailed(h.state.primaryImage.value); assert.equal(h.state.primaryImage.value, ''); assert.equal(h.state.zoomImage.value, ''); assert.equal(h.calls.length, count); assert.ok(h.render().some(n => n.props?.class === 'plant-placeholder')) } finally { h.stop() }
})

test('native modal opens with the authorized URL, locks scroll, focuses close and restores trigger on close', async () => {
  const h = harness(); try { await flush(); let closeFocus = 0, triggerFocus = 0
    h.state.dialog.value = { open: false, showModal() { this.open = true }, close() { this.open = false } }
    h.state.closeButton.value = { focus() { closeFocus++ } }; h.state.portraitTrigger.value = { isConnected: true, focus() { triggerFocus++ } }
    await h.state.openZoom(); assert.equal(h.state.dialog.value.open, true); assert.equal(closeFocus, 1); assert.equal(h.body.style.overflow, 'hidden'); assert.equal(h.state.zoomImage.value, '/api/data/assets/portrait')
    const d = h.render().find(n => n.type === 'dialog'); let prevented = false; d.props.onCancel({ preventDefault() { prevented = true } })
    assert.ok(prevented); assert.equal(h.body.style.overflow, 'auto'); assert.equal(triggerFocus, 1)
    await h.state.openZoom(); const dialogNode = h.render().find(n => n.type === 'dialog'); const backdrop = {}; dialogNode.props.onClick({ target: backdrop, currentTarget: backdrop }); assert.equal(h.state.zoomImage.value, '')
    await h.state.openZoom(); h.route.params.slug = '202'; assert.equal(h.state.zoomImage.value, ''); assert.equal(h.body.style.overflow, 'auto')
  } finally { h.stop() }
})

test('independent plants/gallery failures do not discard species facts or invent empty totals', async () => {
  const h = harness({ handler: async p => { if (p.includes('/species/')) return { species }; throw Error('Unavailable') } }); try { await flush(); assert.equal(h.state.selectedSpecies.value.id, '201'); assert.ok(h.state.plantsError.value); assert.ok(h.state.imagesError.value); assert.ok(!h.render().some(n => String(n.children).includes('plant record found in loaded results'))) } finally { h.stop() }
})

test('API asset ID fallback and authorized gallery fallback are supported; unsafe URLs are rejected', async () => {
  for (const imageFields of [{ image_asset_id: 'safe-id' }, { image_url: 'https://unrelated.test/photo' }]) {
    const h = harness({ handler: async p => p.includes('/species/') ? { species: { species_id: '201', scientific_name: 'Real', ...imageFields } } : p.includes('/plants') ? { plants: [] } : { assets: [{ id: 'fallback', content_type: 'image/png' }, { id: 'pdf', content_type: 'application/pdf' }] } })
    try { await flush(); assert.equal(h.state.primaryImage.value, `/api/data/assets/${imageFields.image_asset_id || 'fallback'}`); assert.equal(h.state.images.value.length, 1) } finally { h.stop() }
  }
})

test('profile layout stacks below 900px, preserves stacked 4:3 portrait and removes duplicated unsupported sections', () => {
  const css = descriptor.styles[0].content
  for (const name of ['prototypeSpecies', 'refreshKnowledge', 'speciesText', 'quick-facts', 'explore-more', 'plant-information', 'culturalSignificance', 'selectedSpecies.category']) assert.ok(!source.includes(name), name)
  assert.match(css, /\.main-image-frame\s*\{[^}]*aspect-ratio: 4 \/ 3/)
  assert.match(css, /@media \(max-width: 899px\)[\s\S]*?\.hero-grid\s*\{[^}]*grid-template-columns: 1fr/)
  assert.doesNotMatch(css, /\.plant-image\s*\{[^}]*height: \d+px/)
  assert.match(css, /\.plant-image\s*\{[^}]*object-fit: cover/)
  assert.ok(source.includes('.showModal()')); assert.ok(source.includes('@cancel.prevent="closeZoom"')); assert.ok(source.includes('@close="closeZoom"'))
})

test('new utility labels and counts render in all supported locales', async () => {
  for (const locale of ['en','ms','zh-CN']) { const h = harness({ locale }); try { await flush(); for (const key of ['profileEyebrow','enlargeImage','loadedRecords','noLoadedRecords','loading','loadingRecords']) { const label = h.t(`species.detail.${key}`); assert.notEqual(label, `species.detail.${key}`); assert.ok(!label.includes('?')); if (locale === 'zh-CN') assert.match(label, /\p{Script=Han}/u) } } finally { h.stop() } }
})


test('hero separates an unboxed gallery from a content-sized white information card', () => {
  const css = descriptor.styles[0].content
  const grid = /\.hero-grid\s*\{([^}]+)\}/.exec(css)[1]
  assert.match(grid, /align-items: start/)
  assert.match(grid, /gap: 24px/)
  assert.match(grid, /0\.44fr.*0\.56fr/)
  assert.doesNotMatch(grid, /background:|border:|border-radius:|box-shadow:|overflow: hidden|height:/)
  const gallery = /\.profile-images\s*\{([^}]+)\}/.exec(css)[1]
  assert.match(gallery, /align-self: start/)
  assert.doesNotMatch(gallery, /background:|border:|box-shadow:|padding:/)
  const copy = /\.hero-copy\s*\{([^}]+)\}/.exec(css)[1]
  assert.match(copy, /background: #fff;/)
  assert.match(copy, /border: 1px solid/)
  assert.match(copy, /border-radius: 26px/)
  assert.match(copy, /box-shadow:/)
  assert.match(copy, /align-self: start/)
  assert.match(copy, /padding: clamp\(22px, 2.8vw, 36px\)/)
  assert.match(copy, /overflow-wrap: anywhere/)
  assert.doesNotMatch(copy, /(?:^|[;\s])(?:min-|max-)?height:|overflow: hidden/)
  assert.match(css, /\.profile-taxonomy\s*\{[^}]*repeat\(2, minmax\(0, 1fr\)\)/)
  assert.doesNotMatch(/\.summary\s*\{([^}]+)\}/.exec(css)[1], /(?:^|[;\s])height:|line-clamp|overflow: hidden/)
})

test('image frame remains rounded and proportional, with no background panel around thumbnails or fallback', () => {
  const css = descriptor.styles[0].content
  for (const selector of ['species-image-card', 'plant-placeholder', 'species-thumbnails']) {
    const block = new RegExp('\\.' + selector + '\\s*\\{([^}]+)\\}').exec(css)[1]
    assert.match(block, /background: transparent;/)
    assert.doesNotMatch(block, /box-shadow|background: #fff/)
  }
  const frame = /\.main-image-frame\s*\{([^}]+)\}/.exec(css)[1]
  assert.match(frame, /aspect-ratio: 4 \/ 3/)
  assert.match(frame, /flex: none/)
  assert.match(frame, /border-radius: 22px/)
  assert.doesNotMatch(frame, /background:|box-shadow|height:/)
  assert.match(css, /\.species-thumbnails\s*\{[^}]*padding: 4px/)
  assert.match(css, /\.zoom-content img\s*\{[^}]*object-fit: contain/)
})


test('taxonomy strip omits absent fields and stays hidden when both are missing', async () => {
  for (const fields of [{}, { family_name: 'Real family' }, { genus_name: 'Real genus' }]) {
    const h = harness({ handler: async p => p.includes('/species/') ? { species: { species_id: '201', scientific_name: 'Real name', ...fields } } : p.includes('/plants') ? { plants: [] } : { assets: [] } })
    try {
      await flush()
      const strips = h.render().filter(n => n.type === 'dl' && JSON.stringify(n.props?.class).includes('profile-taxonomy'))
      assert.equal(strips.length, Object.keys(fields).length ? 1 : 0)
      if (strips.length) assert.ok(JSON.stringify(strips[0].props.class).includes('single-field'))
    } finally { h.stop() }
  }
  const css = descriptor.styles[0].content
  assert.match(css, /\.profile-taxonomy > div\s*\{[^}]*background: #f4f6f1/)
  assert.match(css, /\.detail-hero > \.detail-container\s*\{[^}]*max-width: 1080px/)
  assert.match(css, /\.profile-heading-line \.section-label\s*\{[^}]*text-transform: uppercase/)
  assert.doesNotMatch(css, /\.plant-image\s*\{[^}]*object-fit: contain/)
})


test('profile badge precedes H1; decorative taxonomy icons stay small and accessible', async () => {
  const h = harness()
  try {
    await flush()
    const tree = h.render(), icons = tree.filter(n => n.type === 'svg' && n.props?.class === 'taxonomy-icon')
    assert.equal(icons.length, 2)
    for (const icon of icons) { assert.equal(icon.props['aria-hidden'], 'true'); assert.equal(icon.props.focusable, 'false') }
    assert.ok(tree.findIndex(n => n.props?.class === 'profile-heading-line') < tree.findIndex(n => n.type === 'h1'))
    assert.ok(tree.some(n => n.type === 'p' && n.props?.class === 'scientific-name'))
  } finally { h.stop() }
  const css = descriptor.styles[0].content
  assert.match(css, /\.taxonomy-icon\s*\{[^}]*width: 18px;[^}]*height: 18px/)
  assert.match(css, /@media \(max-width: 420px\)[\s\S]*?\.profile-taxonomy\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/)
})

test('scientific-name fallback heading is not duplicated as a secondary line', async () => {
  const h = harness({ handler: async p => p.includes('/species/') ? { species: { species_id: '201', scientific_name: 'Only scientific' } } : p.includes('/plants') ? { plants: [] } : { assets: [] } })
  try { await flush(); const tree = h.render(); assert.equal(tree.filter(n => n.children === 'Only scientific').length, 1); assert.ok(!tree.some(n => n.props?.class === 'scientific-name')); assert.equal(tree.filter(n => n.props?.class === 'taxonomy-icon').length, 0) } finally { h.stop() }
})


test('documented plant copy counts loaded matches separately from preview cards in every locale', async () => {
  for (const locale of ['en', 'ms', 'zh-CN']) {
    for (const count of [1, 6]) {
      const h = harness({ locale, handler: async p => p.includes('/species/') ? { species } : p.includes('/plants') ? { plants: [...Array.from({ length: count }, (_, i) => ({ plant_id: i + 1, species_id: 201 })), { plant_id: 90, species_id: 202 }, { plant_id: 91, species_id: 201, rbac_status: 'Pending Review' }] } : { assets: [] } })
      try {
        await flush()
        const tree = h.render(), expected = h.t('species.detail.loadedRecords', { count }, count)
        assert.ok(tree.some(n => n.children === expected))
        assert.ok(tree.some(n => n.children === h.t('species.detail.linkedDescription')))
        assert.ok(tree.some(n => n.type === 'h2' && n.children === h.t('species.detail.linkedTitle')))
        assert.equal(h.state.linkedPlants.value.length, count)
        assert.equal(tree.filter(n => n.props?.plant).length, Math.min(3, count))
        if (count > 3) assert.ok(tree.some(n => n.children === h.t('species.detail.previewRecords', { count: 3, loaded: count })))
        else assert.ok(!tree.some(n => n.children === h.t('species.detail.previewRecords', { count, loaded: count })))
        if (locale === 'en') assert.equal(expected, count === 1 ? '1 plant record found in loaded results.' : '6 plant records found in loaded results.')
        assert.ok(!expected.includes('|'))
      } finally { h.stop() }
    }
  }
})

test('documented plant count remains hidden during loading, empty results and failed requests', async () => {
  let resolvePlants
  const h = harness({ handler: p => p.includes('/species/') ? { species } : p.includes('/plants') ? new Promise(resolve => { resolvePlants = resolve }) : { assets: [] } })
  try {
    await flush()
    assert.ok(h.state.plantsLoading.value)
    assert.ok(h.render().some(n => n.props?.role === 'status' && n.children === h.t('species.detail.loadingRecords')))
    assert.ok(!h.render().some(n => String(n.children).includes('found in loaded results')))
    resolvePlants({ plants: [] }); await flush()
    assert.ok(h.render().some(n => n.children === h.t('species.detail.noLoadedRecords')))
    assert.ok(!h.render().some(n => String(n.children).includes('found in loaded results')))
    assert.ok(!h.render().some(n => n.props?.to === '/species/201/plants'))
  } finally { h.stop() }
  const failed = harness({ handler: async p => { if (p.includes('/species/')) return { species }; if (p.includes('/plants')) throw Error('Unavailable'); return { assets: [] } } })
  try { await flush(); assert.ok(failed.render().some(n => n.props?.role === 'alert')); assert.ok(!failed.render().some(n => String(n.children).includes('found in loaded results'))) } finally { failed.stop() }
})


const thumbnails = h => h.render().filter(n => n.type === 'button' && String(n.props?.class).includes('photo-thumbnail'))
const galleryHandler = (assets, portrait = species) => async p => p.includes('/species/') ? { species: portrait } : p.includes('/plants') ? { plants: [] } : { assets }

test('integrated collection keeps backend portrait first, deduplicates URLs and preserves direct API order', async () => {
  const h = harness({ handler: galleryHandler([{ id: 'b', content_type: 'image/png' }, { id: 'portrait', content_type: 'image/jpeg' }, { id: 'a', content_type: 'image/jpeg' }, { id: 'b', content_type: 'image/png' }, { id: 'pdf', content_type: 'application/pdf' }, { id: '../unsafe', content_type: 'image/jpeg' }]) })
  try { await flush()
    assert.deepEqual(Array.from(h.state.galleryImages.value), ['portrait','b','a'].map(id => '/api/data/assets/' + id))
    assert.equal(h.state.primaryImage.value, '/api/data/assets/portrait')
    assert.equal(thumbnails(h).length, 3)
    assert.ok(thumbnails(h)[0].props['aria-pressed'])
    assert.ok(!h.render().some(n => n.props?.class === 'botanical-gallery'))
    assert.ok(h.render().some(n => n.props?.class === 'individual-plants'))
  } finally { h.stop() }
})

test('thumbnail clicks select locally, expose active state and open no modal or write request', async () => {
  const h = harness()
  try { await flush(); const calls = h.calls.length
    const second = thumbnails(h)[1]
    assert.equal(second.props.type, 'button'); assert.equal(second.props['aria-label'], 'View species photo 2')
    second.props.onClick(); await vue.nextTick()
    assert.equal(h.state.primaryImage.value, '/api/data/assets/gallery'); assert.equal(h.state.zoomImage.value, '')
    assert.equal(h.calls.length, calls)
    assert.ok(thumbnails(h)[1].props['aria-pressed']); assert.ok(String(thumbnails(h)[1].props.class).includes('is-selected'))
    h.state.selectImage('/api/data/assets/not-returned'); assert.equal(h.state.primaryImage.value, '/api/data/assets/gallery')
  } finally { h.stop() }
})

test('zero/one image omits thumbnail controls and does not invent evidence candidates', async () => {
  for (const portrait of [{ ...species, image_url: '', image_asset_id: '' }, species]) {
    const h = harness({ handler: galleryHandler([], portrait) })
    try { await flush(); assert.equal(thumbnails(h).length, 0); assert.equal(h.render().filter(n => String(n.props?.class).includes('image-nav')).length, 0); assert.equal(h.render().filter(n => n.props?.class === 'gallery-counter').length, 0); assert.equal(Boolean(h.state.primaryImage.value), Boolean(portrait.image_url)); assert.equal(h.calls.length, 3) } finally { h.stop() }
  }
})

test('failed thumbnails leave selection healthy and failed selected image advances without new requests', async () => {
  const h = harness({ handler: galleryHandler([{ id: 'one', content_type: 'image/jpeg' }, { id: 'two', content_type: 'image/png' }]) })
  try { await flush(); const calls = h.calls.length
    const thumb = thumbnails(h)[1], img = nodes(thumb).find(n => n.type === 'img')
    img.props.onError(); await vue.nextTick()
    assert.deepEqual(Array.from(h.state.galleryImages.value), ['/api/data/assets/portrait','/api/data/assets/two'])
    assert.equal(h.state.primaryImage.value, '/api/data/assets/portrait')
    h.state.selectImage('/api/data/assets/two'); h.state.imageFailed('/api/data/assets/two')
    assert.equal(h.state.primaryImage.value, '/api/data/assets/portrait')
    h.state.mainImageFailed({ currentTarget: { getAttribute: () => '/api/data/assets/portrait' } })
    assert.equal(h.state.primaryImage.value, ''); assert.equal(thumbnails(h).length, 0); assert.equal(h.calls.length, calls)
    h.state.mainImageFailed({ currentTarget: { getAttribute: () => '/api/data/assets/stale-other-species' } })
    assert.ok(!h.state.failedImages.value.includes('/api/data/assets/stale-other-species'))
  } finally { h.stop() }
})

test('zoom follows current thumbnail, advances on failure and restores scroll and focus when none remain', async () => {
  const h = harness()
  try { await flush(); let focused = 0
    h.state.dialog.value = { open: false, showModal() { this.open = true }, close() { this.open = false } }
    h.state.portraitTrigger.value = { isConnected: true, focus() { focused++ } }
    h.state.selectImage('/api/data/assets/gallery'); await h.state.openZoom()
    assert.equal(h.state.zoomImage.value, '/api/data/assets/gallery'); assert.equal(h.body.style.overflow, 'hidden')
    h.state.imageFailed('/api/data/assets/gallery'); assert.equal(h.state.zoomImage.value, '/api/data/assets/portrait'); assert.equal(h.body.style.overflow, 'hidden')
    assert.equal(h.state.primaryImage.value, '/api/data/assets/portrait')
    h.state.imageFailed('/api/data/assets/portrait'); assert.equal(h.state.zoomImage.value, ''); assert.equal(h.body.style.overflow, 'auto'); assert.ok(focused)
  } finally { h.stop() }
})

test('selection and failed URLs reset on route/account changes, and stale asset lists stay discarded', async () => {
  let release, hold = false
  const h = harness({ initial: officer, handler: p => p.includes('/species/') ? { species: { ...species, species_id: p.split('/').at(-1) } } : p.includes('/plants') ? { plants: [] } : hold ? new Promise(resolve => { release = resolve }) : { assets: [{ id: 'staff-image', content_type: 'image/jpeg' }] } })
  try { await flush(); h.state.selectImage('/api/data/assets/staff-image'); h.state.imageFailed('/api/data/assets/portrait')
    hold = true; void h.state.loadSpecies(); await flush(); h.change(null, true)
    assert.equal(h.state.selectedImage.value, ''); assert.equal(h.state.galleryImages.value.length, 0); assert.equal(h.state.failedImages.value.length, 0)
    release({ assets: [{ id: 'late-private', content_type: 'image/jpeg' }] }); await flush(); assert.equal(h.state.galleryImages.value.length, 0)
    hold = false; h.change(null); await flush(); h.state.selectImage('/api/data/assets/staff-image'); h.route.params.slug = '202'
    assert.equal(h.state.selectedImage.value, ''); assert.equal(h.state.galleryImages.value.length, 0)
    await flush(); assert.equal(h.state.primaryImage.value, '/api/data/assets/portrait')
  } finally { h.stop() }
})

test('asset-list error stays inline without hiding portrait, habitat or documented plants', async () => {
  const h = harness({ initial: officer, handler: async p => { if (p.includes('/species/')) return { species }; if (p.includes('/plants')) return { plants: [] }; throw Error('Gallery failed') } })
  try { await flush(); assert.equal(h.state.primaryImage.value, '/api/data/assets/portrait')
    assert.ok(h.render().some(n => n.props?.class === 'profile-image-error' && n.props.role === 'alert'))
    assert.ok(h.render().some(n => n.props?.class === 'profile-habitat')); assert.ok(h.render().some(n => n.props?.class === 'individual-plants'))
    assert.equal(thumbnails(h).length, 0)
  } finally { h.stop() }
})

test('thumbnail strip stays within left column, scrolls without shrinking buttons, and translates neutral labels', async () => {
  const css = descriptor.styles[0].content
  assert.match(css, /\.species-thumbnails\s*\{[^}]*overflow-x: auto/)
  assert.match(css, /\.photo-thumbnail\s*\{[^}]*flex: 0 0 64px;[^}]*height: 52px/)
  assert.match(css, /\.photo-thumbnail:focus-visible/)
  assert.doesNotMatch(source, /botanical-gallery|gallery-grid|gallery-placeholder/)
  for (const locale of ['en','ms','zh-CN']) {
    const h = harness({ locale }); try { await flush(); const label = thumbnails(h)[1].props['aria-label']; assert.equal(label, h.t('species.detail.viewPhoto', { number: 2 })); assert.ok(!label.includes('species.detail.')); assert.ok(!label.includes('?')); assert.equal(thumbnails(h).length, 2) } finally { h.stop() }
  }
})


test('catalogue and detail initialize to the same backend URL or asset-ID portrait despite gallery order', async () => {
  const listed = [{ id: 'first-gallery', content_type: 'image/png' }, { id: 'second-gallery', content_type: 'image/jpeg' }]
  for (const fields of [{ image_url: '/api/assets/backend', image_asset_id: 'unused' }, { image_asset_id: 'backend-id' }, {}]) {
    const row = { species_id: '201', scientific_name: 'Actual species', ...fields }
    const h = harness({ handler: galleryHandler(listed, row) })
    try { await flush(); assert.equal(h.state.primaryImage.value, assets.speciesImageSelection(listed, fields.image_url, fields.image_asset_id).image); assert.equal(h.state.selectedImage.value, '') } finally { h.stop() }
  }
})

test('separate hero sections retain long descriptions with zero, one and multiple photographs', async () => {
  const description = 'Long species description. '.repeat(160) + 'LongUnbrokenName'.repeat(40)
  for (const count of [0, 1, 4]) {
    const record = { ...species, description, image_url: '', image_asset_id: '' }
    const refs = Array.from({ length: count }, (_, index) => ({ id: `photo-${index}`, content_type: 'image/jpeg' }))
    const h = harness({ handler: galleryHandler(refs, record) })
    try {
      await flush()
      const tree = h.render()
      assert.equal(tree.find(node => node.props?.class === 'summary').children, description)
      const hero = tree.find(node => node.props?.class === 'hero-grid')
      const sections = hero.children.filter(node => typeof node === 'object' && node.type === 'div')
      assert.deepEqual(Array.from(sections, node => node.props.class), ['profile-images', 'hero-copy'])
      assert.equal(h.state.galleryImages.value.length, count)
      assert.equal(thumbnails(h).length, count > 1 ? count : 0)
      if (!count) assert.ok(tree.some(node => node.props?.class === 'plant-placeholder'))
      assert.equal(h.calls.length, 3)
    } finally { h.stop() }
  }
})

function galleryPart(h, zoom = false) {
  return h.render().find(node => node.props?.class === (zoom ? 'zoom-photo-frame' : 'main-image-frame'))
}
function clickPhotoArrow(h, direction, zoom = false) {
  const arrow = nodes(galleryPart(h, zoom)).find(node => node.type === 'button' && node.props?.class === `image-nav ${direction}-photo`)
  assert.ok(arrow)
  let stopped = false
  arrow.props.onClick({ stopPropagation() { stopped = true } })
  assert.equal(stopped, true, 'arrow clicks must not bubble to zoom/backdrop handlers')
}
function checkCounter(h, current, total, zoom = false) {
  const counter = nodes(galleryPart(h, zoom)).find(node => node.props?.class === 'gallery-counter')
  assert.ok(counter)
  assert.equal(counter.props.role, 'status'); assert.equal(counter.props['aria-atomic'], 'true')
  assert.ok(nodes(counter).some(node => node.children === `${current} / ${total}`))
  assert.ok(nodes(counter).some(node => node.children === h.t('species.detail.photoCounter', { current, total })))
}
function setupZoom(h) {
  const focus = { close: 0, trigger: 0, opened: 0 }
  h.state.dialog.value = { open: false, showModal() { this.open = true; focus.opened++ }, close() { this.open = false } }
  h.state.closeButton.value = { focus() { focus.close++ } }
  h.state.portraitTrigger.value = { isConnected: true, focus() { focus.trigger++ } }
  return focus
}

test('main Previous/Next wraps in API order, updates thumbnail/counter and never opens zoom or loads assets', async () => {
  const h = harness({ handler: galleryHandler([{ id: 'one', content_type: 'image/jpeg' }, { id: 'two', content_type: 'image/png' }]) })
  try {
    await flush(); const focus = setupZoom(h), calls = h.calls.length
    const order = Array.from(h.state.galleryImages.value)
    assert.deepEqual(order, ['/api/data/assets/portrait', '/api/data/assets/one', '/api/data/assets/two'])
    const verify = index => {
      assert.equal(h.state.primaryImage.value, order[index])
      assert.deepEqual(thumbnails(h).map(node => node.props['aria-pressed']), order.map((_, position) => position === index))
      checkCounter(h, index + 1, 3)
      assert.equal(h.state.zoomImage.value, '')
    }
    verify(0)
    clickPhotoArrow(h, 'previous'); verify(2)
    clickPhotoArrow(h, 'next'); verify(0)
    clickPhotoArrow(h, 'next'); verify(1)
    clickPhotoArrow(h, 'next'); verify(2)
    clickPhotoArrow(h, 'next'); verify(0)
    assert.equal(focus.opened, 0); assert.equal(h.body.style.overflow, 'auto')
    assert.equal(h.calls.length, calls)
  } finally { h.stop() }
})

test('zoom arrow clicks navigate without closing, retain scroll lock/focus and synchronize both counters and thumbnails', async () => {
  const h = harness()
  try {
    await flush(); const focus = setupZoom(h), calls = h.calls.length
    await h.state.openZoom()
    assert.equal(focus.close, 1); assert.equal(h.state.dialog.value.open, true)
    checkCounter(h, 1, 2, true)
    clickPhotoArrow(h, 'next', true)
    assert.equal(h.state.zoomImage.value, '/api/data/assets/gallery')
    assert.equal(h.state.primaryImage.value, h.state.zoomImage.value)
    assert.equal(thumbnails(h)[1].props['aria-pressed'], true)
    checkCounter(h, 2, 2, true); checkCounter(h, 2, 2)
    assert.equal(nodes(galleryPart(h)).find(node => node.props?.class === 'gallery-counter').props['aria-live'], 'off')
    assert.equal(nodes(galleryPart(h, true)).find(node => node.props?.class === 'gallery-counter').props['aria-live'], 'polite')
    clickPhotoArrow(h, 'next', true); checkCounter(h, 1, 2, true)
    clickPhotoArrow(h, 'previous', true); checkCounter(h, 2, 2, true)
    assert.equal(h.state.dialog.value.open, true); assert.equal(h.body.style.overflow, 'hidden')
    assert.equal(focus.close, 1); assert.equal(focus.trigger, 0); assert.equal(focus.opened, 1)
    const dialog = h.render().find(node => node.type === 'dialog')
    dialog.props.onClick({ target: {}, currentTarget: {} })
    assert.equal(h.state.dialog.value.open, true)
    h.state.selectImage('/api/data/assets/portrait')
    assert.equal(h.state.zoomImage.value, '/api/data/assets/portrait')
    assert.equal(h.calls.length, calls)
  } finally { h.stop() }
})

test('dialog keyboard Left/Right wraps, Escape restores focus and unrelated keys preserve native behavior', async () => {
  const h = harness()
  try {
    await flush(); const focus = setupZoom(h)
    const key = (value, modifiers = {}) => {
      let prevented = false, stopped = false
      h.render().find(node => node.type === 'dialog').props.onKeydown({ key: value, ...modifiers, preventDefault() { prevented = true }, stopPropagation() { stopped = true } })
      return { prevented, stopped }
    }
    assert.equal(key('ArrowLeft').prevented, false)
    assert.equal(h.state.primaryImage.value, '/api/data/assets/portrait')
    await h.state.openZoom()
    assert.deepEqual(key('ArrowLeft'), { prevented: true, stopped: true })
    assert.equal(h.state.zoomImage.value, '/api/data/assets/gallery')
    assert.equal(key('ArrowRight').prevented, true)
    assert.equal(h.state.zoomImage.value, '/api/data/assets/portrait')
    assert.equal(key('ArrowRight', { ctrlKey: true }).prevented, false)
    assert.equal(key('Tab').prevented, false)
    assert.equal(key('Escape').prevented, true)
    assert.equal(h.state.zoomImage.value, ''); assert.equal(h.state.dialog.value.open, false)
    assert.equal(h.body.style.overflow, 'auto'); assert.equal(focus.trigger, 1)
  } finally { h.stop() }
})

test('broken active image selects the next valid image, updates navigation count and safely exhausts zoom', async () => {
  const h = harness({ handler: galleryHandler([{ id: 'one', content_type: 'image/jpeg' }, { id: 'two', content_type: 'image/png' }]) })
  try {
    await flush(); const focus = setupZoom(h), calls = h.calls.length
    h.state.navigateImage(1); await h.state.openZoom()
    h.state.imageFailed('/api/data/assets/one')
    assert.equal(h.state.primaryImage.value, '/api/data/assets/two')
    assert.equal(h.state.zoomImage.value, '/api/data/assets/two')
    checkCounter(h, 2, 2, true)
    clickPhotoArrow(h, 'next', true)
    assert.equal(h.state.primaryImage.value, '/api/data/assets/portrait')
    h.state.imageFailed('/api/data/assets/two'); await flush()
    assert.equal(h.state.zoomImage.value, '/api/data/assets/portrait')
    assert.equal(h.state.dialog.value.open, true); assert.equal(h.body.style.overflow, 'hidden')
    assert.equal(h.render().filter(node => String(node.props?.class).includes('image-nav')).length, 0)
    assert.equal(h.render().filter(node => node.props?.class === 'gallery-counter').length, 0)
    assert.ok(focus.close >= 2, 'when arrows disappear, focus returns to the dialog close button')
    h.state.navigateImage(1); assert.equal(h.state.primaryImage.value, '/api/data/assets/portrait')
    h.state.imageFailed('/api/data/assets/portrait')
    assert.equal(h.state.zoomImage.value, ''); assert.equal(h.body.style.overflow, 'auto')
    assert.equal(h.state.dialog.value.open, false); assert.ok(focus.trigger)
    assert.ok(h.render().some(node => node.props?.class === 'plant-placeholder'))
    assert.equal(h.calls.length, calls)
  } finally { h.stop() }
})

test('photo controls have localized accessible labels, touch targets, focus styles and reduced-motion support', async () => {
  const css = descriptor.styles[0].content
  assert.match(css, /\.image-nav\s*\{[^}]*position: absolute;[^}]*width: 44px; height: 44px/)
  assert.match(css, /\.image-nav:focus-visible\s*\{[^}]*outline:/)
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*?\.image-nav\s*\{[^}]*transition: none/)
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*?animation: none/)
  for (const locale of ['en', 'ms', 'zh-CN']) {
    const h = harness({ locale })
    try {
      await flush()
      const arrows = nodes(galleryPart(h)).filter(node => node.type === 'button' && String(node.props?.class).includes('image-nav'))
      assert.equal(arrows.length, 2)
      for (const [index, label] of ['previousPhoto', 'nextPhoto'].entries()) {
        assert.equal(arrows[index].props.type, 'button')
        assert.equal(arrows[index].props['aria-label'], h.t(`species.detail.${label}`))
        assert.notEqual(arrows[index].props['aria-label'], `species.detail.${label}`)
        assert.equal(nodes(arrows[index]).find(node => node.type === 'svg').props['aria-hidden'], 'true')
      }
      checkCounter(h, 1, 2)
      const translated = h.t('species.detail.photoCounter', { current: 1, total: 2 })
      assert.ok(!translated.includes('species.detail.'))
    } finally { h.stop() }
  }
})

test('lightbox removes its panel, shrink-wraps the photograph and anchors controls to the image frame', () => {
  const css = descriptor.styles[0].content
  const dialog = /\.portrait-dialog\s*\{([^}]+)\}/.exec(css)[1]
  assert.match(dialog, /background: transparent/)
  assert.match(dialog, /padding: 0/); assert.match(dialog, /border: 0/)
  assert.match(dialog, /box-shadow: none/); assert.match(dialog, /overflow: hidden/)
  assert.match(css, /\.portrait-dialog::backdrop\s*\{[^}]*background: rgb\(8 24 17 \/ 85%\)/)
  const content = /\.zoom-content\s*\{([^}]+)\}/.exec(css)[1]
  assert.match(content, /align-items: center; justify-content: center/)
  assert.doesNotMatch(content, /background:|padding:/)
  const frame = /\.zoom-photo-frame\s*\{([^}]+)\}/.exec(css)[1]
  assert.match(frame, /position: relative/); assert.match(frame, /width: fit-content/)
  assert.doesNotMatch(frame, /width: 100%|background:|padding:|min-width:/)
  assert.match(css, /\.zoom-close\s*\{[^}]*position: absolute; top: -12px; right: -12px/)
  assert.match(css, /\.zoom-close\s*\{[^}]*width: 44px; height: 44px/)
  assert.match(css, /\.zoom-close:focus-visible\s*\{[^}]*outline: 3px solid #fff/)
  assert.match(css, /\.zoom-photo-frame \.previous-photo\s*\{ left: -52px/)
  assert.match(css, /\.zoom-photo-frame \.next-photo\s*\{ right: -52px/)
  assert.match(css, /\.zoom-photo-frame \.gallery-counter\s*\{[^}]*top: calc\(100% \+ 12px\)[^}]*left: 50%[^}]*background: transparent/)
})

test('lightbox sizing preserves intrinsic dimensions and reserves viewport space for controls across image shapes', () => {
  const image = /\.zoom-content img\s*\{([^}]+)\}/.exec(descriptor.styles[0].content)[1]
  assert.match(image, /width: auto; height: auto; object-fit: contain/)
  assert.match(image, /max-width: calc\(100vw - 128px\)/)
  assert.match(image, /max-height: calc\(100dvh - 128px\)/)
  assert.doesNotMatch(image, /object-fit: cover|width: 100%|height: 100%|min-width:|min-height:/)
})

test('lightbox closes only on outside/close clicks, restores focus and scroll, and keeps controls beside the photo', async () => {
  const h = harness()
  try {
    await flush(); const focus = setupZoom(h)
    await h.state.openZoom()
    const frame = galleryPart(h, true)
    const close = nodes(frame).find(node => node.type === 'button' && node.props?.class === 'zoom-close')
    assert.ok(close, 'close is a child of the image-sized frame')
    assert.equal(close.props['aria-label'], h.t('common.close'))
    assert.equal(close.props.type, 'button')
    assert.equal(nodes(close).find(node => node.type === 'svg').props['aria-hidden'], 'true')
    assert.ok(!nodes(close).some(node => node.children === h.t('common.close')), 'close is an icon, not a text button')
    let stopped = false
    const image = nodes(frame).find(node => node.type === 'img')
    frame.props.onClick({ target: image, currentTarget: frame, stopPropagation() { stopped = true } })
    assert.equal(stopped, true)
    const content = h.render().find(node => node.props?.class === 'zoom-content')
    content.props.onClick({ target: image, currentTarget: content })
    assert.equal(h.state.dialog.value.open, true, 'an image click does not close')
    clickPhotoArrow(h, 'next', true)
    assert.equal(h.state.dialog.value.open, true); assert.equal(h.body.style.overflow, 'hidden')
    content.props.onClick({ target: content, currentTarget: content })
    assert.equal(h.state.dialog.value.open, false); assert.equal(h.body.style.overflow, 'auto')
    assert.equal(focus.trigger, 1)
    await h.state.openZoom()
    const closeAgain = nodes(galleryPart(h, true)).find(node => node.props?.class === 'zoom-close')
    closeAgain.props.onClick({ stopPropagation() {} })
    assert.equal(h.state.zoomImage.value, ''); assert.equal(h.body.style.overflow, 'auto')
    assert.equal(focus.trigger, 2)
  } finally { h.stop() }
})

test('icon close uses the existing translated accessible name in every supported language', async () => {
  for (const locale of ['en', 'ms', 'zh-CN']) {
    const h = harness({ locale })
    try {
      await flush(); setupZoom(h); await h.state.openZoom()
      const close = nodes(galleryPart(h, true)).find(node => node.props?.class === 'zoom-close')
      assert.equal(close.props['aria-label'], h.t('common.close'))
      assert.notEqual(close.props['aria-label'], 'common.close')
    } finally { h.stop() }
  }
})

test('View All Plants is a single translated heading action with the unchanged route and linked-record condition', async () => {
  for (const count of [0, 1, 6]) {
    const h = harness({ handler: async path => path.includes('/species/') ? { species } : path.includes('/plants') ? { plants: Array.from({ length: count }, (_, i) => ({ plant_id: i + 1, species_id: 201 })) } : { assets: [] } })
    try {
      await flush()
      const tree = h.render()
      const links = tree.filter(node => node.props?.class === 'view-all-plants')
      assert.equal(links.length, count ? 1 : 0)
      if (!count) continue
      const heading = tree.find(node => node.props?.class === 'plants-heading-row')
      assert.ok(nodes(heading).includes(links[0]), 'link sits with the title, not beneath plant cards')
      assert.ok(nodes(heading).some(node => node.props?.id === 'individual-plants-title'))
      assert.equal(links[0].props.to, '/species/201/plants')
      assert.ok(nodes(links[0]).some(node => node.children === h.t('species.detail.viewAll')))
      assert.equal(nodes(links[0]).find(node => node.type === 'svg').props['aria-hidden'], 'true')
      assert.equal(h.render().filter(node => node.props?.to === '/species/201/plants').length, 1)
    } finally { h.stop() }
  }
  assert.ok(!source.includes('view-all-row'))
})

test('View All Plants uses a responsive outlined touch target with focus and reduced-motion states', () => {
  const css = descriptor.styles[0].content
  const button = /\.view-all-plants\s*\{([^}]+)\}/.exec(css)[1]
  assert.match(button, /min-height: 44px/)
  assert.match(button, /padding: 12px 18px/)
  assert.match(button, /border: 1px solid #a7c4b0; border-radius: 12px; background: #f8faf5; color: #315b49/)
  assert.doesNotMatch(button, /box-shadow|999px/)
  assert.match(css, /\.view-all-plants:hover\s*\{[^}]*background: #315b49; color: #fff/)
  assert.match(css, /\.view-all-plants:focus-visible\s*\{[^}]*outline: 3px/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{ \.view-all-plants \{ transition: none/)
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*?\.plants-heading-row\s*\{ flex-direction: column; align-items: flex-start/)
})

test('Species Profile orders identity, taxonomy, authorized Habitat, divider and plain Description inside one card', async () => {
  const h = harness({ initial: officer })
  try {
    await flush()
    const tree = h.render(), profile = tree.find(node => node.props?.class === 'hero-copy'), content = nodes(profile)
    const index = predicate => content.findIndex(predicate)
    const positions = [
      index(node => node.props?.class === 'profile-heading-line'),
      index(node => node.type === 'h1'),
      index(node => node.props?.class === 'scientific-name'),
      index(node => String(node.props?.class).includes('profile-taxonomy')),
      index(node => node.props?.class === 'profile-habitat'),
      index(node => node.props?.class === 'profile-divider'),
      index(node => node.props?.class === 'profile-description'),
    ]
    assert.ok(positions.every(position => position >= 0))
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b))
    const habitat = content[positions[4]], description = content[positions[6]]
    assert.ok(nodes(habitat).some(node => node.children === species.habitat))
    assert.ok(nodes(description).some(node => node.props?.class === 'summary' && node.children === species.description))
    assert.equal(nodes(habitat).find(node => node.type === 'svg').props['aria-hidden'], 'true')
    for (const block of [habitat, description]) assert.ok(nodes(block).some(node => node.type === 'h2' && node.props?.id === block.props['aria-labelledby']))
    assert.equal(tree.filter(node => node.props?.class === 'profile-habitat').length, 1)
    assert.equal(tree.filter(node => node.props?.class === 'habitat-section').length, 0)
    assert.equal(h.calls.length, 3)
  } finally { h.stop() }
})

test('Habitat remains restricted to eligible scientific roles even when the response supplies it to other users', async () => {
  const accounts = [null, { ...officer, role: 'Visitor' }, { ...officer, role: 'Administrator' },
    { ...officer, status: 'Inactive' }, { ...officer, mustChangePassword: true }, officer, { ...officer, role: 'Botanist' }]
  for (const initial of accounts) {
    const h = harness({ initial })
    try {
      await flush()
      const allowed = Boolean(initial && ['Conservation Officer', 'Botanist'].includes(initial.role) && initial.status === 'Active' && !initial.mustChangePassword)
      const tree = h.render()
      assert.equal(tree.some(node => node.props?.class === 'profile-habitat'), allowed)
      assert.equal(tree.some(node => node.props?.class === 'profile-divider'), allowed)
      assert.equal(tree.some(node => node.children === species.habitat), allowed)
      assert.equal(h.state.selectedSpecies.value.habitat, allowed ? species.habitat : '')
      assert.ok(tree.some(node => node.props?.class === 'summary' && node.children === species.description))
    } finally { h.stop() }
  }
})

test('empty Habitat and Description omit their blocks and never leave an orphan divider; long content stays complete', async () => {
  const long = 'Long natural text. '.repeat(250) + 'UnbrokenContent'.repeat(90)
  for (const habitat of ['', '   ', 'Short habitat', long]) for (const description of ['', 'Short description', long]) {
    const h = harness({ initial: officer, handler: galleryHandler([], { ...species, habitat, description }) })
    try {
      await flush()
      const tree = h.render(), hasHabitat = Boolean(habitat.trim()), hasDescription = Boolean(description.trim())
      assert.equal(tree.some(node => node.props?.class === 'profile-habitat'), hasHabitat)
      assert.equal(tree.some(node => node.props?.class === 'profile-description'), hasDescription)
      assert.equal(tree.some(node => node.props?.class === 'profile-divider'), hasHabitat && hasDescription)
      if (hasHabitat) assert.ok(nodes(tree.find(node => node.props?.class === 'profile-habitat')).some(node => node.type === 'p' && node.children === habitat.trim()))
      if (hasDescription) assert.equal(tree.find(node => node.props?.class === 'summary').children, description)
      assert.equal(tree.filter(node => node.props?.class === 'main-image-frame').length, 1)
    } finally { h.stop() }
  }
})

test('Habitat matches taxonomy styling, Description has no nested card, and headings use existing translations', async () => {
  const css = descriptor.styles[0].content
  const habitat = /\.profile-habitat\s*\{([^}]+)\}/.exec(css)[1]
  assert.match(habitat, /padding: 16px 18px; border-radius: 12px; background: #f4f6f1/)
  assert.match(css, /\.profile-taxonomy > div\s*\{[^}]*padding: 16px 18px; border-radius: 12px; background: #f4f6f1/)
  assert.doesNotMatch(/\.profile-description\s*\{([^}]+)\}/.exec(css)[1], /background:|border:|box-shadow:|height:/)
  assert.match(css, /\.profile-divider\s*\{[^}]*border-top: 1px solid #dfe7df/)
  assert.match(css, /\.hero-copy\s*\{[^}]*overflow-wrap: anywhere/)
  assert.match(css, /\.profile-images\s*\{[^}]*align-self: start/)
  for (const locale of ['en', 'ms', 'zh-CN']) {
    const h = harness({ initial: officer, locale })
    try {
      await flush()
      assert.ok(h.render().some(node => node.type === 'h2' && node.children === h.t('conservationText.description')))
      assert.ok(h.render().some(node => node.type === 'span' && node.children === h.t('speciesLabels.habitat')))
    } finally { h.stop() }
  }
})
