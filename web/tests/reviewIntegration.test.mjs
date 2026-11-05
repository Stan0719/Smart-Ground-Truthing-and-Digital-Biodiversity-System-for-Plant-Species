import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as vue from 'vue'
import * as observationReview from '../src/services/observationReview.ts'
import * as observationQueue from '../src/services/observationQueue.ts'
import { formatObservationId } from '../src/utils/observationId.ts'
import { formatPlantId } from '../src/utils/plantId.ts'
import { plantSimilarityByObservation } from '../src/data/plantSimilarityPrototype.ts'
import * as speciesRequestIntegration from '../src/services/reviewSpeciesRequest.ts'

// Execute the actual SFC setup/render code with an in-memory HTTP boundary.
// No server, credentials, live database, or browser storage is used.
const filename = new URL('../src/views/conservation/ReviewSubmissionsView.vue', import.meta.url)
const { descriptor } = parse(readFileSync(filename, 'utf8'))
const script = compileScript(descriptor, { id: 'review-integration' })
const template = compileTemplate({
  source: descriptor.template.content,
  filename: filename.pathname,
  id: 'review-integration',
  compilerOptions: { bindingMetadata: script.bindings },
})
const transpile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
const messages = JSON.parse(
  readFileSync(new URL('../src/locales/en.json', import.meta.url), 'utf8'),
)
const firstId = 'aa3bd8be-988f-40a7-b4ea-59408b85dbb1'
const secondId = 'bb3bd8be-988f-40a7-b4ea-59408b85dbb2'
const fixture = (overrides = {}) => ({
  origin_type: 'initial_registration',
  id: firstId,
  plant_id: 1,
  owner_subject: 'staff:botanist-uuid',
  status: 'Pending Review',
  revision: 3,
  species_id: 8,
  scientific_name: 'Actual species',
  common_name: 'Actual name',
  created_at: '2026-10-01T10:00:00Z',
  updated_at: '2026-10-02T10:00:00Z',
  content: {
    heightCm: 12,
    lifeStage: 'Seedling',
    healthStatus: 'Healthy',
    morphology: 'Submitted morphology',
    notes: 'Submitted notes',
    latitude: 0,
    longitude: 0,
    accuracy_m: 0,
  },
  assets: [
    { id: 'image-one', content_type: 'image/jpeg' },
    { id: 'image-two', content_type: 'image/png' },
    { id: 'attachment', content_type: 'application/pdf' },
  ],
  ...overrides,
})
const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await vue.nextTick()
    await new Promise(setImmediate)
  }
}
function fixtureResponse(url, rows) {
  return Response.json(url === '/api/observations' ? { observations: rows } : { observation: rows?.find(row => String(row?.id) === url.split('/').pop()) });
}
function harness(fetchHandler, query = {}, language = 'en', plantHandler = async url => Response.json({ plant: { plant_id: url.split('/').pop(), qr_token: null, qr_status: null } }), queueHandler = null) {
  const messages = JSON.parse(readFileSync(new URL(`../src/locales/${language}.json`, import.meta.url), 'utf8'))
  const scope = vue.effectScope()
  const cleanup = []
  let sessionListener
  let session = { user: { id: 'verified-officer', role: 'Conservation Officer', status: 'Active', mustChangePassword: false }, pending: false }
  const route = vue.reactive({ query })
  const calls = []
  const t = (key, params = {}) => {
    const value = key.split('.').reduce((entry, part) => entry?.[part], messages) ?? key
    return Object.entries(params).reduce(
      (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
      value,
    )
  }
  const exports = {}
  const context = {
    exports,
    Error,
    AbortSignal,
    console,
    HTMLElement: class {},
    fetch: async (url, options) => {
      calls.push({ url, options })
      if (url.startsWith('/api/plants/')) return plantHandler(url, options)
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
      // DOM directives are not mounted by this VNode-only render harness.
      if (name === 'vue')
        return { ...vue, onMounted() {}, onBeforeUnmount(fn) { cleanup.push(fn) }, resolveComponent: name => name, withDirectives: (node) => node }
      if (name === 'vue-router')
        return {
          useRoute: () => route,
          useRouter: () => ({
            replace: ({ query }) => {
              route.query = query
              return Promise.resolve()
            },
          }),
        }
      if (name === 'vue-i18n') return { useI18n: () => ({ t }) }
      if (name.endsWith('useConservationText'))
        return {
          useConservationText: () => ({ ct: (value) => String(value), locale: vue.ref('en') }),
        }
      if (name.endsWith('/auth')) return { sessionSnapshot: () => session, subscribeSession: fn => { sessionListener = fn; return () => { sessionListener = null } } }
      if (name.endsWith('observationId')) return { formatObservationId }
      if (name.endsWith('observationReview')) return observationReview
      if (name.endsWith('observationQueue')) return observationQueue
      if (name.endsWith('reviewSpeciesRequest')) return speciesRequestIntegration
      if (name.endsWith('plantId')) return { formatPlantId }
      if (name.endsWith('plantSimilarityPrototype')) return { plantSimilarityByObservation }
      if (name.endsWith('reviewSpeciesRequest')) return speciesRequestIntegration
      if (name.endsWith('.vue')) return { name }
      throw Error(`Unexpected import: ${name}`)
    },
  }
  vm.runInNewContext(`(function () { ${transpile(script.content)} })()`, context)
  const state = scope.run(() => exports.default.setup({}, { expose() {} }))
  vm.runInNewContext(`(function () { ${transpile(template.code)} })()`, context)
  return {
    state,
    route,
    calls,
    emitSession(user, pending = false) { session = { user, pending }; sessionListener?.(user, pending) },
    stop: () => { cleanup.forEach(fn => fn()); scope.stop() },
    render: () => exports.render({}, [], {}, vue.proxyRefs(state), {}, {}),
  }
}
function nodes(root) {
  const result = []
  function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk)
    if (!node || typeof node !== 'object') return
    result.push(node)
    if (Array.isArray(node.children)) walk(node.children)
    else if (node.children?.default) walk(node.children.default())
  }
  walk(root)
  return result
}

test('UUID list, nested evidence, zero GPS, safe malformed rows, gallery and similarity isolation', async () => {
  const row = fixture()
  const h = harness(async (url) => fixtureResponse(url, [row, null, {}, fixture({ id: 1 })]),
  )
  try {
    assert.match(h.state.countValue(0), /Loading/)
    await h.state.loadObservations()
    assert.equal(h.state.observations.value.length, 2)
    assert.equal(h.state.skippedRecords.value, 2)
    const observation = h.state.observations.value[0]
    assert.equal(observation.id, firstId)
    assert.equal(observation.revision, 3)
    assert.equal(observation.recordedBy, row.owner_subject)
    assert.equal(observation.height, '12 cm')
    assert.equal(observation.growthStage, 'Seedling')
    assert.equal(observation.health, 'Healthy')
    assert.equal(observation.morphology, row.content.morphology)
    assert.equal(observation.notes, row.content.notes)
    for (const key of ['latitude', 'longitude', 'gpsAccuracy']) assert.equal(observation[key], '0')
    assert.equal(observation.createdAt, row.created_at)
    assert.equal(h.state.similarityFor(observation.displayId), undefined)
    assert.ok(h.state.similarityFor(h.state.observations.value[1].displayId))
    await h.state.open(observation)
    await flush()
    assert.equal(h.route.query.review, firstId)
    let images = nodes(h.render()).filter((node) => node.type === 'img')
    assert.equal(images.length, 2)
    assert.ok(images.every((node) => node.props.src.startsWith('/api/data/assets/')))
    images[0].props.onError()
    images = nodes(h.render()).filter((node) => node.type === 'img')
    assert.equal(images.length, 1)
    assert.ok(h.state.canDecide('Approved'))
    assert.ok(h.calls.every((call) => !call.url.includes('species-requests')))
  } finally {
    h.stop()
  }
})

test('UUID deep links outside list cap and reactive query changes load detail; stale responses are ignored', async () => {
  let release
  const h = harness(
    async (url) => {
      if (url === '/api/observations') return Response.json({ observations: [] })
      if (url.endsWith(firstId))
        return new Promise((resolve) => {
          release = () => resolve(Response.json({ observation: fixture() }))
        })
      return Response.json({ observation: fixture({ id: secondId }) })
    },
    { review: firstId },
  )
  try {
    await h.state.loadObservations()
    await flush()
    h.route.query = { review: secondId }
    await flush()
    assert.equal(h.state.selected.value.id, secondId)
    release()
    await flush()
    assert.equal(h.state.selected.value.id, secondId)
    assert.ok(h.calls.some((call) => call.url === `/api/observations/${secondId}`))
  } finally {
    h.stop()
  }
})

test('review commits exact body, refetches persisted state, survives simulated page reload, blocks duplicate clicks', async () => {
  let row = fixture(),
    releasePost
  const h = harness(async (url, options) => {
    if (options.method === 'POST') {
      const body = JSON.parse(options.body)
      assert.deepEqual(Object.keys(body).sort(), ['comment', 'decision', 'revision'])
      assert.deepEqual(body, { decision: 'Approved', comment: '', revision: 3 })
      row = fixture({
        status: 'Approved',
        revision: 4,
        review_comment: 'Verified.',
        review_decision: 'Approved',
        reviewed_at: new Date().toISOString(),
      })
      return new Promise((resolve) => {
        releasePost = () => resolve(Response.json({ reviewed: true }))
      })
    }
    return Response.json(
      url === '/api/observations' ? { observations: [row] } : { observation: row },
    )
  })
  try {
    await h.state.loadObservations()
    await h.state.open(h.state.observations.value[0])
    const save = h.state.decide('Approved')
    await flush()
    assert.equal(h.state.isSaving.value, true)
    h.state.closeReview()
    assert.ok(h.state.selected.value)
    await h.state.decide('Approved')
    assert.equal(h.calls.filter((call) => call.options.method === 'POST').length, 1)
    releasePost()
    await save
    assert.equal(h.state.selected.value.status, 'Approved')
    assert.equal(h.state.selected.value.revision, 4)
    assert.equal(h.state.reviewMessage.value.variant, 'success')
    await h.state.loadObservations()
    assert.equal(h.state.observations.value[0].status, 'Approved')
  } finally {
    h.stop()
  }
})

test('comment requirements and canonical transitions block invalid POSTs', async () => {
  const h = harness(async (url) => fixtureResponse(url, [fixture()]))
  try {
    await h.state.loadObservations()
    await h.state.open(h.state.observations.value[0])
    for (const decision of ['Rejected', 'Correction Required', 'Flagged'])
      await h.state.decide(decision)
    assert.equal(h.calls.filter((call) => call.options.method === 'POST').length, 0)
    assert.match(h.state.reviewMessage.value.message, /comment/)
    for (const status of ['Draft', 'Approved', 'Rejected', 'Correction Required']) {
      h.state.selected.value.status = status
      for (const decision of ['Approved', 'Rejected', 'Correction Required', 'Flagged'])
        assert.equal(h.state.canDecide(decision), false)
    }
    h.state.selected.value.status = 'Flagged'
    assert.equal(h.state.canDecide('Flagged'), false)
    assert.equal(h.state.canDecide('Approved'), true)
  } finally {
    h.stop()
  }
})

test('all four decisions read back saved status, revision and review fields in a fresh page instance', async () => {
  for (const decision of ['Approved', 'Rejected', 'Correction Required', 'Flagged']) {
    let stored = fixture()
    let posts = 0
    const reviewTime = '2026-11-03T05:00:00Z'
    const handler = async (url, options) => {
      if (options.method === 'POST') {
        posts++
        assert.equal(url, `/api/observations/${firstId}/review`)
        const body = JSON.parse(options.body)
        assert.deepEqual(Object.keys(body).sort(), ['comment', 'decision', 'revision'])
        assert.equal(body.decision, decision)
        assert.equal(body.revision, stored.revision)
        stored = {
          ...stored,
          status: decision,
          revision: stored.revision + 1,
          review_comment: body.comment,
          review_decision: decision,
          reviewed_at: reviewTime,
        }
        return Response.json({ reviewed: true })
      }
      return Response.json(
        url === '/api/observations' ? { observations: [stored] } : { observation: stored },
      )
    }
    const h = harness(handler, { review: firstId })
    try {
      await h.state.loadObservations()
      await flush()
      h.state.comment.value = `${decision}: officer evidence`
      await h.state.decide(decision)
      assert.equal(posts, 1)
      assert.equal(h.state.selected.value.status, decision)
      assert.equal(h.state.selected.value.revision, 4)
      assert.equal(h.state.selected.value.reviewDecision, decision)
      assert.equal(h.state.selected.value.reviewComment, `${decision}: officer evidence`)
      assert.equal(h.state.selected.value.reviewedAt, reviewTime)
      assert.equal(h.state.reviewMessage.value.variant, 'success')
    } finally {
      h.stop()
    }

    // Independent setup state simulates a complete page reload, not just a list refresh.
    const reloaded = harness(handler, { review: firstId })
    try {
      await reloaded.state.loadObservations()
      await flush()
      assert.equal(reloaded.state.selected.value.status, decision)
      assert.equal(reloaded.state.selected.value.revision, 4)
      assert.equal(reloaded.state.comment.value, `${decision}: officer evidence`)
      assert.equal(reloaded.state.selected.value.reviewedAt, reviewTime)
      assert.equal(posts, 1)
    } finally {
      reloaded.stop()
    }
  }
})

test('failed conflict reload keeps stale decisions blocked until a successful read and acknowledgment', async () => {
  let detailAvailable = false
  let initialDetail = 2
  const h = harness(async (url, options) => {
    if (options.method === 'POST') return Response.json({ error: 'Changed' }, { status: 409 })
    if (url === '/api/observations') return Response.json({ observations: [fixture()] })
    if (initialDetail && url !== '/api/observations') { initialDetail--; return Response.json({ observation: fixture() }) }
    return detailAvailable
      ? Response.json({ observation: fixture({ revision: 5 }) })
      : Response.json({ error: 'Unavailable' }, { status: 503 })
  })
  try {
    await h.state.loadObservations()
    await h.state.open(h.state.observations.value[0])
    h.state.comment.value = 'Preserve my evidence'
    await h.state.decide('Rejected')
    assert.equal(h.state.needsReload.value, true)
    assert.equal(h.state.canDecide('Rejected'), false)
    detailAvailable = true
    await h.state.reloadSelected()
    assert.equal(h.state.selected.value.revision, 5)
    assert.equal(h.state.comment.value, 'Preserve my evidence')
    assert.equal(h.state.needsReload.value, false)
    assert.equal(h.state.canDecide('Rejected'), false)
    h.state.conflictAcknowledged.value = true
    assert.equal(h.state.canDecide('Rejected'), true)
    assert.equal(h.calls.filter((call) => call.options.method === 'POST').length, 1)
  } finally {
    h.stop()
  }
})

test('409 refetches latest revision, preserves comment, requires acknowledgment and never auto-resubmits', async () => {
  const h = harness(async (url, options) =>
    options.method === 'POST'
      ? Response.json({ error: 'Observation changed.' }, { status: 409 })
      : Response.json(
          url === '/api/observations'
            ? { observations: [fixture()] }
            : { observation: fixture({ revision: 4, status: 'Flagged' }) },
        ),
  )
  try {
    await h.state.loadObservations()
    await h.state.open(h.state.observations.value[0])
    h.state.comment.value = 'Officer notes'
    await h.state.decide('Rejected')
    assert.equal(h.state.selected.value.revision, 4)
    assert.equal(h.state.comment.value, 'Officer notes')
    assert.equal(h.state.canDecide('Rejected'), false)
    assert.equal(h.calls.filter((call) => call.options.method === 'POST').length, 1)
    h.state.conflictAcknowledged.value = true
    assert.equal(h.state.canDecide('Rejected'), true)
  } finally {
    h.stop()
  }
})

test('400/401/403/404, network and malformed responses retain comments and surface errors', async () => {
  for (const status of [400, 401, 403, 404, 'network', 'malformed']) {
    const h = harness(async (url, options) => {
      if (options.method !== 'POST') return fixtureResponse(url, [fixture()])
      if (status === 'network') throw Error('Disconnected')
      if (status === 'malformed') return new Response('<html>gateway</html>')
      return Response.json({ message: `Backend error ${status}` }, { status })
    })
    try {
      await h.state.loadObservations()
      await h.state.open(h.state.observations.value[0])
      h.state.comment.value = 'Keep this comment'
      await h.state.decide('Rejected')
      assert.equal(h.state.comment.value, 'Keep this comment')
      assert.equal(h.state.reviewMessage.value.variant, 'error')
      if (typeof status === 'number')
        assert.equal(h.state.reviewMessage.value.message, `Backend error ${status}`)
      else assert.equal(h.state.needsReload.value, true)
    } finally {
      h.stop()
    }
  }
})

test('committed review with failed refetch is never reported as an unsaved transaction', async () => {
  let initialDetail = 2
  const h = harness(async (url, options) => {
    if (options.method === 'POST') return Response.json({ reviewed: true })
    if (url === '/api/observations') return Response.json({ observations: [fixture()] })
    if (initialDetail) { initialDetail--; return Response.json({ observation: fixture() }) }
    return Response.json({ error: 'Unavailable' }, { status: 503 })
  })
  try {
    await h.state.loadObservations()
    await h.state.open(h.state.observations.value[0])
    await h.state.decide('Approved')
    assert.match(h.state.reviewMessage.value.message, /review was saved/)
    assert.equal(h.state.needsReload.value, true)
  } finally {
    h.stop()
  }
})

test('malformed list produces unavailable counts, while empty lists and missing images stay truthful', async () => {
  const h = harness(async (url) => fixtureResponse(url, null))
  try {
    await h.state.loadObservations()
    assert.equal(h.state.countValue(0), 'Unavailable')
    const empty = h.state.mapObservation(fixture({ assets: [], content: {} }))
    assert.equal(empty.assets.length, 0)
    assert.equal(empty.latitude, '')
    await h.state.open(empty)
    const rendered = nodes(h.render())
    assert.equal(rendered.filter((node) => node.type === 'img').length, 0)
    assert.ok(rendered.some((node) => node.children === 'No submitted images or attachments.'))
  } finally {
    h.stop()
  }
})

const requestFixture = (overrides = {}) => ({
  request_id: 'request-42',
  request_status: 'Pending Review',
  proposed_scientific_name: 'Proposed species',
  suggested_common_name: 'Proposed name',
  genus_name: 'Proposed genus',
  family_name: 'Proposed family',
  conservation_status: 'Not Assessed',
  description: 'Proposed description',
  habitat: 'Submitted habitat',
  requested_by: 'staff:botanist',
  submitted_at: '2026-11-01T10:00:00Z',
  review_comment: 'Species-specific comment',
  ...overrides,
})

test('pending linked request appears before observation details and blocks every plant decision', async () => {
  const h = harness(async (url) => fixtureResponse(url, [
        fixture({ species_request_id: 'request-42', species_request: requestFixture() }),
      ]),
  )
  try {
    await h.state.loadObservations()
    await h.state.open(h.state.observations.value[0])
    assert.equal(h.state.speciesRequestState.value, 'pending')
    assert.equal(h.state.canReviewPlant.value, false)
    assert.equal(h.state.speciesReviewComment.value, 'Species-specific comment')
    assert.equal(h.state.comment.value, '')
    for (const decision of ['Approved', 'Rejected', 'Correction Required', 'Flagged']) {
      assert.equal(h.state.canDecide(decision), false)
      await h.state.decide(decision)
    }
    assert.equal(h.calls.filter((call) => call.options.method === 'POST').length, 0)
    const rendered = nodes(h.render())
    assert.ok(rendered.some((node) => node.props?.class === 'species-request-list'))
    assert.ok(
      rendered.some((node) => node.type === 'h3' && node.children === 'New Species Request'),
    )
    assert.ok(rendered.some((node) => node.type === 'em' && node.children === 'Proposed species'))
    const speciesSection = rendered.findIndex(
      (node) => node.type === 'section' && node.props?.class === 'species-request-card',
    )
    const plantSection = rendered.findIndex(
      (node) => node.type === 'section' && node.props?.class === 'review-section',
    )
    assert.ok(speciesSection >= 0 && speciesSection < plantSection)
    const approveSpecies = rendered.find(
      (node) => node.type === 'button' && node.children === 'Approve Species',
    )
    assert.equal(approveSpecies.props.disabled, false)
    assert.equal(h.state.canReviewSpecies.value, true)
    assert.ok(rendered.some((node) => node.props?.id === 'plant-species-gate'))
  } finally {
    h.stop()
  }
})

test('only backend-approved request with matching resulting species and real name unlocks review', async () => {
  for (const [extra, unlocked] of [
    [{ approved_species_id: 8 }, true],
    [{ approved_species_id: null }, false],
    [{ approved_species_id: 9 }, false],
  ]) {
    const h = harness(async (url) => fixtureResponse(url, [
          fixture({ species_request: requestFixture({ request_status: 'Approved', ...extra }) }),
        ]),
    )
    try {
      await h.state.loadObservations()
      await h.state.open(h.state.observations.value[0])
      assert.equal(h.state.canDecide('Approved'), unlocked)
      assert.equal(h.state.speciesRequestState.value, unlocked ? 'approved' : 'incomplete')
      if (unlocked) {
        assert.ok(
          nodes(h.render()).some(
            (node) => node.type === 'h4' && node.children === 'Approved Species',
          ),
        )
        h.state.selected.value.scientificName = ''
        assert.equal(h.state.canDecide('Approved'), false)
      }
    } finally {
      h.stop()
    }
  }
})

test('rejected, correction, unknown, ID-only and malformed request references fail closed', async () => {
  for (const extra of [
    { species_request: requestFixture({ request_status: 'Rejected' }) },
    { species_request: requestFixture({ request_status: 'Correction Required' }) },
    { species_request: requestFixture({ request_status: 'Unexpected' }) },
    { species_request_id: 'request-42' },
    { species_request_id: 'different', species_request: requestFixture() },
    { species_request: {} },
  ]) {
    const h = harness(async (url) => fixtureResponse(url, [fixture(extra)]))
    try {
      await h.state.loadObservations()
      await h.state.open(h.state.observations.value[0])
      assert.ok(h.state.selectedSpeciesRequest.value)
      assert.equal(h.state.canReviewPlant.value, false)
      assert.equal(h.state.canReviewSpecies.value, false)
      assert.equal(h.state.selected.value.status, 'Pending Review')
    } finally {
      h.stop()
    }
  }
})

test('resolution refresh fails independently, verifies association on GET, and resets between modals', async () => {
  let fail = true,
    release
  const linked = fixture({ species_request: requestFixture() })
  let initialDetail = true
  const h = harness(async (url) => {
    if (url === '/api/observations')
      return Response.json({ observations: [linked, fixture({ id: secondId })] })
    if (url.endsWith(secondId)) return Response.json({ observation: fixture({ id: secondId }) })
    if (initialDetail && url !== '/api/observations') { initialDetail = false; return Response.json({ observation: linked }) }
    if (fail) return Response.json({ error: 'Request service unavailable' }, { status: 503 })
    return new Promise((resolve) => {
      release = () =>
        resolve(
          Response.json({
            observation: fixture({
              species_request: requestFixture({
                request_status: 'Approved',
                approved_species_id: 8,
              }),
            }),
          }),
        )
    })
  })
  try {
    await h.state.loadObservations()
    await h.state.open(h.state.observations.value[0])
    h.state.comment.value = 'Plant comment to preserve'
    await h.state.refreshSpeciesRequest()
    assert.equal(h.state.speciesRequestState.value, 'error')
    assert.equal(h.state.selected.value.height, '12 cm')
    assert.equal(h.state.observations.value.length, 2)
    assert.equal(h.state.canReviewPlant.value, false)
    fail = false
    const refresh = h.state.refreshSpeciesRequest()
    await flush()
    assert.equal(h.state.speciesRequestState.value, 'loading')
    assert.equal(h.state.canReviewPlant.value, false)
    release()
    await refresh
    assert.equal(h.state.canReviewPlant.value, true)
    assert.equal(h.state.comment.value, 'Plant comment to preserve')
    h.state.speciesReviewComment.value = 'Unsaved species note'
    await h.state.open(h.state.observations.value[1])
    await flush()
    assert.equal(h.state.selectedSpeciesRequest.value, null)
    assert.equal(h.state.speciesReviewComment.value, '')
    assert.equal(h.state.speciesLoadError.value, '')
    assert.equal(h.state.canReviewPlant.value, true)
    assert.ok(h.calls.every((call) => !call.url.includes('species-requests')))
  } finally {
    h.stop()
  }
})

test('request dependency cannot silently disappear on resolution refresh', async () => {
  const h = harness(async (url) =>
    Response.json(
      url === '/api/observations'
        ? { observations: [fixture({ species_request_id: 'request-42' })] }
        : { observation: fixture() },
    ),
  )
  try {
    await h.state.loadObservations()
    await h.state.open(h.state.observations.value[0])
    await h.state.refreshSpeciesRequest()
    assert.ok(h.state.speciesLoadError.value)
    assert.equal(h.state.canReviewPlant.value, false)
    h.state.closeReview()
    await h.state.open(h.state.observations.value[0])
    assert.equal(h.state.canReviewPlant.value, false)
  } finally {
    h.stop()
  }
})

test('real species approval posts explicit visibility with decision/comment and waits for authoritative observation linkage', async () => {
  let releasePost, releaseRead
  const pending = fixture({
    species_request: requestFixture({ request_id: '1', review_comment: null }),
  })
  const approved = fixture({
    species_request: requestFixture({
      request_id: '1',
      request_status: 'Approved',
      approved_species_id: '8',
      review_comment: '',
    }),
  })
  let initialDetail = 2
  const h = harness(async (url, options) => {
    if (url === '/api/observations')
      return Response.json({ observations: [pending, fixture({ id: secondId })] })
    if (options.method === 'POST') {
      assert.equal(url, '/api/species-requests/1/review')
      assert.equal(options.credentials, 'same-origin')
      assert.deepEqual(JSON.parse(options.body), { decision: 'Approved', comment: '', visibility: 'internal' })
      return new Promise((resolve) => {
        releasePost = () =>
          resolve(Response.json({ reviewed: true, species_request: approved.species_request }))
      })
    }
    if (initialDetail && url !== '/api/observations') { initialDetail--; return Response.json({ observation: pending }) }
    assert.equal(url, `/api/observations/${firstId}`)
    return new Promise((resolve) => {
      releaseRead = () => resolve(Response.json({ observation: approved }))
    })
  })
  try {
    await h.state.loadObservations()
    await h.state.open(h.state.observations.value[0])
    h.state.comment.value = 'Independent plant comment'
    h.state.speciesVisibility.value = 'internal'
    const save = h.state.decideSpecies('Approved')
    await flush()
    assert.equal(h.state.speciesSaving.value, true)
    assert.equal(h.state.speciesRequestState.value, 'saving')
    assert.equal(h.state.canReviewPlant.value, false)
    assert.equal(h.state.canReviewSpecies.value, false)
    h.state.closeReview()
    await h.state.open(h.state.observations.value[1])
    assert.equal(h.state.selected.value.id, firstId)
    await h.state.decideSpecies('Approved')
    assert.equal(h.calls.filter((c) => c.options.method === 'POST').length, 1)
    releasePost()
    await flush()
    assert.equal(h.state.selectedSpeciesRequest.value.state, 'pending')
    assert.equal(h.state.canReviewPlant.value, false)
    releaseRead()
    await save
    assert.equal(h.state.speciesSaving.value, false)
    assert.equal(h.state.speciesRequestState.value, 'approved')
    assert.equal(h.state.canReviewPlant.value, true)
    assert.equal(h.state.canReviewSpecies.value, false)
    assert.equal(h.state.comment.value, 'Independent plant comment')
    assert.equal(h.state.selected.value.status, 'Pending Review')
    assert.ok(nodes(h.render()).some((n) => n.type === 'h4' && n.children === 'Approved Species'))
    assert.equal(h.state.reviewMessage.value.variant, 'success')
  } finally {
    h.stop()
  }
})

test('species rejection/correction validate comments, refetch saved reasons, and never decide the plant', async () => {
  for (const decision of ['Rejected', 'Correction Required']) {
    let stored = fixture({ species_request: requestFixture({ request_id: '1' }) })
    const h = harness(async (url, options) => {
      if (url === '/api/observations') return Response.json({ observations: [stored] })
      if (options.method === 'POST') {
        assert.equal(url, '/api/species-requests/1/review')
        assert.deepEqual(JSON.parse(options.body), { decision, comment: 'Species reason' })
        stored = fixture({
          species_request: requestFixture({
            request_id: '1',
            request_status: decision,
            review_comment: 'Species reason',
          }),
        })
        return Response.json({ reviewed: true })
      }
      return Response.json({ observation: stored })
    })
    try {
      await h.state.loadObservations()
      await h.state.open(h.state.observations.value[0])
      for (const invalid of ['   ', 'x'.repeat(4001)]) {
        h.state.speciesReviewComment.value = invalid
        await h.state.decideSpecies(decision)
        assert.equal(h.calls.filter((c) => c.options.method === 'POST').length, 0)
        assert.ok(h.state.speciesSaveError.value)
      }
      h.state.speciesReviewComment.value = 'Species reason'
      await h.state.decideSpecies(decision)
      assert.equal(h.state.selectedSpeciesRequest.value.status, decision)
      assert.equal(h.state.selectedSpeciesRequest.value.reviewComment, 'Species reason')
      assert.equal(h.state.canReviewPlant.value, false)
      assert.equal(h.state.selected.value.status, 'Pending Review')
      assert.equal(h.state.reviewMessage.value.variant, 'success')
    } finally {
      h.stop()
    }
  }
})

test('species 400/401/403/404 and network failures preserve comments and require recovery for uncertain saves', async () => {
  for (const status of [400, 401, 403, 404, 0]) {
    const h = harness(async (url, options) => {
      if (url === '/api/observations')
        return Response.json({ observations: [fixture({ species_request: requestFixture() })] })
      if (options.method === 'POST') {
        if (!status) throw Error('Disconnected')
        return Response.json(
          status === 400
            ? { message: 'Species validation failed' }
            : { error: `Species failure ${status}` },
          { status },
        )
      }
      return Response.json({ observation: fixture({ species_request: requestFixture() }) })
    })
    try {
      await h.state.loadObservations()
      await h.state.open(h.state.observations.value[0])
      h.state.speciesReviewComment.value = 'Keep species note'
      await h.state.decideSpecies('Rejected')
      assert.equal(h.state.speciesReviewComment.value, 'Keep species note')
      assert.equal(h.state.speciesRequestState.value, 'error')
      assert.equal(h.state.canReviewPlant.value, false)
      assert.equal(h.state.speciesSaving.value, false)
      assert.match(
        h.state.speciesSaveError.value,
        status === 400
          ? /Species validation failed/
          : status
            ? new RegExp(`Species failure ${status}`)
            : /network|connect|reach/i,
      )
      assert.equal(h.state.speciesNeedsReload.value, status === 0 || status === 404)
      if (h.state.speciesNeedsReload.value) {
        await h.state.decideSpecies('Rejected')
        assert.equal(h.calls.filter((c) => c.options.method === 'POST').length, 1)
        await h.state.refreshSpeciesRequest()
        assert.equal(h.state.canReviewSpecies.value, true)
      }
    } finally {
      h.stop()
    }
  }
})

test('species 409 reloads latest state without resubmitting and preserves the draft comment', async () => {
  let initialDetail = 2
  const h = harness(async (url, options) => {
    if (url === '/api/observations')
      return Response.json({ observations: [fixture({ species_request: requestFixture() })] })
    if (options.method === 'POST')
      return Response.json({ error: 'Already resolved' }, { status: 409 })
    if (initialDetail && url !== '/api/observations') { initialDetail--; return Response.json({ observation: fixture({ species_request: requestFixture() }) }) }
    return Response.json({
      observation: fixture({
        species_request: requestFixture({ request_status: 'Approved', approved_species_id: 8 }),
      }),
    })
  })
  try {
    await h.state.loadObservations()
    await h.state.open(h.state.observations.value[0])
    h.state.speciesReviewComment.value = 'My competing reason'
    await h.state.decideSpecies('Rejected')
    assert.equal(h.state.speciesReviewComment.value, 'My competing reason')
    assert.equal(h.state.canReviewPlant.value, true)
    assert.equal(h.state.canReviewSpecies.value, false)
    assert.match(h.state.reviewMessage.value.message, /latest state has been reloaded/)
    assert.equal(h.calls.filter((c) => c.options.method === 'POST').length, 1)
  } finally {
    h.stop()
  }
})

test('species conflict/readback failures and malformed POST responses stay locked until refreshed', async () => {
  for (const mode of ['conflict', 'committed', 'malformed', 'lost-link']) {
    let recover = false
    let initialDetail = 2
  const h = harness(async (url, options) => {
      if (url === '/api/observations')
        return Response.json({ observations: [fixture({ species_request: requestFixture() })] })
      if (options.method === 'POST')
        return Response.json(
          mode === 'conflict'
            ? { error: 'Changed' }
            : mode === 'malformed'
              ? {}
              : { reviewed: true },
          { status: mode === 'conflict' ? 409 : 200 },
        )
    if (initialDetail && url !== '/api/observations') { initialDetail--; return Response.json({ observation: fixture({ species_request: requestFixture() }) }) }
      if (!recover)
        return mode === 'lost-link'
          ? Response.json({ observation: fixture() })
          : Response.json({ error: 'Read unavailable' }, { status: 503 })
      return Response.json({
        observation: fixture({
          species_request: requestFixture({ request_status: 'Approved', approved_species_id: 8 }),
        }),
      })
    })
    try {
      await h.state.loadObservations()
      await h.state.open(h.state.observations.value[0])
      h.state.speciesReviewComment.value = 'Preserve this species comment'
      h.state.speciesVisibility.value = 'internal'
      await h.state.decideSpecies('Approved')
      assert.equal(h.state.speciesReviewComment.value, 'Preserve this species comment')
      assert.equal(h.state.canReviewPlant.value, false)
      assert.equal(h.state.canReviewSpecies.value, false)
      assert.equal(h.state.speciesNeedsReload.value, true)
      if (mode === 'committed') assert.match(h.state.reviewMessage.value.message, /was saved/)
      await h.state.decideSpecies('Approved')
      assert.equal(h.calls.filter((c) => c.options.method === 'POST').length, 1)
      recover = true
      await h.state.refreshSpeciesRequest()
      assert.equal(h.state.canReviewPlant.value, true)
    } finally {
      h.stop()
    }
  }
})

test('request photo uses the protected same-origin asset URL and fails independently', async () => {
  const h = harness(async (url) => fixtureResponse(url, [
        fixture({
          species_request: requestFixture({
            assets: [{ id: 'species-request-1', content_type: 'image/jpeg' }],
          }),
        }),
      ]),
  )
  try {
    await h.state.loadObservations()
    await h.state.open(h.state.observations.value[0])
    assert.ok(
      nodes(h.render()).some(
        (n) => n.type === 'img' && n.props.src === '/api/data/assets/species-request-1',
      ),
    )
    h.state.imageFailed('species-request-1')
    assert.ok(
      !nodes(h.render()).some(
        (n) => n.type === 'img' && n.props.src === '/api/data/assets/species-request-1',
      ),
    )
    assert.equal(h.state.canReviewSpecies.value, true)
    assert.equal(h.state.canReviewPlant.value, false)
    h.state.selected.value.speciesRequest = null
    assert.equal(h.state.canReviewSpecies.value, false)
    assert.equal(h.state.canReviewPlant.value, true)
    assert.ok(!nodes(h.render()).some((n) => n.props?.class === 'species-request-card'))
  } finally {
    h.stop()
  }
})

test('route changes during species save are deferred; another observation gets clean species state', async () => {
  let release
  let initialDetail = 2
  const h = harness(async (url, options) => {
    if (url === '/api/observations')
      return Response.json({
        observations: [fixture({ species_request: requestFixture() }), fixture({ id: secondId })],
      })
    if (options.method === 'POST')
      return new Promise((resolve) => {
        release = () => resolve(Response.json({ reviewed: true }))
      })
    if (url.endsWith(secondId)) return Response.json({ observation: fixture({ id: secondId }) })
    if (initialDetail && url !== '/api/observations') { initialDetail--; return Response.json({ observation: fixture({ species_request: requestFixture() }) }) }
    return Response.json({
      observation: fixture({
        species_request: requestFixture({
          request_status: 'Rejected',
          review_comment: 'Server reason',
        }),
      }),
    })
  })
  try {
    await h.state.loadObservations()
    await h.state.open(h.state.observations.value[0])
    h.state.speciesReviewComment.value = 'Species reason'
    const saving = h.state.decideSpecies('Rejected')
    await flush()
    h.route.query = { review: secondId }
    await flush()
    assert.equal(h.state.selected.value.id, firstId)
    release()
    await saving
    await flush()
    assert.equal(h.state.selected.value.id, secondId)
    assert.equal(h.state.speciesSaving.value, false)
    assert.equal(h.state.speciesReviewComment.value, '')
    assert.equal(h.state.speciesSaveError.value, '')
    assert.equal(h.state.selectedSpeciesRequest.value, null)
    assert.equal(h.state.canReviewPlant.value, true)
  } finally {
    h.stop()
  }
})

test('species approval requires an explicit visibility choice without a default', async () => {
  const h = harness(async (url) => fixtureResponse(url, [fixture({ species_request: requestFixture() })]))
  try {
    await h.state.loadObservations()
    await h.state.open(h.state.observations.value[0])
    assert.equal(h.state.speciesVisibility.value, '')
    await h.state.decideSpecies('Approved')
    assert.equal(h.calls.filter(c => c.options.method === 'POST').length, 0)
    assert.match(h.state.speciesSaveError.value, /visibility/i)
  } finally { h.stop() }
})

test('existing-species registration with null request metadata shows its selected species and no new-request controls', async () => {
  const row = fixture({ species_request_id: null, species_request: null })
  const h = harness(async (url) => fixtureResponse(url, [row]))
  try {
    await h.state.loadObservations()
    await h.state.open(h.state.observations.value[0]); await flush()
    assert.equal(h.state.selectedSpeciesRequest.value, null)
    assert.equal(h.state.speciesResolved.value, true)
    assert.equal(h.state.canReviewPlant.value, true)
    assert.equal(h.state.selected.value.speciesId, String(row.species_id))
    assert.ok(!nodes(h.render()).some(n => n.props?.class === 'species-request-card'))
    assert.ok(!nodes(h.render()).some(n => n.props?.class === 'species-request-list'))
  } finally { h.stop() }
})
const renderText = h => nodes(h.render()).map(node => typeof node.children === 'string' ? node.children : '').join(' ')
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

test('opening Review refreshes corrected catalogue identity and locks decisions until validated', async () => {
  const pending = deferred()
  const stale = fixture({ species_id: 1, scientific_name: 'Old catalogue', common_name: 'Old common' })
  const h = harness(async url => url === '/api/observations' ? fixtureResponse(url, [stale]) : pending.promise)
  try {
    await h.state.loadObservations()
    const opening = h.state.open(h.state.observations.value[0])
    await flush()
    assert.equal(h.state.selectionLoading.value, true)
    assert.equal(h.state.canDecide('Approved'), false)
    assert.equal(h.state.canReviewSpecies.value, false)
    assert.match(renderText(h), /Loading latest observation/)
    await h.state.decide('Approved')
    assert.equal(h.calls.filter(c => c.options.method === 'POST').length, 0)
    pending.resolve(Response.json({ observation: fixture({ species_id: 6, scientific_name: 'Corrected catalogue', common_name: 'Corrected common', revision: 9 }) }))
    await opening
    assert.equal(h.state.selected.value.speciesId, '6')
    assert.equal(h.state.selected.value.scientificName, 'Corrected catalogue')
    assert.equal(h.state.selected.value.commonName, 'Corrected common')
    assert.equal(h.state.selected.value.revision, 9)
    assert.equal(h.state.observations.value[0].speciesId, '6')
    assert.equal(h.state.canDecide('Approved'), true)
    assert.equal(h.calls.filter(c => c.url === `/api/observations/${firstId}`).length, 1)
    assert.doesNotMatch(renderText(h), /Old catalogue|Species Category/)
  } finally { h.stop() }
})

test('failed, missing, malformed and mismatched fresh details never enable stale decisions; retry preserves comment', async () => {
  for (const response of [() => { throw Error('offline') }, () => Response.json({}, { status: 503 }), () => Response.json({}), () => Response.json({ observation: fixture({ id: secondId }) }), () => Response.json({ observation: fixture({ revision: 0 }) }), () => Response.json({ observation: fixture({ status: 'unknown', species_request: requestFixture() }) })]) {
    let recover = false
    const h = harness(async url => url === '/api/observations' ? fixtureResponse(url, [fixture()]) : recover ? Response.json({ observation: fixture({ revision: 8 }) }) : response())
    try {
      await h.state.loadObservations()
      await h.state.open(h.state.observations.value[0])
      assert.equal(h.state.canDecide('Approved'), false)
      assert.equal(h.state.canReviewSpecies.value, false)
      assert.ok(h.state.selectionError.value)
      assert.match(renderText(h), /Unable to refresh observation/)
      h.state.comment.value = 'Keep field evidence'
      await h.state.decide('Rejected')
      assert.equal(h.calls.filter(c => c.options.method === 'POST').length, 0)
      recover = true
      await h.state.retrySelection()
      assert.equal(h.state.selected.value.revision, 8)
      assert.equal(h.state.comment.value, 'Keep field evidence')
      assert.equal(h.state.canDecide('Approved'), true)
    } finally { h.stop() }
  }
})

test('late modal loads cannot overwrite another selection or restore data after close, logout, account change or unmount', async () => {
  for (const action of ['switch', 'close', 'logout', 'account', 'unmount']) {
    const pending = deferred()
    const rows = [fixture(), fixture({ id: secondId })]
    const h = harness(async url => url === '/api/observations' ? fixtureResponse(url, rows) : url.endsWith(firstId) ? pending.promise : fixtureResponse(url, rows))
    try {
      await h.state.loadObservations()
      const opening = h.state.open(h.state.observations.value[0])
      if (action === 'switch') await h.state.open(h.state.observations.value[1])
      if (action === 'close') h.state.closeReview()
      if (action === 'logout') h.emitSession(null)
      if (action === 'account') h.emitSession({ id: 'another-officer', role: 'Conservation Officer', status: 'Active', mustChangePassword: false })
      if (action === 'unmount') h.stop()
      pending.resolve(Response.json({ observation: fixture({ scientific_name: 'Late private result' }) }))
      await opening; await flush()
      assert.notEqual(h.state.selected.value?.scientificName, 'Late private result')
      if (action === 'switch') assert.equal(h.state.selected.value.id, secondId)
      if (['close', 'logout', 'account'].includes(action)) assert.equal(h.state.selected.value, null)
    } finally { if (action !== 'unmount') h.stop() }
  }
})

test('species labels and request absence/details states render accurately in all three languages', async () => {
  for (const language of ['en', 'ms', 'zh-CN']) {
    const locale = JSON.parse(readFileSync(new URL(`../src/locales/${language}.json`, import.meta.url), 'utf8'))
    const labels = locale.conservationPages.reviews
    for (const extra of [{ species_request: null, species_request_id: null }, { species_request_id: '42' }, { species_request: requestFixture({ request_id: '42', request_status: 'Approved', approved_species_id: 8 }) }]) {
      const row = fixture(extra)
      const h = harness(async url => fixtureResponse(url, [row]), {}, language)
      try {
        await h.state.loadObservations(); await h.state.open(h.state.observations.value[0])
        const text = renderText(h)
        for (const key of ['selectedSpecies', 'speciesScientificName', 'speciesCommonName', 'speciesRequestIdLabel']) {
          assert.equal(typeof labels[key], 'string'); assert.ok(text.includes(labels[key]), key)
          assert.doesNotMatch(labels[key], /\{id\}/)
        }
        assert.doesNotMatch(text, /Species Category|\{id\}/)
        assert.ok(text.includes('Actual species')); assert.ok(text.includes('Actual name'))
        if (extra.species_request_id === null) {
          assert.ok(text.includes(labels.noLinkedSpeciesRequest))
          assert.equal(h.state.selectedSpeciesRequest.value, null)
        } else if (!extra.species_request) {
          assert.ok(text.includes(labels.requestDetailsUnavailable))
          assert.ok(!text.includes(labels.noLinkedSpeciesRequest))
          assert.equal(h.state.canReviewPlant.value, false)
        } else {
          assert.ok(text.includes('42')); assert.ok(text.includes('Approved'))
          assert.ok(nodes(h.render()).some(n => n.props?.class === 'species-request-card'))
        }
      } finally { h.stop() }
    }
  }
})

test('modal source layout supports 320, 375, 390, 768 and desktop widths without changing shared actions', () => {
  // CSS contract verification only: no browser geometry or visual rendering claim.
  const css = readFileSync(new URL('../src/styles/conservation.css', import.meta.url), 'utf8')
  const source = readFileSync(filename, 'utf8')
  const narrow = css.slice(css.indexOf('@media (max-width: 920px)'))
  const phone = css.slice(css.indexOf('@media (max-width: 620px)'))
  for (const width of [320, 375, 390, 768, 1280]) {
    if (width <= 920) assert.match(narrow, /\.two-column\s*\{\s*grid-template-columns: 1fr/)
    else assert.match(css, /\.two-column\s*\{[^}]*grid-template-columns: minmax\(0, 1.4fr\)/)
    if (width <= 620) assert.match(phone, /\.detail-list\s*\{\s*grid-template-columns: 1fr/)
  }
  assert.match(source, /\.detail-list dd\s*\{[^}]*overflow-wrap: anywhere/)
  assert.match(css, /\.officer-layout \.modal-card\s*\{[^}]*max-height:[^}]*overflow: auto/)
  assert.match(css, /\.action-group\s*\{\s*display: flex;/)
  assert.match(css, /\.table-scroll\s*\{[^}]*overflow-x: auto/)
  assert.match(source, /@close="closeReview"/)
})

test('logout also invalidates conflict recovery loads and prevents privileged deep-link reloads', async () => {
  const pending = deferred(); let detailCalls = 0
  const h = harness(async url => {
    if (url === '/api/observations') return fixtureResponse(url, [fixture()])
    detailCalls++
    return detailCalls === 1 ? Response.json({ observation: fixture() }) : pending.promise
  })
  try {
    await h.state.loadObservations(); await h.state.open(h.state.observations.value[0])
    h.state.needsReload.value = true
    const reload = h.state.reloadSelected()
    h.emitSession(null)
    pending.resolve(Response.json({ observation: fixture({ revision: 12 }) }))
    await reload; await flush()
    await h.state.resolveQuery()
    assert.equal(h.state.selected.value, null)
    assert.equal(detailCalls, 2)
  } finally { h.stop() }
})

test('submitted zone is preserved in the row and selected modal; missing values are not recorded', async () => {
  const rows = [fixture({ content: { ...fixture().content, zone: '  Field zone A  ', altitudeM: -5 } }), fixture({ id: secondId, plant_id: 2, content: { ...fixture().content, zone: 'Zone B', altitudeM: 125.5 } })]
  const h = harness(async url => fixtureResponse(url, rows))
  try {
    await h.state.loadObservations()
    assert.equal(h.state.observations.value[0].zone, '  Field zone A  ')
    assert.ok(nodes(h.render()).some(n => n.type === 'td' && n.children === '  Field zone A  '))
    await h.state.open(h.state.observations.value[0]); await flush()
    assert.ok(nodes(h.render()).some(n => n.type === 'dd' && n.children === '  Field zone A  '))
    assert.ok(renderText(h).includes('-5 m'))
    await h.state.open(h.state.observations.value[1]); await flush()
    assert.equal(h.state.selected.value.zone, 'Zone B')
    assert.ok(nodes(h.render()).some(n => n.type === 'dd' && n.children === 'Zone B'))
    assert.ok(renderText(h).includes('125.5 m'))
    for (const zone of [null, undefined, '', '   ', 42]) assert.equal(h.state.mapObservation(fixture({ content: { ...fixture().content, zone } })).zone, '')
  } finally { h.stop() }
})

test('altitude keeps finite zero, negative and decimal values and never fabricates a missing elevation', async () => {
  for (const altitude of [0, -5, 125.5, null, undefined, '', '125', Infinity, NaN]) {
    const row = fixture({ content: { ...fixture().content, altitudeM: altitude } })
    const h = harness(async url => fixtureResponse(url, [row]))
    try {
      const expected = typeof altitude === 'number' && Number.isFinite(altitude) ? String(altitude) : ''
      assert.equal(h.state.mapObservation(row).altitude, expected)
      await h.state.loadObservations(); await h.state.open(h.state.observations.value[0]); await flush()
      assert.ok(nodes(h.render()).some(n => n.type === 'dd' && n.children === (expected === '' ? 'Not recorded' : `${expected} m`)))
    } finally { h.stop() }
  }
})

test('QR uses only validated current plant fields after fresh observation and never overwrites submission evidence', async () => {
  const stale = fixture({ plant_id: 1 })
  const fresh = fixture({ plant_id: 13, content: { ...fixture().content, zone: 'Submitted zone', altitudeM: 0 } })
  const h = harness(async url => url === '/api/observations' ? fixtureResponse(url, [stale]) : Response.json({ observation: fresh }), {}, 'en', async (url, options) => {
    assert.equal(url, '/api/plants/13'); assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'same-origin')
    return Response.json({ plant: { plant_id: 13, qr_id: 99, qr_token: 'actual-current-token', qr_status: 'retired', rbac_status: 'Approved', latitude: 70, longitude: 80, zone: 'Approved zone', altitude_m: 999, latest_approved: { heightCm: 900 }, original_qr_token: 'old-token' } })
  })
  try {
    await h.state.loadObservations()
    assert.equal(h.calls.filter(c => c.url.startsWith('/api/plants/')).length, 0)
    await h.state.open(h.state.observations.value[0]); await flush()
    assert.equal(h.state.plantQr.value.identity, 'actual-current-token')
    assert.equal(h.state.plantQr.value.status, 'retired')
    assert.equal(h.state.selected.value.zone, 'Submitted zone'); assert.equal(h.state.selected.value.altitude, '0')
    assert.equal(h.state.selected.value.latitude, '0'); assert.equal(h.state.selected.value.longitude, '0'); assert.equal(h.state.selected.value.gpsAccuracy, '0')
    assert.equal(h.state.selected.value.height, '12 cm'); assert.equal(h.state.selected.value.assets.length, 3)
    assert.match(renderText(h), /Current Plant QR Information/)
    assert.ok(renderText(h).includes('actual-current-token')); assert.ok(renderText(h).includes('retired'))
    assert.ok(!renderText(h).includes('old-token')); assert.equal(h.state.canDecide('Approved'), true)
  } finally { h.stop() }
})

test('missing QR fields stay not recorded; failed or mismatched plant lookup never fabricates or blocks valid review', async () => {
  for (const mode of ['missing', 'wrong-id', 'missing-id', 'malformed', 'network', 401, 403, 404, 503]) {
    const h = harness(async url => fixtureResponse(url, [fixture()]), {}, 'en', async () => {
      if (mode === 'network') throw Error('offline')
      if (typeof mode === 'number') return Response.json({ error: 'Failure' }, { status: mode })
      if (mode === 'malformed') return Response.json({ plant: [] })
      return Response.json({ plant: { ...(mode === 'missing-id' ? {} : { plant_id: mode === 'wrong-id' ? 99 : 1 }), qr_token: mode === 'missing' ? null : 'must-not-display', qr_status: null } })
    })
    try {
      await h.state.loadObservations(); await h.state.open(h.state.observations.value[0]); await flush()
      assert.equal(h.state.canDecide('Approved'), true)
      assert.equal(h.state.selected.value.height, '12 cm')
      assert.equal(h.state.qrLoading.value, false)
      if (mode === 'missing') {
        assert.equal(h.state.plantQr.value.identity, ''); assert.equal(h.state.qrError.value, '')
        assert.match(renderText(h), /Not recorded/)
      } else {
        assert.equal(h.state.plantQr.value, null)
        assert.equal(h.state.qrError.value, 'Unable to load QR information')
        assert.ok(!renderText(h).includes('must-not-display'))
      }
    } finally { h.stop() }
  }
})

test('QR loading is independent of review and late responses cannot cross selection, modal or account boundaries', async () => {
  for (const action of ['switch', 'close', 'logout', 'account', 'pending-session', 'unmount']) {
    const pending = deferred()
    const rows = [fixture(), fixture({ id: secondId, plant_id: 2 })]
    const h = harness(async url => fixtureResponse(url, rows), {}, 'en', async url => url.endsWith('/1') ? pending.promise : Response.json({ plant: { plant_id: '2', qr_token: 'plant-two-token', qr_status: 'assigned' } }))
    try {
      await h.state.loadObservations(); await h.state.open(h.state.observations.value[0]); await flush()
      assert.equal(h.state.qrLoading.value, true); assert.equal(h.state.plantQr.value, null)
      assert.equal(h.state.canDecide('Approved'), true)
      assert.match(renderText(h), /Loading QR information/)
      if (action === 'switch') { await h.state.open(h.state.observations.value[1]); await flush() }
      if (action === 'close') h.state.closeReview()
      if (action === 'logout') h.emitSession(null)
      if (action === 'account') h.emitSession({ id: 'new-officer', role: 'Conservation Officer', status: 'Active', mustChangePassword: false })
      if (action === 'pending-session') h.emitSession(null, true)
      if (action === 'unmount') h.stop()
      pending.resolve(Response.json({ plant: { plant_id: 1, qr_token: 'late-private-token', qr_status: 'active' } }))
      await flush()
      assert.notEqual(h.state.plantQr.value?.identity, 'late-private-token')
      if (action === 'switch') assert.equal(h.state.plantQr.value.identity, 'plant-two-token')
      else assert.equal(h.state.plantQr.value, null)
    } finally { if (action !== 'unmount') h.stop() }
  }
})

test('zone altitude and QR loading/error labels use natural localized values without changing action layout', async () => {
  for (const language of ['en', 'ms', 'zh-CN']) {
    const labels = JSON.parse(readFileSync(new URL(`../src/locales/${language}.json`, import.meta.url), 'utf8')).conservationPages.reviews
    let failQr = true
    const h = harness(async url => fixtureResponse(url, [fixture()]), {}, language, async () => {
      if (failQr) throw Error('offline')
      return Response.json({ plant: { plant_id: 1, qr_token: 'localized-token', qr_status: 'assigned' } })
    })
    try {
      await h.state.loadObservations(); await h.state.open(h.state.observations.value[0]); await flush()
      assert.ok(renderText(h).includes(labels.currentPlantQr))
      assert.ok(renderText(h).includes(labels.qrLoadFailed))
      assert.ok(renderText(h).includes(labels.notRecorded))
      failQr = false
      await h.state.retrySelection(); await flush()
      assert.ok(renderText(h).includes(labels.qrIdentity))
      assert.ok(renderText(h).includes(labels.qrStatus))
      assert.ok(renderText(h).includes('localized-token'))
      for (const key of ['currentPlantQr', 'qrIdentity', 'qrStatus', 'notRecorded', 'qrLoading', 'qrLoadFailed']) assert.equal(typeof labels[key], 'string')
    } finally { h.stop() }
  }
  const css = readFileSync(new URL('../src/styles/conservation.css', import.meta.url), 'utf8')
  assert.match(css, /\.action-group\s*\{\s*display: flex;/)
  assert.match(css, /\.table-scroll\s*\{[^}]*overflow-x: auto/)
})

test('registration and legacy queues request authoritative origins, preserve all statuses and continue empty filtered pages', async () => {
  const initial = fixture(), proposed = fixture({ id: secondId, species_request: requestFixture() })
  const legacy = fixture({ id: '123', origin_type: 'unknown', status: 'Flagged' })
  let failMore = false
  const h = harness(async url => fixtureResponse(url, [initial, proposed, legacy]), {}, 'en', undefined, async url => {
    const query = new URL(url, 'https://fixture.invalid').searchParams
    assert.equal(query.get('limit'), '100')
    if (query.get('origin_type') === 'unknown') return Response.json({ observations: [legacy], page: { has_more: false, next_cursor: null } })
    if (!query.has('cursor')) return Response.json({ observations: [], page: { has_more: true, next_cursor: 'scan-next' } })
    if (failMore) return Response.json({ error: 'Retry this page' }, { status: 503 })
    return Response.json({ observations: [initial, proposed], page: { has_more: false, next_cursor: null } })
  })
  try {
    await h.state.loadObservations()
    assert.equal(h.state.filtered.value.length, 0); assert.equal(h.state.hasMore.value, true)
    failMore = true; await h.state.loadObservations(true)
    assert.ok(h.state.loadError.value); assert.equal(h.state.nextCursor.value, 'scan-next')
    failMore = false; await h.state.loadObservations(true)
    assert.equal(h.state.filtered.value.length, 2); assert.equal(h.state.hasMore.value, false)
    assert.equal(h.state.filtered.value[0].speciesRequest, null)
    assert.ok(h.state.filtered.value[1].speciesRequest)
    h.state.observations.value.push(h.state.mapObservation(fixture({ id: '321', origin_type: 'subsequent_observation' })))
    assert.equal(h.state.filtered.value.length, 2)
    h.state.queueOrigin.value = 'unknown'; await h.state.loadObservations()
    assert.equal(h.state.filtered.value.length, 1)
    await h.state.open(h.state.filtered.value[0]); await flush()
    assert.equal(h.state.selected.value.origin, 'unknown'); assert.equal(h.state.canDecide('Approved'), true)
    assert.match(renderText(h), /Origin not verified/)
    assert.match(renderText(h), /Loaded records only/)
  } finally { h.stop() }
})

test('fresh origin change before a registration decision prevents POST and refreshes its queue', async () => {
  let row = fixture()
  const h = harness(async url => fixtureResponse(url, [row]))
  try {
    await h.state.loadObservations(); await h.state.open(h.state.observations.value[0]); await flush()
    row = fixture({ origin_type: 'subsequent_observation' })
    await h.state.decide('Approved'); await flush()
    assert.equal(h.calls.filter(c => c.options.method === 'POST').length, 0)
    assert.equal(h.state.canDecide('Approved'), false)
    assert.match(renderText(h), /latest origin belongs to another/)
    assert.equal(h.state.filtered.value.length, 0)
  } finally { h.stop() }
})

test('legacy deep links select the explicit fallback; all queue labels render in three languages', async () => {
  for (const language of ['en', 'ms', 'zh-CN']) {
    const row = fixture({ origin_type: 'unknown' })
    const h = harness(async url => fixtureResponse(url, [row]), { review: firstId }, language)
    try {
      await h.state.loadObservations(); await flush()
      assert.equal(h.state.queueOrigin.value, 'unknown'); assert.equal(h.state.selected.value.origin, 'unknown')
      const labels = JSON.parse(readFileSync(new URL(`../src/locales/${language}.json`, import.meta.url), 'utf8')).conservationPages.reviews.queues
      for (const key of ['registrations', 'legacy', 'originUnverified', 'loadedScope', 'loadMore', 'originMoved']) assert.equal(typeof labels[key], 'string')
      assert.ok(renderText(h).includes(labels.originUnverified))
    } finally { h.stop() }
  }
})
