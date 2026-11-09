import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { parse, compileScript, compileTemplate, compileStyle } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as vue from 'vue'
import * as observationReview from '../src/services/observationReview.ts'
import * as observationQueue from '../src/services/observationQueue.ts'
import { formatObservationId } from '../src/utils/observationId.ts'
import { formatPlantId } from '../src/utils/plantId.ts'
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
function harness(fetchHandler, query = {}, language = 'en', plantHandler = async url => Response.json({ plant: { plant_id: url.split('/').pop(), qr_token: null, qr_status: null } }), queueHandler = null, options = {}) {
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
    AbortController,
    window: { setTimeout, clearTimeout },
    console,
    navigator: { clipboard: options.clipboard },
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
          useConservationText: () => ({ ct: (value, params = {}) => Object.entries(params).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), String(value)), locale: vue.ref('en') }),
        }
      if (name.endsWith('/auth')) return { sessionSnapshot: () => session, subscribeSession: fn => { sessionListener = fn; return () => { sessionListener = null } } }
      if (name.endsWith('observationId')) return { formatObservationId }
      if (name.endsWith('observationReview')) return observationReview
      if (name.endsWith('observationQueue')) return observationQueue
      if (name.endsWith('reviewSpeciesRequest')) return speciesRequestIntegration
      if (name.endsWith('plantId')) return { formatPlantId }
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
    assert.equal(h.state.similarityFor(h.state.observations.value[1].id), undefined)
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

test('similarity loads real UUID results through the plant proxy, preserves missing distance and clears on refresh', async () => {
  const h = harness(async (url, options) => {
    if (url.endsWith('/similarity')) {
      assert.equal(url, `/api/data/observations/${firstId}/similarity`)
      assert.equal(options.credentials, 'same-origin')
      return Response.json({ observationId: firstId, plantId: 'PL001', status: 'available',
        highestSimilarity: 0.92, candidates: [
          { rank: 1, plantId: 'PL008', observationId: secondId, similarity: 0.92, distanceMeters: 0 },
          { rank: 2, plantId: 'PL009', observationId: '2', similarity: 0.8 },
        ] })
    }
    return Response.json({ observations: [fixture()] })
  })
  try {
    await h.state.loadObservations()
    const observation = h.state.observations.value[0]
    await h.state.checkSimilarity(observation, { currentTarget: null })
    const analysis = h.state.similarityFor(firstId)
    assert.equal(analysis.candidates[0].plantId, 'PL008')
    assert.equal(analysis.candidates[0].observationId, secondId)
    assert.equal(analysis.candidates[0].distanceMeters, 0)
    assert.equal(analysis.candidates[1].distanceMeters, undefined)
    assert.equal(analysis.candidates[1].observationId, 'OBS002')
    assert.equal(h.state.similarityAnalysis.value, analysis)
    await h.state.checkSimilarity(observation, { currentTarget: null })
    assert.equal(h.calls.filter((call) => call.url.endsWith('/similarity')).length, 1)
    await h.state.loadObservations()
    assert.equal(h.state.similarityFor(firstId), undefined)
    assert.equal(h.state.similarityAnalysis.value, null)
  } finally { h.stop() }
})

test('similarity session changes clear cached evidence and invalidate pending responses', async () => {
  for (const action of ['logout', 'account', 'pending']) {
    const rows = [fixture(), fixture({ id: secondId, plant_id: 2 })]
    const analysis = (id) => ({ observationId: id, plantId: id === firstId ? 'PL001' : 'PL002',
      status: 'available', highestSimilarity: 0.9,
      candidates: [{ rank: 1, plantId: 'PL008', observationId: '8', similarity: 0.9 }] })
    let release
    const h = harness(async url => {
      if (url === `/api/data/observations/${firstId}/similarity`) return Response.json(analysis(firstId))
      if (url === `/api/data/observations/${secondId}/similarity`)
        return new Promise(resolve => { release = () => resolve(Response.json(analysis(secondId))) })
      return fixtureResponse(url, rows)
    })
    try {
      await h.state.loadObservations()
      const [first, second] = h.state.observations.value
      await h.state.checkSimilarity(first, { currentTarget: null })
      assert.ok(h.state.similarityFor(firstId))
      const pending = h.state.checkSimilarity(second, { currentTarget: null })
      await flush()
      if (action === 'account') h.emitSession({ id: 'another-officer', role: 'Conservation Officer', status: 'Active', mustChangePassword: false })
      else h.emitSession(null, action === 'pending')
      // Let a late server response finish even if the HTTP mock ignores abort.
      release()
      await pending
      assert.equal(h.calls.find(call => call.url.endsWith(`${secondId}/similarity`)).options.signal.aborted, true)
      assert.equal(h.state.similarityFor(firstId), undefined)
      assert.equal(h.state.similarityFor(secondId), undefined)
      assert.equal(h.state.similarityAnalysis.value, null)
      assert.equal(h.state.similarityLoading.value, '')
      if (action !== 'account') {
        const before = h.calls.length
        await h.state.checkSimilarity(first, { currentTarget: null })
        assert.equal(h.calls.length, before)
      }
    } finally { h.stop() }
  }
})

test('loading another queue page preserves BioCLIP results while a full refresh clears them', async () => {
  const rows = [fixture(), fixture({ id: secondId, plant_id: 2 })]
  const h = harness(async url => url.endsWith('/similarity')
    ? Response.json({ observationId: firstId, plantId: 'PL001', status: 'available', highestSimilarity: 0.9,
      candidates: [{ rank: 1, plantId: 'PL008', observationId: '8', similarity: 0.9 }] })
    : fixtureResponse(url, rows), {}, 'en', undefined, async url => {
      const more = new URL(url, 'https://fixture.invalid').searchParams.has('cursor')
      return Response.json({ observations: [rows[more ? 1 : 0]],
        page: { has_more: !more, next_cursor: more ? null : 'next-page' } })
    })
  try {
    await h.state.loadObservations()
    await h.state.checkSimilarity(h.state.observations.value[0], { currentTarget: null })
    const cached = h.state.similarityFor(firstId)
    await h.state.loadObservations(true)
    assert.equal(h.state.observations.value.length, 2)
    assert.equal(h.state.similarityFor(firstId), cached)
    await h.state.loadObservations()
    assert.equal(h.state.similarityFor(firstId), undefined)
    assert.equal(h.state.similarityAnalysis.value, null)
  } finally { h.stop() }
})

test('similarity failures and mismatched observations never display demo results; stale requests are ignored', async () => {
  let mode = 'offline', release
  const h = harness(async (url) => {
    if (!url.endsWith('/similarity')) return Response.json({ observations: [fixture()] })
    if (mode === 'offline') return Response.json({ error: 'BioCLIP unavailable' }, { status: 503 })
    if (mode === 'invalid') return Response.json({ observationId: secondId })
    return new Promise((resolve) => { release = () => resolve(Response.json({
      observationId: firstId, plantId: 'PL001', status: 'available', highestSimilarity: 0.9,
      candidates: [{ rank: 1, plantId: 'PL008', observationId: secondId, similarity: 0.9 }],
    })) })
  })
  try {
    await h.state.loadObservations()
    const observation = h.state.observations.value[0]
    await h.state.checkSimilarity(observation, { currentTarget: null })
    assert.match(h.state.similarityErrors.value[firstId], /BioCLIP unavailable/)
    assert.equal(h.state.similarityFor(firstId), undefined)
    mode = 'invalid'
    await h.state.checkSimilarity(observation, { currentTarget: null })
    assert.match(h.state.similarityErrors.value[firstId], /invalid result/)
    assert.equal(h.state.similarityAnalysis.value, null)
    mode = 'delayed'
    const pending = h.state.checkSimilarity(observation, { currentTarget: null })
    await flush()
    assert.equal(h.state.similarityLoading.value, firstId)
    await h.state.loadObservations()
    release()
    await pending
    assert.equal(h.state.similarityFor(firstId), undefined)
    assert.equal(h.state.similarityAnalysis.value, null)
    assert.equal(h.state.similarityLoading.value, '')
  } finally { h.stop() }
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
    assert.ok(renderText(h).includes(h.state.qrLabel('actual-current-token'))); assert.ok(renderText(h).includes('retired'))
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
      assert.ok(renderText(h).includes(h.state.qrLabel('localized-token')))
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
    assert.doesNotMatch(renderText(h), /Showing loaded submissions only/)
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

const reviewTable = h => nodes(h.render()).find(node => node.type === 'table' && node.props?.class === 'reviews-table')
const reviewCopyButtons = h => nodes(reviewTable(h)).filter(node => node.type === 'button' && node.props?.class === 'identifier-copy')

test('review queue retains nine headers, compact observation/subject labels and raw review identifiers', async () => {
  const row = fixture({ owner_subject: 'staff:2ace382f-1111-4111-8111-111111111111' })
  const h = harness(url => fixtureResponse(url, [row]))
  try {
    await h.state.loadObservations()
    const headers = nodes(reviewTable(h)).filter(node => node.type === 'th')
    assert.deepEqual(headers.map(node => node.children), ['Plant ID', 'Observation ID', 'Species', 'Submitted By', 'Location Zone', messages.conservationPages.reviews.recordCreated, 'Status', 'Similarity', 'Actions'])
    assert.ok(headers.every(node => node.props.scope === 'col'))
    assert.equal(h.state.observationLabel(row.id), 'OBS-AA3BD8BE')
    assert.equal(h.state.submitterLabel(row.owner_subject), 'Staff \u00b7 2ACE382F')
    assert.equal(reviewCopyButtons(h).length, 2)
    const review = nodes(reviewTable(h)).find(node => node.type === 'button' && node.children.trim?.() === 'Review')
    await review.props.onClick(); await flush()
    assert.equal(h.state.selected.value.id, row.id)
    assert.equal(h.state.selected.value.recordedBy, row.owner_subject)
    assert.equal(h.route.query.review, row.id)
    assert.ok(h.calls.some(call => call.url === `/api/observations/${row.id}`))
    assert.ok(h.calls.every(call => !call.options?.method || call.options.method === 'GET'))
  } finally { h.stop() }
})

test('loaded identifier collisions extend independently of search and original filters remain authoritative', async () => {
  const rows = [
    fixture({ id: 'aa3bd8be-1111-4111-8111-111111111111', owner_subject: 'staff:2ace382f-1111-4111-8111-111111111111' }),
    fixture({ id: 'aa3bd8be-2222-4222-8222-222222222222', owner_subject: 'staff:2ace382f-2222-4222-8222-222222222222' }),
  ]
  const h = harness(url => fixtureResponse(url, rows))
  try {
    await h.state.loadObservations()
    assert.equal(h.state.observationLabel(rows[0].id), 'OBS-AA3BD8BE1111')
    assert.equal(h.state.observationLabel(rows[1].id), 'OBS-AA3BD8BE2222')
    assert.notEqual(h.state.submitterLabel(rows[0].owner_subject), h.state.submitterLabel(rows[1].owner_subject))
    for (const query of [rows[0].id, h.state.observationLabel(rows[0].id), rows[0].owner_subject, h.state.submitterLabel(rows[0].owner_subject)]) {
      h.state.search.value = query
      assert.equal(h.state.filtered.value.length, 1)
      assert.equal(h.state.filtered.value[0].id, rows[0].id)
      assert.equal(h.state.observationLabel(rows[0].id), 'OBS-AA3BD8BE1111')
    }
    h.state.search.value = ''; h.state.species.value = '999'
    assert.equal(h.state.filtered.value.length, 0)
    assert.ok(h.calls.every(call => !call.url.includes('OBS-')))
  } finally { h.stop() }
})

test('review copy controls copy full original identities and announce localized feedback without HTTP writes', async () => {
  for (const language of ['en', 'ms', 'zh-CN']) {
    const row = fixture(), copied = []
    const h = harness(url => fixtureResponse(url, [row]), {}, language, undefined, null, { clipboard: { writeText: async value => copied.push(value) } })
    try {
      await h.state.loadObservations()
      for (const [index, value] of [row.id, row.owner_subject].entries()) {
        const button = reviewCopyButtons(h)[index]
        assert.ok(button.props['aria-label'] && !button.props['aria-label'].startsWith('conservationPages.'))
        await button.props.onClick()
        assert.equal(copied[index], value)
        assert.ok(h.state.copyFeedback.value && !h.state.copyFailed.value)
      }
      const live = nodes(h.render()).find(node => String(node.props?.class).includes('copy-feedback'))
      assert.equal(live.props['aria-live'], 'polite')
      assert.equal(live.props.role, 'status')
      assert.equal(h.calls.length, 1)
    } finally { h.stop() }
  }
})

test('submitter names use only exact authorized session identity; copy remains role guarded', async () => {
  const row = fixture({ owner_subject: 'staff:verified-officer' }), copied = []
  const h = harness(url => fixtureResponse(url, [row]), {}, 'en', undefined, null, { clipboard: { writeText: async value => copied.push(value) } })
  try {
    await h.state.loadObservations()
    h.emitSession({ id: 'verified-officer', name: 'Verified Officer', role: 'Conservation Officer', status: 'Active', mustChangePassword: false })
    assert.equal(h.state.submitterLabel(row.owner_subject), 'Verified Officer')
    assert.notEqual(h.state.submitterLabel('staff:someone-else'), 'Verified Officer')
    for (const role of ['Admin', 'Botanist']) {
      h.emitSession({ id: 'verified-officer', name: 'Unauthorized', role, status: 'Active', mustChangePassword: false })
      await h.state.copyIdentifier(row.id, 'observation')
      assert.equal(copied.length, 0)
      assert.notEqual(h.state.submitterLabel(row.owner_subject), 'Unauthorized')
      assert.equal(h.state.observations.value.length, 0)
    }
    assert.ok(h.calls.every(call => !call.url.includes('staff') && !call.url.includes('account')))
  } finally { h.stop() }
})

test('failed clipboard keeps full IDs in details and stale copy completion cannot restore feedback after logout', async () => {
  const row = fixture(), pending = deferred()
  const h = harness(url => fixtureResponse(url, [row]), {}, 'en', undefined, null, { clipboard: { writeText: () => pending.promise } })
  try {
    await h.state.loadObservations()
    const copy = h.state.copyIdentifier(row.id, 'observation')
    await h.state.copyIdentifier(row.owner_subject, 'subject')
    h.emitSession(null)
    pending.resolve(); await copy
    assert.equal(h.state.copyFeedback.value, '')
    assert.equal(h.state.copiedKey.value, '')
  } finally { h.stop() }
  const unavailable = harness(url => fixtureResponse(url, [row]))
  try {
    await unavailable.state.loadObservations()
    await unavailable.state.copyIdentifier(row.id, 'observation')
    assert.equal(unavailable.state.copyFailed.value, true)
    await unavailable.state.open(unavailable.state.observations.value[0]); await flush()
    const modal = nodes(unavailable.render()).find(node => node.type?.name?.endsWith('AppModal.vue'))
    assert.ok(modal)
    assert.equal(unavailable.state.selected.value.id, row.id)
    assert.equal(modal.props.title, 'Review OBS-AA3BD8BE')
    assert.ok(nodes(modal).some(node => node.type === 'dd' && node.children === row.id))
    assert.ok(nodes(modal).some(node => node.type === 'dd' && node.children === row.owner_subject))
  } finally { unavailable.stop() }
})

test('review table matches Observation alignment/header and pending color with scoped scrolling and nowrap controls', async () => {
  const css = descriptor.styles[0].content
  const shared = readFileSync(new URL('../src/styles/conservation.css', import.meta.url), 'utf8')
  const observationSource = readFileSync(new URL('../src/views/conservation/ObservationsView.vue', import.meta.url), 'utf8')
  assert.match(css, /\.reviews-table th, \.reviews-table td\s*\{ padding: 12px 14px; text-align: left; vertical-align: middle/)
  assert.match(css, /\.reviews-table \.species-column\s*\{ width: 13rem/)
  const header = /\.reviews-table th\s*\{([^}]+)\}/.exec(css)[1]
  assert.equal(header.replace('font-size: 12px', 'font-size: 10px'), /\.observations-table th\s*\{([^}]+)\}/.exec(observationSource)[1])
  const sharedHeader = /th\s*\{([^}]+)\}/.exec(shared)[1]
  assert.match(sharedHeader, /text-transform: uppercase/)
  assert.match(sharedHeader, /letter-spacing: 0.6px/)
  assert.match(css, /\.reviews-table\s*\{[^}]*min-width: 96rem; table-layout: auto;[^}]*border-collapse: separate; border-spacing: 0/)
  assert.match(css, /\.reviews-scroll\s*\{ min-width: 0; max-width: 100%; overflow-x: auto/)
  assert.match(css, /\.reviews-table \.badge\s*\{[^}]*display: inline-flex; align-items: center;[^}]*white-space: nowrap/)
  assert.match(css, /\.reviews-scroll \.reviews-table \.action-group\s*\{[^}]*flex-wrap: nowrap; align-items: center;[^}]*gap: 7px; width: max-content; min-width: max-content/)
  assert.match(css, /\.identifier-line\s*\{[^}]*align-items: center;[^}]*gap: 7px;[^}]*vertical-align: middle/)
  assert.match(css, /\.identifier-copy:focus-visible\s*\{ outline: 3px solid/)
  assert.match(css, /@media \(max-width: 767px\)[^\n]*min-height: 44px/)
  const pending = /\.reviews-table \.badge.pending-review\s*\{([^}]+)\}/.exec(css)[1]
  const base = /\.badge\s*\{([^}]+)\}/.exec(shared)[1]
  for (const property of ['background', 'color']) assert.equal(new RegExp(`${property}: (#[a-f0-9]+)`).exec(pending)[1], new RegExp(`${property}: (#[a-f0-9]+)`).exec(base)[1])
  const compiled = compileStyle({ source: css, id: 'data-v-review-integration', scoped: true })
  assert.equal(compiled.errors.length, 0)
  assert.match(compiled.code, /\.reviews-scroll \.reviews-table \.identifier-copy\[data-v-review-integration\]/)
  const h = harness(url => fixtureResponse(url, [fixture()]))
  try {
    await h.state.loadObservations()
    const scroll = nodes(h.render()).find(node => String(node.props?.class).includes('reviews-scroll'))
    assert.equal(scroll.props.role, 'region'); assert.equal(scroll.props.tabindex, '0')
    assert.equal(nodes(scroll).filter(node => String(node.props?.class).includes('table-scroll')).length, 1)
    const badge = nodes(reviewTable(h)).find(node => node.type === 'span' && String(node.props?.class).includes('badge'))
    assert.ok(badge.props.class.includes('pending-review'))
    assert.equal(badge.children, 'Pending Review')
  } finally { h.stop() }
})

const reviewSummaryCards = h => nodes(h.render()).filter(node => node.type === 'article' && String(node.props?.class).includes('review-summary-card'))

test('review summary omits loaded-submission notices from cards and table in every locale', async () => {
  for (const language of ['en', 'ms', 'zh-CN']) {
    const h = harness(url => fixtureResponse(url, [fixture()]), {}, language)
    try {
      await h.state.loadObservations()
      const labels = JSON.parse(readFileSync(new URL(`../src/locales/${language}.json`, import.meta.url), 'utf8')).conservationPages.reviews.queues
      assert.equal(typeof labels.summaryScope, 'string')
      const scope = nodes(h.render()).filter(node => node.props?.id === 'review-summary-scope')
      assert.equal(scope.length, 0)
      assert.ok(!renderText(h).includes(labels.summaryScope))
      assert.ok(!renderText(h).includes(labels.loadedScope))
      const summary = nodes(h.render()).find(node => String(node.props?.class).includes('review-summary-grid'))
      assert.equal(summary.props['aria-describedby'], undefined)
      assert.equal(reviewSummaryCards(h).length, 5)
      assert.ok(reviewSummaryCards(h).every(card => !nodes(card).some(node => node.type === 'small')))
      assert.equal(nodes(reviewTable(h)).filter(node => node.type === 'th').length, 9)
      assert.equal(reviewCopyButtons(h).length, 2)
      assert.ok(h.calls.every(call => !call.options?.method || call.options.method === 'GET'))
    } finally { h.stop() }
  }
})

test('summary titles and counts retain loaded data, loading, unavailable and empty behavior', async () => {
  const rows = [
    ...Array.from({ length: 12 }, (_, index) => fixture({ id: index + 1 })),
    fixture({ id: 13, status: 'Correction Required' }), fixture({ id: 14, status: 'Flagged' }),
    fixture({ id: 15, status: 'Approved', reviewed_at: new Date().toISOString() }),
    fixture({ id: 16, status: 'Approved', reviewed_at: '2000-01-01T12:00:00Z' }),
    fixture({ id: 17, status: 'Rejected' }), fixture({ id: 18, status: ' rejected ' }),
  ]
  const h = harness(url => fixtureResponse(url, rows))
  const values = () => reviewSummaryCards(h).map(card => nodes(card).find(node => node.type === 'strong').children)
  try {
    assert.ok(values().every(value => value === messages.conservationPages.reviews.loading))
    await h.state.loadObservations()
    assert.deepEqual(values(), ['12', '1', '1', '2', '1'])
    assert.deepEqual(reviewSummaryCards(h).map(card => nodes(card).find(node => node.type === 'p').children), ['Pending Review', 'Correction Required', 'Flagged', 'Rejected', 'Approved Today'])
    h.state.search.value = 'no matching result'
    assert.equal(h.state.filtered.value.length, 0)
    assert.deepEqual(values(), ['12', '1', '1', '2', '1'], 'counters keep their existing loaded-record semantics')
    h.state.loadError.value = 'Offline failure'
    assert.ok(values().every(value => value === messages.conservationPages.reviews.unavailable))
    h.state.loadError.value = ''; h.state.observations.value = []
    assert.deepEqual(values(), ['0', '0', '0', '0', '0'])
  } finally { h.stop() }
})

test('summary palette has readable contrast and five/three/two/one-column layout; request badges resist grid stretching', () => {
  const css = descriptor.styles[0].content
  assert.match(css, /\.review-summary-card\s*\{[^}]*border: 1px solid currentColor;[^}]*color: var\(--review-summary-ink\)/)
  const palette = {
    'pending-review': ['#e8f0f5', '#315d78'],
    'correction-required': ['#fff1db', '#926119'],
    flagged: ['#f0eaf8', '#69459a'],
    rejected: ['#fbe8e5', '#a33f35'],
    'approved-today': ['#e7f3e9', '#287347'],
  }
  const luminance = hex => {
    const channels = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722
  }
  for (const [key, [background, foreground]] of Object.entries(palette)) {
    const rule = new RegExp(`\\.review-summary-${key}\\s*\\{([^}]+)\\}`).exec(css)[1]
    assert.ok(rule.includes(`--review-summary-background: ${background}`))
    assert.ok(rule.includes(`--review-summary-ink: ${foreground}`))
    assert.ok((luminance(background) + .05) / (luminance(foreground) + .05) >= 4.5, `${key} text contrast`)
  }
  assert.match(css, /\.review-summary-grid\s*\{ grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/)
  assert.match(css, /@media \(max-width: 1280px\)\s*\{ \.review-summary-grid\s*\{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/)
  assert.match(css, /@media \(max-width: 900px\)\s*\{ \.review-summary-grid\s*\{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/)
  assert.match(css, /@media \(max-width: 480px\)\s*\{ \.review-summary-grid\s*\{ grid-template-columns: minmax\(0, 1fr\)/)
  assert.match(css, /\.review-summary-card strong\s*\{[^}]*font-variant-numeric: tabular-nums; overflow-wrap: anywhere/)
  const badge = /\.reviews-table \.species-request-badge\s*\{([^}]+)\}/.exec(css)[1]
  for (const declaration of ['display: inline-flex', 'align-self: flex-start', 'justify-self: start', 'width: fit-content', 'max-width: 100%', 'white-space: normal']) assert.ok(badge.includes(declaration))
  assert.match(css, /\.species-request-badge\s*\{[^}]*padding: 5px 8px;[^}]*background: #e7f1e7/)
  assert.equal(compileStyle({ source: css, id: 'data-v-review-summary', scoped: true }).errors.length, 0)
})

test('registration introduction is localized and concise while legacy queue remains available', async () => {
  for (const language of ['en', 'ms', 'zh-CN']) {
    const labels = JSON.parse(readFileSync(new URL(`../src/locales/${language}.json`, import.meta.url), 'utf8')).conservationPages.reviews.queues
    const h = harness(url => fixtureResponse(url, []), {}, language)
    try {
      await h.state.loadObservations()
      const intro = nodes(h.render()).find(node => node.type === 'section' && String(node.props?.class).split(' ').includes('page-intro'))
      const text = nodes(intro).filter(node => typeof node.children === 'string').map(node => node.children)
      assert.deepEqual(text, [labels.registrationEyebrow, labels.registrations, labels.registrationIntro])
      assert.ok(!labels.registrationIntro.includes(labels.legacy))
      assert.ok(nodes(h.render()).some(node => node.type === 'option' && node.props?.value === 'unknown'))
      assert.equal(nodes(h.render()).filter(node => node.props?.id === 'review-summary-scope').length, 0)
      assert.equal(reviewSummaryCards(h).length, 5)
      assert.ok(nodes(reviewSummaryCards(h)[3]).some(node => node.type === 'svg' && node.props?.['aria-hidden'] === 'true'))
    } finally { h.stop() }
  }
  const labels = messages.conservationPages.reviews.queues
  assert.equal(labels.registrationEyebrow, 'Verification Workflow')
  assert.equal(labels.registrations, 'New Plant Registrations')
  assert.equal(labels.registrationIntro, 'Review and approve or reject new plant registrations and associated species requests.')
  assert.ok(!labels.registrationIntro.includes('Unclassified records remain available'))
  assert.equal(labels.summaryScope, 'Showing loaded submissions only')
})

test('Rejected counts deduplicated observation statuses, not rejected linked requests or cumulative queue visits', async () => {
  const rejected = fixture({ status: 'rejected' })
  const pending = fixture({ id: secondId, species_request: requestFixture({ request_status: 'Rejected' }) })
  const extra = fixture({ id: '123', status: 'Rejected' })
  const legacy = { ...rejected, origin_type: 'unknown' }
  const h = harness(url => fixtureResponse(url, [rejected, pending, extra]), {}, 'en', undefined, async url => {
    const query = new URL(url, 'https://fixture.invalid').searchParams
    if (query.get('origin_type') === 'unknown') return Response.json({ observations: [legacy, legacy], page: { has_more: false, next_cursor: null } })
    if (query.has('cursor')) return Response.json({ observations: [rejected, extra], page: { has_more: false, next_cursor: null } })
    return Response.json({ observations: [rejected, rejected, pending], page: { has_more: true, next_cursor: 'more-rejected' } })
  })
  const count = () => h.state.counts.value.find(([title]) => title === 'Rejected')[1]
  try {
    await h.state.loadObservations()
    assert.equal(count(), 1)
    assert.equal(h.state.observations.value.length, 2)
    assert.equal(h.state.observations.value.find(row => row.id === secondId).speciesRequest.state, 'rejected')
    await h.state.loadObservations(true)
    assert.equal(count(), 2)
    assert.equal(h.state.observations.value.length, 3)
    h.state.queueOrigin.value = 'unknown'; await h.state.loadObservations()
    assert.equal(count(), 1, 'queue switch replaces the loaded scope rather than adding the same ID twice')
    assert.equal(h.state.observations.value.length, 1)
    h.state.queueOrigin.value = 'initial_registration'; await h.state.loadObservations()
    assert.equal(count(), 1)
    assert.ok(h.calls.every(call => !call.options?.method || call.options.method === 'GET'))
  } finally { h.stop() }
})

const reviewFilterFields = h => {
  const toolbar = nodes(h.render()).find(node => node.type === 'div' && String(node.props?.class).includes('reviews-filters'))
  return nodes(toolbar).filter(node => node.type === 'label')
}

test('review filters use five matching label/control wrappers with no stray text and retain the native calendar', async () => {
  const h = harness(url => fixtureResponse(url, [fixture()]))
  try {
    await h.state.loadObservations()
    const fields = reviewFilterFields(h)
    assert.equal(fields.length, 5)
    assert.deepEqual(fields.map(field => nodes(field).find(node => node.type === 'span').children), ['Review Queue', 'Search', 'Review status', 'Species', messages.conservationPages.reviews.recordCreated])
    for (const field of fields) {
      assert.equal(nodes(field).filter(node => node.type === 'span').length, 1)
      assert.equal(nodes(field).filter(node => ['input', 'select'].includes(node.type)).length, 1)
      const directText = field.children.filter(child => typeof child === 'string' || child?.type === vue.Text).map(child => typeof child === 'string' ? child : child.children).join('')
      assert.equal(directText.trim(), '', 'no anonymous text grid row')
    }
    const date = nodes(fields[4]).find(node => node.type === 'input')
    assert.equal(date.props.type, 'date')
    assert.equal(typeof date.props['onUpdate:modelValue'], 'function')
    date.props['onUpdate:modelValue']('2026-10-01')
    assert.equal(h.state.date.value, '2026-10-01')
    assert.ok(h.calls.every(call => !call.options?.method || call.options.method === 'GET'))
  } finally { h.stop() }
  const css = descriptor.styles[0].content
  assert.match(css, /\.reviews-filters\s*\{ align-items: stretch/)
  assert.match(css, /\.reviews-filters > \.field\s*\{ grid-template-rows: 1fr 44px/)
  assert.match(css, /\.reviews-filters > \.field > span\s*\{ align-self: end; font-size: 12px; line-height: 1.4/)
  assert.match(css, /\.reviews-filters > \.field > input, \.reviews-filters > \.field > select\s*\{ box-sizing: border-box; height: 44px; padding: 9px 10px/)
  assert.doesNotMatch(css, /calendar-picker-indicator|appearance:\s*none/)
  const shared = readFileSync(new URL('../src/styles/conservation.css', import.meta.url), 'utf8')
  assert.match(shared, /\.control-bar\s*\{[^}]*display: flex;[^}]*flex-wrap: wrap/)
  assert.match(shared, /\.search-field\s*\{[^}]*min-width: 240px;[^}]*flex: 2/)
  assert.match(shared, /@media \(max-width: 620px\)[\s\S]*\.control-bar\s*\{[^}]*flex-direction: column/)
})

test('date, search, status, species and queue filters retain independent and combined behavior', async () => {
  const rows = [fixture(), fixture({ id: secondId, status: 'Approved', species_id: 9, scientific_name: 'Other species', created_at: '2026-10-02T12:00:00Z' }), fixture({ id: '123', created_at: '2026-10-02T12:00:00Z' })]
  const h = harness(url => fixtureResponse(url, rows))
  const update = (index, value) => nodes(reviewFilterFields(h)[index]).find(node => ['input', 'select'].includes(node.type)).props['onUpdate:modelValue'](value)
  try {
    await h.state.loadObservations()
    const ids = () => Array.from(h.state.filtered.value, row => row.id)
    assert.deepEqual(ids(), [firstId, secondId, '123'])
    update(4, h.state.dateKey(rows[0].created_at)); assert.deepEqual(ids(), [firstId])
    update(4, ''); update(3, '9'); assert.deepEqual(ids(), [secondId])
    update(3, ''); update(2, 'Pending Review'); assert.deepEqual(ids(), [firstId, '123'])
    update(2, ''); update(1, 'Other species'); assert.deepEqual(ids(), [secondId])
    update(1, firstId); update(2, 'Pending Review'); update(3, '8'); update(4, h.state.dateKey(rows[0].created_at))
    assert.deepEqual(ids(), [firstId])
    update(4, h.state.dateKey(rows[1].created_at)); assert.deepEqual(ids(), [])
    update(4, ''); update(1, ''); update(2, ''); update(3, ''); update(0, 'unknown')
    assert.deepEqual(ids(), [])
    update(0, 'initial_registration'); assert.equal(ids().length, 3)
    assert.ok(h.calls.every(call => !call.options?.method || call.options.method === 'GET'))
  } finally { h.stop() }
})

test('review typography uses a readable hierarchy without squeezing identifiers, badges, filters or actions', () => {
  const css = descriptor.styles[0].content
  for (const [selector, size] of [
    ['.reviews-intro h2', 28], ['.reviews-intro p', 14], ['.reviews-intro .page-kicker', 12],
    ['.review-summary-title p', 14], ['.review-summary-card strong', 30],
    ['.reviews-filters > .field > span', 12], ['.reviews-table th', 12], ['.reviews-table td', 14],
    ['.reviews-table .badge', 12], ['.reviews-table .action-group > .action-button', 13],
    ['.reviews-table .species-request-badge', 12], ['.similarity-unavailable', 12],
  ]) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const rule = new RegExp(`^${escaped}\\s*\\{([^}]+)\\}`, 'm').exec(css)?.[1]
    assert.ok(rule?.includes(`font-size: ${size}px`), selector)
  }
  assert.match(css, /\.reviews-filters > \.field > input, \.reviews-filters > \.field > select\s*\{[^}]*height: 44px;[^}]*font-size: 14px; line-height: 1.4/)
  assert.match(css, /\.identifier-line > strong, \.identifier-line > span\s*\{[^}]*font-size: 14px; line-height: 1.5/)
  assert.match(css, /\.reviews-table \.observation-column\s*\{ width: 12rem/)
  assert.match(css, /\.reviews-table \.created-column\s*\{ width: 12rem/)
  assert.match(css, /\.reviews-table \.badge\s*\{[^}]*white-space: nowrap/)
  assert.match(css, /\.reviews-table \.action-group > \.action-button\s*\{[^}]*white-space: nowrap/)
  assert.match(css, /\.review-summary-title p\s*\{[^}]*line-height: 1.5/)
  assert.doesNotMatch(css, /text-overflow:\s*ellipsis/)
  assert.equal(compileStyle({ source: css, id: 'data-v-review-type', scoped: true }).errors.length, 0)
})

const reviewModal = h => nodes(h.render()).find(node => node.type?.name?.endsWith('AppModal.vue'))
const qrCopyButton = h => nodes(reviewModal(h)).find(node => node.type === 'button' && node.props?.onClick === h.state.copyQrIdentity)

test('modal thumbnails retain protected raw-asset URLs and error handling without visible asset/MIME captions', async () => {
  const row = fixture({ species_request: requestFixture({ assets: [{ id: 'request-photo-uuid', content_type: 'image/jpeg' }] }) })
  const h = harness(url => fixtureResponse(url, [row]))
  try {
    await h.state.loadObservations(); await h.state.open(h.state.observations.value[0]); await flush()
    const modal = reviewModal(h)
    assert.ok(!nodes(modal).some(node => node.props?.class === 'submitted-image-caption'))
    const text = nodes(modal).map(node => typeof node.children === 'string' ? node.children : '').join(' ')
    for (const hidden of ['image-one', 'image-two', 'request-photo-uuid', 'image/jpeg', 'image/png', 'application/pdf']) assert.ok(!text.includes(hidden), hidden)
    const images = nodes(modal).filter(node => node.type === 'img')
    assert.ok(images.some(node => node.props.src === '/api/data/assets/request-photo-uuid'))
    assert.ok(images.some(node => node.props.src === '/api/data/assets/image-one'))
    assert.ok(images.every(node => node.props.loading === 'lazy'))
    images.find(node => node.props.src.endsWith('/image-one')).props.onError()
    assert.ok(!nodes(reviewModal(h)).some(node => node.type === 'img' && node.props.src.endsWith('/image-one')))
    assert.equal(h.state.selected.value.assets.length, 3)
    assert.ok(renderText(h).includes(messages.conservationPages.reviews.imageUnavailable))
    assert.ok(h.calls.every(call => !call.options?.method || call.options.method === 'GET'))
  } finally { h.stop() }
})

test('modal titles and subtitles reuse compact identities, include off-page collisions and preserve numeric IDs exactly', async () => {
  const a = fixture({ id: 'aa3bd8be-1111-4111-8111-111111111111', owner_subject: 'staff:2ace382f-1111-4111-8111-111111111111' })
  const b = fixture({ id: 'aa3bd8be-2222-4222-8222-222222222222', owner_subject: 'staff:2ace382f-2222-4222-8222-222222222222' })
  const h = harness(url => fixtureResponse(url, [a, b]))
  try {
    await h.state.loadObservations(); await h.state.open(h.state.observations.value[0]); await flush()
    assert.equal(reviewModal(h).props.title, 'Review OBS-AA3BD8BE1111')
    assert.ok(reviewModal(h).props.subtitle.includes('Staff \u00b7 2ACE382F1111'))
    assert.ok(!reviewModal(h).props.subtitle.includes(a.owner_subject))
    assert.equal(h.route.query.review, a.id)
    assert.equal(h.state.selected.value.id, a.id)
    h.state.observations.value = [h.state.mapObservation(a)]
    h.state.selected.value = h.state.mapObservation(b)
    assert.equal(reviewModal(h).props.title, 'Review OBS-AA3BD8BE2222', 'deep-linked detail participates in loaded collision handling')
    assert.equal(h.state.observationLabel('1234567890123456789'), 'OBS-1234567890123456789')
    assert.equal(h.state.observationLabel('7'), 'OBS-7')
    h.emitSession({ id: 'verified-officer', role: 'Conservation Officer', name: 'Verified Officer', status: 'Active', mustChangePassword: false })
    h.state.selected.value = h.state.mapObservation(fixture({ owner_subject: 'staff:verified-officer' }))
    assert.ok(reviewModal(h).props.subtitle.includes('Verified Officer'))
  } finally { h.stop() }
})

test('QR display handles UUID, opaque hex and arbitrary tokens, extends known prefix collisions and copies the exact full token', async () => {
  for (const token of ['4451e4cb-5623-4570-995f-1a9b02fd704f', 'a'.repeat(48), 'QR-CODE:arbitrary-token/with-punctuation', 'QR-0001']) {
    const copied = []
    const h = harness(url => fixtureResponse(url, [fixture()]), {}, 'en', async () => Response.json({ plant: { plant_id: 1, qr_token: token, qr_status: 'assigned' } }), null, { clipboard: { writeText: async value => copied.push(value) } })
    try {
      await h.state.loadObservations(); await h.state.open(h.state.observations.value[0]); await flush()
      assert.equal(h.state.plantQr.value.identity, token)
      const button = qrCopyButton(h)
      assert.equal(button.props['aria-label'], 'Copy full QR Code ID')
      await button.props.onClick()
      assert.deepEqual(copied, [token])
      assert.equal(h.state.qrCopyFeedback.value, 'Full QR Code ID copied.')
      assert.equal(h.state.qrCopied.value, true)
      assert.equal(h.state.plantQr.value.status, 'assigned')
      if (token === 'QR-0001') assert.equal(h.state.qrLabel(token), token)
      else assert.ok(h.state.qrLabel(token).length < token.length)
      h.state.knownQrIdentities.value = new Set(['same-prefix-111111', 'same-prefix-222222'])
      assert.notEqual(h.state.qrLabel('same-prefix-111111'), h.state.qrLabel('same-prefix-222222'))
      assert.ok(h.calls.every(call => !call.options?.method || call.options.method === 'GET'))
    } finally { h.stop() }
  }
})

test('QR copy is localized, exposes the full token on clipboard failure and discards late results after modal/session changes', async () => {
  for (const language of ['en', 'ms', 'zh-CN']) {
    const token = 'long-qr-token-with-a-real-identity'
    const labels = JSON.parse(readFileSync(new URL(`../src/locales/${language}.json`, import.meta.url), 'utf8')).conservationPages.reviews
    const h = harness(url => fixtureResponse(url, [fixture()]), {}, language, async () => Response.json({ plant: { plant_id: 1, qr_token: token, qr_status: 'active' } }))
    try {
      await h.state.loadObservations(); await h.state.open(h.state.observations.value[0]); await flush()
      await qrCopyButton(h).props.onClick()
      assert.equal(h.state.qrCopyFailed.value, true)
      assert.equal(h.state.qrCopyFeedback.value, labels.qrCopyUnavailable)
      assert.ok(nodes(reviewModal(h)).some(node => node.props?.class?.includes('qr-copy-fallback') && node.children === token))
      assert.ok(renderText(h).includes(labels.qrIdentity))
      assert.ok(!renderText(h).includes(labels.loadedHistory))
      assert.ok(!renderText(h).includes(labels.historyLimit))
      const live = nodes(reviewModal(h)).find(node => node.props?.class === 'qr-copy-feedback')
      assert.equal(live.props.role, 'status'); assert.equal(live.props['aria-live'], 'polite')
    } finally { h.stop() }
  }
  for (const action of ['close', 'logout', 'role', 'switch']) {
    const wait = deferred(), copied = []
    const h = harness(url => fixtureResponse(url, [fixture()]), {}, 'en', async () => Response.json({ plant: { plant_id: 1, qr_token: 'private-full-qr-token', qr_status: 'active' } }), null, { clipboard: { writeText: value => { copied.push(value); return wait.promise } } })
    try {
      await h.state.loadObservations(); await h.state.open(h.state.observations.value[0]); await flush()
      const copy = h.state.copyQrIdentity()
      await h.state.copyQrIdentity()
      assert.equal(copied.length, 1)
      if (action === 'close') h.state.closeReview()
      if (action === 'logout') h.emitSession(null)
      if (action === 'role') h.emitSession({ id: 'verified-officer', role: 'Admin', status: 'Active', mustChangePassword: false })
      if (action === 'switch') h.state.clearPlantQr()
      wait.resolve(); await copy
      assert.equal(h.state.qrCopyFeedback.value, '')
      assert.equal(h.state.qrCopied.value, false)
      await h.state.copyQrIdentity(); assert.equal(copied.length, 1)
    } finally { h.stop() }
  }
})

test('legacy review history retains loaded array order, compact IDs and accurate dates/health/height without fabricating missing data', async () => {
  const rows = [fixture({ origin_type: 'unknown', id: firstId, created_at: '2026-09-01T10:00:00Z' }), fixture({ id: secondId, created_at: '2026-11-01T10:00:00Z', content: { heightCm: 0, healthStatus: 'Needs Attention' } }), fixture({ id: '123', content: {} }), fixture({ id: '124', plant_id: 2 })]
  const h = harness(url => fixtureResponse(url, rows))
  try {
    h.state.queueOrigin.value = 'unknown'
    await h.state.loadObservations(); await h.state.open(h.state.observations.value[0]); await flush()
    const items = nodes(reviewModal(h)).filter(node => node.props?.class === 'history-item')
    assert.deepEqual(items.map(item => item.key), [firstId, secondId, '123'])
    assert.deepEqual(items.map(item => nodes(item).find(node => node.type === 'strong').children), ['OBS-AA3BD8BE', 'OBS-BB3BD8BE', 'OBS-123'])
    assert.equal(nodes(items[0]).find(node => node.props?.class === 'history-date').children, h.state.formatDate(rows[0].created_at))
    const text = item => nodes(item).map(node => typeof node.children === 'string' ? node.children : '').join(' ')
    assert.ok(text(items[0]).includes('Health Status: Healthy'))
    assert.ok(text(items[0]).includes('Height: 12 cm'))
    assert.ok(text(items[1]).includes('Height: 0 cm'))
    assert.ok(text(items[1]).includes('Needs Attention'))
    assert.ok(!text(items[2]).includes('Height:'))
    assert.ok(!text(items[2]).includes('Health Status:'))
    assert.ok(renderText(h).includes('Showing loaded observations only.'))
    assert.ok(!renderText(h).includes('Record creation order; limited'))
  } finally { h.stop() }
})

test('redundant decision heading is absent while localized accessible group, comment validation and all four handlers remain', async () => {
  const h = harness(url => fixtureResponse(url, [fixture()]))
  try {
    await h.state.loadObservations(); await h.state.open(h.state.observations.value[0]); await flush()
    const modal = reviewModal(h)
    assert.ok(!nodes(modal).some(node => node.type === 'h3' && node.children === 'Plant Review Decision'))
    const group = nodes(modal).find(node => node.props?.class === 'modal-actions plant-review-actions')
    assert.equal(group.props.role, 'group'); assert.equal(group.props['aria-label'], 'Plant Review Decision')
    assert.deepEqual(nodes(group).filter(node => node.type === 'button').map(node => node.children), ['Approve', 'Reject', 'Request Correction', 'Flag'])
    assert.equal(h.state.canDecide('Approved'), true)
    h.state.comment.value = ''
    await h.state.decide('Rejected')
    assert.ok(h.calls.every(call => !call.options?.method || call.options.method === 'GET'))
    assert.match(descriptor.styles[0].content, /\.plant-review-actions\s*\{ margin-top: 20px/)
    assert.match(descriptor.styles[0].content, /\.history-details\s*\{[^}]*flex-wrap: wrap/)
    assert.match(descriptor.styles[0].content, /\.qr-copy-feedback, \.qr-copy-fallback\s*\{[^}]*overflow-wrap: anywhere/)
  } finally { h.stop() }
})

test('Review Submissions headers, body cells and colgroup all put Plant ID first while full observation copying stays authoritative', async () => {
  const row = fixture({ plant_id: 18 }), copied = []
  const h = harness(url => fixtureResponse(url, [row]), {}, 'en', undefined, null, { clipboard: { writeText: async value => copied.push(value) } })
  try {
    await h.state.loadObservations()
    const table = reviewTable(h)
    assert.deepEqual(nodes(table).filter(node => node.type === 'col').map(node => node.props.class), ['plant-column', 'observation-column', 'species-column', 'submitter-column', 'zone-column', 'created-column', 'status-column', 'similarity-column', 'actions-column'])
    assert.deepEqual(nodes(table).filter(node => node.type === 'th').map(node => node.children), ['Plant ID', 'Observation ID', 'Species', 'Submitted By', 'Location Zone', messages.conservationPages.reviews.recordCreated, 'Status', 'Similarity', 'Actions'])
    const renderedRow = nodes(table).find(node => node.type === 'tr' && node.key === row.id)
    const cells = nodes(renderedRow).filter(node => node.type === 'td')
    assert.equal(cells.length, 9)
    assert.equal(cells[0].children, 'PL018')
    assert.equal(cells[0].props.class, 'plant-id-cell')
    assert.match(descriptor.styles[0].content, /\.reviews-table \.plant-id-cell\s*\{ color: #315749; font-weight: 700/)
    assert.match(descriptor.styles[0].content, /\.reviews-table \.identity-cell strong\s*\{ color: inherit; font-weight: 400/)
    assert.equal(nodes(cells[1]).find(node => node.type === 'strong').children, 'OBS-AA3BD8BE')
    const copy = nodes(cells[1]).find(node => node.type === 'button')
    await copy.props.onClick()
    assert.deepEqual(copied, [row.id])
    assert.equal(h.state.observations.value[0].id, row.id)
    assert.equal(h.state.observations.value[0].plantRawId, '18')
    assert.ok(h.calls.every(call => !call.options?.method || call.options.method === 'GET'))
  } finally { h.stop() }
})

test('initial registration modal omits the history section while retaining current submission evidence, comment and review actions', async () => {
  for (const language of ['en', 'ms', 'zh-CN']) {
    const row = fixture({ content: { ...fixture().content, zone: 'Submitted site', altitudeM: 0 } })
    const h = harness(url => fixtureResponse(url, [row, fixture({ id: secondId })]), {}, language)
    const labels = JSON.parse(readFileSync(new URL(`../src/locales/${language}.json`, import.meta.url), 'utf8')).conservationPages.reviews
    try {
      await h.state.loadObservations(); await h.state.open(h.state.observations.value[0]); await flush()
      const modal = reviewModal(h), all = nodes(modal)
      assert.equal(h.state.selected.value.origin, 'initial_registration')
      assert.ok(!all.some(node => node.props?.class === 'history-item' || node.props?.class === 'history-date' || node.props?.class === 'history-details'))
      assert.ok(!renderText(h).includes(labels.loadedHistory))
      assert.ok(!renderText(h).includes(labels.historyLimit))
      const details = all.filter(node => node.type === 'dd').map(node => typeof node.children === 'string' ? node.children : '')
      for (const value of ['12 cm', 'Healthy', 'Submitted morphology', 'Submitted notes', 'Submitted site', '0', '0 m']) assert.ok(details.includes(value), value)
      assert.ok(all.some(node => node.type === 'img' && node.props.src === '/api/data/assets/image-one'))
      assert.equal(h.state.selected.value.assets.length, 3)
      assert.equal(h.state.observations.value.length, 2, 'only history presentation is removed')
      const comment = all.find(node => node.type === 'label' && node.props?.class === 'form-field officer-comment')
      assert.ok(comment)
      nodes(comment).find(node => node.type === 'textarea').props['onUpdate:modelValue']('Retained review comment')
      assert.equal(h.state.comment.value, 'Retained review comment')
      const group = all.find(node => node.props?.class === 'modal-actions plant-review-actions')
      assert.equal(nodes(group).filter(node => node.type === 'button').length, 4)
      assert.equal(h.state.canDecide('Approved'), true)
      assert.ok(h.calls.every(call => !call.options?.method || call.options.method === 'GET'))
    } finally { h.stop() }
  }
})

const standaloneFixture=(changes={})=>({request_id:73,requested_by:'staff:bot',scientific_name:'Standalone original',suggested_common_name:'Original common',genus_name:'Shorea',family_name:'Dipterocarpaceae',conservation_status:'Least Concern',description:'Original description',habitat:'Original habitat',request_status:'Pending Review',submitted_at:'2026-11-09T01:00:00Z',review_comment:'',approved_species_id:null,...changes})
test('standalone species query opens the existing species panel without inventing a plant and reviews with existing rules',async()=>{
 for(const decision of ['Approved','Rejected','Correction Required']){
 let saved=false
 const h=harness(async(url,options)=>{
  if(url==='/api/observations')return Response.json({observations:[]})
  assert.ok(url.startsWith('/api/species-requests/73'))
  if(options.method==='POST'){assert.equal(url,'/api/species-requests/73/review');assert.deepEqual(JSON.parse(options.body),{decision,comment:'Review reason',...(decision==='Approved'?{visibility:'protected'}:{})});saved=true;return Response.json({reviewed:true})}
  return Response.json({species_request:standaloneFixture(saved?{request_status:decision,approved_species_id:decision==='Approved'?99:null}: {})})
 },{speciesRequest:'73'})
 try{
  await h.state.loadObservations();await flush()
  assert.equal(h.state.selected.value,null);assert.equal(h.state.standaloneRequest.value.scientificName,'Standalone original');assert.equal(h.state.canReviewSpecies.value,true)
  const rendered=nodes(h.render());assert.equal(rendered.filter(n=>String(n.props?.class||'').includes('plant-review-actions')).length,0)
  assert.equal(rendered.filter(n=>String(n.props?.class||'')==='species-request-card').length,1)
  await h.state.decideSpecies(decision);assert.equal(h.calls.filter(c=>c.options.method==='POST').length,0)
  h.state.speciesReviewComment.value='Review reason';h.state.speciesVisibility.value='protected';await h.state.decideSpecies(decision)
  assert.equal(h.calls.filter(c=>c.options.method==='POST').length,1);assert.equal(h.state.standaloneRequest.value.status,decision);assert.equal(h.state.canReviewSpecies.value,false)
  h.state.closeReview();await flush();assert.equal(h.state.standaloneRequest.value,null);assert.equal(h.route.query.speciesRequest,undefined)
 }finally{h.stop()}
 }
})
test('standalone query handles mounted navigation, self-review, completed, invalid and inaccessible requests',async()=>{
 const h=harness(async url=>url==='/api/observations'?Response.json({observations:[]}):url.endsWith('/74')?Response.json({error:'Unavailable'},{status:404}):Response.json({species_request:standaloneFixture({requested_by:'staff:verified-officer'})}))
 try{
  await h.state.loadObservations();h.route.query.speciesRequest='73';await flush();assert.equal(h.state.canReviewSpecies.value,false)
  const count=h.calls.length;h.route.query.unrelated='retained';await flush();assert.equal(h.calls.length,count)
  h.route.query.speciesRequest='74';await flush();assert.equal(h.state.standaloneRequest.value,null);assert.ok(h.state.selectionError.value)
  h.route.query.speciesRequest='not-an-id';await flush();assert.ok(h.state.selectionError.value)
  h.emitSession(null);await flush();assert.equal(h.state.standaloneRequest.value,null);assert.ok(h.calls.every(c=>c.options.method==='GET'))
 }finally{h.stop()}
})

test('standalone stale responses and uncertain writes preserve privacy, comments and reload safeguards',async()=>{
 let release,mode='pending'
 const h=harness(async(url,options)=>{
  if(url==='/api/observations')return Response.json({observations:[]})
  if(url.endsWith('/74'))return new Promise(resolve=>{release=resolve})
  if(options.method==='POST'){if(mode==='conflict')return Response.json({error:'Changed'},{status:409});throw Error('uncertain network')}
  return Response.json({species_request:standaloneFixture(mode==='conflict'?{request_status:'Approved',approved_species_id:99}:{})})
 },{speciesRequest:'73'})
 try{
  await h.state.loadObservations();await flush();h.state.speciesReviewComment.value='Keep this comment';h.state.speciesVisibility.value='public'
  await h.state.decideSpecies('Approved');assert.equal(h.state.speciesNeedsReload.value,true);assert.equal(h.state.speciesReviewComment.value,'Keep this comment');assert.equal(h.state.canReviewSpecies.value,false)
  await h.state.refreshSpeciesRequest();assert.equal(h.state.speciesNeedsReload.value,false)
  mode='conflict';await h.state.decideSpecies('Approved');assert.equal(h.state.standaloneRequest.value.state,'approved');assert.equal(h.state.speciesReviewComment.value,'Keep this comment')
  h.route.query.speciesRequest='74';await flush();h.emitSession(null);release(Response.json({species_request:standaloneFixture({request_id:74})}));await flush();assert.equal(h.state.standaloneRequest.value,null)
 }finally{h.stop()}
})

test('Resubmitted is informational, localized and strictly limited to verified Pending Review rows',async()=>{
 for(const language of ['en','ms','zh-CN'])for(const row of [
  {},{revision:9,review_decision:'Correction Required'},{is_correction_resubmission:false},{is_correction_resubmission:null},
  {is_correction_resubmission:'true'},{is_correction_resubmission:true},
  ...['Draft','Approved','Rejected','Correction Required','Flagged'].map(status=>({status,is_correction_resubmission:true})),
  {origin_type:'unknown',is_correction_resubmission:true}
 ]){
  const h=harness(async()=>Response.json({observations:[fixture(row)]}),{},language)
  try{
   await h.state.loadObservations();const tree=nodes(h.render())
   const tags=tree.filter(n=>n.type==='span'&&n.props?.class==='badge resubmission-tag')
   const expected=row.is_correction_resubmission===true&&(!row.status||row.status==='Pending Review')&&row.origin_type!=='unknown'
   assert.equal(tags.length,expected?1:0)
   if(expected){const messages=JSON.parse(readFileSync(new URL(`../src/locales/${language}.json`,import.meta.url),'utf8'));assert.equal(tags[0].children,messages.conservationPages.observations.resubmitted);assert.ok(tree.some(n=>n.type==='span'&&n.children==='Pending Review')||language!=='en')}
   assert.ok(h.calls.every(call=>!call.options?.method||call.options.method==='GET'))
   const styles=descriptor.styles.map(style=>style.content).join(' ')
   assert.match(styles,/display: inline-flex; align-items: center; gap: 7px; white-space: nowrap/)
   assert.match(styles,/background: #FFF1DB; color: #926119/)
  }finally{h.stop()}
 }
})
