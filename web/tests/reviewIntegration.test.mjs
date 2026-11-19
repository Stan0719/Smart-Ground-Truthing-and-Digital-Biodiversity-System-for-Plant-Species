import { createReviewQueueCache } from '../src/services/reviewQueueCache.ts'
import { loadObservationEditQueue, ObservationEditQueueLimitError } from '../src/services/observationEdits.ts'
import { useOfficerCopyConfirmation } from '../src/composables/useOfficerCopyConfirmation.ts'
import { workflowBadgeStyle } from '../src/utils/workflowBadge.ts'
import { similarityBadgeStyle } from '../src/utils/similarityBadge.ts'
import { assetUrlFromId } from '../src/services/assetImages.ts'
import { reviewDateTime, submitterIdentifierLabels } from '../src/utils/officerMonitoringDisplay.ts'
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { parse, compileScript, compileTemplate, compileStyle } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as vue from 'vue'
import * as observationReview from '../src/services/observationReview.ts'
import * as recordChanges from '../src/services/recordChanges.ts'
import * as observationQueue from '../src/services/observationQueue.ts'
import { formatObservationId } from '../src/utils/observationId.ts'
import { formatPlantId } from '../src/utils/plantId.ts'
import * as speciesRequestIntegration from '../src/services/reviewSpeciesRequest.ts'

// Execute the actual SFC setup/render code with an in-memory HTTP boundary.
test('UIUX-003 compact header preserves technical limitations in a localized top-layer help popover',async()=>{
 for(const language of ['en','ms','zh-CN']) {
  const dictionary=JSON.parse(readFileSync(new URL(`../src/locales/${language}.json`,import.meta.url),'utf8')).conservationPages.reviews.queues
  const h=harness(url=>fixtureResponse(url,[fixture()]),{},language)
  try {
   await h.state.loadObservations()
   const tree=nodes(h.render()),button=tree.find(n=>n.props?.class==='queue-help-button'),popover=tree.find(n=>n.props?.id==='registration-queue-help')
   assert.ok(tree.some(n=>n.type==='h2'&&n.children===dictionary.registrations))
   assert.ok(tree.some(n=>n.props?.class==='page-kicker'&&n.children===dictionary.registrationEyebrow))
   assert.ok(tree.some(n=>n.type==='p'&&n.children===dictionary.registrationIntro))
   if(language==='en') {assert.equal(dictionary.registrationIntro,'Review and manage plant registrations and species requests.');assert.match(dictionary.queueHelp,/not necessarily every database record/);assert.match(dictionary.queueHelp,/Species results may be incomplete/)}
   assert.equal(button.props['aria-label'],dictionary.aboutQueue);assert.equal(popover.props.popover,'auto');assert.equal(popover.props.role,'tooltip')
   for(const key of ['aboutQueue','includedHeading','includedText','countsHeading','countsText']) assert.ok(nodes(popover).some(n=>n.children===dictionary[key]))
   let shown=0,hidden=0;const style={}
   h.state.queueHelp.value={style,showPopover(){shown++},hidePopover(){hidden++},getBoundingClientRect(){return {width:300,height:100}}}
   const event={currentTarget:{getBoundingClientRect(){return {left:100,bottom:70}}}}
   button.props.onMouseenter(event);button.props.onFocus(event);button.props.onClick(event)
   assert.equal(shown,3);assert.ok(parseInt(style.left)>=12);assert.ok(parseInt(style.top)>=12)
   h.state.hideQueueHelp();assert.equal(hidden,1)
   assert.ok(!tree.some(n=>n.type==='p'&&n.children===messages.finalOfficerWorkflow.loadedQueue))
  }finally{h.stop()}
 }
 assert.doesNotMatch(descriptor.template.content,/t\('approvedChanges.queueScope'\)|t\('finalOfficerWorkflow.loadedQueue'\)/)
 assert.match(descriptor.template.content,/@keydown.esc.stop.prevent="hideQueueHelp\(\)"/)
 assert.match(descriptor.styles[0].content,/max-width:|width: min\(420px, calc\(100vw - 24px\)\)/)
 assert.match(descriptor.styles[0].content,/registration-title-row \{ display: flex; align-items: center; flex-wrap: wrap/)
})

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
  const routes = []
  let cacheListener
  const changeQueueHandler = options.recordChangesHandler
  const speciesQueueHandler = options.speciesQueueHandler
  const messages = JSON.parse(readFileSync(new URL(`../src/locales/${language}.json`, import.meta.url), 'utf8'))
  const scope = vue.effectScope()
  const cleanup = []
  let sessionListener
  let session = { user: { id: 'verified-officer', role: 'Conservation Officer', status: 'Active', mustChangePassword: false }, pending: false }
  const queueCache = options.queueCache || createReviewQueueCache(() => session, fn => { cacheListener = fn })
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
    window: { setTimeout, clearTimeout, innerWidth: 1024, innerHeight: 768, ...options.window },
    document: options.document || { activeElement: null },
    console,
    navigator: { clipboard: options.clipboard },
    HTMLElement: options.HTMLElement || class {},
    URLSearchParams,
    fetch: async (url, options) => {
      calls.push({ url, options })
      if (url === '/api/species-requests') return speciesQueueHandler ? speciesQueueHandler(url, options) : Response.json({ species_requests: [] })
      if (url.startsWith('/api/data/record-changes?')) return changeQueueHandler ? changeQueueHandler(url) : Response.json({ changes: [], page: { has_more: false, next_cursor: null } })
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
    if (name.endsWith('reviewQueueCache')) return { reviewQueueCache: queueCache }
    if (name.endsWith('.css')) return {}
    if (name.endsWith('observationEdits')) return { ObservationEditQueueLimitError, loadObservationEditQueue: (_read,current) => options.observationEditsHandler ? loadObservationEditQueue(options.observationEditsHandler,current) : Promise.resolve([]) }
    if (name.includes('useOfficerCopyConfirmation')) return { useOfficerCopyConfirmation }
    if (name.endsWith('workflowBadge')) return { workflowBadgeStyle }
    if (name.endsWith('similarityBadge')) return { similarityBadgeStyle }
    if (name.endsWith('assetImages')) return { assetUrlFromId }
    if (name.endsWith('officerMonitoringDisplay')) return { reviewDateTime, submitterIdentifierLabels }
      // DOM directives are not mounted by this VNode-only render harness.
      if (name === 'vue')
        return { ...vue, onMounted() {}, onBeforeUnmount(fn) { cleanup.push(fn) }, resolveComponent: name => name, withDirectives: (node) => node }
      if (name === 'vue-router')
        return {
          useRoute: () => route,
          useRouter: () => ({
            push: destination => { routes.push(destination); route.query = destination.query || {}; return Promise.resolve() },
            replace: destination => {
              routes.push(destination)
              route.query = destination.query
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
      if (name.endsWith('recordChanges')) return recordChanges
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
    emitSession(user, pending = false) { session = { user, pending }; cacheListener?.(); sessionListener?.(user, pending) },
    stop: () => { cleanup.forEach(fn => fn()); scope.stop() },
    routes,
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
    assert.equal(h.state.loadError.value, '', h.state.loadError.value)
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
    assert.ok(h.calls.filter(call => call.url.includes('species-requests')).every(call => call.url === '/api/species-requests' && (!call.options.method || call.options.method === 'GET')))
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

test('similarity table colors use raw score boundaries without changing display, requests or result navigation', async () => {
  let score = 0
  const h = harness(async url => url.endsWith('/similarity')
    ? Response.json({ observationId: firstId, plantId: 'PL001', status: 'available', highestSimilarity: score,
      candidates: [{ rank: 1, plantId: 'PL008', similarity: score }] })
    : Response.json({ observations: [fixture()] }))
  const button = () => nodes(h.render()).find(node => node.props?.class === 'similarity-badge-button')
  try {
    await h.state.loadObservations()
    assert.equal(button().props.style, undefined)
    assert.equal(nodes(button()).find(node => node.type === 'strong').children, 'Check similarity')
    assert.equal(nodes(button()).find(node => node.type === 'span').children, 'BioCLIP 2')
    const row = h.state.observations.value[0]
    assert.ok(nodes(h.render()).some(node => node.type === 'td' && node.children === '1 Oct 2026, 18:00'))
    for (const [value, background, text] of [
      ...[0, 0.55, 0.69, 0.699].map(value => [value, '#DCFCE7', '#166534']),
      ...[0.70, 0.78, 0.89, 0.899].map(value => [value, '#FEF9C3', '#854D0E']),
      ...[0.90, 0.92, 1].map(value => [value, '#FEE2E2', '#B91C1C']),
    ]) {
      score = value
      delete h.state.similarityResults.value[firstId]
      await button().props.onClick({ currentTarget: null })
      const calls = h.calls.length
      const result = button()
      assert.deepEqual({ ...result.props.style }, { '--similarity-background': background, '--similarity-text': text })
      assert.equal(nodes(result).find(node => node.type === 'strong').children, `${Math.round(value * 100)}%`)
      assert.equal(nodes(result).some(node => node.type === 'span' && node.children === 'BioCLIP 2'), false)
      assert.equal(result.props.disabled, false)
      h.state.closeSimilarity()
      await result.props.onClick({ currentTarget: null })
      assert.equal(h.state.similarityAnalysis.value, h.state.similarityFor(row.id))
      assert.ok(nodes(h.render()).some(node => node.type?.name?.endsWith('PlantSimilarityDrawer.vue')))
      h.render(); h.render()
      assert.equal(h.calls.length, calls)
    }
    for (const value of [undefined, null, NaN, Infinity, -Infinity, 1.01, -1.01, '0.92', {}]) assert.equal(h.state.similarityBadgeStyle(value), undefined)
    assert.deepEqual({ ...h.state.similarityBadgeStyle(-0.2) }, { '--similarity-background': '#DCFCE7', '--similarity-text': '#166534' })
    assert.match(descriptor.styles[0].content, /background: var\(--similarity-background, #e8f3ec\)/)
    assert.match(descriptor.styles[0].content, /\.similarity-badge-button:hover\s*\{\s*border-color: #73a68e;\s*background: var\(--similarity-background, #dceee3\)/)
  } finally { h.stop() }
})

test('comparison photo IDs are optional, safely retained and never replaced by gallery photos; raw numeric IDs remain copyable', async () => {
  const h = harness(() => Response.json({ observations: [fixture()] }))
  try {
    const observation = h.state.mapObservation(fixture({ id: '15' }))
    const base = { observationId: '15', plantId: 'PL001', status: 'available', highestSimilarity: .8,
      candidates: [{ rank: 1, plantId: 'PL008', observationId: '8', similarity: .8 }] }
    for (const value of [undefined, null, '', '../private', 'https://example.invalid/photo', {}, 1]) {
      const result = h.state.parseSimilarity({ ...base, sourceAssetId: value, candidates: [{ ...base.candidates[0], assetId: value }] }, observation)
      assert.equal(result.sourceAssetId, undefined)
      assert.equal(result.candidates[0].assetId, undefined)
      assert.equal(result.rawObservationId, '15')
      assert.equal(result.candidates[0].rawObservationId, '8')
      assert.equal(result.observationId, 'OBS015')
    }
    const result = h.state.parseSimilarity({ ...base, sourceAssetId: 'source-selected', candidates: [{ ...base.candidates[0], assetId: 'reference-selected' }] }, observation)
    assert.equal(result.sourceAssetId, 'source-selected')
    assert.equal(result.candidates[0].assetId, 'reference-selected')
    assert.equal(h.calls.length, 0)
    let focused = 0
    h.state.similarityAnalysis.value = result
    h.state.similarityTrigger.value = { focus() { focused++ } }
    h.state.closeSimilarity(); await flush()
    assert.equal(h.state.similarityAnalysis.value, null)
    assert.equal(focused, 1)
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
    if (url.startsWith('/api/conservation/submitter-names?')) return Response.json({ names: {} })
    if (options.method === 'POST') return Response.json({ error: 'Changed' }, { status: 409 })
    if (url === '/api/observations') return Response.json({ observations: [fixture()] })
    if (initialDetail && url === `/api/observations/${firstId}`) { initialDetail--; return Response.json({ observation: fixture() }) }
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
    if (url.startsWith('/api/conservation/submitter-names?')) return Response.json({ names: {} })
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
  review_cycle: 1, content_revision: 1,
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

test('species panel preserves metadata and decision guards, moves the same refresh handler and opens exact authorized thumbnails', async () => {
  class Element {}
  const row = fixture({ species_request: requestFixture({ requested_by: 'staff:2ace382f-1737-463a-aff1-8e4b88308d04', assets: [
    { id: 'species-first', content_type: 'image/jpeg' }, { id: 'species-second', content_type: 'image/png' }, { id: 'species-document', content_type: 'application/pdf' },
  ] }) })
  const h = harness(url => fixtureResponse(url, [row]), {}, 'en', undefined, null, { HTMLElement: Element })
  try {
    await h.state.open(h.state.mapObservation(row)); await flush()
    const panel = () => nodes(reviewModal(h)).find(n => n.props?.class === 'species-request-card')
    const all = nodes(panel()), header = all.find(n => n.props?.class === 'species-request-header')
    const refresh = nodes(header).find(n => n.props?.class === 'species-refresh-button')
    assert.equal(refresh.props.onClick, h.state.refreshSpeciesRequest)
    assert.equal(refresh.props.disabled, false)
    assert.equal(all.filter(n => n.props?.onClick === h.state.refreshSpeciesRequest).length, 1)
    assert.equal(refresh.props['aria-label'], 'Refresh submission and species resolution')
    const help = all.find(n => n.props?.id === 'species-refresh-help')
    assert.equal(help.children, 'Refresh submission and species resolution')
    assert.equal(help.props.popover, 'auto')
    let opened = 0
    const popup = { style: {}, showPopover() { opened++ }, getBoundingClientRect: () => ({ width: 240, height: 40 }) }
    h.state.speciesRefreshHelp.value = popup
    for (const event of ['onMouseenter', 'onFocus', 'onPointerdown']) refresh.props[event]({ currentTarget: { getBoundingClientRect: () => ({ right: 1000, top: 100, bottom: 136 }) } })
    assert.equal(opened, 3)
    const fields = all.filter(n => n.type === 'dt').map(n => n.children)
    for (const name of ['Species Request ID', 'Scientific Name', 'Common Name', 'Genus', 'Family', 'Conservation Status', 'Description', 'Habitat / Ecological Information', 'Submitted By', 'Submitted At']) assert.ok(fields.includes(name), name)
    const identifier = all.find(n => n.type?.name?.endsWith('MonitoringIdentifier.vue'))
    assert.equal(identifier.props.value, row.species_request.requested_by)
    assert.equal(identifier.props.labels.get(identifier.props.value), 'staff:2ace382f\u2026')
    const images = all.filter(n => n.type === 'img')
    assert.deepEqual(images.map(n => n.props.src), ['/api/data/assets/species-first', '/api/data/assets/species-second'])
    assert.equal(h.state.speciesRequestImages.value.length, 2)
    let preview
    h.state.speciesPhotoPreview.value = { open: (...args) => { preview = args } }
    const trigger = new Element()
    all.find(n => n.props?.class === 'species-thumbnail-button').props.onClick({ currentTarget: trigger })
    assert.deepEqual(Array.from(preview[0], item => item.url), images.map(n => n.props.src))
    assert.equal(preview[1], 0); assert.equal(preview[3], trigger)
    images[0].props.onError()
    assert.equal(nodes(panel()).filter(n => n.type === 'img').length, 1)
    assert.ok(nodes(panel()).some(n => n.props?.class === 'species-photo-placeholder'))
    const actions = all.find(n => n.props?.class === 'species-request-actions')
    assert.equal(nodes(actions).filter(n => n.type === 'button').length, 3)
    assert.equal(h.state.canReviewPlant.value, false)
    assert.equal(h.state.speciesReviewComment.value, 'Species-specific comment')
    h.state.speciesRefreshing.value = true
    assert.equal(nodes(panel()).find(n => n.props?.class === 'species-refresh-button').props.disabled, true)
    assert.equal(h.calls.filter(call => call.options.method === 'POST').length, 0)
  } finally { h.stop() }
})

test('review visibility cards start unselected and update the original explicit-choice model', async () => {
  const row = fixture({ species_request: requestFixture() }), h = harness(url => fixtureResponse(url, [row]))
  try {
    await h.state.open(h.state.mapObservation(row)); await flush()
    const selector = nodes(reviewModal(h)).find(n => n.type?.name?.endsWith('VisibilitySelector.vue'))
    assert.ok(selector)
    assert.equal(selector.props.modelValue, '')
    await h.state.decideSpecies('Approved')
    assert.equal(h.state.speciesVisibilityError.value, 'Please select a visibility option before approving this species.')
    assert.equal(h.calls.filter(call => call.options.method === 'POST').length, 0)
    for (const value of ['public', 'internal', 'protected']) {
      selector.props['onUpdate:modelValue'](value)
      assert.equal(h.state.speciesVisibility.value, value)
    }
    assert.equal(h.state.speciesReviewComment.value, 'Species-specific comment')
  } finally { h.stop() }
})

test('species comment feedback is attempt-driven, field-associated and clears visually after correction', async () => {
  for (const decision of ['Rejected', 'Correction Required']) {
    const row = fixture({ species_request: requestFixture({ review_comment: '' }) }), h = harness(url => fixtureResponse(url, [row]))
    try {
      await h.state.open(h.state.mapObservation(row)); await flush()
      const field = () => nodes(reviewModal(h)).find(n => n.type === 'textarea' && n.props.maxlength === '4000')
      const error = () => nodes(reviewModal(h)).filter(n => n.props?.id === 'species-request-comment-error')
      assert.equal(error().length, 0)
      assert.equal(field().props['aria-invalid'], undefined)
      assert.ok(!nodes(reviewModal(h)).some(n => n.props?.id === 'species-request-comment-help'))
      await h.state.decideSpecies(decision)
      assert.equal(error().length, 1)
      assert.equal(error()[0].props.role, 'alert')
      assert.ok(nodes(error()[0]).some(n => n.type === 'span' && n.children === 'Enter a review comment for rejection or correction.'))
      const icon = nodes(error()[0]).find(n => n.type === 'svg')
      assert.equal(icon.props.width, '18'); assert.equal(icon.props['aria-hidden'], 'true')
      assert.equal(field().props['aria-invalid'], 'true')
      assert.equal(field().props['aria-describedby'], 'species-request-comment-error')
      assert.equal(h.calls.filter(call => call.options.method === 'POST').length, 0)
      field().props['onUpdate:modelValue']('Valid review reason')
      assert.equal(error().length, 0)
      assert.equal(field().props['aria-invalid'], undefined)
      assert.equal(h.state.speciesVisibility.value, '')
      h.state.speciesReviewComment.value = 'x'.repeat(4001)
      await h.state.decideSpecies(decision)
      assert.equal(h.state.speciesCommentError.value, 'The species review comment must be 4,000 characters or fewer.')
      assert.equal(error().length, 1)
      h.state.speciesReviewComment.value = 'Valid length'
      assert.equal(error().length, 0)
      h.state.speciesReviewComment.value = ''
      h.state.speciesSaveError.value = 'Enter a review comment for rejection or correction.'
      h.state.reviewMessage.value = { variant: 'error', message: h.state.speciesSaveError.value }
      assert.equal(error().length, 0, 'an existing backend alert is not duplicated')
      h.state.reviewMessage.value = null
      h.state.speciesSaveError.value = 'Unrelated backend failure'
      assert.equal(error().length, 0)
      assert.ok(nodes(reviewModal(h)).some(n => n.type === 'p' && n.children === 'Unrelated backend failure'))
    } finally { h.stop() }
  }
})

test('species approval still allows an empty comment after explicit visibility selection', async () => {
  let row = fixture({ species_request: requestFixture({ request_id: '1', review_comment: '' }) })
  const h = harness((url, options) => {
    if (options.method === 'POST') {
      const body = JSON.parse(options.body)
      assert.equal(body.decision, 'Approved'); assert.equal(body.comment, ''); assert.equal(body.visibility, 'internal')
      row = fixture({ species_request: requestFixture({ request_id: '1', request_status: 'Approved', approved_species_id: 8, review_comment: '' }) })
      return Response.json({ reviewed: true })
    }
    return fixtureResponse(url, [row])
  })
  try {
    await h.state.open(h.state.mapObservation(row)); await flush()
    h.state.speciesVisibility.value = 'internal'
    await h.state.decideSpecies('Approved')
    assert.equal(h.calls.filter(call => call.options.method === 'POST').length, 1)
    assert.equal(h.state.speciesCommentError.value, '')
    assert.equal(h.state.speciesSaveError.value, '')
  } finally { h.stop() }
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
          !nodes(h.render()).some(
            (node) => node.type === 'h4' && node.children === 'Approved Species',
          ),
        )
        assert.equal(h.state.speciesResolved.value, true)
        const all = nodes(h.render())
        assert.ok(all.some(n => n.props?.class === 'form-field species-review-comment'))
        assert.ok(all.some(n => String(n.props?.class || '').includes('species-request-badge') && n.children === messages.conservationPages.reviews.speciesRequest.states.verified))
        const lower = all.find(n => n.props?.class === 'review-observation-evidence')
        assert.ok(nodes(lower).some(n => n.type === 'dd' && n.children === h.state.selected.value.speciesId))
        assert.ok(nodes(lower).some(n => n.type === 'dd' && n.children === h.state.selected.value.scientificName))
        h.state.selected.value.scientificName = ''
        assert.equal(h.state.canDecide('Approved'), true, 'display-only changes do not invalidate the response association')
        h.state.selected.value.speciesAssociation.scientificName = ''
        assert.equal(h.state.canDecide('Approved'), false, 'missing authoritative scientific name still blocks review')
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
    if (url.startsWith('/api/conservation/submitter-names?')) return Response.json({ names: {} })
    if (url === '/api/observations')
      return Response.json({ observations: [linked, fixture({ id: secondId })] })
    if (url.endsWith(secondId)) return Response.json({ observation: fixture({ id: secondId }) })
    if (initialDetail && url === `/api/observations/${firstId}`) { initialDetail = false; return Response.json({ observation: linked }) }
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
    assert.ok(h.calls.filter(call => call.url.includes('species-requests')).every(call => call.url === '/api/species-requests' && (!call.options.method || call.options.method === 'GET')))
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
    if (url.startsWith('/api/conservation/submitter-names?')) return Response.json({ names: {} })
    if (url === '/api/observations')
      return Response.json({ observations: [pending, fixture({ id: secondId })] })
    if (options.method === 'POST') {
      assert.equal(url, '/api/species-requests/1/review')
      assert.equal(options.credentials, 'same-origin')
      assert.deepEqual(JSON.parse(options.body), { decision: 'Approved', comment: '', visibility: 'internal', expected_review_cycle: 1, expected_revision: 1 })
      return new Promise((resolve) => {
        releasePost = () =>
          resolve(Response.json({ reviewed: true, species_request: approved.species_request }))
      })
    }
    if (initialDetail && url === `/api/observations/${firstId}`) { initialDetail--; return Response.json({ observation: pending }) }
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
    assert.ok(!nodes(h.render()).some((n) => n.type === 'h4' && n.children === 'Approved Species'))
    assert.equal(h.state.reviewMessage.value.variant, 'success')
  } finally {
    h.stop()
  }
})

test('species rejection/correction validate comments, refetch saved reasons, and reflect server cascade without a separate plant decision', async () => {
  for (const decision of ['Rejected', 'Correction Required']) {
    let stored = fixture({ species_request: requestFixture({ request_id: '1' }) })
    const h = harness(async (url, options) => {
      if (url === '/api/observations') return Response.json({ observations: [stored] })
      if (options.method === 'POST') {
        assert.equal(url, '/api/species-requests/1/review')
        assert.deepEqual(JSON.parse(options.body), { decision, comment: 'Species reason', expected_review_cycle: 1, expected_revision: 1 })
        stored = fixture({
          status: decision === 'Rejected' ? 'Rejected' : 'Pending Review',
          review_origin: decision === 'Rejected' ? 'species_dependency' : 'officer',
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
        assert.ok(h.state.speciesCommentError.value)
      }
      h.state.speciesReviewComment.value = 'Species reason'
      await h.state.decideSpecies(decision)
      assert.equal(h.state.selectedSpeciesRequest.value.status, decision)
      assert.equal(h.state.selectedSpeciesRequest.value.reviewComment, 'Species reason')
      assert.equal(h.state.canReviewPlant.value, false)
      assert.equal(h.state.selected.value.status, decision === 'Rejected' ? 'Rejected' : 'Pending Review')
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
    if (url.startsWith('/api/conservation/submitter-names?')) return Response.json({ names: {} })
    if (url === '/api/observations')
      return Response.json({ observations: [fixture({ species_request: requestFixture() })] })
    if (options.method === 'POST')
      return Response.json({ error: 'Already resolved' }, { status: 409 })
    if (initialDetail && url === `/api/observations/${firstId}`) { initialDetail--; return Response.json({ observation: fixture({ species_request: requestFixture() }) }) }
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
    assert.equal(h.state.reviewMessage.value.message, messages.conservationPages.reviews.feedback.conflictRefreshed)
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
    if (url.startsWith('/api/conservation/submitter-names?')) return Response.json({ names: {} })
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
    if (initialDetail && url === `/api/observations/${firstId}`) { initialDetail--; return Response.json({ observation: fixture({ species_request: requestFixture() }) }) }
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
    if (url.startsWith('/api/conservation/submitter-names?')) return Response.json({ names: {} })
    if (url === '/api/observations')
      return Response.json({
        observations: [fixture({ species_request: requestFixture() }), fixture({ id: secondId })],
      })
    if (options.method === 'POST')
      return new Promise((resolve) => {
        release = () => resolve(Response.json({ reviewed: true }))
      })
    if (url.endsWith(secondId)) return Response.json({ observation: fixture({ id: secondId }) })
    if (initialDetail && url === `/api/observations/${firstId}`) { initialDetail--; return Response.json({ observation: fixture({ species_request: requestFixture() }) }) }
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
    assert.match(h.state.speciesVisibilityError.value, /visibility/i)
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
    assert.ok(renderText(h).includes(messages.approvedChanges.originalRegistration))
  } finally { h.stop() }
})
const renderText = h => nodes(h.render()).map(node => typeof node.children === 'string' ? node.children : '').join(' ')
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

test('opening Review refreshes corrected catalogue identity and locks decisions until validated', async () => {
  const pending = deferred()
  const stale = fixture({ species_id: 1, scientific_name: 'Old catalogue', common_name: 'Old common' })
  const h = harness(async url => url.startsWith('/api/conservation/submitter-names?') ? Response.json({names:{}}) : url === '/api/observations' ? fixtureResponse(url, [stale]) : pending.promise)
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
    if (url.startsWith('/api/conservation/submitter-names?')) return Response.json({ names: {} })
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

test('unified queue retains authoritative unverified origins, preserve all statuses and continue empty filtered pages', async () => {
  const initial = fixture(), proposed = fixture({ id: secondId, species_request: requestFixture() })
  const legacy = fixture({ id: '123', origin_type: 'unknown', status: 'Flagged' })
  let failMore = false
  const h = harness(async url => fixtureResponse(url, [initial, proposed, legacy]), {}, 'en', undefined, async url => {
    const query = new URL(url, 'https://fixture.invalid').searchParams
    assert.equal(query.get('limit'), '100')
    assert.equal(query.has('origin_type'), false)
    if (!query.has('cursor')) return Response.json({ observations: [], page: { has_more: true, next_cursor: 'scan-next' } })
    if (failMore) return Response.json({ error: 'Retry this page' }, { status: 503 })
    return Response.json({ observations: [initial, proposed, legacy], page: { has_more: false, next_cursor: null } })
  })
  try {
    await h.state.loadObservations()
    assert.equal(h.state.filtered.value.length, 2, 'all source pages are loaded before publishing the queue')
    failMore = true; await h.state.loadObservations()
    assert.ok(h.state.loadError.value); assert.equal(h.state.observations.value.length, 3, 'last coherent snapshot is preserved'); assert.equal(h.state.queueUnverified.value, true); assert.equal(h.state.canReviewPlant.value, false)
    failMore = false; await h.state.loadObservations()
    assert.equal(h.state.filtered.value.length, 2); assert.equal(h.state.hasMore.value, false)
    assert.equal(h.state.filtered.value[0].speciesRequest, null)
    assert.ok(h.state.filtered.value[1].speciesRequest)
    h.state.observations.value.push(h.state.mapObservation(fixture({ id: '321', origin_type: 'subsequent_observation' })))
    assert.equal(h.state.filtered.value.length, 2)
    h.state.queueOrigin.value = 'unknown'; await h.state.loadObservations()
    assert.equal(h.state.filtered.value.length, 1)
    await h.state.open(h.state.filtered.value.find(row => row.origin === 'unknown')); await flush()
    assert.equal(h.state.selected.value.origin, 'unknown'); assert.equal(h.state.canDecide('Approved'), false)
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

test('review queue retains the requested eleven headers, compact observation/subject labels and raw review identifiers', async () => {
  const row = fixture({ owner_subject: 'staff:2ace382f-1111-4111-8111-111111111111' })
  const h = harness(url => fixtureResponse(url, [row]))
  try {
    await h.state.loadObservations()
    const headers = nodes(reviewTable(h)).filter(node => node.type === 'th')
    assert.deepEqual(headers.map(node => node.children), [messages.approvedChanges.submissionId, messages.approvedChanges.plantId, messages.approvedChanges.submissionType, 'Species', 'Submitted By', messages.approvedChanges.reviewedByColumn, 'Location Zone', messages.conservationPages.reviews.recordCreated, 'Status', 'Similarity', 'Actions'])
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

test('review copy controls preserve full identifiers; Submitted By has no success banner', async () => {
  for (const language of ['en', 'ms', 'zh-CN']) {
    const row = fixture(), copied = []
    const h = harness(url => fixtureResponse(url, [row]), {}, language, undefined, null, { clipboard: { writeText: async value => copied.push(value) } })
    try {
      await h.state.loadObservations()
      const requestsBeforeCopy = h.calls.length
      for (const [index, value] of [row.id, row.owner_subject].entries()) {
        const button = reviewCopyButtons(h)[index]
        assert.ok(button.props['aria-label'] && !button.props['aria-label'].startsWith('conservationPages.'))
        await button.props.onClick()
        assert.equal(copied[index], value)
        if (index === 0) { assert.equal(h.state.copyFeedback.value, ''); assert.ok(h.state.controlToastKey.value); assert.equal(h.state.copyFailed.value, false) }
        else { assert.equal(h.state.copyFeedback.value, ''); assert.equal(h.state.submitterCopied.value['observation:' + row.id], true) }
      }
      const live = nodes(h.render()).find(node => String(node.props?.class).includes('copy-feedback'))
      assert.equal(live.props['aria-live'], 'polite')
      assert.equal(live.props.role, 'status')
      assert.equal(h.calls.length, requestsBeforeCopy)
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
    assert.ok(nodes(modal).some(node => node.type?.name?.endsWith('MonitoringIdentifier.vue') && node.props.value === row.owner_subject))
  } finally { unavailable.stop() }
})

test('review table preserves alignment/header and uses shared workflow colors with fixed columns and wrapping controls', async () => {
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
  assert.match(css, /\.reviews-table\s*\{[^}]*min-width: 120rem; table-layout: fixed;[^}]*border-collapse: separate; border-spacing: 0/)
  assert.match(css, /\.reviews-scroll\s*\{ min-width: 0; max-width: 100%; overflow-x: auto/)
  assert.match(css, /\.reviews-table \.badge\s*\{[^}]*display: inline-flex; align-items: center;[^}]*white-space: nowrap/)
  assert.match(css, /\.reviews-scroll \.reviews-table \.action-group\s*\{[^}]*flex-wrap: wrap; align-items: center;[^}]*gap: 7px; width: 100%; min-width: 0/)
  assert.match(css, /\.identifier-line\s*\{[^}]*align-items: center;[^}]*gap: 7px;[^}]*vertical-align: middle/)
  assert.match(css, /\.identifier-copy:focus-visible\s*\{ outline: 3px solid/)
  assert.match(css, /@media \(max-width: 767px\)[^\n]*min-height: 44px/)
  assert.ok(descriptor.template.content.includes(':style="workflowBadgeStyle(observation.status)"'))
  assert.deepEqual(workflowBadgeStyle('Pending Review'), { backgroundColor: '#FEF9C3', color: '#854D0E' })
  const compiled = compileStyle({ source: css, id: 'data-v-review-integration', scoped: true })
  assert.equal(compiled.errors.length, 0)
  assert.match(compiled.code, /\.reviews-scroll \.reviews-table \.identifier-copy\[data-v-review-integration\]/)
  const h = harness(url => fixtureResponse(url, [fixture()]))
  try {
    await h.state.loadObservations()
    const scroll = nodes(h.render()).find(node => String(node.props?.class).includes('reviews-scroll'))
    assert.equal(scroll.props.role, 'region'); assert.equal(scroll.props.tabindex, '0')
    assert.equal(nodes(scroll).filter(node => String(node.props?.class).includes('table-scroll')).length, 1)
    const badge = nodes(reviewTable(h)).find(node => node.type === 'span' && String(node.props?.class).includes('pending-review'))
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
      assert.equal(nodes(reviewTable(h)).filter(node => node.type === 'th').length, 11)
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
    'pending-review': ['#FEF9C3', '#854D0E'],
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

test('registration introduction is localized and concise with queue details in the accessible tooltip', async () => {
  for (const language of ['en', 'ms', 'zh-CN']) {
    const labels = JSON.parse(readFileSync(new URL(`../src/locales/${language}.json`, import.meta.url), 'utf8')).conservationPages.reviews.queues
    const h = harness(url => fixtureResponse(url, []), {}, language)
    try {
      await h.state.loadObservations()
      const intro = nodes(h.render()).find(node => node.type === 'section' && String(node.props?.class).split(' ').includes('page-intro'))
      const text = nodes(intro).filter(node => typeof node.children === 'string').map(node => node.children)
      for (const value of [labels.registrationEyebrow, labels.registrations, labels.registrationIntro]) assert.ok(text.includes(value)); const help=nodes(intro).find(node=>node.props?.id==='registration-queue-help'); assert.equal(help.props.role,'tooltip'); assert.equal(help.props.popover,'auto'); assert.ok(nodes(help).some(node=>node.children===labels.includedText)); assert.ok(nodes(help).some(node=>node.children===labels.countsText))
      assert.ok(text.includes(labels.countsText))
      assert.ok(!labels.registrationIntro.includes(labels.legacy))
      assert.ok(!nodes(h.render()).some(node => node.type === 'option' && node.props?.value === 'unknown'))
      assert.equal(h.state.submissionType.value, '')
      assert.equal(nodes(h.render()).filter(node => node.props?.id === 'review-summary-scope').length, 0)
      assert.equal(reviewSummaryCards(h).length, 5)
      assert.ok(nodes(reviewSummaryCards(h)[3]).some(node => node.type === 'svg' && node.props?.['aria-hidden'] === 'true'))
    } finally { h.stop() }
  }
  const labels = messages.conservationPages.reviews.queues
  assert.equal(labels.registrationEyebrow, 'Verification Workflow')
  assert.equal(labels.registrations, 'New Plant Registrations')
  assert.equal(labels.registrationIntro, 'Review and manage plant registrations and species requests.')
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
    assert.equal(count(), 2)
    assert.equal(h.state.observations.value.length, 3)
    assert.equal(h.state.observations.value.find(row => row.id === secondId).speciesRequest.state, 'rejected')
    await h.state.loadObservations(true)
    assert.equal(count(), 2)
    assert.equal(h.state.observations.value.length, 3)
    h.state.queueOrigin.value = 'unknown'; await h.state.loadObservations()
    assert.equal(count(), 0, 'explicit legacy context counts only eligible legacy records, not hidden registrations')
    assert.equal(h.state.observations.value.length, 3)
    h.state.queueOrigin.value = 'initial_registration'; await h.state.loadObservations()
    assert.equal(count(), 2)
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
    assert.deepEqual(fields.map(field => nodes(field).find(node => node.type === 'span').children), ['Submission Type', 'Search', 'Review status', 'Species', messages.conservationPages.reviews.recordCreated])
    for (const field of fields) {
      assert.equal(nodes(field).filter(node => node.type === 'span').length, 1)
      assert.equal(nodes(field).filter(node => (['input', 'select'].includes(node.type) || node.type?.name?.endsWith('ReviewFilterDropdown.vue'))).length, 1)
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

test('date, search, status, species and type filters retain independent and combined behavior', async () => {
  const rows = [fixture(), fixture({ id: secondId, status: 'Approved', species_id: 9, scientific_name: 'Other species', historical_review: { state: 'partial', fields: { species_id: 9, plant_scientific_name: 'Other species', scientific_name: 'Other species', content: {} }, assets: [] }, created_at: '2026-10-02T12:00:00Z' }), fixture({ id: '123', created_at: '2026-10-02T12:00:00Z' })]
  const h = harness(url => fixtureResponse(url, rows))
  const update = (index, value) => nodes(reviewFilterFields(h)[index]).find(node => (['input', 'select'].includes(node.type) || node.type?.name?.endsWith('ReviewFilterDropdown.vue'))).props['onUpdate:modelValue'](value)
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
    update(4, ''); update(1, ''); update(2, ''); update(3, ''); update(0, 'approved_plant_change')
    assert.equal(h.state.allReviewRows.value.length, 0)
    update(0, 'initial_registration'); assert.equal(h.state.allReviewRows.value.length, 3)
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
    const rule = new RegExp(`^(?:\\.submission-review-badge, )?${escaped}\\s*\\{([^}]+)\\}`, 'm').exec(css)?.[1]
    assert.ok(rule?.includes(`font-size: ${size}px`), selector)
  }
  assert.match(css, /\.reviews-filters > \.field > input, \.reviews-filters > \.field > select\s*\{[^}]*height: 44px;[^}]*font-size: 14px; line-height: 1.4/)
  assert.match(css, /\.identifier-line > strong, \.identifier-line > span\s*\{[^}]*font-size: 14px; line-height: 1.5/)
  assert.match(css, /\.reviews-table \.observation-column\s*\{ width: 12rem/)
  assert.match(css, /\.reviews-table \.created-column\s*\{ width: 12rem/)
  assert.match(css, /\.reviews-table \.badge\s*\{[^}]*white-space: nowrap/)
  assert.match(css, /\.reviews-table \.action-group > \.action-button\s*\{[^}]*min-width: 0; max-width: 100%;[^}]*white-space: normal/)
  assert.match(css, /\.review-summary-title p\s*\{[^}]*line-height: 1.5/)
  assert.doesNotMatch(css, /text-overflow:\s*ellipsis/)
  assert.equal(compileStyle({ source: css, id: 'data-v-review-type', scoped: true }).errors.length, 0)
})

const reviewModal = h => nodes(h.render()).find(node => node.type?.name?.endsWith('AppModal.vue'))

test('missing review comment gets a decorative Lucide circle-alert without changing other feedback', async () => {
  const row = fixture(), h = harness(url => fixtureResponse(url, [row]))
  try {
    await h.state.open(h.state.mapObservation(row)); await flush()
    h.state.comment.value = ''
    await h.state.decide('Rejected')
    const expected = 'Enter a review comment for rejection, correction, or flagging.'
    assert.equal(h.state.reviewMessage.value.message, expected)
    const all = nodes(reviewModal(h)), icon = all.find(n => String(n.props?.class).includes('lucide-circle-alert'))
    assert.ok(icon)
    assert.equal(icon.props.width, '18'); assert.equal(icon.props.height, '18')
    assert.equal(icon.props['aria-hidden'], 'true')
    assert.equal(icon.props.stroke, 'currentColor')
    assert.ok(all.some(n => n.type === 'span' && n.children === expected))
    assert.equal(h.calls.filter(call => call.options.method === 'POST').length, 0)
    h.state.reviewMessage.value = { variant: 'error', message: 'Different backend error' }
    assert.ok(!nodes(reviewModal(h)).some(n => String(n.props?.class).includes('lucide-circle-alert')))
    assert.match(descriptor.styles[0].content, /\.review-comment-validation \{ display: flex; align-items: flex-start; gap: 8px/)
    assert.match(descriptor.styles[0].content, /\.review-comment-alert-icon \{[^}]*flex: 0 0 18px/)
  } finally { h.stop() }
})

test('similarity explanation is a top-layer help tooltip with hover, focus and tap access, without changing comparison', async () => {
  const row = fixture(), document = { activeElement: null }
  const h = harness(url => fixtureResponse(url, [row]), {}, 'en', undefined, null, { document })
  try {
    await h.state.open(h.state.mapObservation(row)); await flush()
    const all = nodes(reviewModal(h)), help = all.find(n => n.props?.class === 'similarity-info-button')
    const tooltip = all.find(n => n.props?.id === 'review-similarity-info')
    const description = 'Compare this submission with approved plant photos.'
    assert.equal(tooltip.children, description)
    assert.equal(tooltip.props.popover, 'auto')
    assert.equal(tooltip.props.role, 'tooltip')
    assert.ok(!all.some(n => n.type === 'p' && n.children === description))
    assert.equal(help.props['aria-describedby'], tooltip.props.id)
    assert.equal(help.props.type, 'button')
    let shows = 0, hides = 0
    const popup = { style: {}, showPopover() { shows++ }, hidePopover() { hides++ }, getBoundingClientRect: () => ({ width: 280, height: 54 }) }
    h.state.similarityInfo.value = popup
    const target = { getBoundingClientRect: () => ({ left: 950, top: 10, bottom: 38 }) }
    for (const handler of ['onMouseenter', 'onFocus', 'onClick']) help.props[handler]({ currentTarget: target, stopPropagation() {}, preventDefault() {} })
    assert.equal(shows, 3)
    assert.equal(popup.style.left, '736px')
    assert.equal(popup.style.top, '46px')
    document.activeElement = target
    help.props.onMouseleave({ type: 'mouseleave', currentTarget: target })
    assert.equal(hides, 0)
    help.props.onBlur({ type: 'blur', currentTarget: target })
    assert.equal(hides, 1)
    assert.ok(all.some(n => n.type === 'button' && n.children === 'Check similarity'))
    assert.equal(h.calls.filter(call => call.url.endsWith('/similarity')).length, 0)
    assert.match(descriptor.styles[0].content, /\.similarity-info-tooltip \{ position: fixed; inset: auto/)
  } finally { h.stop() }
})

test('submission information preserves field order, full submitter identity and day-first Malaysia timestamps', async () => {
  const id = 'staff:2ace382f-1737-463a-aff1-8e4b88308d04'
  const row = fixture({ owner_subject: id, created_at: '2026-11-04T13:28:00Z', updated_at: '2026-11-04T17:18:00Z', reviewed_at: '2026-11-05T01:18:00+08:00', review_decision: 'Rejected', status: 'Correction Required' })
  const h = harness(url => fixtureResponse(url, [row]))
  try {
    await h.state.open(h.state.mapObservation(row)); await flush()
    const all = nodes(reviewModal(h))
    const identifier = all.find(node => node.type?.name?.endsWith('MonitoringIdentifier.vue'))
    assert.equal(identifier.props.value, id)
    assert.equal(identifier.props.labels.get(id), 'staff:2ace382f\u2026')
    assert.equal(identifier.props['copy-label'], 'Copy full submitter ID')
    assert.equal(identifier.props['feedback-duration'], 3000)
    const list = all.find(node => node.type === 'dl' && nodes(node).includes(identifier))
    assert.equal(list.props.class, 'detail-list submission-information')
    assert.deepEqual(nodes(list).filter(node => node.type === 'dt').map(node => node.children), ['Submitted By', 'Record created', 'Last updated', 'Reviewed at', messages.approvedChanges.reviewedBy, 'Latest review decision'])
    assert.deepEqual(nodes(list).filter(node => node.type === 'dd').slice(1, 4).map(node => node.children), ['4 Nov 2026, 21:28', '5 Nov 2026, 01:18', '5 Nov 2026, 01:18'])
    const badges = nodes(list).filter(node => String(node.props?.class).includes('submission-review-badge'))
    assert.deepEqual(badges.map(node => node.children), ['Rejected'])
    const statusBadge=nodes(all.find(node=>node.props?.class==='plant-observation-heading')).find(node=>String(node.props?.class).includes('submission-review-badge'))
    assert.equal(statusBadge.children,'Correction Required');assert.deepEqual(statusBadge.props.style,workflowBadgeStyle('Correction Required'))
    assert.deepEqual(badges.map(node => node.props.style), [workflowBadgeStyle('Rejected')])
    assert.equal(h.calls.filter(call => call.options.method === 'POST').length, 0)
  } finally { h.stop() }
})

test('submission status badges reuse table styles independently for every workflow value and safe fallback', async () => {
  const h = harness(url => fixtureResponse(url, [fixture()]))
  try {
    await h.state.open(h.state.mapObservation(fixture())); await flush()
    for (const value of ['Approved', 'Pending Review', 'Correction Required', 'Rejected', 'Flagged', 'Draft', '', 'Unrecognized']) {
      // Render the already mapped view model: presentation must not classify statuses.
      h.state.selected.value.reviewDecision = value
      h.state.selected.value.status = 'Pending Review'
      const badges = nodes(reviewModal(h)).filter(node => String(node.props?.class).includes('submission-review-badge'))
      assert.equal(badges.length, 2)
      assert.equal(badges[1].children, value || '\u2014')
      assert.deepEqual(badges[1].props.style, workflowBadgeStyle(value))
      assert.equal(badges[0].children, 'Pending Review')
      assert.deepEqual(badges[0].props.style, workflowBadgeStyle('Pending Review'))
    }
    const mapped = h.state.mapObservation(fixture({ status: null, review_decision: null, owner_subject: null, created_at: 'invalid', updated_at: null, reviewed_at: null }))
    h.state.selected.value = mapped
    const all = nodes(reviewModal(h))
    const identifier = all.find(node => node.type?.name?.endsWith('MonitoringIdentifier.vue'))
    assert.equal(identifier.props.value, '')
    const list = all.find(node => node.type === 'dl' && nodes(node).includes(identifier))
    assert.deepEqual(nodes(list).filter(node => node.type === 'dd').slice(1, 4).map(node => node.children), ['\u2014', '\u2014', '\u2014'])
    assert.match(descriptor.styles[0].content, /\.submission-review-badge, \.reviews-table \.badge\s*\{/)
  } finally { h.stop() }
})

test('whole decision panel keeps similarity, comment and feedback together for registration and subsequent layouts', async () => {
  for (const origin of ['initial_registration', 'subsequent_observation']) {
    const row = fixture({ origin_type: origin })
    const h = harness(url => fixtureResponse(url, [row]))
    try {
      await h.state.open(h.state.mapObservation(row)); await flush()
      h.state.comment.value = 'Unsaved Officer comment'
      h.state.reviewMessage.value = { variant: 'error', message: 'Existing validation feedback' }
      const modal = reviewModal(h), all = nodes(modal)
      const panel = all.find(node => node.type === 'aside' && node.props?.class === 'review-decision-panel')
      assert.ok(panel)
      assert.equal(panel.props.tabindex, '0')
      assert.equal(panel.props['aria-labelledby'], 'review-decision-heading')
      assert.ok(nodes(panel).some(node => node.props?.class === 'review-similarity-summary'))
      assert.ok(nodes(panel).some(node => node.props?.id === 'review-decision-heading'))
      assert.ok(nodes(panel).some(node => node.children === 'Existing validation feedback'))
      const textarea = nodes(panel).filter(node => node.type === 'textarea')
      assert.equal(textarea.length, 1)
      textarea[0].props['onUpdate:modelValue']('Officer comment retained while scrolling')
      h.render(); h.render()
      assert.equal(h.state.comment.value, 'Officer comment retained while scrolling')
      const footer = all.filter(node => node.props?.class === 'modal-actions plant-review-actions')
      assert.equal(footer.length, 1)
      assert.ok(!nodes(panel).includes(footer[0]))
      assert.deepEqual(nodes(footer[0]).filter(node => node.type === 'button').map(node => node.children), ['Approve', 'Reject', 'Request Correction', 'Flag'])
      assert.equal(h.calls.filter(call => call.options.method === 'POST').length, 0)
    } finally { h.stop() }
  }
})

test('decision panel sticks only on desktop within the existing modal scroller and caps only oversized content', () => {
  const css = descriptor.styles[0].content
  assert.match(css, /\.review-observation-columns\s*\{ align-items: start/)
  assert.match(css, /@media \(min-width: 921px\)\s*\{\s*\.review-decision-panel\s*\{[^}]*position: sticky;[^}]*top: 16px;[^}]*max-height: calc\(100dvh - 104px\);[^}]*overflow: auto;[^}]*scrollbar-gutter: stable/s)
  assert.match(css, /\.review-decision-panel:focus-visible/)
  assert.match(css, /\.review-decision-panel \.review-similarity-summary\s*\{ flex-wrap: wrap/)
  const shared = readFileSync(new URL('../src/styles/conservation.css', import.meta.url), 'utf8')
  assert.match(shared, /\.officer-layout \.modal-card\s*\{[^}]*max-height: calc\(100vh - 40px\);[^}]*overflow: auto/)
  assert.match(shared, /@media \(max-width: 920px\)[\s\S]*\.two-column\s*\{\s*grid-template-columns: 1fr/)
  assert.deepEqual(compileStyle({ source: css, id: 'data-v-review', scoped: true }).errors, [])
})

test('major review section headings use eight themed outline icons without decorating the fields', async () => {
  for (const origin of ['initial_registration', 'subsequent_observation']) {
    const row = fixture({ origin_type: origin })
    const h = harness(url => fixtureResponse(url, [row]))
    try {
      await h.state.open(h.state.mapObservation(row)); await flush()
      const modal = reviewModal(h), all = nodes(modal)
      const headings = all.filter(node => String(node.props?.class || '').split(' ').includes('review-section-heading'))
      assert.equal(headings.length, 8)
      assert.deepEqual(headings.map(heading => nodes(heading).find(node => node.type === 'svg').props['data-section-icon']), ['leaf', 'sprout', 'pin', 'qr', 'image', 'file', 'clipboard', 'comment'])
      for (const heading of headings) {
        const icons = nodes(heading).filter(node => node.type === 'svg')
        assert.equal(icons.length, 1)
        assert.equal(icons[0].props['aria-hidden'], 'true')
        assert.equal(icons[0].props.focusable, 'false')
        assert.equal(icons[0].props.fill, 'none')
        assert.ok(nodes(heading).some(node => node.type === 'span' && typeof node.children === 'string' && node.children.trim()))
      }
      const section = all.find(node => node.props?.class === 'review-section')
      assert.ok(nodes(section).some(node => node.props?.class === 'detail-list'))
      assert.ok(nodes(section).some(node => node.props?.class === 'two-column review-observation-columns'))
      assert.equal(nodes(section).filter(node => node.type === 'table').length, 0)
      for (const label of nodes(section).filter(node => node.type === 'dt')) assert.equal(nodes(label).filter(node => node.type === 'svg').length, 0)
      const panel = all.find(node => node.props?.class === 'review-decision-panel')
      assert.ok(nodes(panel).some(node => node.props?.id === 'review-decision-heading'))
      assert.ok(nodes(panel).some(node => node.props?.class === 'review-similarity-summary'))
      assert.equal(nodes(panel).filter(node => node.type === 'textarea').length, 1)
    } finally { h.stop() }
  }
  const css = descriptor.styles[0].content
  assert.match(css, /\.review-section-heading\s*\{[^}]*min-height: 40px;[^}]*border-radius: 8px;[^}]*background: #eaf3e9;[^}]*color: var\(--forest, #173f34\)/)
  assert.match(css, /\.review-section-icon\s*\{[^}]*width: 20px;[^}]*height: 20px;[^}]*color: var\(--green, #33745d\)/)
  assert.match(css, /\.review-section-heading > span\s*\{[^}]*overflow-wrap: anywhere/)
})
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
      assert.equal(h.state.qrCopyFeedback.value, '')
      assert.equal(h.state.controlToastKey.value, 'qr:' + firstId)
      assert.match(renderText(h), /Copied/)
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
    assert.equal(nodes(items[0]).find(node => node.props?.class === 'history-date').children, reviewDateTime(rows[0].created_at))
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

test('Review Submissions retains exactly eleven aligned columns while full observation copying stays authoritative', async () => {
  const row = fixture({ plant_id: 18 }), copied = []
  const h = harness(url => fixtureResponse(url, [row]), {}, 'en', undefined, null, { clipboard: { writeText: async value => copied.push(value) } })
  try {
    await h.state.loadObservations()
    const table = reviewTable(h)
    assert.deepEqual(nodes(table).filter(node => node.type === 'col').map(node => node.props.class), ['observation-column', 'plant-column', 'type-column', 'species-column', 'submitter-column', 'reviewer-column', 'zone-column', 'created-column', 'status-column', 'similarity-column', 'actions-column'])
    assert.deepEqual(nodes(table).filter(node => node.type === 'th').map(node => node.children), [messages.approvedChanges.submissionId, messages.approvedChanges.plantId, messages.approvedChanges.submissionType, 'Species', 'Submitted By', messages.approvedChanges.reviewedByColumn, 'Location Zone', messages.conservationPages.reviews.recordCreated, 'Status', 'Similarity', 'Actions'])
    const renderedRow = nodes(table).find(node => node.type === 'tr' && node.key === 'observation:' + row.id)
    const cells = nodes(renderedRow).filter(node => node.type === 'td')
    assert.equal(cells.length, 11)
    assert.equal(cells[1].props.class, 'plant-id-cell')
    assert.equal(cells[1].children, 'PL018')
    assert.equal(cells[0].props.class, 'identity-cell')
    assert.match(descriptor.styles[0].content, /\.reviews-table \.plant-id-cell\s*\{ color: #315749; font-weight: 700/)
    assert.match(descriptor.styles[0].content, /\.reviews-table \.identity-cell strong\s*\{ color: inherit; font-weight: 700/)
    assert.equal(nodes(cells[0]).find(node => node.type === 'strong').children, 'OBS-AA3BD8BE')
    const copy = nodes(cells[0]).find(node => node.type === 'button')
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

const standaloneFixture=(changes={})=>({request_id:73,review_cycle:1,content_revision:1,requested_by:'staff:bot',scientific_name:'Standalone original',suggested_common_name:'Original common',genus_name:'Shorea',family_name:'Dipterocarpaceae',conservation_status:'Least Concern',description:'Original description',habitat:'Original habitat',request_status:'Pending Review',submitted_at:'2026-11-09T01:00:00Z',review_comment:'',approved_species_id:null,...changes})
test('standalone species query opens the existing species panel without inventing a plant and reviews with existing rules',async()=>{
 for(const decision of ['Approved','Rejected','Correction Required']){
 let saved=false
 const h=harness(async(url,options)=>{
  if(url==='/api/observations')return Response.json({observations:[]})
  assert.ok(url.startsWith('/api/species-requests/73'))
  if(options.method==='POST'){assert.equal(url,'/api/species-requests/73/review');assert.deepEqual(JSON.parse(options.body),{decision,comment:'Review reason',expected_review_cycle:1,expected_revision:1,...(decision==='Approved'?{visibility:'protected'}:{})});saved=true;return Response.json({reviewed:true})}
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
  await h.state.decideSpecies('Approved');assert.equal(h.state.speciesVersionConflict.value,false);assert.equal(h.state.speciesNeedsReload.value,true);assert.equal(h.state.speciesReviewComment.value,'Keep this comment');assert.equal(h.state.canReviewSpecies.value,false)
  await h.state.refreshSpeciesRequest();assert.equal(h.state.speciesNeedsReload.value,false)
  mode='conflict';h.state.speciesVisibility.value='public';await h.state.decideSpecies('Approved');assert.equal(h.state.standaloneRequest.value.state,'approved');assert.equal(h.state.speciesReviewComment.value,'Keep this comment')
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

test('linked and standalone species reviews refresh conflicted revisions automatically and require inspection before a new decision', async () => {
  for (const standalone of [false, true]) {
    let revision = 1, posts = 0, saved = false
    const raw = () => requestFixture({ request_id: '73', review_cycle: 1, content_revision: revision, request_status: saved ? 'Approved' : 'Pending Review', approved_species_id: saved ? 8 : null, proposed_scientific_name: revision === 1 ? 'Inspected name' : 'Changed name' })
    const row = () => fixture({ species_request_id: '73', species_request: raw() })
    const h = harness(async (url, options) => {
      if (options.method === 'POST') {
        posts++
        const body = JSON.parse(options.body)
        if (posts === 1) {
          assert.equal(body.expected_revision, 1)
          return Response.json({ code: 'SPECIES_REQUEST_VERSION_CONFLICT', error: 'Changed' }, { status: 409 })
        }
        assert.equal(body.expected_revision, 2)
        saved = true
        return Response.json({ reviewed: true })
      }
      if (url === '/api/species-requests/73') return Response.json({ species_request: { ...standaloneFixture({ review_cycle: 1, content_revision: revision, request_status: saved ? 'Approved' : 'Pending Review', approved_species_id: saved ? 8 : null }), scientific_name: raw().proposed_scientific_name } })
      return fixtureResponse(url, [row()])
    }, standalone ? { speciesRequest: '73' } : {})
    try {
      await h.state.loadObservations(); await flush()
      if (!standalone) await h.state.open(h.state.observations.value[0])
      h.state.speciesReviewComment.value = 'Inspected version one'
      h.state.speciesVisibility.value = 'public'
      revision = 2
      await h.state.decideSpecies('Approved')
      assert.equal(posts, 1)
      assert.equal(h.state.selectedSpeciesRequest.value.contentRevision, 2)
      assert.equal(h.state.speciesVersionConflict.value, false)
      assert.equal(h.state.canReviewSpecies.value, false)
      assert.equal(h.state.speciesVisibility.value, '')
      await h.state.decideSpecies('Rejected'); assert.equal(posts, 1)
      const inspection = nodes(h.render()).find(node => node.type === 'label' && nodes(node).some(child => child.type === 'input' && child.props?.type === 'checkbox'))
      assert.ok(inspection)
      assert.ok(renderText(h).includes(messages.conservationPages.reviews.speciesRequest.inspectLatest))
      await h.state.refreshSpeciesRequest()
      assert.equal(h.state.selectedSpeciesRequest.value.id, '73')
      assert.equal(h.state.selectedSpeciesRequest.value.contentRevision, 2)
      assert.equal(h.state.selectedSpeciesRequest.value.scientificName, 'Changed name')
      assert.equal(h.state.selectedSpeciesRequest.value.updated, true)
      assert.equal(h.state.speciesVersionConflict.value, false)
      assert.equal(h.state.speciesReloaded.value, true)
      assert.equal(h.state.speciesInspectionRequired.value, true)
      assert.equal(h.state.canReviewSpecies.value, false)
      const checkbox = nodes(h.render()).find(node => node.type === 'input' && node.props?.type === 'checkbox' && node.props?.onChange)
      checkbox.props.onChange({ target: { checked: true } })
      assert.equal(h.state.canReviewSpecies.value, true)
      assert.equal(posts, 1)
      h.state.speciesVisibility.value = 'internal'
      await h.state.decideSpecies('Approved')
      assert.equal(posts, 2)
      assert.equal(h.state.selectedSpeciesRequest.value.state, 'approved')
    } finally { h.stop() }
  }
})

test('Updated reflects an authoritative positive content revision on pending species only', async () => {
  for (const [revision, status, updated] of [[1,'Pending Review',false],[2,'Pending Review',true],[null,'Pending Review',false],[0,'Pending Review',false],[2,'Approved',false],[2.5,'Pending Review',false]]) {
    const row = fixture({ species_request: requestFixture({ review_cycle: 1, content_revision: revision, request_status: status }) })
    const h = harness(url => fixtureResponse(url, [row]))
    try {
      await h.state.loadObservations(); await h.state.open(h.state.observations.value[0])
      assert.equal(h.state.selectedSpeciesRequest.value.updated, updated)
      assert.equal(Boolean(nodes(h.render()).some(node => node.children === 'Updated')), updated)
      if (!Number.isSafeInteger(revision) || revision < 1) assert.equal(h.state.canReviewSpecies.value, false)
    } finally { h.stop() }
  }
})

test('late species version conflicts after logout cannot restore an older request warning', async () => {
  let release
  const h = harness(async (url, options) => {
    if (url === '/api/observations') return Response.json({ observations: [] })
    if (options.method === 'POST') return new Promise(resolve => { release = resolve })
    return Response.json({ species_request: standaloneFixture() })
  }, { speciesRequest: '73' })
  try {
    await h.state.loadObservations(); await flush()
    h.state.speciesVisibility.value = 'public'
    const pending = h.state.decideSpecies('Approved')
    await flush()
    h.emitSession(null)
    release(Response.json({ code: 'SPECIES_REQUEST_VERSION_CONFLICT' }, { status: 409 }))
    await pending; await flush()
    assert.equal(h.state.standaloneRequest.value, null)
    assert.equal(h.state.speciesVersionConflict.value, false)
  } finally { h.stop() }
})


test('species field validation focuses and scrolls only the modal and clears on valid input', async () => {
  for (const decision of ['Approved', 'Rejected', 'Correction Required']) {
    const row = fixture({ species_request: requestFixture({ review_comment: '' }) })
    const scrolls = [], focuses = []
    const modal = {
      parentElement: null, scrollHeight: 1200, clientHeight: 400, scrollTop: 0, contains: () => true,
      getBoundingClientRect: () => ({ top: 0, bottom: 400 }),
      scrollTo: value => scrolls.push(value),
    }
    const control = { focus: value => focuses.push(value) }
    const field = {
      parentElement: modal, closest: () => modal, querySelector: selector => selector === '.visibility-error' ? null : control,
      focus: control.focus,
      getBoundingClientRect: () => ({ top: 800, bottom: 920 }),
    }
    const h = harness(url => fixtureResponse(url, [row]), {}, 'en', undefined, null, {
      window: { getComputedStyle: () => ({ overflowY: 'auto' }), matchMedia: () => ({ matches: true }) },
    })
    try {
      await h.state.open(h.state.mapObservation(row)); await flush()
      if (decision === 'Approved') h.state.speciesVisibilityField.value = field
      else h.state.speciesCommentField.value = field
      const before = h.calls.length
      await h.state.decideSpecies(decision)
      assert.equal(h.calls.length, before, 'validation performs no HTTP request')
      assert.equal(focuses.length, 1)
      assert.equal(focuses[0].preventScroll, true)
      assert.equal(scrolls.length, 1)
      assert.equal(scrolls[0].top, 784)
      assert.equal(scrolls[0].behavior, 'auto')
      if (decision === 'Approved') {
        const selector = nodes(h.render()).find(n => n.props?.id === 'species-review-visibility')
        assert.equal(selector.props.invalid, true)
        assert.match(selector.props.error, /Please select a visibility/)
        assert.equal(h.state.speciesSaveError.value, '')
        assert.equal(h.state.canReviewSpecies.value, true)
        h.state.speciesVisibility.value = 'protected'
        assert.equal(h.state.speciesVisibilityError.value, '')
      } else {
        assert.ok(nodes(h.render()).some(n => n.props?.id === 'species-request-comment-error'))
        h.state.speciesReviewComment.value = 'Verified reason'
        assert.equal(h.state.speciesCommentError.value, '')
      }
    } finally { h.stop() }
  }
})

test('missing species revision and verification failures remain prominent blocking alerts', async () => {
  const row = fixture({ species_request: requestFixture({ content_revision: null }) })
  const h = harness(url => fixtureResponse(url, [row]))
  try {
    await h.state.open(h.state.mapObservation(row)); await flush()
    assert.equal(h.state.canReviewSpecies.value, false)
    assert.ok(nodes(h.render()).some(n => n.props?.role === 'alert' && nodes(n).some(child => child.children === 'Species revision could not be verified.')))
    h.state.speciesLoadError.value = 'Request identity could not be verified'
    const alert = nodes(h.render()).find(n => n.type === 'p' && n.children === h.state.speciesLoadError.value)
    assert.equal(alert.props.role, 'alert')
    assert.match(alert.props.class, /review-feedback error/)
    const before = h.calls.length
    await h.state.decideSpecies('Approved')
    assert.equal(h.calls.length, before)
  } finally { h.stop() }
})


test('species visibility error follows the choices with accessible associations and responsive styling', () => {
  const selector = readFileSync(new URL('../src/components/conservation/VisibilitySelector.vue', import.meta.url), 'utf8')
  assert.ok(selector.indexOf('v-if="error"') > selector.indexOf('class="visibility-options"'))
  assert.match(selector, /:aria-invalid="Boolean\(invalid\)"/)
  assert.match(selector, /aria-describedby/)
  assert.match(selector, /max-width: 620px/)
  assert.match(selector, /grid-template-columns: minmax\(0, 1fr\)/)
  assert.match(descriptor.template.content, /class="species-visibility-validation" aria-live="polite" aria-atomic="true"/)
  assert.match(descriptor.styles.map(s => s.content).join(' '), /textarea\[aria-invalid="true"\]/)
})


test('pending plant edits refresh explicit names and saved measurements while preserving the inspected revision precondition', async () => {
  let revision = 1, posts = 0;
  const row = () => fixture({ revision, plant_scientific_name: revision === 1 ? 'Inspected plant' : 'Edited plant',
    species_scientific_name: 'Taxon name', scientific_name: 'Taxon name',
    content: { heightCm: revision === 1 ? 12 : 18, healthStatus: 'Healthy', lifeStage: 'Mature', morphology: 'Leaves' },
    submission_update: revision === 1 ? { state: 'unavailable' } : { state: 'updated', version: 2, updated_at: '2026-11-13T04:00:00Z', changes: [{ field: 'heightCm', before: 12, after: 18 }] } });
  const h = harness((url, options) => {
    if (options.method === 'POST') {
      posts++; assert.equal(JSON.parse(options.body).revision, 1); revision = 2;
      return Response.json({ error: 'Observation changed' }, { status: 409 });
    }
    return fixtureResponse(url, [row()]);
  });
  try {
    await h.state.loadObservations(); await h.state.open(h.state.observations.value[0]);
    assert.equal(h.state.selected.value.plantScientificName, 'Inspected plant');
    assert.equal(h.state.selected.value.speciesScientificName, 'Taxon name');
    h.state.comment.value = 'Retain this review comment';
    await h.state.decide('Approved');
    assert.equal(h.state.selected.value.height, '18 cm');
    assert.equal(h.state.selected.value.plantScientificName, 'Edited plant');
    assert.equal(h.state.selected.value.submissionUpdate.state, 'updated');
    assert.equal(h.state.conflictAcknowledged.value, false);
    assert.equal(h.state.comment.value, 'Retain this review comment');
    await h.state.decide('Approved'); assert.equal(posts, 1);
  } finally { h.stop(); }
});


test('linked and standalone review cycles stay tied to inspection through automatic readback and explicit acknowledgement',async()=>{
 for(const standalone of [false,true]){
  let cycle=1,posts=0;
  const row=()=>fixture({species_request_id:'73',species_request:requestFixture({request_id:'73',review_cycle:cycle})});
  const h=harness((url,options)=>{
   if(options.method==='POST'){posts++;assert.equal(JSON.parse(options.body).expected_review_cycle,1);return Response.json({code:'SPECIES_REQUEST_REVIEW_CYCLE_CONFLICT',error:'New correction cycle'},{status:409});}
   if(url==='/api/species-requests/73')return Response.json({species_request:standaloneFixture({review_cycle:cycle})});
   return fixtureResponse(url,[row()]);
  },standalone?{speciesRequest:'73'}:{});
  try{
   await h.state.loadObservations();await flush();if(!standalone)await h.state.open(h.state.observations.value[0]);
   h.state.speciesVisibility.value='public';cycle=2;await h.state.decideSpecies('Approved');
   assert.equal(posts,1);assert.equal(h.state.speciesVersionConflict.value,false);assert.equal(h.state.speciesVisibility.value,'');
   await h.state.refreshSpeciesRequest();assert.equal(h.state.selectedSpeciesRequest.value.reviewCycle,2);assert.equal(h.state.canReviewSpecies.value,false);
   const checkbox=nodes(h.render()).find(node=>node.type==='input'&&node.props?.type==='checkbox'&&node.props?.onChange);checkbox.props.onChange({target:{checked:true}});
   assert.equal(h.state.canReviewSpecies.value,true);assert.equal(posts,1);
  }finally{h.stop();}
 }
});

const changeFixture = (overrides = {}) => ({ revision:1,id:'12345678-1234-1234-1234-123456789abc',plant_id:24,species_id:null,owner_subject:'staff:edit-owner',status:'Pending Review',created_at:'2026-11-14T01:00:00Z',reviewed_at:null,base_snapshot:{scientific_name:'Approved plant name',species_id:8,content:{heightCm:12,zone:'Existing zone'}},proposed_snapshot:{scientific_name:'Proposed plant name',species_id:8,content:{heightCm:18,zone:'Proposed zone'}},proposal_photo_count:0,...overrides })
const changesResponse = changes => Response.json({changes,page:{has_more:false,next_cursor:null}})
test('one original table integrates registration, linked species, plant edits and species edits in all three languages',async()=>{
  for(const language of ['en','ms','zh-CN']) {
    const labels=JSON.parse(readFileSync(new URL('../src/locales/'+language+'.json',import.meta.url),'utf8')).approvedChanges
    const plant=changeFixture(), speciesChange=changeFixture({id:'22345678-1234-1234-1234-123456789abc',plant_id:null,species_id:6,proposed_snapshot:{scientific_name:'Proposed species name'}})
    const h=harness(url=>fixtureResponse(url,[fixture({species_request:requestFixture()})]),{},language,undefined,null,{recordChangesHandler:()=>changesResponse([plant,speciesChange])})
    try {
      await h.state.loadObservations();assert.equal(h.state.loadError.value,'')
      const table=reviewTable(h),text=renderText(h)
      assert.equal(nodes(h.render()).filter(n=>n.type==='table'&&n.props?.class==='reviews-table').length,1)
      assert.equal(nodes(table).filter(n=>n.type==='th').length,11)
      assert.equal(nodes(table).find(n=>n.type==='th').children,labels.submissionId)
      assert.equal(nodes(table).filter(n=>n.type==='th')[1].children,labels.plantId)
      for (const rendered of nodes(table).filter(n=>n.type==='tr' && n.key)) {
        const cells=nodes(rendered).filter(n=>n.type==='td')
        const expected=rendered.key === 'change:' + plant.id ? 'PL024' : rendered.key === 'change:' + speciesChange.id ? '\u2014' : 'PL001'
        assert.equal(cells[1].children,expected)
      }
      assert.equal(nodes(table).filter(n=>n.type==='td').length,33)
      assert.ok(text.includes(labels.plantEdit));assert.ok(text.includes(labels.speciesEdit))
      const rows=h.state.allReviewRows.value
      assert.deepEqual(new Set(rows.map(r=>r.kind)),new Set(['linked_species_request','approved_plant_change','approved_species_change']))
      assert.equal(rows.find(r=>r.kind==='approved_plant_change').change.id,plant.id)
      assert.equal(h.state.counts.value.find(([title])=>title==='Pending Review')[1],3)
      const editRows=nodes(table).filter(n=>n.type==='tr'&&String(n.key).startsWith('change:'))
      assert.ok(editRows.every(row=>!nodes(row).some(n=>n.props?.class==='similarity-badge-button')))
      assert.ok(editRows.every(row=>nodes(row).some(n=>n.type==='button'&&n.props?.class==='action-button')))
      await nodes(editRows[0]).find(n=>n.type==='button'&&n.props?.class==='action-button').props.onClick()
      assert.equal(h.route.query.change,editRows[0].key.slice(7));assert.equal(h.state.selected.value,null)
      assert.ok(!h.calls.some(c=>c.options?.method==='POST'))
    } finally {h.stop()}
  }
})
test('complete source pages produce global sorting, local pagination, counts and combined filters without losing later proposals',async()=>{
  const observations=Array.from({length:105},(_,i)=>fixture({id:String(i+1),created_at:'2026-11-01T00:00:00Z'}))
  const plant=changeFixture(),cancelled=changeFixture({id:'32345678-1234-1234-1234-123456789abc',plant_id:null,species_id:6,status:'Cancelled',created_at:'2026-11-13T00:00:00Z'})
  const h=harness(url=>fixtureResponse(url,observations),{},'en',undefined,async url=>{
    const more=new URL(url,'https://fixture.invalid').searchParams.has('cursor')
    return Response.json({observations:more?observations.slice(100):observations.slice(0,100),page:{has_more:!more,next_cursor:more?null:'observations-next'}})
  },{recordChangesHandler:url=>{const more=new URL(url,'https://fixture.invalid').searchParams.has('cursor');return Response.json({changes:more?[plant]:[cancelled],page:{has_more:!more,next_cursor:more?null:cancelled.id}})}})
  try {
    await h.state.loadObservations();assert.equal(h.state.loadError.value,'')
    assert.equal(h.state.allReviewRows.value.length,107);assert.equal(h.state.reviewRows.value.length,100)
    assert.equal(h.state.allReviewRows.value[0].change.id,plant.id,'later API page contains globally newest row')
    assert.equal(h.state.counts.value.find(([title])=>title==='Pending Review')[1],106)
    const requests=h.calls.length;await h.state.loadObservations(true);assert.equal(h.calls.length,requests);assert.equal(h.state.reviewRows.value.length,107)
    h.state.status.value='Pending Review';assert.equal(h.state.allReviewRows.value.length,106)
    h.state.search.value='Proposed plant name';assert.equal(h.state.allReviewRows.value.length,1)
    h.state.species.value='8';h.state.date.value='2026-11-14';assert.equal(h.state.allReviewRows.value[0].change.id,plant.id)
    h.state.species.value='6';assert.equal(h.state.allReviewRows.value.length,0)
    h.route.query={change:cancelled.id};await flush();assert.equal(h.state.reviewRows.value[0].change.status,'Cancelled','notification selection bypasses ordinary filters honestly')
  } finally {h.stop()}
})
test('a failed proposal source publishes no partial combined queue and no invented counts',async()=>{
  const h=harness(url=>fixtureResponse(url,[fixture()]),{},'en',undefined,null,{recordChangesHandler:()=>Response.json({error:'Unavailable'},{status:503})})
  try {await h.state.loadObservations();assert.ok(h.state.loadError.value);assert.equal(h.state.allReviewRows.value.length,0);assert.equal(h.state.countValue(0),messages.conservationPages.reviews.unavailable)}finally{h.stop()}
})

test('edit identifiers are emphasized, distinct badges preserve registration green, and copy retains canonical proposal IDs',async()=>{
  const copied=[],plant=changeFixture(),speciesChange=changeFixture({id:'42345678-1234-1234-1234-123456789abc',plant_id:null,species_id:6})
  const h=harness(url=>fixtureResponse(url,[fixture({species_request:requestFixture()})]),{},'en',undefined,null,{clipboard:{writeText:async value=>copied.push(value)},recordChangesHandler:()=>changesResponse([plant,speciesChange])})
  try {
    await h.state.loadObservations()
    const editRows=nodes(reviewTable(h)).filter(row=>row.type==='tr'&&String(row.key).startsWith('change:'))
    for(const row of editRows) {
      const identity=nodes(row).find(n=>n.type==='td'&&String(n.props?.class).includes('edit-identity'))
      assert.ok(identity);await nodes(identity).find(n=>n.type==='button').props.onClick()
      assert.equal(copied.at(-1),row.key.slice(7));assert.equal(h.state.copyFeedback.value,'');assert.ok(h.state.controlToastKey.value)
    }
    const badges=nodes(reviewTable(h)).filter(n=>n.type==='span'&&String(n.props?.class).includes('edit-type-badge'))
    assert.ok(badges.some(n=>n.props.class.includes('plant-edit')));assert.ok(badges.some(n=>n.props.class.includes('species-edit')))
    assert.ok(nodes(reviewTable(h)).some(n=>n.type==='span'&&n.props?.class==='species-request-badge'),'new species request badge is unchanged')
    assert.match(descriptor.styles[0].content,/\.reviews-table \.edit-identity strong\s*\{[^}]*font-weight: 700/)
    assert.match(descriptor.styles[0].content,/\.species-request-badge\.plant-edit\s*\{ background: #e5f2f7/)
    assert.match(descriptor.styles[0].content,/\.species-request-badge\.species-edit\s*\{ background: #f0eaf7/)
  } finally {h.stop()}
})


test('submission type owns all four badges, leaving Species with scientific names only', async () => {
  const original=fixture({plant_id:24,plant_scientific_name:'Original registration name'});
  const linked=fixture({id:secondId,species_request:requestFixture()});
  const plant=changeFixture(), speciesEdit=changeFixture({id:'52345678-1234-1234-1234-123456789abc',plant_id:null,species_id:6});
  const h=harness(url=>fixtureResponse(url,[original,linked]),{},'en',undefined,null,{recordChangesHandler:()=>changesResponse([plant,speciesEdit])});
  try {
    await h.state.loadObservations();
    const table=reviewTable(h), headers=nodes(table).filter(n=>n.type==='th');
    assert.equal(headers.length,11);assert.equal(headers[2].children,messages.approvedChanges.submissionType);
    for (const row of nodes(table).filter(n=>n.type==='tr'&&n.key)) {
      const cells=nodes(row).filter(n=>n.type==='td');assert.equal(cells.length,11);
      assert.equal(nodes(cells[2]).filter(n=>String(n.props?.class).includes('species-request-badge')).length,1);
      assert.equal(nodes(cells[3]).filter(n=>String(n.props?.class).includes('badge')).length,0);
      assert.ok(nodes(cells[3]).some(n=>n.type==='em'));
    }
    for(const label of [messages.approvedChanges.originalRegistration,messages.conservationPages.reviews.speciesRequest.title,messages.approvedChanges.plantEdit,messages.approvedChanges.speciesEdit]) assert.ok(renderText(h).includes(label));
    assert.equal(nodes(table).filter(n=>n.type==='td').some(n=>/Edit \d/.test(String(n.children))),false);
  } finally {h.stop()}
});

test('approved original review uses verified fields and assets rather than mutable live values', async () => {
  const historical={state:'partial',fields:{species_id:8,plant_scientific_name:'Original scientific name',species_scientific_name:null,scientific_name:null,common_name:null,content:{heightCm:12,morphology:'Original morphology',zone:'Original zone',notes:'Original notes'}},assets:[{id:'original-photo',content_type:'image/jpeg'}]};
  const original=fixture({plant_id:24,status:'Approved',review_decision:'Approved',reviewed_by:'staff:original-officer',review_comment:'Original decision',reviewed_at:'2026-11-01T00:00:00Z',plant_scientific_name:'EDITED LIVE NAME',scientific_name:'EDITED CATALOGUE',content:{heightCm:99,morphology:'EDITED LIVE CONTENT'},assets:[{id:'edit-photo',content_type:'image/jpeg'}],historical_review:historical});
  const edit=changeFixture({status:'Approved'});
  const h=harness(url=>fixtureResponse(url,[original]),{},'en',undefined,null,{recordChangesHandler:()=>changesResponse([edit])});
  try {
    await h.state.loadObservations();
    assert.equal(h.state.allReviewRows.value.length,2);
    assert.equal(new Set(h.state.allReviewRows.value.map(r=>r.key)).size,2);
    h.state.status.value='Approved';assert.equal(h.state.allReviewRows.value.length,2);
    h.state.status.value='Pending Review';assert.equal(h.state.allReviewRows.value.length,0);
    h.state.status.value='';await h.state.open(h.state.observations.value[0]);await flush();
    assert.equal(h.state.selected.value.plantScientificName,'Original scientific name');
    assert.equal(h.state.selected.value.height,'12 cm');assert.equal(h.state.selected.value.morphology,'Original morphology');
    assert.equal(h.state.selected.value.speciesScientificName,'');assert.equal(h.state.selected.value.reviewedBy,'staff:original-officer');
    assert.deepEqual(Array.from(h.state.selected.value.assets,a=>a.id),['original-photo']);
    assert.ok(renderText(h).includes(messages.approvedChanges.historicalPartial));
    assert.ok(!renderText(h).includes('EDITED LIVE'));assert.ok(!renderText(h).includes('EDITED CATALOGUE'));
  } finally {h.stop()}
});

test('missing historical projection fails closed in the row and original review dialog', async () => {
  const original=fixture({status:'Approved',review_decision:'Approved',plant_scientific_name:'Unverified current name',scientific_name:'Unverified current catalogue'});
  const h=harness(url=>fixtureResponse(url,[original]));
  try {
    await h.state.loadObservations();await h.state.open(h.state.observations.value[0]);await flush();
    const row=h.state.selected.value;
    assert.equal(row.status,'Approved');assert.equal(row.height,'');assert.equal(row.zone,'');assert.equal(row.plantScientificName,'');assert.equal(row.assets.length,0);
    assert.ok(renderText(h).includes(messages.approvedChanges.historicalUnavailable));
    assert.ok(renderText(h).includes(messages.approvedChanges.historicalPhotosUnavailable));
    assert.ok(!renderText(h).includes('Unverified current'));
  } finally {h.stop()}
});

test('historical species mapping is opt-in and uses event-linked fields and authenticated photo URLs', async () => {
  const request=requestFixture({request_status:'Approved',proposed_scientific_name:'Current species',historical_review:{state:'available',fields:{scientific_name:'Original species',common_name:'Original common'},assets:[{id:'historical-species-version-id',content_type:'image/jpeg'}]}});
  const input={species_request:request};
  assert.equal(speciesRequestIntegration.mapLinkedSpeciesRequest(input).scientificName,'Current species');
  const history=speciesRequestIntegration.mapLinkedSpeciesRequest(input,true);
  assert.equal(history.scientificName,'Original species');assert.equal(history.commonName,'Original common');
  const h=harness(url=>fixtureResponse(url,[fixture()]));
  try {assert.equal(h.state.assetUrl(history.assets[0].id),'/api/data/record-versions/version-id/photo');} finally {h.stop()}
  delete request.historical_review;
  const missing=speciesRequestIntegration.mapLinkedSpeciesRequest(input,true);
  assert.equal(missing.scientificName,'');assert.equal(missing.historicalState,'unavailable');assert.equal(missing.assets.length,0);
});


test('Reviewed By uses reviewer-specific compact labels without changing attribution or missing-ID display', async () => {
  const full='staff:7f6e5d4c-1111-4111-8111-111111111111';
  for (const reviewer of [full,'staff:42','',null,undefined]) {
    const row=fixture({reviewed_by:reviewer}),h=harness(url=>fixtureResponse(url,[row]));
    try {
      await h.state.open(h.state.mapObservation(row));await flush();
      const field=nodes(reviewModal(h)).find(n=>n.type==='div'&&Array.isArray(n.children)&&n.children.some(child=>child?.type==='dt'&&child.children===messages.approvedChanges.reviewedBy));
      assert.ok(field);
      const identifier=nodes(field).find(n=>n.type?.name?.endsWith('MonitoringIdentifier.vue'));
      if(reviewer) {
        assert.equal(identifier.props.value,reviewer);
        assert.equal(identifier.props.labels.get(reviewer),reviewer===full?'staff:7f6e5d4c\u2026':reviewer);
        assert.equal(identifier.props['copy-label'],'Copy full staff ID');
        assert.equal(identifier.props['feedback-duration'],3000);
        assert.equal(h.state.selected.value.reviewedBy,reviewer);
      } else {
        assert.equal(identifier,undefined);assert.ok(nodes(field).some(n=>n.type==='span'&&n.children==='\u2014'));
      }
      assert.equal(h.calls.filter(call=>call.options?.method==='POST').length,0);
    } finally {h.stop()}
  }
});

test('linked species and observation Reviewed By identifiers both use their own authoritative reviewer values', async () => {
  const plantReviewer='staff:7f6e5d4c-1111-4111-8111-111111111111';
  const speciesReviewer='staff:9a8b7c6d-2222-4222-8222-222222222222';
  const row=fixture({reviewed_by:plantReviewer,species_request:requestFixture({reviewed_by:speciesReviewer})});
  const h=harness(url=>fixtureResponse(url,[row]));
  try {
    await h.state.open(h.state.mapObservation(row));await flush();
    const fields=nodes(reviewModal(h)).filter(n=>n.type?.name?.endsWith('MonitoringIdentifier.vue')&&n.props['copy-label']==='Copy full staff ID');
    assert.equal(fields.length,2);
    for(const [id,label] of [[plantReviewer,'staff:7f6e5d4c\u2026'],[speciesReviewer,'staff:9a8b7c6d\u2026']]) {
      const field=fields.find(n=>n.props.value===id);assert.ok(field);assert.equal(field.props.labels.get(id),label);
    }
  } finally {h.stop()}
});


test('association eligibility uses raw API metadata independently of missing historical fields and photos', async () => {
  const unavailable={state:'unavailable',fields:{},assets:[]};
  const cases=[
    {name:'approved valid',status:'Approved',requestStatus:'Approved',speciesId:14,approvedId:14,scientificName:'Current association name',resolved:true,state:'approved',allowed:false},
    {name:'approved missing current ID',status:'Approved',requestStatus:'Approved',speciesId:null,approvedId:14,scientificName:'Current association name',resolved:false,state:'incomplete',allowed:false},
    {name:'approved missing resulting ID',status:'Approved',requestStatus:'Approved',speciesId:14,approvedId:null,scientificName:'Current association name',resolved:false,state:'incomplete',allowed:false},
    {name:'pending valid',status:'Pending Review',requestStatus:'Approved',speciesId:14,approvedId:14,scientificName:'Current association name',resolved:true,state:'approved',allowed:true},
    {name:'pending species request',status:'Pending Review',requestStatus:'Pending Review',speciesId:14,approvedId:null,scientificName:'Current association name',resolved:false,state:'pending',allowed:false},
    {name:'rejected species request',status:'Pending Review',requestStatus:'Rejected',speciesId:14,approvedId:null,scientificName:'Current association name',resolved:false,state:'rejected',allowed:false},
    {name:'mismatched species ID',status:'Pending Review',requestStatus:'Approved',speciesId:14,approvedId:15,scientificName:'Current association name',resolved:false,state:'incomplete',allowed:false},
    {name:'blank scientific name',status:'Pending Review',requestStatus:'Approved',speciesId:14,approvedId:14,scientificName:'   ',resolved:false,state:'incomplete',allowed:false},
    {name:'missing scientific name',status:'Approved',requestStatus:'Approved',speciesId:14,approvedId:14,scientificName:undefined,resolved:false,state:'incomplete',allowed:false},
  ];
  for(const scenario of cases) {
    const row=fixture({plant_id:25,status:scenario.status,species_id:scenario.speciesId,scientific_name:scenario.scientificName,
      species_scientific_name:'Current catalogue must not replace missing association metadata',
      historical_review:unavailable,
      species_request:requestFixture({request_id:8,request_status:scenario.requestStatus,approved_species_id:scenario.approvedId,historical_review:unavailable})});
    const h=harness(url=>fixtureResponse(url,[row]));
    try {
      await h.state.loadObservations();await h.state.open(h.state.observations.value[0]);await flush();
      assert.equal(h.state.speciesResolved.value,scenario.resolved,scenario.name);
      assert.equal(h.state.speciesRequestState.value,scenario.state,scenario.name);
      assert.equal(h.state.canReviewPlant.value,scenario.allowed,scenario.name);
      const rendered=renderText(h),labels=messages.conservationPages.reviews.speciesRequest;
      assert.equal(rendered.includes(labels.requiredFirst),!scenario.resolved,scenario.name);
      if(scenario.resolved) assert.ok(rendered.includes(labels.states.verified),scenario.name);
      if(scenario.state==='incomplete') assert.ok(rendered.includes(labels.states.incomplete),scenario.name);
      if(scenario.requestStatus==='Approved') {
        assert.equal(h.state.selectedSpeciesRequest.value.scientificName,'');
        assert.equal(h.state.selectedSpeciesRequest.value.commonName,'');
        assert.equal(h.state.selectedSpeciesRequest.value.assets.length,0);
        assert.ok(rendered.includes(messages.approvedChanges.historicalSpeciesUnavailable));
        assert.ok(rendered.includes(messages.approvedChanges.historicalPhotosUnavailable));
      }
      if(scenario.status==='Approved') {
        assert.equal(h.state.selected.value.speciesId,'');assert.equal(h.state.selected.value.scientificName,'');
        assert.equal(h.state.selected.value.assets.length,0);assert.equal(h.state.selected.value.status,'Approved');
        assert.ok(!rendered.includes('Current association name'));
        for(const decision of ['Approved','Rejected','Correction Required','Flagged']) {
          assert.equal(h.state.canDecide(decision),false);await h.state.decide(decision);
        }
        if(scenario.resolved) assert.ok(rendered.includes(labels.notices.approvedReadOnly));
      }
      if(scenario.allowed) {
        h.state.needsReload.value=true;assert.equal(h.state.canReviewPlant.value,false);
        h.state.needsReload.value=false;h.state.conflictAcknowledged.value=false;assert.equal(h.state.canReviewPlant.value,false);
      }
      assert.equal(h.calls.filter(call=>call.options?.method==='POST').length,0,scenario.name);
    } finally {h.stop()}
  }
});

test('verified historical values cannot supply a missing authoritative association or override a valid current association',async()=>{
  for(const rawName of [undefined,'Authoritative current name']) {
    const row=fixture({status:'Approved',species_id:14,scientific_name:rawName,
      historical_review:{state:'available',fields:{species_id:99,scientific_name:'Verified historical name',content:{}},assets:[]},
      species_request:requestFixture({request_status:'Approved',approved_species_id:14})});
    const h=harness(url=>fixtureResponse(url,[row]));
    try {
      await h.state.open(h.state.mapObservation(row));await flush();
      assert.equal(h.state.selected.value.speciesId,'99');assert.equal(h.state.selected.value.scientificName,'Verified historical name');
      assert.equal(h.state.speciesResolved.value,Boolean(rawName));
      assert.equal(h.state.canReviewPlant.value,false);
      assert.ok(!renderText(h).includes('Authoritative current name'));
    }finally{h.stop()}
  }
});

test('verified linked-species status and approved read-only notice are localized in every supported language',async()=>{
  for(const language of ['en','ms','zh-CN']) {
    const labels=JSON.parse(readFileSync(new URL('../src/locales/'+language+'.json',import.meta.url),'utf8'));
    const row=fixture({status:'Approved',species_request:requestFixture({request_status:'Approved',approved_species_id:8})});
    const h=harness(url=>fixtureResponse(url,[row]),{},language);
    try {
      await h.state.open(h.state.mapObservation(row));await flush();
      assert.ok(renderText(h).includes(labels.conservationPages.reviews.speciesRequest.states.verified));
      assert.ok(renderText(h).includes(labels.conservationPages.reviews.speciesRequest.notices.approvedReadOnly));
      assert.ok(!renderText(h).includes(labels.conservationPages.reviews.speciesRequest.requiredFirst));
      assert.equal(h.state.canReviewPlant.value,false);
    }finally{h.stop()}
  }
});


test('fresh registration and unchanged reload preserve current evidence and drafts without a conflict', async () => {
  let current = fixture({ revision: 1, species_request: requestFixture(), submission_update: { state: 'unavailable', changes: [] } })
  const h = harness(url => fixtureResponse(url, [current]))
  try {
    await h.state.loadObservations(); await h.state.open(h.state.observations.value[0]); await flush()
    assert.equal(h.state.selected.value.revision, 1)
    assert.equal(h.state.selected.value.morphology, 'Submitted morphology')
    assert.equal(h.state.conflictAcknowledged.value, true)
    assert.equal(h.state.canDecide('Approved'), false) // species pending
    const summary = nodes(h.render()).find(n => n.props?.['initial-submission'] === true)
    assert.ok(summary)
    assert.equal(nodes(h.render()).filter(n => n.type === 'img').length, 2)
    h.state.comment.value = 'Draft plant comment'
    h.state.speciesReviewComment.value = 'Draft species comment'
    h.state.speciesVisibility.value = 'internal'
    current = { ...current, updated_at: '2026-10-02T18:00:00+08:00',
      assets: [...current.assets].reverse(), content: Object.fromEntries(Object.entries(current.content).reverse()) }
    await h.state.reloadSelected()
    assert.equal(h.state.conflictAcknowledged.value, true)
    assert.equal(h.state.needsReload.value, false)
    assert.equal(h.state.speciesInspectionRequired.value, false)
    assert.equal(h.state.comment.value, 'Draft plant comment')
    assert.equal(h.state.speciesReviewComment.value, 'Draft species comment')
    assert.equal(h.state.speciesVisibility.value, 'internal')
    assert.match(renderText(h), /Submission is up to date/)
    assert.doesNotMatch(renderText(h), /This submission changed or was reviewed/)
    assert.equal(h.calls.filter(c => c.options.method === 'POST').length, 0)
  } finally { h.stop() }
})

for (const [name, change] of [
  ['revision increase', row => ({ ...row, revision: 2 })],
  ['same-revision content change', row => ({ ...row, content: { ...row.content, heightCm: 99 } })],
  ['another Officer approval', row => ({ ...row, status: 'Approved' })],
  ['another Officer rejection', row => ({ ...row, status: 'Rejected' })],
]) test(`manual reload detects ${name} and requires inspection without retrying`, async () => {
  let current = fixture({ revision: 1 })
  const h = harness(url => fixtureResponse(url, [current]))
  try {
    await h.state.loadObservations(); await h.state.open(h.state.observations.value[0]); await flush()
    h.state.comment.value = 'Keep draft'
    current = change(current)
    await h.state.reloadSelected()
    assert.equal(h.state.conflictAcknowledged.value, false)
    assert.equal(h.state.comment.value, 'Keep draft')
    assert.equal(h.state.canDecide('Approved'), false)
    assert.match(renderText(h), /This submission changed or was reviewed/)
    h.state.conflictAcknowledged.value = true
    assert.equal(h.state.canDecide('Approved'), current.status === 'Pending Review')
    assert.equal(h.calls.filter(c => c.options.method === 'POST').length, 0)
  } finally { h.stop() }
})

for (const patch of [{ content_revision: 2 }, { review_cycle: 2 }, { request_status: 'Approved', approved_species_id: 8 }]) {
  test(`linked request reload requires fresh inspection for ${Object.keys(patch)[0]}`, async () => {
    let current = fixture({ revision: 1, species_request: requestFixture() })
    const h = harness(url => fixtureResponse(url, [current]))
    try {
      await h.state.loadObservations(); await h.state.open(h.state.observations.value[0]); await flush()
      h.state.speciesReviewComment.value = 'Preserved species draft'
      h.state.speciesVisibility.value = 'public'
      current = { ...current, species_request: { ...current.species_request, ...patch } }
      await h.state.reloadSelected()
      assert.equal(h.state.selected.value.revision, 1)
      assert.equal(h.state.conflictAcknowledged.value, false)
      assert.equal(h.state.speciesInspectionRequired.value, true)
      assert.equal(h.state.speciesVisibility.value, '')
      assert.equal(h.state.speciesReviewComment.value, 'Preserved species draft')
      assert.equal(h.state.canDecide('Approved'), false)
      h.state.conflictAcknowledged.value = true
      assert.equal(h.state.canDecide('Approved'), patch.request_status === 'Approved')
    } finally { h.stop() }
  })
}

for (const revision of [null, undefined, '1', 0, 1.5]) test(`invalid reload revision ${String(revision)} fails closed`, async () => {
  let current = fixture({ revision: 1 })
  const h = harness(url => fixtureResponse(url, [current]))
  try {
    await h.state.loadObservations(); await h.state.open(h.state.observations.value[0]); await flush()
    h.state.comment.value = 'Keep draft'
    current = { ...current, revision }
    await h.state.reloadSelected()
    assert.equal(h.state.needsReload.value, true)
    assert.equal(h.state.canDecide('Approved'), false)
    assert.equal(h.state.comment.value, 'Keep draft')
    assert.match(renderText(h), /latest submission could not be verified/)
    assert.doesNotMatch(renderText(h), /This submission changed or was reviewed/)
    assert.equal(h.calls.filter(c => c.options.method === 'POST').length, 0)
  } finally { h.stop() }
})

test('unchanged approved observation stays read-only after manual reload', async () => {
  const current = fixture({ status: 'Approved', revision: 1 })
  const h = harness(url => fixtureResponse(url, [current]))
  try {
    await h.state.loadObservations(); await h.state.open(h.state.observations.value[0]); await flush()
    await h.state.reloadSelected()
    assert.equal(h.state.conflictAcknowledged.value, true)
    assert.equal(h.state.canDecide('Approved'), false)
    assert.equal(h.state.canDecide('Rejected'), false)
  } finally { h.stop() }
})


test('unchanged manual reload cannot clear inspection required by a real HTTP 409', async () => {
  const current = fixture({ revision: 1 })
  const h = harness((url, options) => options.method === 'POST'
    ? Response.json({ error: 'Review cycle changed' }, { status: 409 })
    : fixtureResponse(url, [current]))
  try {
    await h.state.loadObservations(); await h.state.open(h.state.observations.value[0]); await flush()
    h.state.comment.value = 'Preserve actual conflict draft'
    await h.state.decide('Rejected')
    assert.equal(h.state.conflictAcknowledged.value, false)
    await h.state.reloadSelected()
    assert.equal(h.state.conflictAcknowledged.value, false)
    assert.equal(h.state.canDecide('Rejected'), false)
    assert.equal(h.state.comment.value, 'Preserve actual conflict draft')
    assert.equal(h.calls.filter(c => c.options.method === 'POST').length, 1)
    h.state.conflictAcknowledged.value = true
    assert.equal(h.state.canDecide('Rejected'), true)
  } finally { h.stop() }
})


test('submission header refresh and neutral feedback preserve the separate species control and lock guidance', async () => {
  const row = fixture({ revision: 1, species_request: requestFixture() })
  const h = harness(url => fixtureResponse(url, [row]))
  try {
    await h.state.loadObservations(); await h.state.open(h.state.observations.value[0]); await flush()
    const header = () => nodes(reviewModal(h).children.title())
    const refresh = header().find(n => n.type === 'button')
    assert.equal(refresh.props['aria-label'], messages.submissionChanges.reload)
    assert.equal(refresh.props['aria-describedby'], 'submission-refresh-tooltip')
    const tooltip = header().find(n => n.props?.id === 'submission-refresh-tooltip')
    assert.equal(tooltip.props.role, 'tooltip')
    assert.equal(tooltip.children, messages.submissionChanges.reload)
    assert.equal(refresh.props.disabled, false)
    const speciesRefresh = () => nodes(reviewModal(h)).find(n => n.props?.class === 'species-refresh-button')
    const originalSpeciesHandler = speciesRefresh().props.onClick
    assert.equal(speciesRefresh().props['aria-label'], 'Refresh submission and species resolution')
    assert.equal(speciesRefresh().props['aria-describedby'], 'species-refresh-help')
    const summary = nodes(reviewModal(h)).find(n => n.props?.['hide-reload'] !== undefined)
    assert.ok(summary)
    assert.doesNotMatch(renderText(h), /This submission proposes a new species/)
    const guide = nodes(reviewModal(h)).find(n => n.props?.id === 'plant-species-gate')
    assert.equal(guide.props.class, 'species-gate-notice')
    assert.equal(guide.props.role, 'status')
    assert.ok(nodes(guide).some(n => n.type === 'svg' && n.props.class === 'species-gate-info-icon'))
    assert.equal(h.state.canDecide('Approved'), false)
    h.state.comment.value = 'Keep my draft'
    await refresh.props.onClick()
    assert.equal(h.state.reviewMessage.value.variant, 'info')
    assert.equal(h.state.feedback.value.variant, 'info')
    assert.equal(h.state.comment.value, 'Keep my draft')
    const info = nodes(reviewModal(h)).find(n => n.type === 'p' && nodes(n).some(child => child.children === messages.submissionChanges.upToDate))
    assert.ok(info.props.class.includes('info'))
    assert.ok(!info.props.class.includes('error'))
    assert.equal(info.props.role, 'status')
    assert.equal(speciesRefresh().props.onClick, originalSpeciesHandler)
    h.state.isSaving.value = true
    assert.equal(header().find(n => n.type === 'button').props.disabled, true)
  } finally { h.stop() }
})

test('changed reloads and failed reads retain danger feedback styling', async () => {
  let row = fixture({ revision: 1 }), fail = false
  const h = harness(url => fail ? Response.json({ error: 'Unavailable' }, { status: 503 }) : fixtureResponse(url, [row]))
  try {
    await h.state.loadObservations(); await h.state.open(h.state.observations.value[0]); await flush()
    row = { ...row, revision: 2 }
    await h.state.reloadSelected()
    assert.equal(h.state.reviewMessage.value.variant, 'error')
    assert.equal(h.state.feedback.value.variant, 'error')
    assert.ok(nodes(reviewModal(h)).some(n => n.props?.role === 'alert' && n.props?.class === 'review-feedback error'))
    fail = true
    await h.state.reloadSelected()
    assert.equal(h.state.feedback.value.variant, 'error')
    assert.equal(h.state.needsReload.value, true)
    assert.equal(h.state.canDecide('Approved'), false)
  } finally { h.stop() }
})


test('Submission Type replaces the view selector and is localized without changing provenance', async () => {
  for (const language of ['en', 'ms', 'zh-CN']) {
    const messages = JSON.parse(readFileSync(new URL(`../src/locales/${language}.json`, import.meta.url), 'utf8'))
    const rows = [fixture(), fixture({ id: secondId, origin_type: 'unknown' })]
    const h = harness(url => fixtureResponse(url, rows), {}, language)
    try {
      await h.state.loadObservations()
      const field = reviewFilterFields(h)[0]
      assert.equal(nodes(field).find(n => n.type === 'span').children, messages.approvedChanges.submissionType)
      const select = nodes(field).find(n => n.type?.name?.endsWith('ReviewFilterDropdown.vue'))
      const options = Array.from(select.props.options, option => ({ props: { value: option.value }, children: option.label }))
      assert.deepEqual(options.map(n => n.props.value), ['', 'initial_registration', 'linked_species_request', 'approved_plant_change', 'approved_species_change'])
      assert.deepEqual(options.map(n => n.children), [messages.approvedChanges.allTypes, messages.approvedChanges.originalRegistration, messages.conservationPages.reviews.speciesRequest.title, messages.approvedChanges.plantEdit, messages.approvedChanges.speciesEdit])
      assert.equal(h.state.submissionType.value, '')
      assert.equal(h.state.allReviewRows.value.length, 1)
      select.props['onUpdate:modelValue']('initial_registration')
      assert.equal(h.state.allReviewRows.value.length, 1)
      const clear = nodes(h.render()).find(n => n.type === 'button' && n.props.class === 'secondary-button clear-review-filters')
      assert.equal(nodes(clear).find(n => n.type === 'span').children, messages.common.clearFilters)
      assert.ok(nodes(clear).some(n => n.type === 'svg' && n.props['aria-hidden'] === 'true'))
      clear.props.onClick()
      assert.equal(h.state.allReviewRows.value.length, 1)
      h.state.queueOrigin.value = 'unknown'
      assert.ok(renderText(h).includes(messages.conservationPages.reviews.queues.unverifiedOriginSubmissions))
      assert.ok(h.calls.every(c => !c.options.method || c.options.method === 'GET'))
    } finally { h.stop() }
  }
})


function mixedSearchHarness(language = 'en') {
  const registration = fixture({ plant_id: 24, status: 'Approved', species_request: requestFixture({ request_status: 'Approved', approved_species_id: 8 }),
    historical_review: { state: 'available', fields: { species_id: 8, scientific_name: 'Historical species', plant_scientific_name: 'Original plant name', content: { zone: 'Original zone', morphology: 'Original morphology' } }, assets: [] } })
  const original = fixture({ id: secondId, plant_id: 25 })
  const unverified = fixture({ id: '777', plant_id: 26, origin_type: 'unknown' })
  const unrelated = fixture({ id: '24ffffff-1234-1234-1234-123456789abc', plant_id: 124, content: { zone: 'Zone 24' } })
  const plant = changeFixture({ id: '089df70e-1234-1234-1234-123456789abc' })
  const speciesEdit = changeFixture({ id: '22345678-1234-1234-1234-123456789abc', plant_id: null, species_id: 6, owner_subject: 'staff:species-editor', proposed_snapshot: { scientific_name: 'Edited species name' } })
  const rows = [registration, original, unverified, unrelated]
  const h = harness(url => fixtureResponse(url, rows), {}, language, undefined, null, { recordChangesHandler: () => changesResponse([plant, speciesEdit]) })
  return { h, registration, original, unverified, plant, speciesEdit }
}

test('PL024, pl024 and exact numeric plant search retain original registration and its separate edit', async () => {
  const { h, registration, plant } = mixedSearchHarness()
  try {
    await h.state.loadObservations()
    for (const query of ['PL024', 'pl024', '  PL024  ', '24']) {
      h.state.search.value = query
      assert.deepEqual(new Set(h.state.allReviewRows.value.map(row => row.key)), new Set(['observation:' + registration.id, 'change:' + plant.id]))
    }
    assert.equal(h.state.observations.value.find(row => row.id === registration.id).status, 'Approved')
    assert.equal(h.state.observations.value.find(row => row.id === registration.id).morphology, 'Original morphology')
    assert.equal(h.state.changeProposals.value.find(row => row.id === plant.id).status, 'Pending Review')
    h.state.search.value = 'CHANGE-089DF70E'
    assert.deepEqual(Array.from(h.state.allReviewRows.value, row => row.key), ['change:' + plant.id])
    h.state.search.value = plant.id
    assert.equal(h.state.allReviewRows.value.length, 1)
    h.state.search.value = h.state.observationLabel(registration.id)
    assert.deepEqual(Array.from(h.state.allReviewRows.value, row => row.key), ['observation:' + registration.id])
  } finally { h.stop() }
})

test('mixed searches cover names, both submitter representations, types, zones, status and whitespace', async () => {
  const { h, plant, speciesEdit, registration } = mixedSearchHarness()
  try {
    await h.state.loadObservations()
    for (const [query, key] of [
      ['  Proposed   plant name ', 'change:' + plant.id],
      ['Edited species name', 'change:' + speciesEdit.id],
      [plant.owner_subject, 'change:' + plant.id],
      [h.state.submitterLabel(plant.owner_subject), 'change:' + plant.id],
      ['Plant Edit', 'change:' + plant.id],
      ['Species Edit', 'change:' + speciesEdit.id],
      ['Proposed zone', 'change:' + plant.id],
      ['Original zone', 'observation:' + registration.id],
      ['Approved', 'observation:' + registration.id],
    ]) {
      h.state.search.value = query
      assert.ok(h.state.allReviewRows.value.some(row => row.key === key), query)
    }
    h.state.search.value = 'no matching submission'
    assert.equal(h.state.allReviewRows.value.length, 0)
  } finally { h.stop() }
})

test('all four normalized types and their combined filters operate on distinct rows without duplicating linked requests', async () => {
  const { h, registration, original, plant, speciesEdit } = mixedSearchHarness()
  try {
    await h.state.loadObservations()
    assert.equal(h.state.allReviewRows.value.length, 5)
    for (const [kind, key] of [
      ['initial_registration', 'observation:' + original.id],
      ['linked_species_request', 'observation:' + registration.id],
      ['approved_plant_change', 'change:' + plant.id],
      ['approved_species_change', 'change:' + speciesEdit.id],
    ]) {
      h.state.submissionType.value = kind
      assert.ok(h.state.allReviewRows.value.some(row => row.key === key))
      assert.ok(h.state.allReviewRows.value.every(row => row.kind === kind))
    }
    h.state.submissionType.value = 'approved_plant_change'; h.state.search.value = 'pl024'
    assert.equal(h.state.allReviewRows.value.length, 1)
    h.state.status.value = 'Approved'; assert.equal(h.state.allReviewRows.value.length, 0)
    h.state.status.value = 'Pending Review'; h.state.species.value = '8'; h.state.date.value = h.state.dateKey(plant.created_at)
    assert.deepEqual(Array.from(h.state.allReviewRows.value, row => row.key), ['change:' + plant.id])
    h.state.species.value = '6'; assert.equal(h.state.allReviewRows.value.length, 0)
    h.state.search.value = ''; h.state.submissionType.value = 'approved_species_change'; h.state.date.value = h.state.dateKey(speciesEdit.created_at)
    assert.deepEqual(Array.from(h.state.allReviewRows.value, row => row.key), ['change:' + speciesEdit.id])
    h.state.clearFilters()
    assert.equal(h.state.allReviewRows.value.length, 5)
    assert.equal(h.state.allReviewRows.value.filter(row => row.key === 'observation:' + registration.id).length, 1)
    assert.ok(!h.state.allReviewRows.value.some(row => row.kind === 'legacy_observation'))
  } finally { h.stop() }
})

test('Clear Filters preserves the open modal and drafts, and notification proposals remain pinned across type filters', async () => {
  const { h, original, speciesEdit } = mixedSearchHarness()
  try {
    await h.state.loadObservations(); await h.state.open(h.state.observations.value.find(row => row.id === original.id)); await flush()
    h.state.comment.value = 'Keep plant draft'; h.state.speciesReviewComment.value = 'Keep species draft'
    h.state.search.value = 'pl024'; h.state.submissionType.value = 'approved_plant_change'; h.state.status.value = 'Approved'; h.state.species.value = '99'; h.state.date.value = '2000-01-01'
    const requests = h.calls.length
    h.state.clearFilters()
    assert.equal(h.calls.length, requests)
    for (const name of ['search', 'submissionType', 'status', 'species', 'date']) assert.equal(h.state[name].value, '')
    assert.equal(h.state.selected.value.id, original.id)
    assert.equal(h.state.comment.value, 'Keep plant draft')
    assert.equal(h.state.speciesReviewComment.value, 'Keep species draft')
    assert.equal(h.state.allReviewRows.value.length, 5)
    h.state.submissionType.value = 'approved_plant_change'; h.state.search.value = 'no match'; h.route.query = { change: speciesEdit.id }; await flush()
    assert.equal(h.state.reviewRows.value[0].key, 'change:' + speciesEdit.id)
    assert.equal(h.state.reviewRows.value.length, 1)
  } finally { h.stop() }
})

test('unverified submissions remain discoverable with the existing modal provenance protections', async () => {
  const { h, unverified } = mixedSearchHarness()
  try {
    await h.state.loadObservations()
    const row = h.state.observations.value.find(row => row.id === unverified.id)
    assert.equal(row.origin, 'unknown')
    await h.state.open(row); await flush()
    assert.equal(h.state.queueOrigin.value, 'unknown')
    assert.equal(h.state.selected.value.origin, 'unknown')
    assert.match(renderText(h), /Origin not verified/)
    assert.equal(h.state.allReviewRows.value.length, 3)
    assert.equal(h.state.canReviewPlant.value,false)
    assert.ok(!h.calls.some(call => call.options.method === 'POST'))
  } finally { h.stop() }
})


function submitterClock() {
 let now=0,id=0;const timers=new Map()
 return {timers,window:{setTimeout(fn,ms){const key=++id;timers.set(key,{fn,due:now+ms});return key},clearTimeout(key){timers.delete(key)}},advance(ms){now+=ms;for(const [key,timer] of timers)if(timer.due<=now){timers.delete(key);timer.fn()}}}
}
const submittedByButtons=h=>nodes(reviewTable(h)).filter(n=>n.type==='button'&&n.props?.['data-submitter-copy'])
const checkedSubmitterRows=h=>submittedByButtons(h).filter(b=>nodes(b).some(n=>n.type==='path'&&n.props?.d==='m5 12 4 4 10-10')).map(b=>b.props['data-submitter-copy'])

test('Submitted By rows with shared names/identifiers and cross-type overlapping IDs have independent timers',async()=>{
 const clock=submitterClock(),copied=[]
 const rows=[fixture({owner_subject:'staff:shared'}),fixture({id:secondId,owner_subject:'staff:shared'})]
 const change=changeFixture({id:firstId,owner_subject:'staff:shared'})
 const h=harness(url=>fixtureResponse(url,rows),{},'en',undefined,null,{window:clock.window,clipboard:{writeText:async v=>copied.push(v)},recordChangesHandler:()=>changesResponse([change])})
 try{
  await h.state.loadObservations();h.state.submitterNames.value={shared:'Botanist KEE'}
  const button=key=>submittedByButtons(h).find(b=>b.props['data-submitter-copy']===key)
  h.state.reviewMessage.value={variant:'info',message:'Existing conflict notice'}
  await button('observation:'+firstId).props.onClick()
  assert.deepEqual(checkedSubmitterRows(h),['observation:'+firstId])
  assert.equal(h.state.copyFeedback.value,'');assert.equal(h.state.reviewMessage.value.message,'Existing conflict notice')
  assert.equal(h.state.submitterLabel('staff:shared'),'Botanist KEE')
  clock.advance(1000);await button('observation:'+secondId).props.onClick();await button('change:'+firstId).props.onClick()
  assert.equal(checkedSubmitterRows(h).length,3)
  clock.advance(1000);assert.equal(checkedSubmitterRows(h).length,2);assert.ok(!checkedSubmitterRows(h).includes('observation:'+firstId))
  clock.advance(1000);assert.deepEqual(checkedSubmitterRows(h),[])
  assert.deepEqual(copied,['staff:shared','staff:shared','staff:shared'])
 }finally{h.stop()}
 assert.equal(clock.timers.size,0)
})

test('Submitted By repeated successful copy restarts duration and ignores an old timer callback',async()=>{
 const clock=submitterClock(),h=harness(url=>fixtureResponse(url,[fixture()]),{},'en',undefined,null,{window:clock.window,clipboard:{writeText:async()=>{}}})
 try{
  await h.state.loadObservations();await submittedByButtons(h)[0].props.onClick()
  const old=[...clock.timers.values()][0].fn
  clock.advance(1500);await submittedByButtons(h)[0].props.onClick();assert.equal(clock.timers.size,1)
  old();assert.equal(checkedSubmitterRows(h).length,1)
  clock.advance(500);assert.equal(checkedSubmitterRows(h).length,1)
  clock.advance(1500);assert.deepEqual(checkedSubmitterRows(h),[])
 }finally{h.stop()}
})

test('Submitted By failure, filters, refreshed/reused identities and unmount clear stale confirmation',async()=>{
 const clock=submitterClock();let fail=false
 const h=harness(url=>fixtureResponse(url,[fixture()]),{},'en',undefined,null,{window:clock.window,clipboard:{writeText:async()=>{if(fail)throw Error('blocked')}}})
 try{
  await h.state.loadObservations();fail=true;await submittedByButtons(h)[0].props.onClick()
  assert.deepEqual(checkedSubmitterRows(h),[]);assert.equal(h.state.copyFailed.value,true)
  fail=false;await submittedByButtons(h)[0].props.onClick();assert.equal(h.state.copyFeedback.value,'')
  h.state.search.value='unmatched';await flush();assert.equal(clock.timers.size,0)
  h.state.search.value='';await flush();assert.deepEqual(checkedSubmitterRows(h),[])
  await submittedByButtons(h)[0].props.onClick()
  h.state.observations.value=h.state.observations.value.map(row=>({...row}));await flush()
  assert.deepEqual(checkedSubmitterRows(h),[])
  await submittedByButtons(h)[0].props.onClick()
  h.state.observations.value[0].recordedBy='staff:different';await flush();assert.deepEqual(checkedSubmitterRows(h),[])
  await submittedByButtons(h)[0].props.onClick();assert.equal(clock.timers.size,1)
 }finally{h.stop()}
 assert.equal(clock.timers.size,0)
})

test('Submitted By late clipboard completion cannot restore confirmation after row removal or logout',async()=>{
 for(const logout of [false,true]){
  const pending=deferred(),clock=submitterClock(),h=harness(url=>fixtureResponse(url,[fixture()]),{},'en',undefined,null,{window:clock.window,clipboard:{writeText:()=>pending.promise}})
  try{
   await h.state.loadObservations();const copying=submittedByButtons(h)[0].props.onClick()
   if(logout)h.emitSession(null);else h.state.observations.value=[]
   await flush();pending.resolve();await copying
   assert.equal(Object.keys(h.state.submitterCopied.value).length,0);assert.equal(clock.timers.size,0);assert.equal(h.state.copyFeedback.value,'')
  }finally{h.stop()}
 }
})


test('Submitted By sort changes keep success attached to its row and refresh resets it',async()=>{
 const clock=submitterClock(),rows=[fixture(),fixture({id:secondId,created_at:'2026-09-01T01:00:00Z'})]
 const h=harness(url=>fixtureResponse(url,rows),{},'en',undefined,null,{window:clock.window,clipboard:{writeText:async()=>{}}})
 try{
  await h.state.loadObservations();await submittedByButtons(h)[0].props.onClick()
  h.state.observations.value[1].createdAt='2026-12-01T01:00:00Z';await flush()
  assert.equal(submittedByButtons(h)[0].props['data-submitter-copy'],'observation:'+secondId)
  assert.deepEqual(checkedSubmitterRows(h),['observation:'+firstId])
  await h.state.loadObservations();assert.deepEqual(checkedSubmitterRows(h),[]);assert.equal(clock.timers.size,0)
 }finally{h.stop()}
})


test('Submitted By equal display names with distinct staff identities copy each original value',async()=>{
 const copied=[],clock=submitterClock()
 const h=harness(url=>fixtureResponse(url,[fixture({owner_subject:'staff:one'}),fixture({id:secondId,owner_subject:'staff:two'})]),{},'en',undefined,null,{window:clock.window,clipboard:{writeText:async value=>copied.push(value)}})
 try{
  await h.state.loadObservations();h.state.submitterNames.value={one:'stanton',two:'stanton'}
  assert.equal(h.state.submitterLabel('staff:one'),h.state.submitterLabel('staff:two'))
  await submittedByButtons(h).find(b=>b.props['data-submitter-copy']==='observation:'+firstId).props.onClick()
  assert.deepEqual(checkedSubmitterRows(h),['observation:'+firstId])
  await submittedByButtons(h).find(b=>b.props['data-submitter-copy']==='observation:'+secondId).props.onClick()
  assert.deepEqual(copied,['staff:one','staff:two']);assert.equal(checkedSubmitterRows(h).length,2)
 }finally{h.stop()}
})


const submitterToasts=h=>nodes(h.render()).filter(n=>n.type==='span'&&n.props?.class==='submitter-copy-toast')

test('Submitted By success shows one compact Copied toast only after clipboard completion and expires at two seconds',async()=>{
 const clock=submitterClock(),pending=deferred(),copied=[]
 const h=harness(url=>fixtureResponse(url,[fixture()]),{},'en',undefined,null,{window:clock.window,clipboard:{writeText:value=>{copied.push(value);return pending.promise}}})
 try{
  await h.state.loadObservations();assert.equal(submitterToasts(h).length,0)
  const copying=submittedByButtons(h)[0].props.onClick();assert.equal(submitterToasts(h).length,0)
  pending.resolve();await copying
  assert.deepEqual(copied,[fixture().owner_subject]);assert.equal(submitterToasts(h).length,1)
  const toast=submitterToasts(h)[0]
  assert.equal(nodes(toast).find(n=>n.type==='span'&&typeof n.children==='string').children,'Copied')
  assert.equal(toast.props['aria-hidden'],'true');assert.ok(nodes(toast).some(n=>n.type==='svg'))
  const live=nodes(h.render()).find(n=>n.props?.class==='submitter-copy-status')
  assert.equal(live.props.role,'status');assert.equal(live.props['aria-live'],'polite');assert.equal(live.props['aria-atomic'],'true')
  assert.equal(h.state.copyFeedback.value,'')
  clock.advance(1999);assert.equal(submitterToasts(h).length,1)
  clock.advance(1);assert.equal(submitterToasts(h).length,0);assert.deepEqual(checkedSubmitterRows(h),[])
 }finally{h.stop()}
})

test('Submitted By latest successful row refreshes one toast; an older row timer cannot dismiss it',async()=>{
 const clock=submitterClock()
 const h=harness(url=>fixtureResponse(url,[fixture(),fixture({id:secondId})]),{},'en',undefined,null,{window:clock.window,clipboard:{writeText:async()=>{}}})
 try{
  await h.state.loadObservations()
  await submittedByButtons(h).find(b=>b.props['data-submitter-copy']==='observation:'+firstId).props.onClick()
  clock.advance(1000)
  await submittedByButtons(h).find(b=>b.props['data-submitter-copy']==='observation:'+secondId).props.onClick()
  assert.equal(submitterToasts(h).length,1)
  clock.advance(1000);assert.equal(submitterToasts(h).length,1)
  assert.equal(h.state.copiedToastRow.value,'observation:'+secondId)
  clock.advance(1000);assert.equal(submitterToasts(h).length,0)
 }finally{h.stop()}
})

test('Submitted By failed clipboard and navigation leave no success toast, and cleanup removes timers',async()=>{
 const clock=submitterClock();let fail=false
 const h=harness(url=>fixtureResponse(url,[fixture()]),{},'en',undefined,null,{window:clock.window,clipboard:{writeText:async()=>{if(fail)throw Error('denied')}}})
 try{
  await h.state.loadObservations();await submittedByButtons(h)[0].props.onClick()
  fail=true;await submittedByButtons(h)[0].props.onClick()
  assert.equal(submitterToasts(h).length,0);assert.deepEqual(checkedSubmitterRows(h),[]);assert.equal(h.state.copyFailed.value,true)
  fail=false;await submittedByButtons(h)[0].props.onClick()
  h.route.query={review:firstId};await flush()
  assert.equal(submitterToasts(h).length,0);assert.equal(clock.timers.size,0)
  await submittedByButtons(h)[0].props.onClick();assert.equal(submitterToasts(h).length,1)
 }finally{h.stop()}
 assert.equal(clock.timers.size,0)
})

test('Submitted By toast has exact brand colors, icon anchoring, no pointer interception or motion, and localized text',async()=>{
 const source=descriptor.styles[0].content
 assert.match(source,/background: #DCF3E4; color: #245A46/)
 assert.match(source,/\.submitter-copy-anchor \{ position: relative;/)
 assert.match(source,/bottom: calc\(100% \+ 8px\); left: 50%; transform: translateX\(-50%\)/)
 assert.match(source,/z-index: 200; pointer-events: none/)
 assert.doesNotMatch(source.match(/\.submitter-copy-toast \{[^}]*\}/)[0],/animation|transition/)
 for(const [language,label] of [['en','Copied'],['ms','Disalin'],['zh-CN','\u5df2\u590d\u5236']]){
  const clock=submitterClock(),h=harness(url=>fixtureResponse(url,[fixture()]),{},language,undefined,null,{window:clock.window,clipboard:{writeText:async()=>{}}})
  try{await h.state.loadObservations();await submittedByButtons(h)[0].props.onClick();assert.equal(nodes(submitterToasts(h)[0]).find(n=>n.type==='span'&&typeof n.children==='string').children,label)}finally{h.stop()}
 }
})


test('Submitted By Copied toast renders directly above the clicked icon in its own anchor',async()=>{
 const clock=submitterClock(),h=harness(url=>fixtureResponse(url,[fixture(),fixture({id:secondId})]),{},'en',undefined,null,{window:clock.window,clipboard:{writeText:async()=>{}}})
 try{
  await h.state.loadObservations()
  await submittedByButtons(h).find(b=>b.props['data-submitter-copy']==='observation:'+secondId).props.onClick()
  const anchors=nodes(reviewTable(h)).filter(n=>n.props?.class==='submitter-copy-anchor')
  assert.equal(anchors.length,2)
  const withToast=anchors.filter(n=>nodes(n).some(child=>child.props?.class==='submitter-copy-toast'))
  assert.equal(withToast.length,1)
  assert.equal(nodes(withToast[0]).find(n=>n.type==='button').props['data-submitter-copy'],'observation:'+secondId)
 }finally{h.stop()}
})


test('Review submission ID, proposal ID and QR copy icons share the anchored two-second flow',async()=>{
 const clock=submitterClock(),copied=[]
 const change=changeFixture({id:firstId})
 const h=harness(url=>fixtureResponse(url,[fixture()]),{},'en',undefined,null,{window:clock.window,clipboard:{writeText:async value=>copied.push(value)},recordChangesHandler:()=>changesResponse([change])})
 const toasts=()=>nodes(h.render()).filter(n=>n.props?.class==='officer-copy-toast')
 try{
  await h.state.loadObservations()
  const ids=reviewCopyButtons(h).filter(b=>!b.props['data-submitter-copy'])
  assert.equal(ids.length,2)
  await ids[0].props.onClick();assert.equal(toasts().length,1)
  await ids[1].props.onClick();assert.deepEqual(copied,[firstId,firstId]);assert.equal(toasts().length,1)
  assert.equal(Object.keys(h.state.controlCopied.value).length,2);assert.equal(h.state.copyFeedback.value,'')
  clock.advance(2000);assert.equal(toasts().length,0);assert.equal(Object.keys(h.state.controlCopied.value).length,0)
  await h.state.open(h.state.observations.value[0]);await flush()
  h.state.plantQr.value={identity:'QR-exact-original'};h.state.qrLoading.value=false;h.state.qrError.value=''
  await h.state.copyQrIdentity();assert.equal(copied.at(-1),'QR-exact-original');assert.equal(toasts().length,1);assert.equal(h.state.qrCopyFeedback.value,'')
  assert.ok(nodes(h.render()).some(n=>n.props?.class==='officer-copy-anchor'&&nodes(n).some(c=>c.props?.class==='officer-copy-toast')))
  clock.advance(2000);assert.equal(toasts().length,0)
 }finally{h.stop()}
 assert.equal(clock.timers.size,0)
})


test('temporary verification failure preserves Officer review drafts while blocking decisions; confirmed logout clears them', async () => {
  const h=harness(url=>fixtureResponse(url,[fixture()]))
  try {
    await h.state.loadObservations();await h.state.open(h.state.observations.value[0])
    h.state.comment.value='Keep my unsaved review';h.state.speciesReviewComment.value='Keep species draft'
    h.state.speciesCycleConflict.value=true;h.state.reviewMessage.value={message:'Private notice',variant:'info'};h.state.feedback.value={message:'Private feedback',variant:'error'}
    const officer=h.state.reviewSession.value.user
    h.emitSession(officer,true)
    assert.equal(h.state.selected.value.id,firstId)
    assert.equal(h.state.comment.value,'Keep my unsaved review')
    assert.equal(h.state.speciesReviewComment.value,'Keep species draft')
    assert.equal(h.state.canReviewPlant.value,false)
    assert.equal(h.state.speciesCycleConflict.value,true);assert.equal(h.state.reviewMessage.value.message,'Private notice')
    await h.state.decide('Approved');assert.equal(h.calls.filter(call=>call.options.method==='POST').length,0)
    h.emitSession(officer,false)
    assert.equal(h.state.comment.value,'Keep my unsaved review');assert.equal(h.state.canReviewPlant.value,true)
    h.emitSession(null,false)
    assert.equal(h.state.selected.value,null);assert.equal(h.state.comment.value,'')
    assert.equal(h.state.speciesCycleConflict.value,false);assert.equal(h.state.reviewMessage.value,null);assert.equal(h.state.feedback.value,null)
  }finally{h.stop()}
})


test('Reviewed By resolves the actual completed decision for every existing table category without borrowing linked Species reviewers', async () => {
  const stamp='2026-11-16T01:00:00Z'
  const rows=[
    fixture({status:'Rejected',review_decision:'Rejected',reviewed_by:'staff:latest',reviewed_at:stamp,
      reviews:[{reviewer_subject:'staff:earlier'},{reviewer_subject:'staff:latest'}]}),
    fixture({id:secondId,status:'Correction Required',review_decision:'Correction Required',reviewed_by:'staff:latest',reviewed_at:stamp,
      species_request:requestFixture({request_status:'Approved',reviewed_by:'staff:species-officer',reviewed_at:stamp})}),
    fixture({id:'18',origin_type:'unknown',status:'Flagged',review_decision:'Flagged',reviewed_by:'staff:latest',reviewed_at:stamp}),
  ]
  const changes=[changeFixture({id:'plant-review',status:'Approved',reviewed_by:'staff:latest',reviewed_at:stamp}),
    changeFixture({id:'species-review',plant_id:null,species_id:8,status:'Rejected',reviewed_by:'staff:latest',reviewed_at:stamp})]
  const h=harness(url=>url.startsWith('/api/conservation/submitter-names?')
    ?Response.json({names:{latest:'Officer Aina',earlier:'Earlier Officer','species-officer':'Species Officer'}}):fixtureResponse(url,rows),
    {},'en',undefined,null,{recordChangesHandler:()=>changesResponse(changes)})
  try{
    await h.state.loadObservations()
    await flush()
    const cells=nodes(reviewTable(h)).filter(n=>n.type==='td'&&n.props?.class==='reviewer-cell')
    assert.equal(cells.length,4)
    assert.ok(cells.every(n=>n.children==='Officer Aina'))
    h.state.queueOrigin.value='unknown'
    const legacyCells=nodes(reviewTable(h)).filter(n=>n.type==='td'&&n.props?.class==='reviewer-cell')
    assert.equal(legacyCells.length,3); assert.ok(legacyCells.every(n=>n.children==='Officer Aina'))
    const lookup=h.calls.find(c=>c.url.startsWith('/api/conservation/submitter-names?'))
    assert.ok(new URL(lookup.url,'https://fixture.invalid').searchParams.get('ids').split(',').includes('latest'))
  }finally{h.stop()}
})

test('Reviewed By hides previous-cycle reviews on Pending Review rows and uses an em dash for unresolved or mismatched evidence', async () => {
  const stamp='2026-11-16T01:00:00Z'
  const rows=[fixture({reviewed_by:'staff:earlier',reviewed_at:stamp,review_decision:'Correction Required'}),
    fixture({id:secondId,status:'Rejected',reviewed_by:'staff:missing',reviewed_at:stamp,review_decision:'Rejected'}),
    fixture({id:'19',status:'Rejected',reviewed_by:'staff:earlier',reviewed_at:stamp,review_decision:'Flagged'})]
  const h=harness(url=>url.startsWith('/api/conservation/submitter-names?')?Response.json({names:{earlier:'Earlier Officer'}}):fixtureResponse(url,rows),
    {},'en',undefined,null,{recordChangesHandler:()=>changesResponse([changeFixture({reviewed_by:'staff:earlier',reviewed_at:stamp})])})
  try{
    await h.state.loadObservations()
    assert.ok(nodes(reviewTable(h)).filter(n=>n.type==='td'&&n.props?.class==='reviewer-cell').every(n=>n.children==='\u2014'))
    assert.equal(h.state.reviewerName('staff:missing'),'\u2014')
    assert.equal(h.state.reviewerName('visitor:earlier'),'\u2014')
  }finally{h.stop()}
})

test('Reviewed By column is localized, aligns eleven cells, and all Submission IDs retain Plant ID bold weight and copy controls', async () => {
  for(const language of ['en','ms','zh-CN']){
    const locale=JSON.parse(readFileSync(new URL('../src/locales/'+language+'.json',import.meta.url),'utf8'))
    assert.equal(locale.approvedChanges.reviewedByColumn,{en:'REVIEWED BY',ms:'DISEMAK OLEH','zh-CN':'\u5ba1\u6838\u4eba'}[language])
    const h=harness(url=>fixtureResponse(url,[fixture()]),{},language,undefined,null,{recordChangesHandler:()=>changesResponse([changeFixture()])})
    try{
      await h.state.loadObservations()
      const table=reviewTable(h)
      assert.ok(nodes(table).some(n=>n.type==='th'&&n.children===locale.approvedChanges.reviewedByColumn))
      for(const row of nodes(table).filter(n=>n.type==='tr'&&n.key)){
        const cells=nodes(row).filter(n=>n.type==='td')
        assert.equal(cells.length,11)
        assert.ok(nodes(cells[0]).some(n=>n.type==='strong'&&/^(OBS|CHANGE)-/.test(n.children)))
        assert.ok(nodes(cells[0]).some(n=>n.type==='button'&&n.props.onClick))
      }
      assert.match(descriptor.styles[0].content,/\.identity-cell strong\s*\{[^}]*font-weight: 700/)
      assert.match(descriptor.styles[0].content,/\.plant-id-cell\s*\{[^}]*font-weight: 700/)
    }finally{h.stop()}
  }
})

test('competing observation decisions refresh detail and filtered table once without retrying; attribution is verified', async () => {
  for (const decision of ['Approved', 'Rejected']) for (const reviewer of ['staff:other-officer', '', 'staff:verified-officer']) {
    let posted = false, posts = 0, recoveryReads = 0
    const row = () => fixture(posted ? { status: decision, revision: 4, reviewed_by: reviewer, reviewed_at: '2026-11-16T01:00:00Z', review_decision: decision } : {})
    const h = harness(async (url, options) => {
      if (options.method === 'POST') { posted = true; posts++; return Response.json({ error: 'Already reviewed' }, { status: 409 }) }
      if (posted && url === `/api/observations/${firstId}`) recoveryReads++
      return fixtureResponse(url, [row()])
    })
    try {
      await h.state.loadObservations(); await h.state.open(h.state.observations.value[0])
      h.state.status.value = 'Pending Review'; h.state.comment.value = 'My unsaved reason'
      await h.state.decide('Approved')
      assert.equal(posts, 1); assert.equal(recoveryReads, 1)
      assert.equal(h.state.selected.value.status, decision)
      assert.equal(h.state.observations.value[0].status, decision)
      assert.equal(h.state.filtered.value.length, 0)
      assert.equal(h.state.comment.value, 'My unsaved reason')
      assert.equal(h.state.canReviewPlant.value, false)
      if (reviewer === 'staff:other-officer') {
        assert.equal(h.state.reviewMessage.value.variant, 'info')
        assert.equal(h.state.reviewMessage.value.message, messages.conservationPages.reviews.feedback.reviewedElsewhere)
      } else assert.ok(!h.state.reviewMessage.value.message.includes('already been reviewed by another Officer'))
      await h.state.decide('Approved'); assert.equal(posts, 1)
    } finally { h.stop() }
  }
})

test('linked and standalone species conflicts recover completed decisions with one detail read and synchronized table', async () => {
  for (const standalone of [false, true]) for (const decision of ['Approved', 'Rejected']) {
    let posted = false, posts = 0, recoveryReads = 0
    const request = () => requestFixture({ request_id: '73', request_status: posted ? decision : 'Pending Review', approved_species_id: posted && decision === 'Approved' ? 8 : null, reviewed_by: posted ? 'staff:other-officer' : null, reviewed_at: posted ? '2026-11-16T01:00:00Z' : null })
    const row = () => fixture({ species_request_id: '73', species_request: request(), status: posted && decision === 'Rejected' ? 'Rejected' : 'Pending Review' })
    const h = harness(async (url, options) => {
      if (options.method === 'POST') { posts++; posted = true; return Response.json({ error: 'Already reviewed' }, { status: 409 }) }
      if (posted && url === (standalone ? '/api/species-requests/73' : `/api/observations/${firstId}`)) recoveryReads++
      if (url === '/api/species-requests/73') return Response.json({ species_request: standaloneFixture({ ...request(), scientific_name: 'Recovered species' }) })
      return fixtureResponse(url, [row()])
    }, standalone ? { speciesRequest: '73' } : {})
    try {
      await h.state.loadObservations(); await flush()
      if (!standalone) await h.state.open(h.state.observations.value[0])
      h.state.speciesReviewComment.value = 'Preserve species draft'; h.state.comment.value = 'Preserve plant draft'; h.state.speciesVisibility.value = 'public'
      await h.state.decideSpecies('Approved'); await flush()
      assert.equal(posts, 1); assert.equal(recoveryReads, 1)
      assert.equal(h.state.selectedSpeciesRequest.value.status, decision)
      assert.equal(h.state.observations.value[0].speciesRequest.status, decision)
      assert.equal(h.state.speciesReviewComment.value, 'Preserve species draft')
      assert.equal(h.state.comment.value, 'Preserve plant draft')
      assert.equal(h.state.speciesVisibility.value, '')
      assert.equal(h.state.canReviewSpecies.value, false)
      assert.equal(h.state.reviewMessage.value.variant, 'info')
      assert.equal(h.state.speciesSaveError.value, '')
      await h.state.decideSpecies('Rejected'); assert.equal(posts, 1)
    } finally { h.stop() }
  }
})

test('record-change detail readbacks patch their table row without refetching or changing filters', async () => {
  const h = harness(async url => fixtureResponse(url, [fixture()]), {}, 'en', undefined, null, { recordChangesHandler: () => changesResponse([changeFixture()]) })
  try {
    await h.state.loadObservations()
    h.state.status.value = 'Pending Review'
    h.state.updateChange(changeFixture({ status: 'Approved', reviewed_by: 'staff:other-officer' }))
    assert.equal(h.state.changeProposals.value[0].status, 'Approved')
    assert.equal(h.state.matchingChanges.value.length, 0)
    assert.equal(h.state.status.value, 'Pending Review')
    h.emitSession(null)
    h.state.updateChange(changeFixture({ status: 'Rejected' }))
    assert.equal(h.state.changeProposals.value.length, 0)
  } finally { h.stop() }
})


test('a late queue load cannot overwrite a newer record-change detail readback', async () => {
  let release
  const h = harness(url => fixtureResponse(url, [fixture()]), {}, 'en', undefined, null, { recordChangesHandler: () => new Promise(resolve => release = resolve) })
  try {
    const loading = h.state.loadObservations(); await flush()
    h.state.updateChange(changeFixture({ status: 'Rejected', reviewed_by: 'staff:other-officer' }))
    release(changesResponse([changeFixture()]))
    await loading
    assert.equal(h.state.changeProposals.value[0].status, 'Rejected')
  } finally { h.stop() }
})

test('logout during species conflict readback discards late recovery and blocks a second decision', async () => {
  for (const standalone of [false,true]) {
    let posted = false, posts = 0, release
    const row = fixture({ species_request_id: '73', species_request: requestFixture({request_id:'73'}) })
    const h = harness(async (url, options) => {
      if (options.method === 'POST') { posted=true; posts++; return Response.json({error:'Conflict'},{status:409}) }
      if (posted && url === (standalone ? '/api/species-requests/73' : `/api/observations/${firstId}`)) return new Promise(resolve => release=resolve)
      if (url === '/api/species-requests/73') return Response.json({species_request:standaloneFixture()})
      return fixtureResponse(url,[row])
    }, standalone ? {speciesRequest:'73'} : {})
    try {
      await h.state.loadObservations();await flush()
      if(!standalone)await h.state.open(h.state.observations.value[0])
      h.state.speciesVisibility.value='public'
      const action=h.state.decideSpecies('Approved');await flush()
      assert.ok(release)
      await h.state.decideSpecies('Approved');assert.equal(posts,1)
      h.emitSession(null)
      release(standalone ? Response.json({species_request:standaloneFixture({request_status:'Approved',reviewed_by:'staff:other-officer',reviewed_at:'2026-11-16T01:00:00Z'})}) : fixtureResponse(`/api/observations/${firstId}`,[row]))
      await action;await flush()
      assert.equal(h.state.selected.value,null);assert.equal(h.state.standaloneRequest.value,null)
      assert.equal(h.state.speciesReviewComment.value,'')
      assert.equal(h.state.observations.value.length,0)
    } finally {h.stop()}
  }
})


test('a late observation queue page cannot overwrite recovered detail and table status', async () => {
  let release, delayed = false
  const h = harness(url => fixtureResponse(url,[fixture()]), {}, 'en', undefined, () => delayed ? new Promise(resolve => release=resolve) : Response.json({observations:[fixture()],page:{has_more:false,next_cursor:null}}))
  try {
    await h.state.loadObservations()
    await h.state.open(h.state.observations.value[0])
    delayed=true
    const loading=h.state.loadObservations();await flush()
    h.state.updateObservation(h.state.mapObservation(fixture({status:'Rejected',revision:4})))
    release(Response.json({observations:[fixture()],page:{has_more:false,next_cursor:null}}))
    await loading
    assert.equal(h.state.selected.value.status,'Rejected')
    assert.equal(h.state.observations.value[0].status,'Rejected')
  } finally {h.stop()}
})


test('recovery safeguards: Species save navigation clears only its own request and never duplicates POST', async () => {
  let release, posts = 0
  const rows = [fixture({ species_request: requestFixture() }), fixture({ id: secondId })]
  const h = harness((url, options) => {
    if (url.startsWith('/api/conservation/submitter-names?')) return Response.json({names:{}})
    if (options.method === 'POST') { posts++; return new Promise(resolve => release = resolve) }
    return fixtureResponse(url, rows)
  })
  try {
    await h.state.loadObservations(); await h.state.open(h.state.observations.value[0])
    h.state.speciesReviewComment.value = 'Review reason'
    const saving = h.state.decideSpecies('Rejected'); await flush()
    assert.equal(posts, 1); assert.ok(release)
    h.route.query = {review: secondId}; await flush()
    release(Response.json({reviewed:true})); await saving; await flush()
    assert.equal(h.state.speciesSaving.value, false)
    assert.equal(h.state.selected.value.id, secondId)
    assert.equal(h.state.speciesReviewComment.value, '')
    assert.equal(posts, 1)
  } finally { h.stop() }
})

test('recovery safeguards: Observation conflict preserves linked Species draft and clears visibility without retry', async () => {
  let posted = false, posts = 0
  const row = () => fixture({revision: posted ? 4 : 3, species_request: requestFixture({request_status:'Approved',approved_species_id:8})})
  const h = harness((url, options) => {
    if (options.method === 'POST') { posted = true; posts++; return Response.json({error:'Revision conflict'},{status:409}) }
    return fixtureResponse(url,[row()])
  })
  try {
    await h.state.loadObservations(); await h.state.open(h.state.observations.value[0])
    h.state.speciesReviewComment.value = 'Unsaved linked Species reason'; h.state.speciesVisibility.value = 'public'
    await h.state.decide('Rejected') // Rejection requires a comment and must not send a request yet.
    assert.equal(posts, 0)
    h.state.comment.value = 'Plant reason'; await h.state.decide('Rejected')
    assert.equal(posts, 1)
    assert.equal(h.state.speciesReviewComment.value, 'Unsaved linked Species reason')
    assert.equal(h.state.speciesVisibility.value, '')
    assert.equal(h.state.comment.value, 'Plant reason')
    assert.equal(h.state.selected.value.revision, 4)
  } finally {h.stop()}
})

test('recovery safeguards: delayed Observation readback ignores navigation, session changes, newer selection and disposal', async () => {
  for (const action of ['route', 'pending', 'logout', 'newer', 'dispose']) {
    let release, posted = false, posts = 0
    const rows = [fixture(), fixture({id:secondId})]
    const h = harness((url, options) => {
      if (options.method === 'POST') { posted = true; posts++; return Response.json({error:'Conflict'},{status:409}) }
      if (posted && url === `/api/observations/${firstId}`) return new Promise(resolve => release = resolve)
      return fixtureResponse(url,rows)
    })
    let stopped = false
    try {
      await h.state.loadObservations(); await h.state.open(h.state.observations.value[0])
      const saving = h.state.decide('Approved'); await flush(); assert.ok(release)
      if (action === 'route') h.route.query = {review:secondId}
      if (action === 'pending') h.emitSession(h.state.reviewSession.value.user,true)
      if (action === 'logout') h.emitSession(null)
      if (action === 'newer') {const officer=h.state.reviewSession.value.user;h.emitSession(officer,true);h.emitSession(officer,false);await h.state.open(h.state.observations.value[1])}
      if (action === 'dispose') {h.stop();stopped=true}
      await flush()
      release(Response.json({observation:fixture({status:'Rejected',revision:99})}))
      await saving; await flush()
      assert.equal(posts,1)
      assert.notEqual(h.state.selected.value?.revision,99)
      assert.ok(h.state.observations.value.every(row=>row.revision!==99))
      assert.notEqual(h.state.reviewMessage.value?.message,'Conflict')
    } finally {if(!stopped)h.stop()}
  }
})


test('recovery safeguards: obsolete Species cleanup cannot clear a newer submission save', async () => {
  const releases = []; let posts = 0
  const rows = [fixture({species_request:requestFixture()}), fixture({id:secondId,species_request:requestFixture({request_id:'9'})})]
  const h = harness((url, options) => {
    if (options.method === 'POST') {posts++;return new Promise(resolve=>releases.push(resolve))}
    return fixtureResponse(url,rows)
  })
  try {
    await h.state.loadObservations();await h.state.open(h.state.observations.value[0])
    h.state.speciesReviewComment.value='First reason'
    const first=h.state.decideSpecies('Rejected');await flush();assert.equal(posts,1)
    const officer=h.state.reviewSession.value.user
    h.emitSession(officer,true);h.emitSession(officer,false)
    await h.state.open(h.state.observations.value[1])
    h.state.speciesReviewComment.value='Second reason'
    const second=h.state.decideSpecies('Rejected');await flush();assert.equal(posts,2)
    releases[0](Response.json({reviewed:true}));await first
    assert.equal(h.state.speciesSaving.value,true)
    assert.equal(h.state.selected.value.id,secondId)
    assert.equal(h.state.speciesReviewComment.value,'Second reason')
    releases[1](Response.json({reviewed:true}));await second
    assert.equal(h.state.speciesSaving.value,false);assert.equal(posts,2)
  }finally{h.stop()}
})


test('Plant review categories never load or duplicate Observation edit proposals',async()=>{
 let editReads=0
 const h=harness(url=>fixtureResponse(url,[fixture()]),{},'en',undefined,null,{recordChangesHandler:()=>changesResponse([changeFixture()]),observationEditsHandler:async()=>{editReads++;throw Error('independent queue offline')}})
 try{
 await h.state.loadObservations();assert.equal(h.state.loadError.value,'');assert.equal(editReads,0)
 assert.equal(h.state.allReviewRows.value.length,2);assert.ok(h.state.allReviewRows.value.every(row=>row.kind!=='observation_edit'))
 assert.deepEqual(Array.from(h.state.submissionTypes),['initial_registration','linked_species_request','approved_plant_change','approved_species_change'])
 assert.ok(!descriptor.template.content.includes('<ObservationEditReview'))
 }finally{h.stop()}
})

test('old Observation edit bookmarks retain explicit compatibility detail until authoritative dispatch',async()=>{
 const h=harness(url=>fixtureResponse(url,[]),{observationEdit:firstId})
 try{await flush();assert.equal(h.route.query.observationEdit,firstId);assert.ok(descriptor.template.content.includes('<RegistrationObservationEdits'));assert.ok(!h.routes.some(route=>route.name==='conservation-observations'));h.route.query.observationEdit=secondId;await flush();assert.equal(h.route.query.observationEdit,secondId);assert.ok(!h.calls.some(call=>call.options?.method==='POST'))}finally{h.stop()}
})

test('historical Observation selection blocks every decision handler and restores current Pending eligibility', async () => {
  const h = harness(url => fixtureResponse(url, [fixture({ species_request: requestFixture({ request_status: 'Approved', approved_species_id: 8 }) })]))
  try {
    await h.state.loadObservations(); await h.state.open(h.state.observations.value[0])
    assert.equal(h.state.canDecide('Approved'), true)
    h.state.historicalSelectionActive.value = true
    const before = h.calls.filter(call => call.options.method === 'POST').length
    for (const decision of ['Approved', 'Rejected', 'Correction Required', 'Flagged']) {
      assert.equal(h.state.canDecide(decision), false)
      await h.state.decide(decision)
    }
    await h.state.decideSpecies('Approved')
    assert.equal(h.calls.filter(call => call.options.method === 'POST').length, before)
    assert.equal(h.state.canReviewSpecies.value, false)
    h.state.historicalSelectionActive.value = false
    assert.equal(h.state.canDecide('Approved'), true)
  } finally { h.stop() }
})


test('withdrawn standalone Species opens authoritative details and never posts another decision',async()=>{
 for(const stale of [false,true]){
 let withdrawn=!stale
 const h=harness(async(url,options)=>{
  if(url==='/api/observations')return Response.json({observations:[]})
  if(options.method==='POST'){withdrawn=true;return Response.json({error:'Withdrawn'},{status:409})}
  return Response.json({species_request:standaloneFixture({request_status:withdrawn?'Withdrawn':'Pending Review'})})
 },{speciesRequest:'73'})
 try{
  await h.state.loadObservations();await flush()
  if(stale){h.state.speciesReviewComment.value='Keep draft';h.state.speciesVisibility.value='protected';await h.state.decideSpecies('Approved');await flush()}
  assert.equal(h.state.standaloneRequest.value.state,'withdrawn')
  assert.equal(h.state.canReviewSpecies.value,false)
  assert.equal(h.state.speciesSaveError.value,'')
  assert.ok(renderText(h).includes(messages.conservationPages.reviews.speciesRequest.states.withdrawn))
  const count=h.calls.filter(c=>c.options.method==='POST').length
  await h.state.decideSpecies('Approved');await h.state.decideSpecies('Rejected');await h.state.decideSpecies('Correction Required')
  assert.equal(h.calls.filter(c=>c.options.method==='POST').length,count)
  assert.equal(count,stale?1:0)
 }finally{h.stop()}
 }
})


test('normal registration rows exclude field and unclassified originals; explicit legacy access is view-only',async()=>{
 const rows=[fixture({id:firstId,origin_type:'initial_registration'}),fixture({id:secondId,origin_type:'unknown'}),fixture({id:'field-only',origin_type:'subsequent_observation'})];
 const h=harness(url=>fixtureResponse(url,rows));try{await h.state.loadObservations();assert.deepEqual(Array.from(h.state.filtered.value,r=>r.id),[firstId]);h.route.query.legacy='1';await flush();assert.equal(h.state.queueOrigin.value,'unknown');assert.deepEqual(Array.from(h.state.filtered.value,r=>r.id),[secondId]);h.state.selected.value=h.state.filtered.value[0];assert.equal(h.state.canReviewPlant.value,false);assert.equal(h.state.canReviewSpecies.value,false)}finally{h.stop()}
})

const queueSpecies = (id, extra = {}) => requestFixture({ request_id: id, scientific_name: 'Standalone '+id, submitted_at: '2026-11-18T00:00:00Z', ...extra })
const speciesQueueOptions = rows => ({ speciesQueueHandler: async()=>Response.json({species_requests:rows}) })
test('shared Species queue deduplicates linked requests, keeps Plant IDs absent, sorts and paginates mixed rows',async()=>{
 const standalone=Array.from({length:105},(_,i)=>queueSpecies(100+i))
 const rows=[fixture({species_request:requestFixture({request_id:7})}),fixture({id:secondId,origin_type:'unknown'})]
 const h=harness(url=>fixtureResponse(url,rows),{},'en',undefined,null,speciesQueueOptions([queueSpecies(7),...standalone,standalone[0]]))
 try{
  await h.state.loadObservations()
  assert.equal(h.state.allReviewRows.value.length,106)
  assert.equal(h.state.standaloneRows.value.length,105)
  assert.equal(h.state.reviewRows.value.length,100)
  assert.equal(h.state.reviewRows.value[0].key,'species-request:100')
  assert.ok(h.state.reviewRows.value.every(row=>'speciesRequest' in row))
  assert.equal(h.state.counts.value[0][1],106,'unknown registration excluded and linked request represented once')
  await h.state.loadObservations(true);assert.equal(h.state.reviewRows.value.length,106)
  assert.equal(h.state.reviewRows.value.at(-1).key,'observation:'+firstId)
  assert.ok(h.state.standaloneRows.value.every(row=>!('plant_id' in row.speciesRequest)))
  h.state.submissionType.value='initial_registration';assert.equal(h.state.allReviewRows.value.length,0)
  h.state.submissionType.value='linked_species_request';h.state.search.value='SPECIES-100';assert.deepEqual(Array.from(h.state.allReviewRows.value,row=>row.key),['species-request:100'])
 }finally{h.stop()}
})
test('capped Species source is disclosed and unavailable required source blocks initial publication',async()=>{
 for(const fail of [false,true]){
 const h=harness(url=>fixtureResponse(url,[fixture()]),{},'en',undefined,null,{speciesQueueHandler:async()=>fail?Response.json({}, {status:503}):Response.json({species_requests:Array.from({length:500},(_,i)=>queueSpecies(100+i))})})
 try{await h.state.loadObservations();assert.equal(h.state.speciesQueueCapped.value,!fail);assert.equal(h.state.speciesQueueError.value,fail);assert.equal(h.state.allReviewRows.value.some(row=>row.key==='observation:'+firstId),!fail);assert.equal(h.state.queueUnverified.value,fail);assert.equal(h.state.queueReady.value,!fail);assert.match(renderText(h),/Counts reflect loaded submissions before filters are applied/);assert.match(renderText(h),fail?/could not be loaded/:/incomplete/)}finally{h.stop()}
 }
})
for(const decision of ['Approved','Rejected','Correction Required'])test('standalone '+decision+' readback synchronizes the shared queue and active status filter once',async()=>{
 let current=queueSpecies(42),posts=0
 const h=harness(async(url,options)=>{
  if(options.method==='POST'){posts++;current={...current,request_status:decision,review_comment:'Decision',reviewed_by:'staff:officer',reviewed_at:'2026-11-18T01:00:00Z'};return Response.json({reviewed:true})}
  if(url==='/api/species-requests/42')return Response.json({species_request:current})
  return fixtureResponse(url,[])
 },{speciesRequest:'42'},'en',undefined,null,speciesQueueOptions([current]))
 try{await h.state.loadObservations();await h.state.resolveStandaloneQuery();h.state.status.value='Pending Review';h.state.speciesVisibility.value='public';await h.state.decideSpecies(decision);assert.equal(posts,1);assert.equal(h.state.standaloneSpecies.value[0].status,decision);assert.equal(h.state.allReviewRows.value.length,0);h.state.status.value=decision;assert.equal(h.state.allReviewRows.value[0].speciesRequest.status,decision);assert.equal(h.state.standaloneRequest.value.status,decision)}finally{h.stop()}
})
test('older Species list responses cannot overwrite a newer verified detail readback',async()=>{
 let release
 const h=harness(url=>fixtureResponse(url,[]),{},'en',undefined,null,{speciesQueueHandler:()=>new Promise(resolve=>{release=resolve})})
 try{const pending=h.state.loadObservations();await flush();const fresh=speciesRequestIntegration.mapLinkedSpeciesRequest({species_request_id:42,species_request:queueSpecies(42,{request_status:'Rejected'})},true);h.state.applyVerifiedSpecies(fresh);release(Response.json({species_requests:[queueSpecies(42)]}));await pending;assert.equal(h.state.standaloneSpecies.value[0].status,'Rejected');assert.equal(h.state.allReviewRows.value[0].speciesRequest.status,'Rejected')}finally{h.stop()}
})
test('standalone saved-but-unverified shared row recovery is GET only and never fabricates a decision',async()=>{
 let current=queueSpecies(42),committed=false,available=true,posts=0
 const h=harness(async(url,options)=>{if(options.method==='POST'){posts++;committed=true;current={...current,request_status:'Approved'};available=false;return Response.json({reviewed:true})}if(url==='/api/species-requests/42')return available?Response.json({species_request:current}):Response.json({}, {status:503});return fixtureResponse(url,[])},{speciesRequest:'42'},'en',undefined,null,speciesQueueOptions([current]))
 try{await h.state.loadObservations();await h.state.resolveStandaloneQuery();h.state.speciesVisibility.value='public';await h.state.decideSpecies('Approved');assert.equal(committed,true);assert.equal(posts,1);assert.equal(h.state.speciesNeedsReload.value,true);assert.equal(h.state.standaloneSpecies.value[0].status,'Pending Review');available=true;await h.state.refreshStandaloneRequest();assert.equal(posts,1);assert.equal(h.state.standaloneSpecies.value[0].status,'Approved')}finally{h.stop()}
})
test('Species HTTP 409 installs only authoritative state and never retries the decision',async()=>{
 let current=queueSpecies(42),posts=0
 const h=harness(async(url,options)=>{if(options.method==='POST'){posts++;current={...current,content_revision:2};return Response.json({error:'Changed',code:'SPECIES_REQUEST_VERSION_CONFLICT'},{status:409})}if(url==='/api/species-requests/42')return Response.json({species_request:current});return fixtureResponse(url,[])},{speciesRequest:'42'},'en',undefined,null,{speciesQueueHandler:async()=>Response.json({species_requests:[current]})})
 try{await h.state.loadObservations();await h.state.resolveStandaloneQuery();h.state.speciesVisibility.value='public';await h.state.decideSpecies('Approved');await flush();assert.equal(posts,1);assert.equal(h.state.standaloneSpecies.value[0].status,'Pending Review');assert.equal(h.state.standaloneSpecies.value[0].contentRevision,2);assert.equal(h.state.speciesInspectionRequired.value,true)}finally{h.stop()}
})

test('shared normal counts exclude unclassified registrations without hiding their independent Species requests',async()=>{
 const rows=[fixture(),fixture({id:secondId,origin_type:'unknown',species_request:requestFixture({request_id:42})})]
 const h=harness(url=>fixtureResponse(url,rows),{},'en',undefined,null,speciesQueueOptions([queueSpecies(42)]))
 try{await h.state.loadObservations();assert.equal(h.state.counts.value[0][1],2);assert.equal(h.state.allReviewRows.value.length,2);assert.ok(h.state.allReviewRows.value.some(row=>row.key==='species-request:42'));assert.ok(!h.state.allReviewRows.value.some(row=>row.key==='observation:'+secondId));h.state.queueOrigin.value='unknown';assert.equal(h.state.standaloneRows.value.length,0);assert.equal(h.state.counts.value[0][1],1)}finally{h.stop()}
})
test('Plant edit, standalone Species and registration share one chronological order',async()=>{
 const h=harness(url=>fixtureResponse(url,[fixture()]),{},'en',undefined,null,{...speciesQueueOptions([queueSpecies(42)]),recordChangesHandler:()=>changesResponse([changeFixture({id:'latest-edit',created_at:'2026-11-19T00:00:00Z'})])})
 try{await h.state.loadObservations();assert.deepEqual(Array.from(h.state.allReviewRows.value,row=>row.key),['change:latest-edit','species-request:42','observation:'+firstId])}finally{h.stop()}
})
test('Species source retry never repeats decisions and session changes discard its late results',async()=>{
 let release,wait=false
 const h=harness(url=>fixtureResponse(url,[fixture()]),{},'en',undefined,null,{speciesQueueHandler:()=>wait?new Promise(resolve=>{release=resolve}):Response.json({species_requests:[queueSpecies(42)]})})
 try{await h.state.loadObservations();wait=true;const pending=h.state.loadStandaloneSpecies();await flush();h.emitSession(null);release(Response.json({species_requests:[queueSpecies(43)]}));await pending;assert.equal(h.state.standaloneSpecies.value.length,0);assert.ok(!h.calls.some(call=>call.options.method==='POST'))}finally{h.stop()}
})

test('Species list cannot restore Pending after verified completion but can expose a genuine correction resubmission',async()=>{
 let list=[queueSpecies(42)]
 const h=harness(url=>fixtureResponse(url,[]),{},'en',undefined,null,{speciesQueueHandler:async()=>Response.json({species_requests:list})})
 try{await h.state.loadObservations();h.state.applyVerifiedSpecies(speciesRequestIntegration.mapLinkedSpeciesRequest({species_request_id:42,species_request:queueSpecies(42,{request_status:'Correction Required'})},true));await h.state.loadStandaloneSpecies();assert.equal(h.state.standaloneSpecies.value[0].status,'Correction Required');list=[queueSpecies(42,{content_revision:2,review_cycle:2})];await h.state.loadStandaloneSpecies();assert.equal(h.state.standaloneSpecies.value[0].status,'Pending Review');assert.equal(h.state.standaloneSpecies.value[0].contentRevision,2)}finally{h.stop()}
})


test('BUG-004 publishes linked and standalone Species only with the complete multi-page queues; names do not block', async () => {
  let releaseObservations, releaseNames
  const linked = requestFixture({ request_id: '41' }), standalone = requestFixture({ request_id: '42' })
  const h = harness(async url => {
    if (url.startsWith('/api/conservation/submitter-names')) return new Promise(resolve => { releaseNames = () => resolve(Response.json({ names: {} })) })
    throw Error('Unexpected fixture request ' + url)
  }, {}, 'en', undefined, async url => {
    if (!url.includes('cursor=')) return new Promise(resolve => { releaseObservations = () => resolve(Response.json({ observations: [fixture({ species_request_id: '41', species_request: linked })], page: { has_more: true, next_cursor: 'next' } })) })
    return Response.json({ observations: [], page: { has_more: false, next_cursor: null } })
  }, { speciesQueueHandler: async () => Response.json({ species_requests: [linked, standalone].map(row => ({ ...row, scientific_name: row.proposed_scientific_name })) }),
    recordChangesHandler: async url => Response.json({ changes: [], page: url.includes('cursor=') ? { has_more: false, next_cursor: null } : { has_more: true, next_cursor: 'next' } }) })
  try {
    const work = h.state.loadObservations(); await flush()
    assert.equal(h.state.reviewRows.value.length, 0); assert.equal(h.state.queueReady.value, false)
    assert.equal(h.state.isLoading.value, true); assert.match(h.state.countValue(0), /Loading/)
    releaseObservations(); await work
    assert.equal(h.state.isLoading.value, false); assert.equal(h.state.queueReady.value, true)
    assert.deepEqual(Array.from(h.state.reviewRows.value, row => row.key), ['species-request:42', 'observation:' + firstId])
    assert.equal(h.calls.filter(call => call.url.startsWith('/api/observations?')).length, 2)
    assert.equal(h.calls.filter(call => call.url.startsWith('/api/data/record-changes?')).length, 2)
    assert.equal(h.calls.filter(call => call.url.startsWith('/api/species-requests')).length, 1)
    assert.ok(releaseNames, 'Optional names are pending while the complete queue is usable')
    releaseNames(); await flush()
  } finally { h.stop() }
})

test('BUG-004 cached revisit renders promptly, coalesces refresh, and preserves rows if a source fails', async () => {
  const session = { user: { id: 'verified-officer', role: 'Conservation Officer', status: 'Active', mustChangePassword: false }, pending: false }
  const cache = createReviewQueueCache(() => session, () => {})
  const first = harness(url => fixtureResponse(url, [fixture()]), {}, 'en', undefined, null, { queueCache: cache })
  await first.state.loadObservations(); first.stop()
  let release; const start = performance.now()
  const h = harness(async () => Response.json({ names: {} }), {}, 'en', undefined, () => new Promise(resolve => { release = resolve }), { queueCache: cache })
  try {
    const a = h.state.loadObservations(), b = h.state.loadObservations(); await flush()
    assert.equal(h.state.queueReady.value, true); assert.equal(h.state.isLoading.value, false); assert.equal(h.state.queueRefreshing.value, true)
    assert.equal(h.state.reviewRows.value.length, 1)
    assert.equal(h.calls.filter(call => call.url.startsWith('/api/observations?')).length, 1)
    assert.equal(h.calls.filter(call => call.url.startsWith('/api/data/record-changes?')).length, 1)
    assert.equal(h.calls.filter(call => call.url === '/api/species-requests').length, 1)
    console.info('BUG-004 cached fixture presentation ms:', Math.round(performance.now() - start), 'queue requests:', 3)
    release(Response.json({ error: 'Unavailable' }, { status: 503 })); await Promise.all([a, b])
    assert.equal(h.state.reviewRows.value.length, 1); assert.equal(h.state.queueUnverified.value, true)
    assert.equal(h.state.queueRefreshing.value, false); assert.equal(h.state.canReviewPlant.value, false)
  } finally { h.stop() }
})

test('BUG-004 table retains eleven explicit columns, loaded-only notice and bounded optional-name lookup', () => {
  assert.equal((descriptor.template.content.match(/<col class=/g) || []).length, 11)
  assert.match(descriptor.styles.map(x => x.content).join(''), /table-layout: fixed/)
  assert.match(descriptor.styles.map(x => x.content).join(''), /actions-column \{ width: 16rem/)
  assert.match(descriptor.template.content, /queues.countsText/); assert.match(descriptor.template.content, /id="registration-queue-help"[^>]*popover="auto"/)
  assert.match(script.content, /AbortSignal.timeout\(5000\)/)
  assert.match(script.content, /void resolveQueueNames/)
})


test('BUG-004 unavailable optional names preserve queue and safe reviewer fallback', async () => {
  const h = harness(async url => url.startsWith('/api/conservation/submitter-names') ? Response.json({}, {status:503}) : fixtureResponse(url,[fixture()]))
  try { await h.state.loadObservations(); await flush(); assert.equal(h.state.queueReady.value,true); assert.equal(h.state.queueUnverified.value,false); assert.equal(h.state.reviewRows.value.length,1); assert.equal(h.state.reviewerName('staff:missing'),'\u2014') } finally {h.stop()}
})

test('BUG-004 approved-record mutations invalidate the shared queue before POST, including failed readback', () => {
  const child = readFileSync(new URL('../src/components/conservation/ApprovedRecordChanges.vue',import.meta.url),'utf8')
  const start=child.indexOf('async function decide('), invalidate=child.indexOf("emit('reviewing')",start), post=child.indexOf('await changeRequest',start)
  assert.ok(invalidate>start && invalidate<post)
  assert.match(descriptor.template.content, /@reviewing="reviewQueueCache.invalidate\(\)"/)
  assert.match(script.content, /method === 'POST'\) reviewQueueCache.invalidate\(\)/)
})


test('BUG-004 navigation during a load shares work across mounts without cancelling the next consumer', async () => {
  const session = { user: {id:'verified-officer',role:'Conservation Officer',status:'Active',mustChangePassword:false},pending:false }
  const cache=createReviewQueueCache(()=>session,()=>{});let release
  const first=harness(async()=>Response.json({names:{}}),{},'en',undefined,()=>new Promise(resolve=>{release=resolve}),{queueCache:cache})
  const a=first.state.loadObservations();await flush();first.stop()
  const second=harness(async()=>Response.json({names:{}}),{},'en',undefined,()=>{throw Error('Duplicate queue request')},{queueCache:cache})
  try{
    const b=second.state.loadObservations();await flush()
    assert.equal(second.calls.filter(c=>c.url.includes('limit=100')||c.url==='/api/species-requests').length,0)
    release(Response.json({observations:[fixture()],page:{has_more:false,next_cursor:null}}));await Promise.all([a,b])
    assert.equal(first.state.queueReady.value,false);assert.equal(second.state.queueReady.value,true);assert.equal(second.state.reviewRows.value.length,1)
    assert.ok(cache.read())
  }finally{second.stop()}
})

test('BUG-004 late optional names cannot cross a logout boundary', async () => {
  let release
  const h=harness(async url=>url.startsWith('/api/conservation/submitter-names')?new Promise(resolve=>{release=resolve}):fixtureResponse(url,[fixture()]))
  try{
    await h.state.loadObservations();assert.ok(release);h.emitSession(null,false)
    release(Response.json({names:{'botanist-uuid':'Private display name'}}));await flush()
    assert.equal(Object.keys(h.state.submitterNames.value).length,0);assert.equal(h.state.queueReady.value,false);assert.equal(h.state.observations.value.length,0)
  }finally{h.stop()}
})


test('UIUX-002 Plant Observation heading uses authoritative status and only verified superseded approval captures get a secondary badge', async () => {
  for(const status of ['Pending Review','Approved','Rejected','Flagged','Correction Required']){
    const raw=fixture({status,historical_review:{state:'available',approval_capture:{id:'capture-original',status:'Superseded'},fields:{content:{heightCm:20}},assets:[]}})
    const h=harness(url=>fixtureResponse(url,[raw]))
    try{
      await h.state.loadObservations();await h.state.open(h.state.observations.value[0]);await flush()
      const heading=nodes(h.render()).find(n=>n.props?.class==='plant-observation-heading')
      assert.ok(heading);assert.ok(nodes(heading).some(n=>n.type==='h3'&&n.children===messages.conservationPages.reviews.speciesRequest.plantObservation))
      const badges=nodes(heading).filter(n=>n.type==='span'&&String(n.props?.class).includes('badge'))
      assert.equal(badges[0].children,status);assert.deepEqual(badges[0].props.style,workflowBadgeStyle(status))
      assert.equal(badges.length,status==='Approved'?2:1)
      if(status==='Approved')assert.equal(badges[1].children,messages.observationVersions.historicalVersion)
      assert.ok(!nodes(h.render()).some(n=>n.type==='p'&&n.children===messages.approvedChanges.historicalAvailable))
      const fields=nodes(reviewModal(h)).filter(n=>n.type==='dt');assert.ok(!fields.some(n=>n.children==='Status'))
    }finally{h.stop()}
  }
})

test('UIUX-002 current, unavailable, unlinked and subsequent records cannot infer Historical Version from proposals or changed content', () => {
  const h=harness(async()=>Response.json({}))
  try{
    for(const patch of [
      {historical_review:{state:'available',approval_capture:{id:'capture',status:'Approved'},fields:{content:{heightCm:20}}}},
      {historical_review:{state:'unavailable',approval_capture:{id:'capture',status:'Superseded'}}},
      {historical_review:{state:'available',fields:{content:{heightCm:20}},proposal:{status:'Approved'}}},
      {historical_review:{state:'available',approval_capture:{id:'',status:'Superseded'}}},
      {origin_type:'subsequent_observation',historical_review:{state:'available',approval_capture:{id:'capture',status:'Superseded'}}},
    ])assert.equal(h.state.mapObservation(fixture({status:'Approved',content:{heightCm:99},...patch})).historicalVersion,false)
    const unavailable=h.state.mapObservation(fixture({status:'Approved',content:{heightCm:99},historical_review:{state:'unavailable'}}))
    assert.equal(unavailable.height,'');assert.equal(unavailable.assets.length,0)
  }finally{h.stop()}
})


test('historical-row badge reuses list evidence and modal eligibility in EN/MS/ZH without per-row reads or new status filters', async()=>{
 const approvedHistory = captureStatus => ({state:'available',approval_capture:{id:'original-capture',status:captureStatus},fields:{content:{heightCm:20}},assets:[]})
 for(const lang of ['en','ms','zh-CN']){
  const rows=[fixture({status:'Approved',historical_review:approvedHistory('Superseded')}),fixture({id:secondId,status:'Approved',historical_review:approvedHistory('Approved')})]
  const edits=[changeFixture({status:'Approved',reviewed_at:'2026-11-17T01:00:00Z',reviewed_by:'staff:officer'}),changeFixture({id:'approved-species-edit',plant_id:null,species_id:8,status:'Approved'})]
  const h=harness(async url=>url.startsWith('/api/conservation/submitter-names')?Response.json({names:{}}):fixtureResponse(url,rows),{},lang,undefined,null,{recordChangesHandler:()=>changesResponse(edits)})
  try{
   await h.state.loadObservations();const table=reviewTable(h),badge=nodes(table).filter(n=>String(n.props?.class).includes('historical-version-badge'))
   assert.equal(badge.length,1);assert.equal(badge[0].children,JSON.parse(readFileSync(new URL('../src/locales/'+lang+'.json',import.meta.url),'utf8')).observationVersions.historicalVersion)
   const groups=nodes(table).filter(n=>String(n.props?.class).includes('review-status-group'));assert.equal(groups.length,4)
   const historicalGroup=groups.find(n=>String(n.props?.class).includes('has-historical-version'));assert.ok(historicalGroup)
   assert.equal(nodes(historicalGroup).filter(n=>n.type==='span'&&String(n.props?.class).includes('badge')).length,2)
   assert.ok(groups.filter(group=>group!==historicalGroup).every(group=>nodes(group).filter(n=>n.type==='span'&&String(n.props?.class).includes('badge')).length===1))
   const primary=nodes(historicalGroup).find(n=>String(n.props?.class).includes('approved'))
   assert.equal(primary.children,'Approved');assert.deepEqual(primary.props.style,workflowBadgeStyle('Approved'))
   assert.equal(h.state.observations.value[0].status,'Approved');assert.equal(h.state.observations.value[0].historicalVersion,true)
   assert.equal(h.state.changeProposals.value[0].status,'Approved')
   const counts=JSON.stringify(h.state.counts.value);h.state.status.value='Approved';assert.equal(h.state.reviewRows.value.length,4);assert.equal(JSON.stringify(h.state.counts.value),counts)
   assert.ok(!h.state.statusFilterOptions.value.some(o=>o.value==='Historical Version'))
   await h.state.open(h.state.observations.value[0]);await flush()
   assert.equal(h.state.selected.value.historicalVersion,true);assert.ok(nodes(reviewModal(h)).some(n=>n.props?.class==='badge historical-version-badge'))
   assert.equal(h.calls.filter(c=>c.url.startsWith('/api/observations?')).length,1)
   assert.equal(h.calls.filter(c=>c.url.startsWith('/api/data/record-changes?')).length,1)
   assert.equal(h.calls.filter(c=>c.url==='/api/species-requests').length,1)
   assert.ok(h.calls.every(c=>!c.options.method||c.options.method==='GET'));assert.ok(!h.calls.some(c=>c.url.includes('record-versions')))
  }finally{h.stop()}
 }
})

test('historical-row badge excludes every nonapproved, unknown-origin and unverified row even with pending/rejected edits', async()=>{
 const historical={state:'available',approval_capture:{id:'capture',status:'Superseded'},fields:{content:{heightCm:20}},assets:[]}
 const rows=['Pending Review','Rejected','Flagged','Correction Required'].map((status,i)=>fixture({id:String(i+1),status,historical_review:historical}))
 rows.push(fixture({id:'8',origin_type:'subsequent_observation',status:'Approved',historical_review:historical}),fixture({id:'5',origin_type:'unknown',status:'Approved',historical_review:historical}),fixture({id:'6',status:'Approved',historical_review:{state:'unavailable'}}),fixture({id:'7',status:'Approved',historical_review:{state:'available',fields:{content:{heightCm:20}}}}))
 const h=harness(url=>fixtureResponse(url,rows),{},'en',undefined,null,{speciesQueueHandler:async()=>Response.json({species_requests:[queueSpecies(42)]}),recordChangesHandler:()=>changesResponse([changeFixture(),changeFixture({id:'rejected-edit',status:'Rejected'})])})
 try{await h.state.loadObservations();assert.ok(h.state.observations.value.every(row=>!row.historicalVersion));assert.equal(nodes(reviewTable(h)).filter(n=>String(n.props?.class).includes('historical-version-badge')).length,0);assert.ok(h.state.standaloneRows.value.length);assert.equal(h.calls.filter(c=>c.url.startsWith('/api/observations/')).length,0)}finally{h.stop()}
})

test('historical-row badge follows coherent cached and refreshed snapshots without retaining unverified badges',async()=>{
 const session={user:{id:'verified-officer',role:'Conservation Officer',status:'Active',mustChangePassword:false},pending:false},cache=createReviewQueueCache(()=>session,()=>{})
 let lifecycle='Superseded',release
 const row=()=>fixture({status:'Approved',historical_review:{state:'available',approval_capture:{id:'capture',status:lifecycle},fields:{content:{heightCm:20}},assets:[]}})
 const first=harness(url=>fixtureResponse(url,[row()]),{},'en',undefined,null,{queueCache:cache});await first.state.loadObservations();first.stop()
 lifecycle='unavailable'
 const h=harness(async()=>Response.json({names:{}}),{},'en',undefined,()=>new Promise(resolve=>{release=resolve}),{queueCache:cache})
 try{
  const work=h.state.loadObservations();await flush();assert.equal(h.state.queueRefreshing.value,true);assert.equal(nodes(reviewTable(h)).filter(n=>String(n.props?.class).includes('historical-version-badge')).length,1)
  release(Response.json({observations:[fixture({status:'Approved',historical_review:{state:'unavailable'}})],page:{has_more:false,next_cursor:null}}));await work
  assert.equal(h.state.queueRefreshing.value,false);assert.equal(h.state.observations.value[0].historicalVersion,false);assert.equal(nodes(reviewTable(h)).filter(n=>String(n.props?.class).includes('historical-version-badge')).length,0)
  assert.equal(cache.read().observations[0].historicalVersion,false)
 }finally{h.stop()}
 const css=descriptor.styles[0].content;assert.match(css,/has-historical-version \{ flex-direction: column; align-items: flex-start/);assert.match(css,/has-historical-version \.badge \{ max-width: 100%; white-space: normal/);assert.match(css,/status-column \{ width: 12rem/);assert.match(css,/actions-column \{ width: 16rem/)
})
