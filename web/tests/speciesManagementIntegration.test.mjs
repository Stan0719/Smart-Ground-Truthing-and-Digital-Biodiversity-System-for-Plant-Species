import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
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
function harness(fetchHandler, query = {}) {
  const scope = vue.effectScope()
  const route = vue.reactive({ query })
  const calls = []
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
  return { state, calls, route, render: () => exports.render({}, [], {}, vue.proxyRefs(state), {}, {}), stop: () => scope.stop() }
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
        culturalSignificance: 'Community value',
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
      habitat: ' Limestone forest ', culturalSignificance: ' Community value ',
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
      assert.deepEqual(Object.keys(body).sort(), ['common_name','conservation_status','culturalSignificance','description','genus_id','habitat','scientific_name','visibility'].sort())
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
  assert.match(source, /st\('imageLimitation'\)/)
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
    habitat: '', culturalSignificance: '',
  }
  const taxonomy = [{ id: '7', name: 'Shorea', family: 'Dipterocarpaceae' }]
  for (const [field, limit] of [['scientificName', 200], ['commonName', 200], ['description', 4000], ['habitat', 4000]]) {
    assert.equal(integration.validateSpeciesForm({ ...valid, [field]: 'x'.repeat(limit) }, taxonomy, ['Vulnerable'])[field], undefined)
    assert.ok(integration.validateSpeciesForm({ ...valid, [field]: 'x'.repeat(limit + 1) }, taxonomy, ['Vulnerable'])[field])
  }
  assert.match(source, /v-model\.trim="search" maxlength="100"/)
})
