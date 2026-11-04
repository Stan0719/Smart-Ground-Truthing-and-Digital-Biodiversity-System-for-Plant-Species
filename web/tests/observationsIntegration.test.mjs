import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as vue from 'vue'
import { formatPlantId } from '../src/utils/plantId.ts'

const filename = new URL('../src/views/conservation/ObservationsView.vue', import.meta.url)
const { descriptor } = parse(readFileSync(filename, 'utf8'))
const script = compileScript(descriptor, { id: 'observations-integration' })
const template = compileTemplate({
  source: descriptor.template.content,
  filename: filename.pathname,
  id: 'observations-integration',
  compilerOptions: { bindingMetadata: script.bindings },
})
const transpile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const messages = JSON.parse(readFileSync(new URL('../src/locales/en.json', import.meta.url), 'utf8'))
const uuid = '5d8a3647-e3c3-43fa-b355-aabdddf05f71'
const fixture = (overrides = {}) => ({
  id: uuid,
  plant_id: 7,
  owner_subject: 'staff:real-botanist-subject',
  status: 'Pending Review',
  revision: 4,
  created_at: '2026-11-02T10:00:00Z',
  updated_at: '2026-11-03T10:00:00Z',
  species_id: 3,
  scientific_name: 'Shorea actualis',
  common_name: 'Actual meranti',
  review_comment: 'Current review comment',
  review_decision: 'Flagged',
  reviewed_at: '2026-11-03T11:00:00Z',
  content: {
    heightCm: 12.5,
    healthStatus: 'Healthy',
    lifeStage: 'Mature',
    morphology: 'Current nested morphology',
    notes: 'Current nested notes',
    latitude: 0,
    longitude: 0,
    accuracy_m: 0,
    taxonomy: { genus: 'Shorea', confidence: 0.9 },
  },
  assets: [
    { id: 'real-image', content_type: 'image/jpeg' },
    { id: 'field-notes', content_type: 'application/pdf' },
  ],
  ...overrides,
})
const flush = async () => {
  for (let i = 0; i < 4; i++) {
    await vue.nextTick()
    await new Promise(setImmediate)
  }
}
function harness(fetchHandler) {
  const scope = vue.effectScope()
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
        onBeforeUnmount() {},
        resolveComponent: (component) => component,
        withDirectives: (node) => node,
      }
      if (name === 'vue-i18n') return { useI18n: () => ({ t, te: (key) => typeof key.split('.').reduce((entry, part) => entry?.[part], messages) === 'string', locale: vue.ref('en') }) }
      if (name.endsWith('plantId')) return { formatPlantId }
      if (name.endsWith('.vue')) return { name }
      throw Error(`Unexpected import: ${name}`)
    },
  }
  vm.runInNewContext(`(function () { ${transpile(script.content)} })()`, context)
  const state = scope.run(() => exports.default.setup({}, { expose() {} }))
  vm.runInNewContext(`(function () { ${transpile(template.code)} })()`, context)
  return { state, calls, render: () => exports.render({}, [], {}, vue.proxyRefs(state), {}, {}), stop: () => scope.stop() }
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

test('UUID and legacy raw IDs map current nested content, status, review fields and zero GPS', () => {
  const h = harness(async () => Response.json({ observations: [] }))
  try {
    const current = h.state.mapObservation(fixture())
    assert.equal(current.id, uuid)
    assert.equal(current.plantRawId, '7')
    assert.equal(current.plantDisplayId, 'PL007')
    assert.equal(current.ownerSubject, 'staff:real-botanist-subject')
    assert.equal(current.height, '12.5 cm')
    assert.equal(current.healthStatus, 'Healthy')
    assert.equal(current.lifeStage, 'Mature')
    assert.equal(current.morphology, 'Current nested morphology')
    assert.equal(current.notes, 'Current nested notes')
    assert.equal(current.latitude, '0')
    assert.equal(current.longitude, '0')
    assert.equal(current.gpsAccuracy, '0')
    assert.equal(current.status, 'Pending Review')
    assert.equal(current.reviewDecision, 'Flagged')
    assert.equal(current.reviewComment, 'Current review comment')
    assert.equal(current.reviewedAt, '2026-11-03T11:00:00Z')
    assert.deepEqual({ ...current.taxonomy }, { genus: 'Shorea', confidence: '0.9' })
    for (const id of [42, 'legacy-import-A7']) assert.equal(h.state.mapObservation(fixture({ id })).id, String(id))
  } finally { h.stop() }
})

test('list keeps raw IDs, sorts valid created timestamps, searches current fields and links raw review ID', async () => {
  const older = fixture({ id: 'legacy-text', created_at: '2026-01-01T00:00:00Z', owner_subject: 'another-owner' })
  const invalidDate = fixture({ id: '17', created_at: 'not-a-date', scientific_name: 'Last species' })
  const h = harness(async () => Response.json({ observations: [invalidDate, older, fixture()] }))
  try {
    await h.state.loadObservations()
    assert.deepEqual(Array.from(h.state.observations.value, (item) => item.id), [uuid, 'legacy-text', '17'])
    h.state.search.value = 'real-botanist-subject'
    assert.deepEqual(Array.from(h.state.filtered.value, (item) => item.id), [uuid, '17'])
    h.state.search.value = 'shorea actualis'
    assert.equal(h.state.filtered.value.length, 2)
    const links = nodes(h.render()).filter((node) => node.props?.to?.name === 'conservation-reviews')
    assert.ok(links.some((node) => node.props.to.query.review === uuid))
    assert.ok(links.every((node) => !String(node.props.to.query.review).startsWith('OBS')))
    const mapLinks = nodes(h.render()).filter((node) => node.props?.to?.name === 'conservation-map')
    assert.ok(mapLinks.every((node) => node.props.to.query.plant === '7'))
  } finally { h.stop() }
})

test('detail GET refreshes assets; images, attachments and broken images fail independently', async () => {
  const row = fixture()
  const h = harness(async (url) => Response.json(url === '/api/observations' ? { observations: [row] } : { observation: row }))
  try {
    await h.state.loadObservations()
    await h.state.open(h.state.observations.value[0])
    assert.ok(h.calls.some((call) => call.url === `/api/observations/${uuid}`))
    assert.equal(h.state.selected.value.assets.length, 2)
    let rendered = nodes(h.render())
    let image = rendered.find((node) => node.type === 'img')
    assert.equal(image.props.src, '/api/data/assets/real-image')
    assert.ok(rendered.some((node) => node.children === 'Attachment'))
    image.props.onError()
    await flush()
    rendered = nodes(h.render())
    assert.equal(rendered.filter((node) => node.type === 'img').length, 0)
    assert.ok(rendered.some((node) => node.children === 'Image unavailable'))
    assert.equal(h.state.selected.value.id, uuid)
  } finally { h.stop() }
})

test('API failures and malformed contracts stay distinct from a successful empty list', async () => {
  for (const response of [
    () => Response.json({ error: 'Database unavailable.' }, { status: 503 }),
    () => new Response('<html>gateway</html>', { status: 502 }),
    () => Response.json({ observations: null }),
    () => { throw Error('offline') },
  ]) {
    const h = harness(response)
    try {
      await h.state.loadObservations()
      assert.ok(h.state.loadError.value)
      assert.equal(h.state.observations.value.length, 0)
      assert.ok(nodes(h.render()).some((node) => node.children === 'Observations could not be loaded.'))
    } finally { h.stop() }
  }
  const empty = harness(async () => Response.json({ observations: [] }))
  try {
    await empty.state.loadObservations()
    assert.equal(empty.state.loadError.value, '')
    assert.ok(nodes(empty.render()).some((node) => node.children === 'No observations match your filters.'))
  } finally { empty.stop() }
})

test('only clearly malformed records are skipped without discarding valid raw IDs', async () => {
  const h = harness(async () => Response.json({ observations: [null, {}, fixture({ id: '' }), fixture({ content: null }), fixture({ id: 'text-id' })] }))
  try {
    await h.state.loadObservations()
    assert.equal(h.state.skippedRecords.value, 4)
    assert.deepEqual(Array.from(h.state.observations.value, (item) => item.id), ['text-id'])
  } finally { h.stop() }
})
