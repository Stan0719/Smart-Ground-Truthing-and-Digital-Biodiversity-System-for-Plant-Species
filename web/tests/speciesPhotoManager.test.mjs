import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as vue from 'vue'
import * as service from '../src/services/speciesManagement.ts'
import * as assets from '../src/services/assetImages.ts'

const filename = new URL('../src/components/conservation/SpeciesPhotoManager.vue', import.meta.url)
const source = readFileSync(filename, 'utf8')
const { descriptor } = parse(source)
const script = compileScript(descriptor, { id: 'species-photo-manager' })
const template = compileTemplate({ source: descriptor.template.content, filename: filename.pathname, id: 'species-photo-manager', compilerOptions: { bindingMetadata: script.bindings } })
assert.deepEqual(template.errors, [])
const transpile = value => ts.transpileModule(value, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const messages = JSON.parse(readFileSync(new URL('../src/locales/en.json', import.meta.url), 'utf8'))
const readyCapability = { version: 1, activationRequested: true, writesEnabled: true, schemaReady: true, galleryAvailable: true, semanticRolesAvailable: true, migration014: 'verified-applied', migration015: 'verified-applied' }
const officer = { id: 'officer', role: 'Conservation Officer', status: 'Active', mustChangePassword: false }
const fixture = id => service.mapManagedSpecies({ species_id: id, common_name: `Common ${id}`, scientific_name: `Scientific ${id}`, image_url: '/api/assets/official' })
const jpeg = () => new File([new Uint8Array([255, 216, 255, 224, 1, 2])], 'leaf.jpg', { type: 'image/jpeg' })
const png = () => new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'stem.png', { type: 'image/png' })
const snapshot = () => ({ speciesId: 12, revision: 7, primaryAssetId: 'a', images: [
  { assetId: 'a', url: '/api/assets/a', contentType: 'image/jpeg', position: 0, eligible: true },
  { assetId: 'b', url: '/api/assets/b', contentType: 'image/png', position: 1, eligible: true },
] })
async function flush() { for (let i = 0; i < 5; i++) { await vue.nextTick(); await new Promise(setImmediate) } }
function nodes(root) {
  const found = []
  const visit = node => {
    if (Array.isArray(node)) return node.forEach(visit)
    if (!node || typeof node !== 'object') return
    found.push(node)
    if (Array.isArray(node.children)) visit(node.children)
  }
  visit(root); return found
}
const allText = root => nodes(root).map(node => typeof node.children === 'string' ? node.children : '').join(' ')
function harness(handler, account = officer, options = {}) {
  const scope = vue.effectScope(), props = vue.reactive({ species: options.create ? null : fixture('12'), embedded: options.embedded || false, busy: false })
  const exports = {}, mounted = [], calls = [], emitted = [], created = [], revoked = [], listeners = new Set()
  let session = { user: account, pending: false }, active = null, serial = 0
  class Element {
    isConnected = true
    focus() { active = this }
  }
  const opener = new Element(), closeButton = new Element()
  active = opener
  const dialog = Object.assign(new Element(), { open: false, showModal() { this.open = true }, close() { this.open = false } })
  const t = (key, params = {}) => {
    const result = key.split('.').reduce((entry, part) => entry?.[part], messages)
    return Object.entries(params).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), typeof result === 'string' ? result : key)
  }
  const context = { exports, console, Intl, crypto: globalThis.crypto, HTMLElement: Element, document: { get activeElement() { return active }, elementFromPoint: (...args) => options.hitTest?.(...args) },
    URL: { createObjectURL(file) { const url = `blob:preview-${++serial}`; created.push({ file, url }); return url }, revokeObjectURL(url) { revoked.push(url) } },
    require(name) {
      if (name === 'vue') return { ...vue, onMounted: callback => mounted.push(callback), useId: () => 'photo-test', withDirectives: node => node, resolveDynamicComponent: name => name }
      if (name === 'vue-i18n') return { useI18n: () => ({ t, locale: vue.ref('en') }) }
      if (name.endsWith('/auth')) return { sessionSnapshot: () => session, subscribeSession: listener => { listeners.add(listener); return () => listeners.delete(listener) } }
      if (name.endsWith('/assetImages')) return assets
      if (name.endsWith('/speciesManagement')) return { ...service, ...(options.services || {}), requestSpeciesApi: async (url, options = {}) => {
        calls.push({ url, options }); return handler ? handler(url, options) : url.startsWith('/api/species/')
          ? { species: { species_id: props.species?.id, image_url: '/api/assets/official' } }
          : { assets: [{ id: 'a', content_type: 'image/jpeg' }, { id: 'b', content_type: 'image/png' }] }
      } }
      throw Error(`Unexpected import ${name}`)
    },
  }
  vm.runInNewContext(`(function () { ${transpile(script.content)} })()`, context)
  const state = scope.run(() => exports.default.setup(props, { expose() {}, emit: event => emitted.push(event) }))
  state.dialog.value = vue.markRaw(dialog); state.closeButton.value = vue.markRaw(closeButton)
  vm.runInNewContext(`(function () { ${transpile(template.code)} })()`, context)
  return { state, props, calls, emitted, created, revoked, dialog, opener, closeButton,
    get active() { return active },
    render: () => exports.render({}, [], props, vue.proxyRefs(state), {}, {}),
    mount: async () => { for (const callback of mounted) await callback(); await flush() },
    files: async files => { const field = { files, value: 'selected' }; await state.selectFiles({ target: field }); return field },
    session: (user, pending = false) => { session = { user, pending }; listeners.forEach(listener => listener(user, pending)) },
    stop: () => scope.stop(),
  }
}

test('real species names, authoritative portrait and safe JPEG/PNG gallery render without management reads', async () => {
  const h = harness(url => url.startsWith('/api/species/')
    ? { species: { species_id: '12', image_url: '/api/assets/official' } }
    : { assets: [{ id: 'a', content_type: 'image/jpeg' }, { id: 'b', content_type: 'image/png' }, { id: 'a', content_type: 'image/jpeg' }, { id: 'pdf', content_type: 'application/pdf' }, { id: '../private', content_type: 'image/jpeg' }] })
  try {
    await h.mount()
    assert.match(allText(h.render()), /Common 12/); assert.match(allText(h.render()), /Scientific 12/)
    assert.equal(h.state.mainImage.value, '/api/data/assets/official')
    assert.deepEqual(Array.from(h.state.images.value, image => image.assetId), ['a', 'b'])
    assert.equal(h.state.draft.value, null); assert.equal(h.state.canonical.value, null)
    assert.deepEqual(h.calls.map(call => call.url).sort(), ['/api/data/assets?species_id=12', '/api/species/12', '/api/species/photos/capabilities'])
    assert.ok(h.calls.every(call => !call.options.method || call.options.method === 'GET'))
  } finally { h.stop() }
})

test('gallery-unavailable guidance follows canonical loading state without losing queued files or writing', async () => {
  for (const available of [false, true]) {
    let resolveGallery
    const gallery = new Promise(resolve => { resolveGallery = resolve })
    const h = harness(url => url === '/api/species/photos/capabilities'
      ? { ...readyCapability, activationRequested: false, writesEnabled: false }
      : url === '/api/species/12' ? { species: { species_id: 12 } } : { assets: [] },
    officer, { services: { readSpeciesGallery: async () => {
      const value = await gallery
      if (!available) throw Error('Canonical gallery unavailable')
      return value
    } } })
    try {
      await h.mount(); await h.files([jpeg()])
      assert.equal(h.state.loading.value, true)
      assert.doesNotMatch(allText(h.render()), /Saved primary and arrangement metadata are not available yet/)
      resolveGallery(snapshot()); await flush()
      assert.equal(h.state.loading.value, false)
      assert.equal(h.state.arrangementAvailable.value, available)
      if (available) {
        assert.doesNotMatch(allText(h.render()), /Saved primary and arrangement metadata are not available yet/)
        assert.equal(h.state.canonical.value.revision, 7)
      } else {
        assert.match(allText(h.render()), /Saved primary and arrangement metadata are not available yet/)
      }
      assert.equal(h.state.queue.value.length, 1)
      assert.equal(h.state.writesAvailable.value, false)
      assert.ok(h.calls.every(call => !call.options.method || call.options.method === 'GET'))
    } finally { resolveGallery(snapshot()); h.stop() }
  }
})

test('missing and failed images render neutral placeholders; failed reads are retryable', async () => {
  let failing = true
  const h = harness(() => { if (failing) throw Error('Unavailable'); return { assets: [] } })
  try {
    await h.mount(); assert.equal(h.state.readErrors.value.length, 2)
    assert.match(allText(h.render()), /could not be loaded/)
    failing = false
    await h.files([jpeg()]); await h.state.loadImages()
    assert.equal(h.state.queue.value.length, 1, 'retry must retain selected files')
    assert.match(allText(h.render()), /No authorized reference images/)
  } finally { h.stop() }
  const broken = harness()
  try { await broken.mount(); broken.state.failImage('/api/data/assets/a'); assert.match(allText(broken.render()), /Image unavailable/) }
  finally { broken.stop() }
})

test('native modal focuses close control, Escape cancels, and disposal restores the trigger', async () => {
  const h = harness()
  await h.mount()
  assert.equal(h.dialog.open, true); assert.equal(h.active, h.closeButton)
  const root = h.render()
  assert.equal(root.type, 'dialog'); assert.equal(root.props['aria-labelledby'], 'photo-test-title')
  let prevented = false
  await h.files([jpeg()])
  root.props.onCancel({ preventDefault() { prevented = true } })
  assert.equal(prevented, true); assert.equal(h.dialog.open, false)
  assert.deepEqual(h.emitted, ['close']); assert.equal(h.state.queue.value.length, 0)
  h.stop(); assert.equal(h.active, h.opener)
})

test('native input remains keyboard-focusable, labeled, multiple and restricted to JPEG/PNG', async () => {
  const h = harness()
  try {
    await h.mount()
    const rendered = nodes(h.render()), field = rendered.find(node => node.type === 'input')
    assert.equal(field.props.type, 'file'); assert.equal(field.props.accept, 'image/jpeg,image/png'); assert.equal(field.props.multiple, '')
    assert.ok(rendered.some(node => node.type === 'label' && node.props.for === field.props.id))
    assert.notEqual(field.props.tabindex, -1); assert.ok(field.props['aria-describedby'].includes('guidance'))
    assert.match(descriptor.styles[0].content, /focus-within[\s\S]*?outline: 3px/)
    assert.doesNotMatch(descriptor.styles[0].content, /\.visually-hidden\s*\{[^}]*display:\s*none/)
    assert.ok(!field.props.onKeydown, 'native file input supplies keyboard activation')
  } finally { h.stop() }
})

test('multiple real files become queued local previews; removal and repeat selection release URLs', async () => {
  const h = harness()
  try {
    await h.mount(); const field = await h.files([jpeg(), png()])
    assert.equal(field.value, ''); assert.equal(h.state.queue.value.length, 2)
    assert.ok(h.state.queue.value.every(item => item.status === 'queued'))
    assert.notEqual(h.state.queue.value[0].id, h.state.queue.value[1].id)
    assert.match(allText(h.render()), /leaf.jpg/); assert.match(allText(h.render()), /Queued/)
    const first = h.state.queue.value[0]
    const remove = nodes(h.render()).find(node => node.type === 'button' && node.props['aria-label'] === 'Remove leaf.jpg from queue')
    remove.props.onClick({ stopPropagation() {} }); assert.equal(h.state.queue.value.length, 1); assert.deepEqual(h.revoked, [first.url])
    await h.files([jpeg()]); assert.equal(h.state.queue.value.length, 2)
    assert.equal(h.calls.length, 3, 'selection and removal must never upload')
  } finally { h.stop() }
  assert.equal(h.revoked.length, h.created.length)
})

test('invalid MIME, empty, oversized and mismatched content are rejected with per-file errors', async () => {
  const h = harness()
  try {
    await h.mount()
    await h.files([
      new File(['%PDF'], 'fake.jpg', { type: 'application/pdf' }),
      new File([], 'empty.png', { type: 'image/png' }),
      new File([new Uint8Array(4194305)], 'large.png', { type: 'image/png' }),
      new File(['not an image'], 'renamed.jpg', { type: 'image/jpeg' }), jpeg(),
    ])
    assert.deepEqual(Array.from(h.state.fileErrors.value, error => error.key), ['unsupportedType', 'emptyFile', 'tooLarge', 'invalidImage'])
    assert.equal(h.state.queue.value.length, 1); assert.equal(h.created.length, 1)
    const rendered = allText(h.render())
    for (const name of ['fake.jpg', 'empty.png', 'large.png', 'renamed.jpg']) assert.ok(rendered.includes(name))
    assert.ok(nodes(h.render()).some(node => node.props?.['aria-live'] === 'polite'))
  } finally { h.stop() }
})

test('file limit is exactly 4 MiB and extension alone grants no trust', async () => {
  const bytes = new Uint8Array(4194304); bytes.set([255, 216, 255])
  assert.equal(await service.validateSpeciesPhoto(new File([bytes], 'no-extension', { type: 'image/jpeg' })), null)
  assert.equal(await service.validateSpeciesPhoto(new File([bytes], 'renamed.jpg', { type: 'text/plain' })), 'unsupportedType')
  assert.equal(await service.validateSpeciesPhoto(new File([png()], 'fake.jpg', { type: 'image/jpeg' })), 'invalidImage')
})

test('central gate disables uploads and arrangement saves even with valid files and a dirty draft', async () => {
  const h = harness()
  try {
    await h.mount(); await h.files([jpeg()]); h.state.initializeDraft(snapshot()); h.state.setMain('b')
    assert.equal(service.speciesPhotoWritesAvailable({}), false); assert.equal(h.state.dirty.value, true)
    for (const label of ['Upload Photos', 'Save Arrangement']) {
      const button = nodes(h.render()).find(node => node.type === 'button' && node.children === label)
      assert.equal(button.props.disabled, true)
    }
    assert.ok(h.calls.every(call => call.url !== '/api/assets' && !/\/images$/.test(call.url)))
    const text = allText(h.render())
    assert.match(text, /selected photos will remain unsaved/); assert.match(text, /after species image management is enabled/)
    assert.doesNotMatch(text, /successfully|Uploaded|saved successfully/)
  } finally { h.stop() }
})

test('read-only galleries cannot imply canonical primary/order or enable arrangement controls', async () => {
  const h = harness()
  try {
    await h.mount(); assert.equal(h.state.draft.value, null)
    h.state.expanded.value = true; await flush()
    const buttons = nodes(h.render()).filter(node => node.type === 'button' && (node.props?.class?.includes('set-main') || node.props?.title))
    assert.equal(buttons.length, 0, 'read-only library has no editing controls')
    assert.equal(h.state.editableCards.value.length, 0)
    h.state.setMain('b'); h.state.move('b', -1); h.state.stageRemoval('a')
    assert.equal(h.state.draft.value, null)
  } finally { h.stop() }
})

test('future canonical draft uses real revision, supports local primary/order/removal and resets on cancel', async () => {
  const h = harness()
  try {
    await h.mount(); h.state.initializeDraft(snapshot())
    assert.equal(h.state.draft.value.expectedRevision, 7)
    assert.equal(h.state.dirty.value, false)
    h.state.move('b', -1); assert.deepEqual(Array.from(h.state.draft.value.orderedAssetIds), ['b', 'a'])
    h.state.setMain('b'); assert.equal(h.state.mainImage.value, '/api/data/assets/b')
    h.state.stageRemoval('b'); assert.equal(h.state.draft.value.primaryAssetId, 'a')
    h.state.setMain('b'); assert.equal(h.state.draft.value.primaryAssetId, 'a', 'a staged removal cannot become primary again')
    assert.deepEqual(Array.from(h.state.draft.value.removedAssetIds), ['b'])
    assert.deepEqual(snapshot().images.map(image => image.assetId), ['a', 'b'])
    h.state.closeManager(); assert.equal(h.state.draft.value, null); assert.equal(h.state.canonical.value, null)
    assert.equal(h.calls.length, 3)
  } finally { h.stop() }
})

test('species changes, session transitions and unmount clear queue URLs and draft state', async () => {
  const h = harness()
  try {
    await h.mount(); await h.files([jpeg(), png()]); h.state.initializeDraft(snapshot())
    h.props.species = fixture('99'); await flush()
    assert.equal(h.state.queue.value.length, 0); assert.equal(h.revoked.length, 2); assert.equal(h.state.draft.value, null)
    assert.ok(h.calls.some(call => call.url.endsWith('species_id=99')))
    await h.files([jpeg()]); h.session(null, true)
    assert.equal(h.state.queue.value.length, 0); assert.equal(h.revoked.length, 3); assert.equal(h.state.images.value.length, 0)
    assert.deepEqual(h.emitted, ['close'])
  } finally { h.stop() }
})

test('late reads and file validation cannot repopulate a closed or changed manager', async () => {
  let resolveReads
  const blocked = new Promise(resolve => { resolveReads = resolve })
  const h = harness(() => blocked)
  try {
    await h.mount(); const selecting = h.files([jpeg()]); h.state.closeManager()
    resolveReads({ assets: [{ id: 'leak', content_type: 'image/jpeg' }] })
    await selecting; await flush()
    assert.equal(h.state.queue.value.length, 0); assert.equal(h.state.images.value.length, 0); assert.equal(h.created.length, 0)
  } finally { h.stop() }
})

test('direct manager initialization by unauthorized roles cannot read or queue images', async () => {
  for (const account of [null, { ...officer, role: 'Administrator' }, { ...officer, role: 'Botanist' }, { ...officer, role: 'Visitor' }]) {
    const h = harness(undefined, account)
    try { await h.mount(); await h.files([jpeg()]); assert.equal(h.calls.length, 0); assert.equal(h.created.length, 0); assert.deepEqual(h.emitted, ['close']) }
    finally { h.stop() }
  }
})

test('all supported locales provide matching complete photo-manager translations', () => {
  const expected = Object.keys(messages.conservationPages.species.photos).sort()
  for (const locale of ['en', 'ms', 'zh-CN']) {
    const translated = JSON.parse(readFileSync(new URL(`../src/locales/${locale}.json`, import.meta.url), 'utf8')).conservationPages.species.photos
    assert.deepEqual(Object.keys(translated).sort(), expected)
    assert.ok(Object.values(translated).every(text => typeof text === 'string' && text.trim() && !text.includes('?')))
  }
  const chinese = JSON.parse(readFileSync(new URL('../src/locales/zh-CN.json', import.meta.url), 'utf8')).conservationPages.species.photos
  assert.match(chinese.title, /[\u4e00-\u9fff]/)
})

test('responsive CSS keeps dialog, uploader and controls usable at required viewport widths', () => {
  const css = descriptor.styles[0].content
  assert.match(css, /max-height: calc\(100dvh - 32px\)/)
  assert.match(css, /overflow-y: auto/); assert.match(css, /minmax\(0, 1fr\)/)
  assert.match(css, /repeat\(auto-fill, minmax\(140px, 1fr\)\)/); assert.match(css, /object-fit: cover/)
  assert.match(css, /min-height: 44px/); assert.match(css, /prefers-reduced-motion/)
  assert.match(css, /\.thumbnail-remove \{[^}]*width: 44px; height: 44px/)
  assert.match(css, /\.thumbnail-remove > span \{[^}]*width: 28px; height: 28px;[^}]*background: #174a33; color: #fff;/)
  assert.doesNotMatch(source, /position-control|changePosition/)
  for (const width of [1440, 1280, 1024, 768, 390, 360]) {
    const gutter = width <= 480 ? 16 : 32
    const dialogWidth = Math.min(960, width - gutter)
    const padding = width <= 480 ? 32 : 56
    assert.ok(Math.min(420, dialogWidth - padding) <= width - gutter)
    if (width <= 480) assert.match(css, /@media \(max-width: 480px\)[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/)
  }
})

test('embedded Create uses first-position main while drag ordering and accessible moves preserve photo IDs', async () => {
  const h = harness(undefined, officer, { create: true, embedded: true })
  try {
    await h.mount(); assert.equal(h.dialog.open, false); assert.equal(h.render().type, 'section')
    assert.equal(h.calls.length, 1) // Create also verifies explicit server capability.
    await h.files([jpeg(), png()])
    const first = h.state.queue.value[0].id, second = h.state.queue.value[1].id
    assert.equal(h.state.queuePrimary.value, first)
    h.state.startDrag({ dataTransfer: { setData() {} } }, first, true)
    h.state.dropImage(second, true)
    assert.deepEqual(Array.from(h.state.queue.value, item => item.id), [second, first])
    assert.equal(h.state.queuePrimary.value, second)
    h.state.moveQueued(first, -1); assert.equal(h.state.queue.value[0].id, first)
    h.state.queuePrimary.value = second
    h.state.removeQueued(second); assert.equal(h.state.queuePrimary.value, first)
    assert.match(allText(h.render()), /Main Image/)
    const saved = await h.state.commitPhotos('42')
    assert.equal(saved.complete, false); assert.equal(saved.deferred, true)
    assert.equal(h.calls.length, 1); assert.equal(h.state.queue.value.length, 1)
  } finally { h.stop() }
})

test('Edit stays compact, expands inside the form and uses source-bound server continuation', async () => {
  const h = harness(url => url.includes('photo-library') ? { images: [{ assetId: 'whole', source: 'plant' }], page: { nextCursor: 'server-cursor' } }
    : url.includes('assets?') ? { assets: Array.from({ length: 25 }, (_, i) => ({ id: `ref-${i}`, content_type: 'image/jpeg' })) }
      : { species: { species_id: '12' } }, officer, { embedded: true })
  try {
    await h.mount(); assert.equal(h.state.displayedImages.value.length, 4)
    assert.match(allText(h.render()), /Showing 4 loaded photos/)
    h.state.expanded.value = true; await flush()
    assert.equal(h.render().type, 'section'); assert.equal(h.state.images.value[0].source, 'plant')
    assert.equal(h.state.nextCursor.value, 'server-cursor')
    h.state.sourceFilter.value = 'plant'; await h.state.loadLibrary('server-cursor')
    assert.ok(h.calls.some(call => call.url.includes('source=plant&limit=16&cursor=server-cursor')))
    assert.match(allText(h.render()), /stays linked to its observation/)
    assert.ok(!nodes(h.render()).some(node => node.props?.class?.includes('remove-reference')))
    assert.ok(!h.calls.some(call => /^\/api\/(?:data\/)?plants/.test(call.url)))
  } finally { h.stop() }
})

test('photo persistence retains successful upload receipts and failed files, retries without duplicate uploads', async () => {
  const original = globalThis.fetch
  const files = [jpeg(), png()].map((file, index) => ({ id: `file-${index}`, clientKey: `key-${index}`, file, url: `blob:${index}`, status: 'queued' }))
  let failSecond = true, saved = false
  const uploaded = new Set(), calls = []
  globalThis.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null; calls.push({ url, body, method: options.method || 'GET' })
    if (url.endsWith('capabilities')) return Response.json(readyCapability)
    if (url === '/api/assets') {
      if (body.client_key === 'key-1' && failSecond) return Response.json({ error: 'Storage failure' }, { status: 503 })
      const id = body.client_key === 'key-0' ? 'uploaded-a' : 'uploaded-b'; uploaded.add(id); return Response.json({ id })
    }
    if (options.method === 'PUT') { saved = true; assert.deepEqual(body.orderedAssetIds, ['uploaded-a', 'uploaded-b']); assert.equal(body.primaryAssetId, 'uploaded-b'); return Response.json({}) }
    return Response.json({ speciesId: 42, revision: saved ? 1 : 0, managed: saved, primaryAssetId: saved ? 'uploaded-b' : null,
      images: [...uploaded].map((id, position) => ({ assetId: id, url: `/api/assets/${id}`, contentType: 'image/jpeg', position, eligible: true })) })
  }
  try {
    const base = { speciesId: 42, revision: 0, managed: false, primaryAssetId: null, images: [] }
    const partial = await service.persistSpeciesPhotoBatch('42', base, files, 'file-1', null)
    assert.equal(partial.complete, false); assert.equal(files[0].status, 'uploaded'); assert.equal(files[1].status, 'failed')
    failSecond = false
    const retry = await service.persistSpeciesPhotoBatch('42', base, files, 'file-1', null)
    assert.equal(retry.complete, true)
    assert.equal(calls.filter(call => call.url === '/api/assets' && call.body.client_key === 'key-0').length, 1)
    assert.equal(calls.filter(call => call.url === '/api/species').length, 0)
  } finally { globalThis.fetch = original }
})

test('unavailable capability and stale canonical revisions never send uploads or overwrite an arrangement', async () => {
  const original = globalThis.fetch
  const baseline = { speciesId: 12, managed: true, revision: 7, primaryAssetId: 'a', images: snapshot().images }
  let available = false, writes = 0
  globalThis.fetch = async (url, options = {}) => {
    if (options.method && options.method !== 'GET') writes++
    if (url.endsWith('capabilities')) return Response.json({ ...readyCapability, writesEnabled: available })
    return Response.json({ ...baseline, revision: 8 })
  }
  try {
    const draft = service.createSpeciesGalleryDraft(baseline)
    await assert.rejects(service.persistSpeciesPhotoBatch('12', baseline, [], null, draft), { status: 503 })
    available = true
    await assert.rejects(service.persistSpeciesPhotoBatch('12', baseline, [], null, draft), { status: 409 })
    assert.equal(writes, 0); assert.equal(draft.expectedRevision, 7); assert.deepEqual(draft.orderedAssetIds, ['a', 'b'])
  } finally { globalThis.fetch = original }
})

test('Edit appends new photos and promotes them only when moved ahead of saved references', async () => {
  const h = harness(undefined, officer, { embedded: true })
  try {
    await h.mount(); h.state.initializeDraft(snapshot()); await h.files([jpeg()])
    assert.equal(h.state.queuePrimary.value, null)
    assert.equal(h.state.mainImage.value, '/api/data/assets/a')
    h.state.setQueuedMain(h.state.queue.value[0].id)
    assert.equal(h.state.mainImage.value, h.state.queue.value[0].url)
    h.state.setMain('b')
    assert.equal(h.state.queuePrimary.value, null)
    assert.equal(h.state.mainImage.value, '/api/data/assets/b')
  } finally { h.stop() }
})

test('only the full explicit server readiness contract enables Create writes', async () => {
  for (const value of [null, {}, { writesEnabled: true }, { ...readyCapability, activationRequested: false }, { ...readyCapability, schemaReady: false }, { ...readyCapability, migration015: 'partially-present' }]) assert.equal(service.speciesPhotoWritesAvailable(value), false)
  const h = harness(() => readyCapability, officer, { create: true, embedded: true })
  try { await h.mount(); assert.equal(h.state.writesAvailable.value, true); assert.equal(h.calls.length, 1) }
  finally { h.stop() }
})

test('409 loads canonical state, keeps draft/files, and requires explicit reconciliation before a new save', async () => {
  let latest = snapshot(), attempts = 0
  const h = harness(url => url.endsWith('capabilities') ? readyCapability : url.includes('assets?')
    ? { assets: [{ id: 'a', content_type: 'image/jpeg' }, { id: 'b', content_type: 'image/png' }] }
    : { species: { species_id: '12' } }, officer, { embedded: true, services: {
      readSpeciesGallery: async () => structuredClone(latest),
      persistSpeciesPhotoBatch: async (_id, base, files, _main, draft) => {
        attempts++
        if (attempts === 1) throw new service.SpeciesApiError('Changed', 409)
        assert.equal(base.revision, 8); assert.equal(draft.expectedRevision, 8)
        assert.deepEqual(Array.from(draft.removedAssetIds), ['a'])
        assert.equal(files.length, 1)
        latest = { ...latest, revision: 9, primaryAssetId: 'b', images: latest.images.filter(image => image.assetId !== 'a') }
        return { complete: true, snapshot: latest }
      },
    } })
  try {
    await h.mount(); await h.files([jpeg()]); h.state.setMain('b'); h.state.stageRemoval('a')
    latest = { ...snapshot(), revision: 8, primaryAssetId: 'c', images: [...snapshot().images, { assetId: 'c', url: '/api/data/assets/c', contentType: 'image/jpeg', position: 2, eligible: true }] }
    const result = await h.state.commitPhotos('12')
    assert.equal(result.conflict, true); assert.equal(h.state.draft.value.expectedRevision, 7)
    assert.equal(h.state.conflictSnapshot.value.revision, 8); assert.equal(h.state.queue.value.length, 1)
    assert.match(allText(h.render()), /Photo library changed/)
    await h.state.commitPhotos('12'); assert.equal(attempts, 1, 'no implicit stale retry')
    h.state.reconcileConflict(true)
    assert.deepEqual(Array.from(h.state.draft.value.orderedAssetIds), ['b', 'c'])
    assert.equal(h.state.draft.value.primaryAssetId, 'b'); assert.equal(attempts, 1)
    assert.equal((await h.state.commitPhotos('12')).complete, true); assert.equal(h.state.queue.value.length, 0)
  } finally { h.stop() }
})

test('duplicate save clicks share no second upload and do not erase retry state', async () => {
  let release, calls = 0
  const waiting = new Promise(resolve => { release = resolve })
  const h = harness(() => readyCapability, officer, { create: true, embedded: true, services: {
    readSpeciesGallery: async () => ({ speciesId: 42, revision: 0, primaryAssetId: null, images: [] }),
    persistSpeciesPhotoBatch: async () => { calls++; await waiting; return { complete: false } },
  } })
  try {
    await h.mount(); await h.files([jpeg()]); const saving = h.state.commitPhotos('42'); await flush()
    assert.equal(h.state.saving.value, true); await h.state.commitPhotos('42'); assert.equal(calls, 1)
    release(); await saving; assert.equal(h.state.saving.value, false); assert.equal(h.state.queue.value.length, 1)
  } finally { release(); h.stop() }
})

test('explicit reconciliation preserves remote additions and upload receipts without reviving removed IDs', () => {
  const latest = { ...snapshot(), revision: 9, images: [snapshot().images[1], { ...snapshot().images[0], assetId: 'remote', position: 3 }, { ...snapshot().images[0], assetId: 'uploaded', position: 4 }] }
  const local = { speciesId: 12, expectedRevision: 7, orderedAssetIds: ['a', 'b'], primaryAssetId: 'a', removedAssetIds: [] }
  const files = [{ assetId: 'uploaded' }]
  const merged = service.reconcileSpeciesPhotoDraft(latest, local, files, true)
  assert.equal(merged.expectedRevision, 9); assert.deepEqual(merged.orderedAssetIds, ['b', 'remote'])
  assert.equal(merged.primaryAssetId, null); assert.deepEqual(local.orderedAssetIds, ['a', 'b'])
})

test('one editable grid skips ineligible references, mixes saved/new photos and promotes on removal without writes', async () => {
  const base = snapshot()
  base.images.unshift({ ...base.images[0], assetId: 'unavailable', position: -1, eligible: false })
  const h = harness(url => url.endsWith('capabilities') ? readyCapability : url.includes('assets?') ? { assets: [] } : { species: { species_id: 12 } }, officer,
    { embedded: true, services: { readSpeciesGallery: async () => structuredClone(base) } })
  try {
    await h.mount()
    assert.equal(h.state.firstEligible.value, 'saved:a')
    assert.equal(h.state.canReorder('saved:unavailable'), false)
    assert.equal(h.state.canReorder('saved:plant-evidence'), false)
    await h.files([jpeg(), png()])
    const [first, second] = h.state.queue.value.map(file => file.id)
    h.state.startDrag({ dataTransfer: { setData() {} } }, second, true)
    h.state.pointerCancel({ pointerId: 1 }) // Browser cancels mouse pointer events when native drag begins.
    assert.equal(h.state.dragging.value, `queued:${second}`)
    h.state.dropImage('a', false)
    assert.equal(h.state.queuePrimary.value, second)
    assert.equal(h.state.firstEligible.value, `queued:${second}`)
    assert.equal(nodes(h.render()).filter(node => node.props?.class === 'main-badge').length, 1)
    h.state.startDrag({ dataTransfer: { setData() {} } }, 'b', false)
    h.state.dropImage(second, true)
    assert.equal(h.state.draft.value.primaryAssetId, 'b')
    assert.equal(h.state.queuePrimary.value, null)
    h.state.removeQueued(first) // Removing another card preserves main.
    assert.equal(h.state.firstEligible.value, 'saved:b')
    h.state.stageRemoval('b')
    assert.equal(h.state.queuePrimary.value, second)
    h.state.removeQueued(second)
    assert.equal(h.state.draft.value.primaryAssetId, 'a')
    h.state.stageRemoval('a')
    assert.equal(h.state.firstEligible.value, null)
    assert.equal(h.state.draft.value.primaryAssetId, null)
    assert.deepEqual(Array.from(h.state.draft.value.removedAssetIds), ['b', 'a'])
    assert.equal(base.images.length, 3, 'canonical membership was not mutated')
    assert.ok(h.calls.every(call => !call.options.method || call.options.method === 'GET'))
    assert.ok(!nodes(h.render()).some(node => node.props?.class === 'main-preview'))
  } finally { h.stop() }
})

test('touch drag and keyboard moves share local order without position selectors; remove controls never start drag', async () => {
  let hit = null, captured = null
  const h = harness(() => readyCapability, officer, { create: true, embedded: true,
    hitTest: () => hit ? { closest: () => ({ dataset: { photoKey: hit } }) } : null })
  try {
    await h.mount(); await h.files([jpeg(), png()])
    const [first, second] = h.state.queue.value.map(file => file.id)
    const key = `queued:${second}`
    const target = { closest: () => null }
    h.state.pointerStart({ pointerType: 'touch', pointerId: 3, target, currentTarget: { setPointerCapture(id) { captured = id } } }, key)
    assert.equal(captured, 3); assert.equal(h.state.dragging.value, key)
    hit = `queued:${first}`
    h.state.pointerMove({ pointerId: 3, clientX: 10, clientY: 10, preventDefault() {} })
    assert.equal(h.state.dropTarget.value, hit)
    h.state.pointerEnd({ pointerId: 3 })
    assert.equal(h.state.queuePrimary.value, second)
    assert.equal(h.state.dragging.value, null)
    let prevented = false
    h.state.keyboardMove({ altKey: true, key: 'ArrowLeft', preventDefault() { prevented = true } }, `queued:${first}`)
    assert.equal(prevented, true); assert.equal(h.state.queuePrimary.value, first)
    const selectors = nodes(h.render()).filter(node => node.type === 'select')
    assert.equal(selectors.length, 0)
    assert.doesNotMatch(allText(h.render()), /position menu|Position for/)
    h.state.keyboardMove({ altKey: true, key: 'ArrowLeft', preventDefault() {} }, `queued:${second}`)
    assert.equal(h.state.queuePrimary.value, second)
    const remove = nodes(h.render()).find(node => node.type === 'button' && node.props?.class === 'thumbnail-remove')
    let stopped = 0
    remove.props.onPointerdown({ stopPropagation() { stopped++ } })
    remove.props.onDragstart({ stopPropagation() { stopped++ }, preventDefault() { prevented = true } })
    assert.equal(stopped, 2); assert.equal(h.state.dragging.value, null)
    h.state.startDrag({ target: { closest: () => ({}) }, preventDefault() { prevented = true } }, first, true)
    assert.equal(h.state.dragging.value, null)
    // An interrupted touch drag makes no changes.
    h.state.pointerStart({ pointerType: 'touch', pointerId: 4, target, currentTarget: { setPointerCapture() {} } }, key)
    h.state.pointerCancel({ pointerId: 4 }); h.state.pointerEnd({ pointerId: 4 })
    assert.equal(h.state.queuePrimary.value, second)
    remove.props.onClick({ stopPropagation() {} })
    assert.equal(h.state.queue.value.length, 1)
    assert.equal(h.state.queuePrimary.value, first)
    assert.equal(h.calls.length, 1, 'only the initial capability GET occurred')
  } finally { h.stop() }
})

test('a mixed saved/queued order persists through explicit commit only, retaining the revision and receipt workflow', async () => {
  const original = globalThis.fetch
  let live = { ...snapshot(), managed: true }, puts = 0, posts = 0
  globalThis.fetch = async (url, options = {}) => {
    if (url.endsWith('capabilities')) return Response.json(readyCapability)
    if (options.method === 'POST') {
      posts++
      const body = JSON.parse(options.body)
      assert.equal(body.species_id, 12); assert.ok(body.client_key)
      live = { ...live, revision: 8, images: [...live.images, { assetId: 'uploaded', url: '/api/assets/uploaded', contentType: 'image/jpeg', position: 2, eligible: true }] }
      return Response.json({ id: 'uploaded' })
    }
    if (options.method === 'PUT') {
      puts++
      const body = JSON.parse(options.body)
      assert.deepEqual(body, { expectedRevision: 8, orderedAssetIds: ['uploaded', 'b', 'a'], primaryAssetId: 'uploaded', removedAssetIds: [] })
      live = { ...live, revision: 9, primaryAssetId: body.primaryAssetId, images: body.orderedAssetIds.map((id, position) => ({ ...live.images.find(image => image.assetId === id), position })) }
      return Response.json({})
    }
    return Response.json(live)
  }
  const h = harness(url => url.endsWith('capabilities') ? readyCapability : url.includes('assets?') ? { assets: [] } : { species: { species_id: 12 } }, officer,
    { embedded: true, services: { readSpeciesGallery: async () => structuredClone(live) } })
  try {
    await h.mount(); await h.files([jpeg()])
    h.state.move('b', -1)
    h.state.startDrag({ dataTransfer: { setData() {} } }, h.state.queue.value[0].id, true)
    h.state.dropImage('b', false)
    assert.equal(posts, 0); assert.equal(puts, 0)
    assert.equal((await h.state.commitPhotos('12')).complete, true)
    assert.equal(posts, 1); assert.equal(puts, 1)
    assert.equal(h.state.canonical.value.primaryAssetId, 'uploaded')
    assert.equal(h.state.queue.value.length, 0)
  } finally { h.stop(); globalThis.fetch = original }
})

test('removing an uploaded retry receipt stages a tombstone and never re-uploads or deletes its bytes', async () => {
  let committed
  const h = harness(() => readyCapability, officer, { create: true, embedded: true, services: {
    readSpeciesGallery: async () => ({ speciesId: 42, revision: 0, primaryAssetId: null, images: [] }),
    persistSpeciesPhotoBatch: async (...args) => { committed = args; return { complete: false } },
  } })
  try {
    await h.mount(); await h.files([jpeg(), png()])
    const receipt = h.state.queue.value[0]
    receipt.assetId = 'receipt'; receipt.status = 'uploaded'
    h.state.removeQueued(receipt.id)
    assert.equal(h.state.queue.value.length, 2, 'receipt stays available to revision checking')
    assert.equal(receipt.removed, true)
    assert.equal(h.state.photoCards.value.length, 1)
    assert.equal(h.state.queuePrimary.value, h.state.queue.value[1].id)
    await h.state.commitPhotos('42')
    assert.equal(committed[2][0].assetId, 'receipt')
    assert.deepEqual(Array.from(committed[6], item => item.queueId), [h.state.queue.value[1].id])
  } finally { h.stop() }
  const original = globalThis.fetch, base = { ...snapshot(), managed: true }
  const receipt = { id: 'local', clientKey: 'stable-key', file: jpeg(), url: 'blob:receipt', status: 'uploaded', assetId: 'receipt', removed: true }
  const calls = []
  globalThis.fetch = async (url, options = {}) => {
    calls.push(options.method || 'GET')
    if (url.endsWith('capabilities')) return Response.json(readyCapability)
    if (options.method === 'PUT') {
      assert.deepEqual(JSON.parse(options.body), { expectedRevision: 8, orderedAssetIds: ['a', 'b'], primaryAssetId: 'a', removedAssetIds: ['receipt'] })
      return Response.json({})
    }
    return Response.json({ ...base, revision: 8, images: [...base.images, { ...base.images[0], assetId: 'receipt', url: '/api/assets/receipt', position: 2 }] })
  }
  try {
    await service.persistSpeciesPhotoBatch('12', base, [receipt], null, service.createSpeciesGalleryDraft(base), () => true, [{ assetId: 'a' }, { assetId: 'b' }])
    assert.equal(calls.filter(method => method === 'PUT').length, 1)
    assert.ok(!calls.includes('POST') && !calls.includes('DELETE'))
  } finally { globalThis.fetch = original }
})

test('library plant evidence has no editable controls and cannot enter the primary/order draft', async () => {
  const h = harness(url => url.endsWith('capabilities') ? readyCapability : url.includes('photo-library') ? { images: [{ assetId: 'evidence', source: 'plant' }], page: {} } : url.includes('assets?') ? { assets: [] } : { species: { species_id: 12 } }, officer,
    { embedded: true, services: { readSpeciesGallery: async () => snapshot() } })
  try {
    await h.mount(); h.state.expanded.value = true; await flush()
    const before = JSON.stringify(h.state.draft.value)
    h.state.startDrag({ preventDefault() {} }, 'evidence', false)
    h.state.setMain('evidence'); h.state.move('evidence', -1); h.state.stageRemoval('evidence')
    assert.equal(h.state.dragging.value, null); assert.equal(JSON.stringify(h.state.draft.value), before)
    const evidence = nodes(h.render()).find(node => node.type === 'li' && node.props?.class === 'library-photo')
    assert.ok(evidence); assert.ok(!nodes(evidence).some(node => node.type === 'button' || node.type === 'select'))
    assert.ok(h.calls.every(call => !call.options.method || call.options.method === 'GET'))
  } finally { h.stop() }
})

test('read retries preserve an interleaved local order even when saved-reference order and primary did not change', async () => {
  const h = harness(url => url.endsWith('capabilities') ? readyCapability : url.includes('assets?') ? { assets: [] } : { species: { species_id: 12 } }, officer,
    { embedded: true, services: { readSpeciesGallery: async () => snapshot() } })
  try {
    await h.mount(); await h.files([jpeg()])
    const key = `queued:${h.state.queue.value[0].id}`
    h.state.reorderPhoto(key, 'saved:b')
    assert.deepEqual(Array.from(h.state.photoOrder.value), ['saved:a', key, 'saved:b'])
    assert.equal(h.state.dirty.value, true)
    await h.state.loadImages()
    assert.deepEqual(Array.from(h.state.photoOrder.value), ['saved:a', key, 'saved:b'])
    assert.equal(h.state.draft.value.primaryAssetId, 'a')
  } finally { h.stop() }
})

test('explicit grid order retains retry receipts, rejects incomplete membership and saves null when all eligible photos are removed', async () => {
  const original = globalThis.fetch
  const base = { ...snapshot(), managed: true }, files = [jpeg(), png()].map((file, index) => ({ id: `local-${index}`, clientKey: `key-${index}`, file, url: `blob:${index}`, status: 'queued' }))
  let fail = true, put = null, posts = 0
  const uploaded = []
  globalThis.fetch = async (url, options = {}) => {
    if (url.endsWith('capabilities')) return Response.json(readyCapability)
    if (options.method === 'POST') {
      const body = JSON.parse(options.body); posts++
      if (fail && body.client_key === 'key-1') return Response.json({ error: 'Retry' }, { status: 503 })
      const assetId = body.client_key === 'key-0' ? 'new-a' : 'new-b'
      uploaded.push({ ...base.images[0], assetId, url: `/api/assets/${assetId}`, position: base.images.length + uploaded.length })
      return Response.json({ id: assetId })
    }
    if (options.method === 'PUT') { put = JSON.parse(options.body); return Response.json({}) }
    return Response.json({ ...base, revision: 7 + uploaded.length, images: [...base.images, ...uploaded] })
  }
  try {
    const order = [{ queueId: 'local-1' }, { assetId: 'a' }, { queueId: 'local-0' }, { assetId: 'b' }]
    assert.equal((await service.persistSpeciesPhotoBatch('12', base, files, 'local-1', service.createSpeciesGalleryDraft(base), () => true, order)).complete, false)
    assert.equal(put, null)
    fail = false
    await service.persistSpeciesPhotoBatch('12', base, files, 'local-1', service.createSpeciesGalleryDraft(base), () => true, order)
    assert.equal(posts, 3, 'successful first receipt was not uploaded twice')
    assert.deepEqual(put.orderedAssetIds, ['new-b', 'a', 'new-a', 'b']); assert.equal(put.primaryAssetId, 'new-b')
    put = null
    await assert.rejects(service.persistSpeciesPhotoBatch('12', base, files, null, service.createSpeciesGalleryDraft(base), () => true, [{ assetId: 'a' }]), { status: 409 })
    assert.equal(put, null, 'incomplete grid never sends PUT')
    for (const file of files) file.removed = true
    const draft = { ...service.createSpeciesGalleryDraft(base), orderedAssetIds: [], removedAssetIds: ['a', 'b'], primaryAssetId: null }
    await service.persistSpeciesPhotoBatch('12', base, files, null, draft, () => true, [])
    assert.equal(put.primaryAssetId, null); assert.deepEqual(put.orderedAssetIds, [])
    assert.deepEqual(put.removedAssetIds, ['a', 'b', 'new-a', 'new-b'])
    assert.equal(posts, 3)
  } finally { globalThis.fetch = original }
})

test('photo validation bridge reports rejected selections without changing valid queued files or gallery order', async () => {
  const h = harness()
  try {
    await h.mount(); h.state.initializeDraft(snapshot()); await h.files([jpeg()])
    h.state.moveQueued(h.state.queue.value[0].id, -1)
    const order = JSON.stringify(h.state.photoOrder.value), queue = h.state.queue.value[0], main = h.state.queuePrimary.value
    await h.files([new File(['invalid'], 'fake.jpg', { type: 'application/pdf' }), new File([], 'empty.png', { type: 'image/png' })])
    assert.equal(h.state.validationState().invalid, true)
    assert.equal(h.state.validationState().pending, false)
    assert.equal(h.state.fileErrors.value.length, 2)
    const field = nodes(h.render()).find(node => node.type === 'input' && node.props?.type === 'file')
    assert.equal(field.props['data-validation-field'], 'photos'); assert.equal(field.props['aria-invalid'], true)
    assert.match(field.props['aria-describedby'], /selection-error/)
    assert.ok(nodes(h.render()).some(node => node.props?.id === 'photo-test-selection-error'))
    const discard = nodes(h.render()).find(node => node.type === 'button' && node.children === 'Discard rejected selections')
    assert.ok(discard); discard.props.onClick()
    assert.equal(h.state.validationState().invalid, false)
    assert.equal(h.state.queue.value[0], queue)
    assert.equal(JSON.stringify(h.state.photoOrder.value), order); assert.equal(h.state.queuePrimary.value, main)
    assert.equal(h.revoked.length, 0)
    assert.ok(h.calls.every(call => !call.options.method || call.options.method === 'GET'))
  } finally { h.stop() }
})
