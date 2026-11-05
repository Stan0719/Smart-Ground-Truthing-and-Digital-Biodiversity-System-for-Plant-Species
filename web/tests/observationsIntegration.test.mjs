import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as vue from 'vue'
import * as observationReview from '../src/services/observationReview.ts'
import * as observationQueue from '../src/services/observationQueue.ts'
import * as speciesRequestIntegration from '../src/services/reviewSpeciesRequest.ts'
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
  origin_type: 'subsequent_observation',
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
const officer = { id: 'officer', role: 'Conservation Officer', status: 'Active', mustChangePassword: false }
function harness(fetchHandler, initialUser = officer, pending = false, queueHandler = null, language = 'en') {
  const messages = JSON.parse(readFileSync(new URL(`../src/locales/${language}.json`, import.meta.url), 'utf8'))
  let session = { user: initialUser, pending }
  const sessionListeners = new Set()
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
    Error,
    AbortSignal,
    console,
    fetch: async (url, options) => {
      calls.push({ url, options })
      if (url.startsWith('/api/observations?')) {
        if (queueHandler) return queueHandler(url, options)
        const response = await fetchHandler('/api/observations', options)
        if (!response.ok) return response
        const result = await response.json()
        return Response.json({ ...result, page: { has_more: false, next_cursor: null } })
      }
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
      if (name.endsWith('/auth')) return { currentUser: async () => session.user, sessionSnapshot: () => session, subscribeSession: fn => { sessionListeners.add(fn); return () => sessionListeners.delete(fn) } }
      if (name.endsWith('observationReview')) return observationReview
      if (name.endsWith('observationQueue')) return observationQueue
      if (name.endsWith('reviewSpeciesRequest')) return speciesRequestIntegration
      if (name.endsWith('plantId')) return { formatPlantId }
      if (name.endsWith('.vue')) return { name }
      throw Error(`Unexpected import: ${name}`)
    },
  }
  vm.runInNewContext(`(function () { ${transpile(script.content)} })()`, context)
  const state = scope.run(() => exports.default.setup({}, { expose() {} }))
  vm.runInNewContext(`(function () { ${transpile(template.code)} })()`, context)
  return { state, calls, changeSession(user, pending = false) { session = { user, pending }; for (const fn of sessionListeners) fn(user, pending) }, render: () => exports.render({}, [], {}, vue.proxyRefs(state), {}, {}), stop: () => scope.stop() }
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

test('list keeps raw IDs, sorts valid timestamps and opens local review without leaving Observations', async () => {
  const older = fixture({ id: 'legacy-text', created_at: '2026-01-01T00:00:00Z', owner_subject: 'another-owner' })
  const invalidDate = fixture({ id: '17', created_at: 'not-a-date', scientific_name: 'Last species' })
  const h = harness(async url => Response.json(url === '/api/observations' ? { observations: [invalidDate, older, fixture()] } : { observation: fixture() }))
  try {
    await h.state.loadObservations()
    assert.deepEqual(Array.from(h.state.observations.value, (item) => item.id), [uuid, 'legacy-text', '17'])
    h.state.search.value = 'real-botanist-subject'
    assert.deepEqual(Array.from(h.state.filtered.value, (item) => item.id), [uuid, '17'])
    h.state.search.value = 'shorea actualis'
    assert.equal(h.state.filtered.value.length, 2)
    const links = nodes(h.render()).filter((node) => node.props?.to?.name === 'conservation-reviews')
    const reviewButtons = nodes(h.render()).filter(node => node.type === 'button' && node.props?.class === 'action-button' && node.children === 'Review')
    assert.ok(reviewButtons.length > 0)
    assert.equal(links.length, 0)
    await reviewButtons[0].props.onClick()
    assert.equal(h.state.reviewMode.value, true)
    assert.equal(h.state.selected.value.id, uuid)
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
    assert.ok(nodes(empty.render()).some((node) => node.children === 'No field observations in the loaded results.'))
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


const modalReview = h => nodes(h.render()).find(n => n.props?.class === 'action-button modal-review-link')

test('modal review navigation is available only for refreshed Pending Review and Flagged observations', async () => {
  for (const status of ['Pending Review', 'Flagged', 'Approved', 'Rejected', 'Correction Required', 'Draft', 'Unknown']) {
    const row = fixture({ status, origin_type: 'initial_registration' })
    const h = harness(async () => Response.json({ observation: row }))
    try {
      const opening = h.state.open(h.state.mapObservation(row))
      assert.equal(modalReview(h), undefined, 'cached data must not enable navigation while refreshing')
      await opening
      const action = modalReview(h)
      assert.equal(Boolean(action), ['Pending Review', 'Flagged'].includes(status), status)
      if (action) {
        assert.ok(nodes(action).some(node => node.children === 'Review Submission'))
        assert.equal(action.props.to.name, 'conservation-reviews')
        assert.equal(action.props.to.query.review, row.id)
        action.props.onClick()
        assert.equal(h.state.selected.value, null)
        assert.equal(h.state.detailLoading.value, false)
        assert.ok(h.calls.every(call => !call.options?.method || call.options.method === 'GET'))
      }
    } finally { h.stop() }
  }
})

test('modal action denies unauthorized, inactive, temporary-password and unverified sessions', async () => {
  for (const [user, pending] of [[null, false], [officer, true], [{ ...officer, role: 'Administrator' }, false], [{ ...officer, role: 'Botanist' }, false], [{ ...officer, role: 'Visitor' }, false], [{ ...officer, status: 'Suspended' }, false], [{ ...officer, mustChangePassword: true }, false]]) {
    const h = harness(async () => Response.json({ observation: fixture() }), user, pending)
    try { await h.state.open(h.state.mapObservation(fixture())); assert.equal(modalReview(h), undefined) }
    finally { h.stop() }
  }
})

test('refreshed status, mismatched IDs and failed detail reads cannot enable stale review navigation', async () => {
  for (const response of [() => Response.json({ observation: fixture({ status: 'Approved' }) }), () => Response.json({ observation: fixture({ id: 'different-id' }) }), () => Response.json({ error: 'Unavailable' }, { status: 503 })]) {
    const h = harness(response)
    try { await h.state.open(h.state.mapObservation(fixture())); assert.equal(modalReview(h), undefined) }
    finally { h.stop() }
  }
})

test('logout closes the modal and late detail responses cannot restore the navigation action', async () => {
  let finish
  const h = harness(() => new Promise(resolve => { finish = resolve }))
  try {
    const opening = h.state.open(h.state.mapObservation(fixture()))
    h.changeSession(null, true)
    assert.equal(h.state.selected.value, null)
    finish(Response.json({ observation: fixture() }))
    await opening
    assert.equal(h.state.selected.value, null)
    assert.equal(modalReview(h), undefined)
  } finally { h.stop() }
})

test('modal review uses page-action sizing and bounded wrapping without altering the table action contract', () => {
  const content = descriptor.template.content
  assert.ok(content.indexOf('observation-review-actions') > content.indexOf('selected.assets'))
  assert.match(descriptor.styles[0].content, /\.modal-review-link \{ max-width: 100%; white-space: normal;/)
  assert.match(content, /@click="open\(item, true\)"/)
  for (const [locale, label] of [['en', 'Review Submission'], ['ms', 'Semak Penyerahan'], ['zh-CN', '\u5ba1\u6838\u63d0\u4ea4']]) {
    const translations = JSON.parse(readFileSync(new URL('../src/locales/' + locale + '.json', import.meta.url), 'utf8'))
    assert.equal(translations.conservationPages.observations.reviewSubmission, label)
  }
})


function reviewHarness(row = fixture(), save = () => Response.json({ reviewed: true })) {
  let current = row
  const h = harness(async (url, options) => {
    if (options?.method === 'POST') return save(url, options, value => { current = value })
    return Response.json(url === '/api/observations' ? { observations: [current] } : { observation: current })
  })
  return { h, set: row => { current = row } }
}

test('View stays read-only; Review opens the same modal and uses actual status transitions', async () => {
  for (const status of ['Pending Review', 'Flagged', 'Approved', 'Rejected', 'Correction Required', 'Draft']) {
    const { h } = reviewHarness(fixture({ status }))
    try {
      await h.state.open(h.state.mapObservation(fixture({ status })))
      assert.equal(h.state.reviewMode.value, false)
      assert.ok(!nodes(h.render()).some(n => n.props?.class === 'officer-review'))
      await h.state.open(h.state.selected.value, true)
      assert.equal(h.state.reviewMode.value, true)
      assert.deepEqual(Array.from(h.state.reviewDecisions.value), observationReview.reviewTransitions[status] || [])
      assert.equal(Boolean(h.state.reviewAllowed.value), ['Pending Review', 'Flagged'].includes(status))
    } finally { h.stop() }
  }
})

test('review requires feedback for non-approval decisions and denies self-review, invalid revisions and unresolved dependencies', async () => {
  const { h } = reviewHarness()
  try {
    await h.state.open(h.state.mapObservation(fixture()), true)
    for (const decision of ['Rejected', 'Correction Required', 'Flagged']) {
      h.state.reviewComment.value = ' '
      await h.state.decide(decision)
      assert.ok(!h.calls.some(c => c.options?.method === 'POST'))
    }
  } finally { h.stop() }
  for (const changes of [{ revision: 0 }, { revision: null }, { owner_subject: 'staff:officer' }, { species_request_id: '12' }, { species_request_id: '12', species_request: { request_id: '12', request_status: 'Pending Review' } }]) {
    const { h } = reviewHarness(fixture(changes))
    try { await h.state.open(h.state.mapObservation(fixture(changes)), true); assert.equal(h.state.reviewAllowed.value, false); await h.state.decide('Approved'); assert.ok(!h.calls.some(c => c.options?.method === 'POST')) }
    finally { h.stop() }
  }
})

test('review submits one exact decision and refetches persisted content into modal, row and filters', async () => {
  let complete
  const { h } = reviewHarness(fixture(), (url, options, set) => new Promise(resolve => { complete = () => { set(fixture({ status: 'Approved', revision: 5, content: { ...fixture().content, heightCm: 25 } })); resolve(Response.json({ reviewed: true })) } }))
  try {
    await h.state.loadObservations(); await h.state.open(h.state.observations.value[0], true)
    h.state.reviewComment.value = 'Verified in field'
    const saving = h.state.decide('Approved'); await flush(); await h.state.decide('Approved')
    const posts = h.calls.filter(c => c.options?.method === 'POST'); assert.equal(posts.length, 1)
    assert.equal(posts[0].url, '/api/observations/' + uuid + '/review')
    assert.deepEqual(JSON.parse(posts[0].options.body), { decision: 'Approved', comment: 'Verified in field', revision: 4 })
    complete(); await saving
    assert.equal(h.state.selected.value.status, 'Approved'); assert.equal(h.state.selected.value.height, '25 cm')
    assert.equal(h.state.observations.value[0].status, 'Approved'); assert.equal(h.state.reviewAllowed.value, false)
    h.state.status.value = 'Pending Review'; assert.equal(h.state.filtered.value.length, 0)
  } finally { h.stop() }
})

test('409 reloads authoritative data, preserves feedback and requires acknowledgement before retry', async () => {
  const { h, set } = reviewHarness(fixture(), () => { set(fixture({ revision: 5 })); return Response.json({ error: 'Changed' }, { status: 409 }) })
  try {
    await h.state.open(h.state.mapObservation(fixture()), true); h.state.reviewComment.value = 'Keep my comment'
    await h.state.decide('Rejected')
    assert.equal(h.state.selected.value.revision, 5); assert.equal(h.state.reviewComment.value, 'Keep my comment')
    assert.equal(h.state.reviewAcknowledged.value, false); assert.equal(h.state.reviewAllowed.value, false)
    h.state.reviewAcknowledged.value = true; assert.equal(h.state.reviewAllowed.value, true)
  } finally { h.stop() }
})

test('uncertain save requires an authoritative reload and cannot silently retry a committed decision', async () => {
  const { h, set } = reviewHarness(fixture(), () => { set(fixture({ status: 'Approved', revision: 5 })); throw Error('Connection lost') })
  try {
    await h.state.open(h.state.mapObservation(fixture()), true); await h.state.decide('Approved')
    assert.equal(h.state.reviewNeedsReload.value, true); assert.equal(h.state.reviewAllowed.value, false)
    await h.state.decide('Approved'); assert.equal(h.calls.filter(c => c.options?.method === 'POST').length, 1)
    await h.state.reloadReview(); assert.equal(h.state.selected.value.status, 'Approved'); assert.equal(h.state.reviewNeedsReload.value, false)
    assert.equal(h.state.reviewAcknowledged.value, false)
  } finally { h.stop() }
})

test('logout invalidates a pending review readback and cannot reopen privileged modal data', async () => {
  let finish
  const { h } = reviewHarness(fixture(), () => new Promise(resolve => { finish = resolve }))
  try {
    await h.state.open(h.state.mapObservation(fixture()), true)
    const saving = h.state.decide('Approved'); await flush(); const before = h.calls.length
    h.changeSession(null, true); assert.equal(h.state.selected.value, null)
    finish(Response.json({ reviewed: true })); await saving
    assert.equal(h.state.selected.value, null); assert.equal(h.state.reviewAllowed.value, false); assert.equal(h.calls.length, before)
  } finally { h.stop() }
})

test('approved species linkage enables review, but a disappearing dependency remains blocked after refresh', async () => {
  const linked = fixture({ species_request_id: '12', species_request: { request_id: '12', request_status: 'Approved', approved_species_id: '3', proposed_scientific_name: 'Shorea actualis' } })
  const { h, set } = reviewHarness(linked, () => { set(fixture({ revision: 5 })); return Response.json({ error: 'Reload' }, { status: 409 }) })
  try {
    await h.state.open(h.state.mapObservation(linked), true); assert.equal(h.state.reviewAllowed.value, true)
    await h.state.decide('Approved'); h.state.reviewAcknowledged.value = true
    assert.equal(h.state.selected.value.speciesRequest.state, 'error'); assert.equal(h.state.reviewAllowed.value, false)
  } finally { h.stop() }
})

test('field queue, all-origin history and legacy browsing retain their distinct review owners', async () => {
  const field = fixture(), initial = fixture({ id: '21', origin_type: 'initial_registration' }), legacy = fixture({ id: '22', origin_type: 'unknown' })
  const rows = [field, initial, legacy]
  const h = harness(async url => Response.json({ observation: rows.find(row => row.id === url.split('/').pop()) }), officer, false, async url => {
    const query = new URL(url, 'https://fixture.invalid').searchParams
    return Response.json({ observations: rows.filter(row => !query.get('origin_type') || row.origin_type === query.get('origin_type')), page: { has_more: false, next_cursor: null } })
  })
  try {
    await h.state.loadObservations(); assert.equal(h.state.filtered.value.length, 1)
    assert.ok(h.calls[0].url.includes('origin_type=subsequent_observation'))
    await h.state.open(h.state.filtered.value[0], true); assert.equal(h.state.reviewAllowed.value, true)
    h.state.closeModal(); h.state.queueOrigin.value = 'all'; await h.state.loadObservations()
    assert.equal(h.state.filtered.value.length, 3)
    await h.state.open(h.state.mapObservation(initial), true)
    assert.equal(h.state.reviewAllowed.value, false)
    assert.ok(modalReview(h)); h.state.closeModal()
    h.state.queueOrigin.value = 'unknown'; await h.state.loadObservations()
    assert.equal(h.state.filtered.value[0].origin, 'unknown')
    assert.ok(nodes(h.render()).some(n => typeof n.children === 'string' && n.children === 'Origin not verified'))
    await h.state.open(h.state.filtered.value[0]); assert.ok(modalReview(h))
  } finally { h.stop() }
})

test('pagination reaches older field records, survives a failed next page and rejects stale selection loads', async () => {
  let fail = true
  const h = harness(async () => Response.json({ observation: fixture() }), officer, false, async url => {
    const query = new URL(url, 'https://fixture.invalid').searchParams
    if (!query.has('cursor')) return Response.json({ observations: [fixture()], page: { has_more: true, next_cursor: 'older' } })
    if (fail) return Response.json({ error: 'Page unavailable' }, { status: 503 })
    return Response.json({ observations: [fixture({ id: '99', created_at: '2020-01-01T00:00:00Z' })], page: { has_more: false, next_cursor: null } })
  })
  try {
    await h.state.loadObservations(); assert.equal(h.state.hasMore.value, true)
    await h.state.loadObservations(true); assert.equal(h.state.observations.value.length, 1); assert.ok(h.state.loadError.value)
    fail = false; await h.state.loadObservations(true)
    assert.equal(h.state.observations.value.length, 2); assert.equal(h.state.hasMore.value, false)
    assert.equal(h.state.observations.value[1].id, '99')
  } finally { h.stop() }
})

test('fresh field-origin changes before POST disable the field decision and retain view access', async () => {
  let current = fixture()
  const h = harness(async () => Response.json({ observation: current }))
  try {
    await h.state.open(h.state.mapObservation(current), true)
    current = fixture({ origin_type: 'initial_registration' })
    await h.state.decide('Approved'); await flush()
    assert.equal(h.calls.filter(c => c.options?.method === 'POST').length, 0)
    assert.equal(h.state.reviewAllowed.value, false)
    assert.equal(h.state.selected.value.origin, 'initial_registration')
    assert.ok(modalReview(h))
  } finally { h.stop() }
})


test('primary field action respects status, self-review, session, revision and species dependencies', async () => {
  const cases = [
    [{}, officer, false, true], [{ status: 'Flagged' }, officer, false, true],
    ...['Approved', 'Rejected', 'Correction Required', 'Draft', 'Unknown'].map(status => [{ status }, officer, false, false]),
    [{ owner_subject: 'staff:officer' }, officer, false, false],
    [{ status: 'Flagged', owner_subject: 'staff:officer' }, officer, false, false],
    [{ revision: null }, officer, false, false], [{ species_request_id: '12' }, officer, false, false],
    [{}, null, false, false], [{}, officer, true, false], [{}, { ...officer, role: 'Botanist' }, false, false],
  ]
  for (const [changes, user, pending, eligible] of cases) {
    const row = fixture(changes)
    const h = harness(async () => Response.json({ observation: row }), user, pending)
    try {
      h.state.isLoading.value = false; h.state.observations.value = [h.state.mapObservation(row)]
      const buttons = nodes(h.render()).filter(n => n.type === 'button' && ['Review', 'View Details', 'View'].includes(n.children))
      assert.equal(buttons.length, 1, JSON.stringify(changes))
      assert.equal(buttons[0].children, eligible ? 'Review' : 'View Details')
      await buttons[0].props.onClick(); await flush()
      assert.equal(h.state.selected.value.id, uuid)
      assert.equal(h.state.reviewMode.value, eligible)
      assert.equal(Boolean(nodes(h.render()).find(n => n.props?.class === 'officer-review')), eligible)
      assert.equal(h.calls.filter(c => c.options?.method === 'POST').length, 0)
      assert.equal(h.state.selected.value.latitude, '0'); assert.equal(h.state.selected.value.assets.length, 2)
    } finally { h.stop() }
  }
})

test('initial and legacy rows preserve read-only details, review routing and supporting actions', async () => {
  for (const origin of ['initial_registration', 'unknown']) {
    const row = fixture({ origin_type: origin })
    const h = harness(async () => Response.json({ observation: row }))
    try {
      h.state.queueOrigin.value = 'all'; h.state.isLoading.value = false
      h.state.observations.value = [h.state.mapObservation(row)]
      const actions = nodes(nodes(h.render()).find(n => n.props?.class === 'action-group'))
      const view = actions.find(n => n.type === 'button' && n.children === 'View Details')
      assert.ok(view); assert.ok(!actions.some(n => n.type === 'button' && n.children === 'Review'))
      assert.ok(actions.some(n => n.props?.to?.name === 'conservation-reviews' && n.props.to.query.review === uuid))
      assert.ok(actions.some(n => n.props?.to === '/plant/' + h.state.observations.value[0].plantRouteId))
      assert.ok(actions.some(n => n.children === 'History'))
      assert.ok(actions.some(n => n.props?.to?.name === 'conservation-map'))
      await view.props.onClick(); await flush()
      assert.equal(h.state.selected.value.origin, origin); assert.equal(h.state.reviewMode.value, false)
      assert.ok(!nodes(h.render()).some(n => n.props?.class === 'officer-review'))
    } finally { h.stop() }
  }
})

test('primary action labels reuse English, Malay and Chinese translations', () => {
  for (const language of ['en', 'ms', 'zh-CN']) {
    const labels = JSON.parse(readFileSync(new URL(`../src/locales/${language}.json`, import.meta.url), 'utf8'))
    const h = harness(async () => Response.json({}), officer, false, null, language)
    try {
      h.state.isLoading.value = false
      for (const status of ['Pending Review', 'Approved']) {
        h.state.observations.value = [h.state.mapObservation(fixture({ status }))]
        const expected = status === 'Approved' ? labels.common.viewDetails : labels.conservationPages.observations.review
        assert.ok(nodes(h.render()).some(n => n.type === 'button' && n.children === expected))
      }
    } finally { h.stop() }
  }
})
