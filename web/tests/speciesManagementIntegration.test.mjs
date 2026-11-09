import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { parse, compileScript, compileTemplate, compileStyle } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as vue from 'vue'
import * as integration from '../src/services/speciesManagement.ts'

const filename = new URL('../src/views/conservation/PlantSpeciesView.vue', import.meta.url)
const source = readFileSync(filename, 'utf8')
const { descriptor } = parse(source)
const script = compileScript(descriptor, { id: 'species-management-integration' })
const template = compileTemplate({
  source: descriptor.template.content,
  filename: filename.pathname,
  id: 'species-management-integration',
  compilerOptions: { bindingMetadata: script.bindings },
})
const transpile = (value) => ts.transpileModule(value, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const messages = JSON.parse(readFileSync(new URL('../src/locales/en.json', import.meta.url), 'utf8'))
const speciesFixture = (overrides = {}) => ({
  species_id: '3',
  scientific_name: 'Shorea persisted',
  common_name: 'Persisted meranti',
  genus_id: 7,
  genus_name: 'Shorea',
  family_name: 'Dipterocarpaceae',
  conservation_status: 'Vulnerable',
  status_id: 2,
  sensitivity: 'protected',
  description: 'Persisted description',
  habitat: 'Persisted habitat',
  culturalSignificance: 'Persisted cultural value',
  ...overrides,
})
const taxonomyFixture = [{ genus_id: 7, genus_name: 'Shorea', family_name: 'Dipterocarpaceae' }]
const flush = async () => {
  for (let i = 0; i < 4; i++) {
    await vue.nextTick()
    await new Promise(setImmediate)
  }
}
function harness(fetchHandler, query = {}, authUser = { id: 'officer', role: 'Conservation Officer', status: 'Active', mustChangePassword: false }, options = {}) {
  const scope = vue.effectScope()
  const route = vue.reactive({ query })
  const calls = []
  const timers = new Map()
  let timerId = 0
  let session = { user: authUser, pending: false }
  const sessionListeners = new Set()
  const t = (key, params = {}) => {
    const found = key.split('.').reduce((entry, part) => entry?.[part], messages)
    const value = typeof found === 'string' ? found : key
    return Object.entries(params).reduce((text, [name, replacement]) =>
      text.replaceAll(`{${name}}`, String(replacement)), value)
  }
  const exports = {}
  const context = {
    exports,
    AbortSignal,
    console,
    window: {
      matchMedia: () => ({ matches: options.reducedMotion === true }),
      getComputedStyle: () => ({ position: options.stickyHeader ? 'sticky' : 'static' }),
    },
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id },
    clearTimeout: id => timers.delete(id),
    fetch: async (url, options) => {
      calls.push({ url, options })
      return fetchHandler(url, options)
    },
    require(name) {
      if (name === 'vue') return {
        ...vue,
        onMounted() {},
        resolveComponent: (component) => component,
        withDirectives: (node) => node,
      }
      if (name === 'vue-router') return {
        useRoute: () => route,
        useRouter: () => ({ replace: ({ query }) => { route.query = query; return Promise.resolve() } }),
      }
      if (name === 'vue-i18n') return { useI18n: () => ({ t }) }
      if (name.endsWith('/auth')) return {
        sessionSnapshot: () => session,
        subscribeSession: listener => { sessionListeners.add(listener); return () => sessionListeners.delete(listener) },
      }
      if (name.endsWith('speciesManagement')) return {
        ...integration,
        requestSpeciesApi: async (url, options = {}) => {
          const response = await context.fetch(url, {
            method: options.method || 'GET',
            credentials: 'same-origin',
            ...(options.body
              ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options.body) }
              : {}),
          })
          let result
          try { result = await response.json() }
          catch { throw Error('The species service returned an invalid response.') }
          if (!response.ok) {
            const message = result?.message || result?.error ||
              (response.status === 403 ? 'You do not have permission to manage species.' : `Species request failed (${response.status}).`)
            throw Error(message)
          }
          return result
        },
      }
      if (name.endsWith('.vue')) return { name }
      throw Error(`Unexpected import: ${name}`)
    },
  }
  vm.runInNewContext(`(function () { ${transpile(script.content)} })()`, context)
  const state = scope.run(() => exports.default.setup({}, { expose() {} }))
  vm.runInNewContext(`(function () { ${transpile(template.code)} })()`, context)
  return { state, calls, route, timers,
    session: (user, pending = false) => { session = { user, pending }; sessionListeners.forEach(listener => listener(user, pending)) },
    render: () => exports.render({}, [], {}, vue.proxyRefs(state), {}, {}), stop: () => scope.stop() }
}
function nodes(root) {
  const result = []
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (!node || typeof node !== 'object') return
    result.push(node)
    if (Array.isArray(node.children)) walk(node.children)
    else if (node.children?.default) walk(node.children.default())
  }
  walk(root)
  return result
}

test('real list and taxonomy render current fields, mappings, filters and stable sorting', async () => {
  const h = harness(async (url) => Response.json(url === '/api/taxonomy'
    ? { genera: taxonomyFixture }
    : { species: [speciesFixture({ species_id: 4, scientific_name: 'Zamia real', sensitivity: 'public' }), speciesFixture()] }))
  try {
    await Promise.all([h.state.loadSpecies(), h.state.loadTaxonomy()])
    assert.deepEqual(Array.from(h.state.species.value, (item) => item.scientificName), ['Shorea persisted', 'Zamia real'])
    assert.equal(h.state.species.value[0].visibility, 'protected')
    assert.equal(h.state.taxonomy.value[0].family, 'Dipterocarpaceae')
    h.state.search.value = 'dipterocarpaceae'
    assert.equal(h.state.filtered.value.length, 2)
    h.state.visibilityFilter.value = 'protected'
    assert.equal(h.state.filtered.value.length, 1)
    assert.ok(nodes(h.render()).some((node) => node.children === 'Shorea persisted'))
  } finally { h.stop() }
})

test('successful empty list is distinct from API and permission failure', async () => {
  const empty = harness(async () => Response.json({ species: [] }))
  try {
    await empty.state.loadSpecies()
    assert.equal(empty.state.loadError.value, '')
    assert.ok(nodes(empty.render()).some((node) => node.children === 'No species records are available.'))
  } finally { empty.stop() }
  for (const [status, body] of [[503, { error: 'Database unavailable.' }], [403, {}]]) {
    const failed = harness(async () => Response.json(body, { status }))
    try {
      await failed.state.loadSpecies()
      assert.ok(failed.state.loadError.value)
      assert.equal(failed.state.species.value.length, 0)
      assert.ok(nodes(failed.render()).some((node) => node.children === 'Species could not be loaded.'))
      if (status === 403) assert.match(failed.state.loadError.value, /permission/i)
    } finally { failed.stop() }
  }
})

test('taxonomy failure disables only Genus; retry restores it without changing status or sending writes', async () => {
  let taxonomyFails = true
  const h = harness(async url => {
    if (url === '/api/taxonomy') return taxonomyFails
      ? Response.json({ error: 'Access denied.' }, { status: 403 })
      : Response.json({ genera: taxonomyFixture })
    return Response.json({ species: url === '/api/species/3' ? speciesFixture() : [speciesFixture()] })
  })
  const formSelect = label => {
    const field = nodes(h.render()).find(node => ['label', 'div'].includes(node.type) && node.props?.class === 'form-field'
      && nodes(node).some(child => child.type === 'span' && child.children === label))
    assert.ok(field, label)
    return nodes(field).find(node => node.type === 'select')
  }
  try {
    await Promise.all([h.state.loadSpecies(), h.state.loadTaxonomy()])
    await h.state.openEdit(h.state.species.value[0]); await flush()
    assert.equal(h.state.taxonomyError.value, 'Access denied.')
    assert.equal(formSelect('Genus').props.disabled, true)
    assert.equal(formSelect('Conservation Status').props.disabled, false)
    assert.ok(nodes(formSelect('Conservation Status')).some(node => node.type === 'option' && node.props?.value === 'Vulnerable'))
    assert.equal(h.state.form.conservationStatus, 'Vulnerable')
    taxonomyFails = false
    await h.state.loadTaxonomy(); await flush()
    assert.equal(h.state.taxonomyError.value, '')
    assert.equal(formSelect('Genus').props.disabled, false)
    assert.equal(h.state.form.genusId, '7')
    assert.equal(h.state.form.conservationStatus, 'Vulnerable')
    assert.ok(h.calls.every(call => call.options.method === 'GET' && call.options.credentials === 'same-origin'))
  } finally { h.stop() }
})

test('create sends exact supported payload then refetches detail and list', async () => {
  let list = [speciesFixture()]
  const h = harness(async (url, options) => {
    if (url === '/api/taxonomy') return Response.json({ genera: taxonomyFixture })
    if (url === '/api/species' && options.method === 'POST') {
      assert.deepEqual(JSON.parse(options.body), {
        scientific_name: 'Hopea durable',
        common_name: 'Durable hopea',
        description: 'Persisted description',
        visibility: 'internal',
        genus_id: 7,
        conservation_status: 'Vulnerable',
        habitat: 'Limestone forest',
      })
      list = [...list, speciesFixture({ species_id: 9, scientific_name: 'Hopea durable', common_name: 'Durable hopea', sensitivity: 'internal' })]
      return Response.json({ species_id: 9 }, { status: 201 })
    }
    if (url === '/api/species/9') return Response.json({ species: list[1] })
    return Response.json({ species: list })
  })
  try {
    await Promise.all([h.state.loadSpecies(), h.state.loadTaxonomy()])
    h.state.openCreate()
    Object.assign(h.state.form, {
      scientificName: '  Hopea durable ', commonName: ' Durable hopea ', genusId: '7',
      conservationStatus: 'Vulnerable', visibility: 'internal', description: ' Persisted description ',
      habitat: ' Limestone forest ',
    })
    await h.state.save()
    assert.equal(h.state.modal.value, null)
    assert.equal(h.state.species.value.length, 2)
    assert.ok(h.calls.some((call) => call.url === '/api/species/9' && call.options.method === 'GET'))
    assert.equal(h.calls.filter((call) => call.url.includes('scope=scientific')).length, 2)
    assert.match(h.state.feedback.value.message, /persisted backend data/)
  } finally { h.stop() }
})

test('create validation blocks incomplete and invalid reference payloads', async () => {
  const h = harness(async (url) => Response.json(url === '/api/taxonomy'
    ? { genera: taxonomyFixture } : { species: [speciesFixture()] }))
  try {
    await Promise.all([h.state.loadSpecies(), h.state.loadTaxonomy()])
    h.state.openCreate()
    Object.assign(h.state.form, { scientificName: '', commonName: '', description: '', genusId: '999', visibility: '', conservationStatus: 'Invented' })
    await h.state.save()
    assert.ok(h.state.formErrors.value.scientificName)
    assert.ok(h.state.formErrors.value.commonName)
    assert.ok(h.state.formErrors.value.description)
    assert.ok(h.state.formErrors.value.genusId)
    assert.ok(h.state.formErrors.value.visibility)
    assert.ok(h.state.formErrors.value.conservationStatus)
    assert.equal(h.calls.filter((call) => ['POST', 'PATCH'].includes(call.options.method)).length, 0)
  } finally { h.stop() }
})

test('edit loads authoritative detail, sends exact PATCH and verifies persisted state', async () => {
  let stored = speciesFixture()
  const h = harness(async (url, options) => {
    if (url === '/api/taxonomy') return Response.json({ genera: taxonomyFixture })
    if (url === '/api/species/3' && options.method === 'PATCH') {
      const body = JSON.parse(options.body)
      assert.deepEqual(Object.keys(body).sort(), ['common_name','conservation_status','description','genus_id','habitat','scientific_name','visibility'].sort())
      assert.equal(body.scientific_name, 'Shorea updated')
      assert.equal(body.visibility, 'public')
      stored = speciesFixture({ scientific_name: 'Shorea updated', sensitivity: 'public' })
      return Response.json({ updated: true })
    }
    if (url === '/api/species/3') return Response.json({ species: stored })
    return Response.json({ species: [stored] })
  })
  try {
    await Promise.all([h.state.loadSpecies(), h.state.loadTaxonomy()])
    await h.state.openEdit(h.state.species.value[0])
    await flush()
    assert.equal(h.state.form.scientificName, 'Shorea persisted')
    h.state.form.scientificName = 'Shorea updated'
    h.state.form.visibility = 'public'
    await h.state.save()
    assert.equal(h.state.species.value[0].scientificName, 'Shorea updated')
    assert.equal(h.state.species.value[0].visibility, 'public')
    assert.equal(h.calls.filter((call) => call.url === '/api/species/3').length, 3)
  } finally { h.stop() }
})

test('delete requires confirmation, uses exact endpoint, and preserves row on conflict', async () => {
  let conflict = true
  let rows = [speciesFixture()]
  const h = harness(async (url, options) => {
    if (url === '/api/species/3' && options.method === 'DELETE') {
      if (conflict) return Response.json({ error: 'Species is referenced by plant records.' }, { status: 409 })
      rows = []
      return Response.json({ deleted: true })
    }
    return Response.json({ species: rows })
  })
  try {
    await h.state.loadSpecies()
    h.state.confirmDelete(h.state.species.value[0])
    assert.equal(h.state.modal.value, 'delete')
    assert.equal(h.calls.filter((call) => call.options.method === 'DELETE').length, 0)
    await h.state.remove()
    assert.match(h.state.mutationError.value, /referenced by plant records/)
    assert.equal(h.state.species.value.length, 1)
    assert.equal(h.state.modal.value, 'delete')
    conflict = false
    await h.state.remove()
    assert.equal(h.state.modal.value, null)
    assert.equal(h.state.species.value.length, 0)
    assert.equal(h.calls.filter((call) => call.url === '/api/species/3' && call.options.method === 'DELETE').length, 2)
  } finally { h.stop() }
})

test('fresh component instances refetch persisted backend state instead of sharing local species', async () => {
  let stored = speciesFixture()
  const handler = async () => Response.json({ species: [stored] })
  const first = harness(handler)
  try {
    await first.state.loadSpecies()
    assert.equal(first.state.species.value[0].scientificName, 'Shorea persisted')
  } finally { first.stop() }
  stored = speciesFixture({ scientific_name: 'Reloaded persisted name' })
  const reloaded = harness(handler)
  try {
    await reloaded.state.loadSpecies()
    assert.equal(reloaded.state.species.value[0].scientificName, 'Reloaded persisted name')
  } finally { reloaded.stop() }
})

test('production page has no local store or fake image persistence dependency', () => {
  assert.doesNotMatch(source, /conservationStore|FileReader|readAsDataURL|data:image|species\.push|species\.splice/)
  assert.match(source, /requestSpeciesApi\('\/api\/species\?scope=scientific'\)/)
  assert.match(source, /requestSpeciesApi\('\/api\/taxonomy'\)/)
  assert.match(source, /SpeciesPhotoManager/)
})

test('species API preserves structured errors and distinguishes malformed and network failures', async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => Response.json({ message: 'Duplicate scientific name.' }, { status: 400 })
    await assert.rejects(integration.requestSpeciesApi('/api/species'), {
      message: 'Duplicate scientific name.', status: 400,
    })
    globalThis.fetch = async () => Response.json({}, { status: 401 })
    await assert.rejects(integration.requestSpeciesApi('/api/species'), { message: /session has expired/i })
    globalThis.fetch = async () => new Response('<html>gateway</html>', { status: 502 })
    await assert.rejects(integration.requestSpeciesApi('/api/species'), { kind: 'invalid' })
    globalThis.fetch = async () => { throw Error('offline') }
    await assert.rejects(integration.requestSpeciesApi('/api/species'), { kind: 'network' })
  } finally {
    globalThis.fetch = originalFetch
  }
})


test('teammate text limits and trimmed bounded search survive the merge', () => {
  const valid = {
    scientificName: 'Shorea real', commonName: 'Meranti', genusId: '7',
    conservationStatus: 'Vulnerable', visibility: 'internal', description: 'Details',
    habitat: '',
  }
  const taxonomy = [{ id: '7', name: 'Shorea', family: 'Dipterocarpaceae' }]
  for (const [field, limit] of [['scientificName', 200], ['commonName', 200], ['description', 4000], ['habitat', 4000]]) {
    assert.equal(integration.validateSpeciesForm({ ...valid, [field]: 'x'.repeat(limit) }, taxonomy, ['Vulnerable'])[field], undefined)
    assert.ok(integration.validateSpeciesForm({ ...valid, [field]: 'x'.repeat(limit + 1) }, taxonomy, ['Vulnerable'])[field])
  }
  assert.match(source, /v-model\.trim="search" maxlength="100"/)
})

test('active routed Officer page embeds photos in Create and Edit without changing CRUD actions', async () => {
  const h = harness(async () => Response.json({ species: [speciesFixture()] }))
  try {
    await h.state.loadSpecies()
    const buttons = nodes(h.render()).filter(node => node.type === 'button')
    for (const label of ['View', 'Edit Species', 'Delete Species']) assert.ok(buttons.some(node => node.children === label))
    assert.ok(!buttons.some(node => node.props?.class?.includes('manage-photos-action')))
    h.state.openCreate()
    let manager = nodes(h.render()).find(node => node.type?.name?.endsWith('SpeciesPhotoManager.vue'))
    assert.ok(manager.props.embedded !== undefined)
    assert.equal(manager.props.species, null)
    await h.state.openEdit(h.state.species.value[0])
    manager = nodes(h.render()).find(node => node.type?.name?.endsWith('SpeciesPhotoManager.vue'))
    assert.equal(manager.props.species.id, '3')
    const router = readFileSync(new URL('../src/router/index.ts', import.meta.url), 'utf8')
    assert.match(router, /name: 'conservation-species'[\s\S]*?conservation\/PlantSpeciesView.vue/)
  } finally { h.stop() }
})

test('inline photos exclude public roles, inactive Officers and verification transitions', async () => {
  for (const account of [null, ...['Administrator', 'Botanist', 'Visitor'].map(role => ({ id: 'x', role, status: 'Active', mustChangePassword: false })),
    { id: 'x', role: 'Conservation Officer', status: 'Inactive', mustChangePassword: false },
    { id: 'x', role: 'Conservation Officer', status: 'Active', mustChangePassword: true }]) {
    const h = harness(async () => Response.json({ species: [speciesFixture()] }), {}, account)
    try {
      await h.state.loadSpecies()
      assert.ok(!nodes(h.render()).some(node => node.props?.class?.includes('manage-photos-action')))
      h.state.openCreate()
      assert.ok(!nodes(h.render()).some(node => node.type?.name?.endsWith('SpeciesPhotoManager.vue')))
    } finally { h.stop() }
  }
  const h = harness(async () => Response.json({ species: [speciesFixture()] }))
  try {
    await h.state.loadSpecies(); h.state.openCreate()
    h.session(null, true)
    assert.equal(h.state.modal.value, null)
    assert.equal(h.state.canManagePhotos.value, false)
  } finally { h.stop() }
})

test('partial photo saves keep the created species ID and never create a duplicate on retry', async () => {
  const h = harness(async (url, options) => {
    if (options.method === 'POST') return Response.json({ species_id: 9 }, { status: 201 })
    if (options.method === 'PATCH') return Response.json({ updated: true })
    if (url === '/api/taxonomy') return Response.json({ genera: taxonomyFixture })
    return Response.json({ species: url === '/api/species/9' ? speciesFixture({ species_id: 9 }) : [speciesFixture()] })
  })
  try {
    await Promise.all([h.state.loadSpecies(), h.state.loadTaxonomy()]); h.state.openCreate()
    Object.assign(h.state.form, { scientificName: 'New species', commonName: 'Common', genusId: '7', conservationStatus: 'Vulnerable', visibility: 'public', description: 'Description' })
    let attempts = 0
    h.state.photoEditor.value = { commitPhotos: async id => { assert.equal(id, '9'); return { complete: ++attempts > 1, deferred: false } } }
    await h.state.save()
    assert.equal(h.state.createdSpeciesId.value, '9'); assert.equal(h.state.modal.value, 'form')
    assert.match(h.state.photoSaveNotice.value, /some photo operations failed/)
    await h.state.save()
    assert.equal(h.state.modal.value, null)
    assert.equal(h.calls.filter(call => call.options.method === 'POST').length, 1)
    assert.equal(h.calls.filter(call => call.options.method === 'PATCH' && call.url === '/api/species/9').length, 1)
  } finally { h.stop() }
})

// Minimal DOM boundary for the real SFC logic: page scrolling is deliberately unavailable.
function validationDom(h, overrides = {}) {
  const scrolls = [], focused = [], groups = new Map()
  const names = ['scientificName', 'commonName', 'genusId', 'conservationStatus', 'visibility', 'description', 'habitat', 'photos']
  const controls = names.map(name => {
    const classes = new Set()
    const recovery = { focus(options) { focused.push({ name: `${name}-recovery`, options }) } }
    const group = {
      classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) },
      getBoundingClientRect: () => ({ top: -600, height: 150 }),
      querySelector: () => name === 'genusId' && overrides.genusDisabled ? recovery : null,
      focus(options) { focused.push({ name: `${name}-group`, options }) },
      offsetWidth: 300,
    }
    groups.set(name, group)
    return { dataset: { validationField: name }, disabled: name === 'genusId' && overrides.genusDisabled,
      validity: { valid: true }, validationMessage: '', closest: () => group,
      matches: () => name === 'genusId' && overrides.genusDisabled,
      focus(options) { focused.push({ name, options }) },
    }
  })
  const scroller = { scrollTop: 1200, getBoundingClientRect: () => ({ top: 100 }),
    querySelector: () => ({ getBoundingClientRect: () => ({ height: 64 }) }),
    scrollTo: options => scrolls.push(options) }
  h.state.speciesForm.value = vue.markRaw({ querySelectorAll: () => controls, closest: () => scroller })
  return { scrolls, focused, groups, controls }
}
const validationHandler = async url => Response.json(url === '/api/taxonomy' ? { genera: taxonomyFixture }
  : url === '/api/species/3' ? { species: speciesFixture() } : { species: [speciesFixture()] })
const summaryNode = h => nodes(h.render()).find(node => node.type === 'p' && node.props?.class === 'validation-summary')

test('Create and Edit failures scroll only the modal, focus first invalid field and preserve the complete photo draft', async () => {
  for (const mode of ['create', 'edit']) {
    const h = harness(async (url, options) => options.method === 'POST' ? Response.json({ species_id: 3 }) : options.method === 'PATCH' ? Response.json({ updated: true }) : validationHandler(url))
    try {
      await Promise.all([h.state.loadSpecies(), h.state.loadTaxonomy()])
      if (mode === 'edit') await h.state.openEdit(h.state.species.value[0])
      else h.state.openCreate()
      Object.assign(h.state.form, { scientificName: '', commonName: '', description: '', genusId: '7', conservationStatus: 'Vulnerable', visibility: 'internal', habitat: 'Keep this habitat' })
      const photoDraft = { queue: [{ id: 'queued', clientKey: 'stable-key' }], ordered: ['queued', 'saved'], main: 'queued', revision: 7 }
      let photoWrites = 0
      h.state.photoEditor.value = vue.markRaw({ validationState: () => ({ invalid: false, pending: false }), commitPhotos: () => { photoWrites++; return { complete: true } }, draft: photoDraft })
      const before = JSON.stringify({ form: h.state.form, photoDraft })
      const dom = validationDom(h)
      await h.state.save()
      assert.equal(h.state.modal.value, 'form')
      assert.equal(JSON.stringify({ form: h.state.form, photoDraft }), before)
      assert.deepEqual(Array.from(h.state.invalidFields.value), ['scientificName', 'commonName', 'description'])
      assert.equal(dom.focused[0].name, 'scientificName')
      assert.equal(dom.focused[0].options.preventScroll, true)
      assert.equal(dom.scrolls.length, 1); assert.equal(dom.scrolls[0].behavior, 'smooth')
      assert.equal(dom.scrolls[0].top, 480)
      assert.ok(dom.groups.get('scientificName').classList.contains('validation-highlight'))
      assert.match(summaryNode(h).children, /\(3\)/)
      assert.equal(summaryNode(h).props['aria-live'], 'polite')
      assert.equal(summaryNode(h).props['aria-atomic'], 'true')
      const input = nodes(h.render()).find(node => node.props?.['data-validation-field'] === 'scientificName')
      assert.equal(input.props['aria-invalid'], true)
      assert.equal(input.props['aria-describedby'], 'species-scientificName-error')
      assert.ok(nodes(h.render()).some(node => node.props?.id === input.props['aria-describedby']))
      assert.equal(photoWrites, 0)
      assert.ok(h.calls.every(call => call.options.method === 'GET'))
      assert.equal(h.timers.size, 1)
      await h.state.save()
      assert.equal(h.timers.size, 1, 'repeated Save replaces the pulse timer')
      assert.equal(nodes(h.render()).filter(node => node.props?.class === 'validation-summary').length, 1)
      const timer = [...h.timers.values()][0]
      assert.equal(timer.delay, 1800); timer.callback()
      assert.equal(h.timers.size, 0)
      assert.equal(dom.groups.get('scientificName').classList.contains('validation-highlight'), false)
      const scrollCount = dom.scrolls.length, focusCount = dom.focused.length
      h.state.form.scientificName = 'Shorea corrected'; await flush()
      assert.equal(h.state.formErrors.value.scientificName, undefined)
      assert.match(summaryNode(h).children, /\(2\)/)
      assert.equal(dom.scrolls.length, scrollCount); assert.equal(dom.focused.length, focusCount)
      h.state.form.commonName = 'Corrected common name'; h.state.form.description = 'Corrected description'; await flush()
      assert.equal(h.state.invalidFields.value.length, 0)
      assert.equal(summaryNode(h).children, '')
      assert.equal(h.state.photoEditor.value.draft, photoDraft)
      await h.state.save()
      assert.equal(photoWrites, 1, 'corrected submission reaches the existing photo workflow once')
      assert.equal(h.state.modal.value, null)
      assert.equal(h.calls.filter(call => call.options.method === (mode === 'create' ? 'POST' : 'PATCH')).length, 1)
    } finally { h.stop() }
  }
})

test('reduced motion scrolls immediately without pulse; sticky modal header gets clearance', async () => {
  const h = harness(validationHandler, {}, undefined, { reducedMotion: true, stickyHeader: true })
  try {
    h.state.openCreate(); const dom = validationDom(h)
    await h.state.save()
    assert.equal(dom.scrolls[0].behavior, 'instant')
    assert.equal(dom.scrolls[0].top, 416)
    assert.equal(dom.focused[0].options.preventScroll, true)
    assert.equal(h.timers.size, 0)
    assert.equal(dom.groups.get('scientificName').classList.contains('validation-highlight'), false)
    assert.match(descriptor.styles[0].content, /prefers-reduced-motion[\s\S]*animation: none/)
  } finally { h.stop() }
})

test('native and custom constraints share one error per field and DOM order determines the first target', async () => {
  const h = harness(validationHandler)
  try {
    await Promise.all([h.state.loadSpecies(), h.state.loadTaxonomy()]); await h.state.openEdit(h.state.species.value[0])
    const dom = validationDom(h)
    const scientific = dom.controls[0], habitat = dom.controls.find(control => control.dataset.validationField === 'habitat')
    scientific.validity.valid = false; scientific.validationMessage = 'Native constraint failed.'
    h.state.form.habitat = 'x'.repeat(4001) // Custom error is inserted before the native scientific-name error.
    habitat.validity.valid = false; habitat.validationMessage = 'Too long.'
    await h.state.save()
    assert.equal(h.state.invalidFields.value.length, 2, 'native/custom habitat errors count once')
    assert.equal(h.state.formErrors.value.scientificName, 'Native constraint failed.')
    assert.equal(dom.focused[0].name, 'scientificName', 'DOM order wins over error insertion order')
    scientific.validity.valid = true; habitat.validity.valid = true
    h.state.form.habitat = 'Corrected habitat'; await flush()
    assert.equal(h.state.invalidFields.value.length, 0)
    assert.equal(dom.scrolls.length, 1)
  } finally { h.stop() }
})

test('unavailable taxonomy retains its meaningful error and focuses recovery without invalidating status', async () => {
  let unavailable = true
  const h = harness(async url => url === '/api/taxonomy' && unavailable ? Response.json({ error: 'Access denied.' }, { status: 403 }) : validationHandler(url))
  try {
    await Promise.all([h.state.loadSpecies(), h.state.loadTaxonomy()]); await h.state.openEdit(h.state.species.value[0])
    const dom = validationDom(h, { genusDisabled: true })
    await h.state.save()
    assert.equal(h.state.invalidFields.value.length, 1)
    assert.match(h.state.formErrors.value.genusId, /Taxonomy selection is unavailable: Access denied/)
    assert.equal(h.state.formErrors.value.conservationStatus, undefined)
    assert.equal(dom.focused[0].name, 'genusId-recovery')
    assert.ok(h.calls.every(call => call.options.method === 'GET'))
    unavailable = false; await h.state.loadTaxonomy(); await flush()
    assert.equal(h.state.invalidFields.value.length, 0)
    assert.equal(h.state.form.genusId, '7'); assert.equal(h.state.form.conservationStatus, 'Vulnerable')
    assert.equal(dom.scrolls.length, 1)
  } finally { h.stop() }
})

test('photo selection errors and pending validation block text and photo writes while counting the photo field once', async () => {
  const h = harness(validationHandler)
  try {
    await Promise.all([h.state.loadSpecies(), h.state.loadTaxonomy()]); await h.state.openEdit(h.state.species.value[0])
    const photoState = vue.reactive({ invalid: true, pending: false })
    let photoWrites = 0
    h.state.photoEditor.value = vue.markRaw({ validationState: () => photoState, commitPhotos: () => { photoWrites++ } })
    const dom = validationDom(h)
    await h.state.save()
    assert.deepEqual(Array.from(h.state.invalidFields.value), ['photos'])
    assert.equal(dom.focused[0].name, 'photos')
    photoState.invalid = false; photoState.pending = true; await flush()
    await h.state.save(); assert.equal(photoWrites, 0)
    assert.ok(h.calls.every(call => call.options.method === 'GET'))
    photoState.pending = false; await flush()
    assert.equal(h.state.invalidFields.value.length, 0)
    assert.equal(summaryNode(h).children, '')
    h.state.modal.value = null; await flush()
    assert.equal(h.timers.size, 0, 'closing cleans up any pulse')
  } finally { h.stop() }
})

test('localized placeholders appear in shared Create/Edit fields without becoming form values', async () => {
  const expected = messages.conservationPages.species.placeholders
  for (const mode of ['create', 'edit']) {
    const h = harness(validationHandler)
    try {
      await Promise.all([h.state.loadSpecies(), h.state.loadTaxonomy()])
      if (mode === 'edit') await h.state.openEdit(h.state.species.value[0])
      else h.state.openCreate()
      const before = JSON.stringify(h.state.form)
      const rendered = nodes(h.render())
      for (const key of ['scientificName', 'commonName', 'description', 'habitat']) {
        const field = rendered.find(node => node.props?.['data-validation-field'] === key)
        assert.equal(field.props.placeholder, expected[key])
        assert.ok(['input', 'textarea'].includes(field.type))
        if (mode === 'create') assert.equal(h.state.form[key], '')
      }
      for (const key of ['scientificName', 'commonName', 'description', 'visibility']) {
        const field = rendered.find(node => node.props?.['data-validation-field'] === key)
        assert.equal(field.props['aria-required'], 'true')
      }
      const labels = rendered.filter(node => node.type === 'span').map(node => node.children)
      assert.ok(labels.includes('Scientific Name *')); assert.ok(labels.includes('Common Name *'))
      assert.ok(labels.includes('Description *')); assert.ok(labels.includes('Visibility *'))
      const family = rendered.find(node => node.props?.class === 'readonly-field')
      assert.equal(family.props.placeholder, expected.family)
      assert.ok(Object.hasOwn(family.props, 'readonly'))
      assert.equal(family.props.value, mode === 'edit' ? 'Dipterocarpaceae' : '')
      assert.equal(JSON.stringify(h.state.form), before)
      if (mode === 'create') {
        assert.equal(integration.speciesPayload(h.state.form).scientific_name, '')
        let photoSaves = 0
        h.state.photoEditor.value = vue.markRaw({ commitPhotos: () => { photoSaves++ } })
        await h.state.save()
        assert.deepEqual(Array.from(h.state.invalidFields.value), ['scientificName', 'commonName', 'description'])
        assert.equal(photoSaves, 0)
      } else {
        assert.equal(h.state.form.scientificName, 'Shorea persisted')
        assert.equal(h.state.form.commonName, 'Persisted meranti')
        assert.equal(h.state.form.description, 'Persisted description')
      }
      assert.ok(h.calls.every(call => call.options.method === 'GET'))
    } finally { h.stop() }
  }
})

test('dropdown hints preserve optional unassigned selections, visibility default and derived family', async () => {
  const h = harness(validationHandler)
  try {
    await Promise.all([h.state.loadSpecies(), h.state.loadTaxonomy()]); h.state.openCreate()
    const control = key => nodes(h.render()).find(node => node.props?.['data-validation-field'] === key)
    for (const [key, hint, emptyLabel] of [['genusId', 'genus', 'No genus assigned'], ['conservationStatus', 'conservationStatus', 'No conservation status assigned']]) {
      const field = control(key)
      assert.equal(field.props.title, messages.conservationPages.species.placeholders[hint])
      assert.equal(field.props['aria-description'], field.props.title)
      const empty = nodes(field).find(node => node.type === 'option' && node.props?.value === '')
      assert.equal(empty.children, emptyLabel)
      assert.equal(empty.props.disabled, undefined, 'unassigned remains a valid selectable value')
      assert.equal(h.state.form[key], '')
    }
    const visibility = control('visibility')
    const placeholder = nodes(visibility).find(node => node.type === 'option' && node.props?.value === '')
    assert.equal(placeholder.children, messages.conservationPages.species.placeholders.visibility)
    assert.ok(Object.hasOwn(placeholder.props, 'disabled'))
    assert.equal(h.state.form.visibility, 'protected')
    assert.deepEqual(nodes(visibility).filter(node => node.type === 'option' && node.props?.value).map(node => node.props.value), ['public', 'internal', 'protected'])
    control('genusId').props['onUpdate:modelValue']('7'); await flush()
    assert.equal(nodes(h.render()).find(node => node.props?.class === 'readonly-field').props.value, 'Dipterocarpaceae')
    control('genusId').props['onUpdate:modelValue'](''); await flush()
    assert.equal(nodes(h.render()).find(node => node.props?.class === 'readonly-field').props.value, '')
    const payload = integration.speciesPayload(h.state.form)
    assert.equal(payload.genus_id, null); assert.equal(payload.conservation_status, '')
    const errors = integration.validateSpeciesForm(h.state.form, h.state.taxonomy.value, h.state.knownStatuses.value)
    assert.equal(errors.genusId, undefined); assert.equal(errors.conservationStatus, undefined)
    assert.ok(h.calls.every(call => call.options.method === 'GET'))
  } finally { h.stop() }
})

test('every supported locale has complete nonempty form placeholder translations', () => {
  const keys = ['scientificName', 'commonName', 'genus', 'family', 'conservationStatus', 'visibility', 'description', 'habitat'].sort()
  for (const locale of ['en', 'ms', 'zh-CN']) {
    const hints = JSON.parse(readFileSync(new URL(`../src/locales/${locale}.json`, import.meta.url), 'utf8')).conservationPages.species.placeholders
    assert.deepEqual(Object.keys(hints).sort(), keys)
    assert.ok(Object.values(hints).every(hint => typeof hint === 'string' && hint.trim()))
    if (locale === 'zh-CN') assert.ok(Object.values(hints).every(hint => /[\u4e00-\u9fff]/.test(hint)))
  }
})

test('Create/Edit omit Cultural Significance controls and payloads while keeping stored read metadata and required Description', async () => {
  for (const mode of ['create', 'edit']) {
    const h = harness(validationHandler)
    try {
      await Promise.all([h.state.loadSpecies(), h.state.loadTaxonomy()])
      if (mode === 'edit') await h.state.openEdit(h.state.species.value[0])
      else h.state.openCreate()
      const controls = nodes(h.render()).filter(node => node.props?.['data-validation-field'])
      assert.ok(!controls.some(node => node.props['data-validation-field'] === 'culturalSignificance'))
      assert.deepEqual(controls.filter(node => node.type === 'textarea').map(node => node.props['data-validation-field']), ['description', 'habitat'])
      assert.equal(Object.hasOwn(h.state.form, 'culturalSignificance'), false)
      if (mode === 'edit') {
        assert.equal(h.state.selected.value.culturalSignificance, 'Persisted cultural value', 'read mapping remains compatible')
        assert.equal(h.state.form.habitat, 'Persisted habitat')
      }
      const payload = integration.speciesPayload(h.state.form)
      assert.equal(Object.hasOwn(payload, 'culturalSignificance'), false)
      assert.equal(Object.hasOwn(integration.speciesPayload({ ...h.state.form, culturalSignificance: 'legacy hidden value' }), 'culturalSignificance'), false)
      const errors = integration.validateSpeciesForm({ ...h.state.form, description: '', culturalSignificance: 'x'.repeat(5000) }, h.state.taxonomy.value, h.state.knownStatuses.value)
      assert.ok(errors.description); assert.equal(errors.culturalSignificance, undefined)
      assert.ok(h.calls.every(call => call.options.method === 'GET'))
    } finally { h.stop() }
  }
})

const speciesTable = h => nodes(h.render()).find(node => node.type === 'table' && node.props?.class === 'species-table')

test('Plant Species keeps eight aligned columns, intact names and all existing row actions in the scoped table', async () => {
  const row = speciesFixture({ scientific_name: 'Shorea exceptionally long scientific name', common_name: 'Meranti with a long documented common name' })
  const h = harness(async url => Response.json(url === '/api/taxonomy' ? { genera: taxonomyFixture } : { species: [row] }))
  try {
    await Promise.all([h.state.loadSpecies(), h.state.loadTaxonomy()])
    const table = speciesTable(h)
    const labels = messages.conservationPages.species
    assert.deepEqual(nodes(table).filter(node => node.type === 'th').map(node => node.children), ['speciesId', 'scientificName', 'commonName', 'genus', 'family', 'conservationStatus', 'visibility', 'actions'].map(key => labels[key]))
    assert.ok(nodes(table).filter(node => node.type === 'th').every(node => node.props.scope === 'col'))
    assert.deepEqual(nodes(table).filter(node => node.type === 'col').map(node => node.props.class), ['species-id-column', 'scientific-column', 'common-column', 'genus-column', 'family-column', 'status-column', 'visibility-column', 'actions-column'])
    const renderedRow = nodes(table).find(node => node.type === 'tr' && node.key === '3')
    const cells = nodes(renderedRow).filter(node => node.type === 'td')
    assert.equal(cells.length, 8)
    assert.equal(nodes(cells[1]).find(node => node.type === 'em').children, row.scientific_name)
    assert.equal(cells[2].children, row.common_name)
    assert.equal(cells[3].children, row.genus_name)
    assert.equal(cells[4].children, row.family_name)
    assert.ok(cells.slice(1, 5).every(node => node.props.class === 'name-cell'))
    assert.equal(cells[5].props.class, 'status-cell')
    assert.deepEqual(nodes(cells[7]).filter(node => node.type === 'button').map(node => node.children), [labels.view, labels.editSpecies, labels.deleteSpecies])
    assert.ok(h.calls.every(call => call.options.method === 'GET'))
  } finally { h.stop() }
})

test('loaded-limit paragraph is removed visually while accessible scope, skipped records and loading states remain', async () => {
  const h = harness(async () => Response.json({ species: [speciesFixture(), {}] }))
  try {
    const loading = nodes(speciesTable(h)).find(node => node.type === 'td' && node.props.colspan === '8')
    assert.ok(loading)
    await h.state.loadSpecies()
    const all = nodes(h.render())
    assert.ok(!all.some(node => node.type === 'p' && typeof node.children === 'string' && node.children.includes('Client-side search and filters')))
    const scroll = all.find(node => node.props?.class === 'table-scroll species-scroll')
    assert.equal(scroll.props.role, 'region')
    assert.equal(scroll.props.tabindex, '0')
    assert.equal(scroll.props['aria-description'], messages.conservationPages.species.loadedLimit)
    assert.equal(scroll.props['aria-label'], messages.conservationPages.species.title)
    assert.equal(h.state.skippedRecords.value, 1)
    const warning = all.find(node => node.type === 'p' && node.props?.class === 'dataset-note')
    assert.ok(warning); assert.equal(warning.props.role, 'status')
    assert.ok(!String(warning.children).includes(messages.conservationPages.species.loadedLimit))
    assert.equal(h.calls[0].url, '/api/species?scope=scientific')
    assert.ok(h.calls.every(call => call.options.method === 'GET'))
  } finally { h.stop() }
})

test('Plant Species styles preserve the Officer header, natural taxonomy wrapping and internally scrollable action rows', () => {
  const css = descriptor.styles[0].content
  assert.match(css, /\.officer-layout \.species-scroll \.species-table\s*\{[^}]*min-width: 88rem; table-layout: auto; border-collapse: separate; border-spacing: 0/)
  assert.match(css, /\.species-table th\s*\{ background: #245443; color: #fff;[^}]*font-size: var\(--officer-small, .75rem\); font-weight: 700; text-transform: uppercase/)
  assert.match(css, /\.species-table td\s*\{ font-size: var\(--officer-text, .875rem\); line-height: 1.5/)
  assert.match(css, /\.species-table th, \.officer-layout \.species-scroll \.species-table td\s*\{ padding: 12px 14px; text-align: left; vertical-align: middle/)
  assert.match(css, /\.species-table td.name-cell\s*\{ white-space: normal; overflow-wrap: normal; word-break: normal/)
  assert.match(css, /\.species-table \.action-group\s*\{ display: flex; align-items: center; flex-wrap: nowrap; gap: 7px; width: max-content; min-width: max-content/)
  assert.match(css, /\.officer-layout \.species-scroll\s*\{ min-width: 0; max-width: 100%; overflow-x: auto/)
  assert.match(css, /\.species-scroll:focus-visible\s*\{ outline: 3px solid/)
  assert.doesNotMatch(css, /word-break: break-all|text-overflow: ellipsis/)
  const compiled = compileStyle({ source: css, id: 'data-v-species-table', scoped: true })
  assert.equal(compiled.errors.length, 0)
  // This boundary and scoped attribute outrank the shared Officer table's anywhere wrapping.
  assert.match(compiled.code, /\.officer-layout \.species-scroll \.species-table td.name-cell\[data-v-species-table\]/)
  assert.equal(compileTemplate({ source: descriptor.template.content, filename: filename.pathname, id: 'species-table', compilerOptions: { bindingMetadata: script.bindings } }).errors.length, 0)
})
