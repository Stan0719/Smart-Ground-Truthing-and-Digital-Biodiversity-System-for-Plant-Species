import { mapObservationEdit } from '../src/services/observationEdits.ts'
import { useOfficerCopyConfirmation } from '../src/composables/useOfficerCopyConfirmation.ts'
import { workflowBadgeStyle } from '../src/utils/workflowBadge.ts'
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { parse, compileScript, compileTemplate, compileStyle } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as vue from 'vue'
import * as observationReview from '../src/services/observationReview.ts'
import * as observationQueue from '../src/services/observationQueue.ts'
import { formatReviewTimestamp } from '../src/services/observationReviewHistory.ts'
import * as speciesRequestIntegration from '../src/services/reviewSpeciesRequest.ts'
import { formatPlantId } from '../src/utils/plantId.ts'
import postcss from 'postcss'

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
function assertReadOnlyObservationSources(h) {
  assert.ok(h.calls.every(call => (call.url.startsWith('/api/observations') || call.url.startsWith('/api/conservation/submitter-names?')) &&
    (!call.options.method || call.options.method === 'GET') && call.options.credentials === 'same-origin'),
    'identity display reads only the authorized Observation and name-directory contracts')
}
const flush = async () => {
  for (let i = 0; i < 4; i++) {
    await vue.nextTick()
    await new Promise(setImmediate)
  }
}
const officer = { id: 'officer', role: 'Conservation Officer', status: 'Active', mustChangePassword: false }
const summaryStates = ['Pending Review','Correction Required','Flagged','Rejected','Approved']
const summaryCards = h => nodes(h.render()).filter(node => node.type === 'article' && String(node.props?.class).includes('observation-summary-card'))

test('five informational status cards count each loaded observation once in the subsequent queue, including normalized statuses',async()=>{
  const rows=['subsequent_observation','initial_registration','unknown'].flatMap(origin=>summaryStates.map((status,index)=>fixture({id:origin+'-'+index,origin_type:origin,status:status.toUpperCase().replaceAll(' ','_')})))
  rows.push(fixture({id:'draft',status:'Draft'}));rows.push(rows[0])
  const h=harness(async()=>Response.json({observations:rows}));try{
    h.state.queueOrigin.value = 'subsequent_observation' // Only verified subsequent records belong to this page.

    await h.state.loadObservations()
    assert.deepEqual(Array.from(h.state.summaryCounts.value,item=>item.status),summaryStates)
    assert.deepEqual(Array.from(h.state.summaryCounts.value,item=>item.count),[1,1,1,1,1])
    h.state.search.value='no matches';h.state.species.value='missing';h.state.owner.value='missing';h.state.date.value='2026-01-01'
    assert.equal(h.state.filtered.value.length,0);assert.deepEqual(Array.from(h.state.summaryCounts.value,item=>item.count),[0,0,0,0,0])
    const cards=summaryCards(h);assert.equal(cards.length,5);assert.ok(cards.every(card=>nodes(card).filter(node=>node.type==='svg').length===1))
    assert.ok(cards.every(card=>!card.props.onClick&&!nodes(card).some(node=>node.type==='button'||node.type==='a')))
    const tree=nodes(h.render());assert.ok(tree.findIndex(node=>node.props?.class==='observation-summary')<tree.findIndex(node=>node.props?.class==='control-bar'))
    assert.equal(h.calls.filter(call=>call.url.startsWith('/api/observations')).length,1,'cards never issue a count request or change filters')
  }finally{h.stop()}
})

test('summary totals include every loaded page, deduplicate page overlaps and show unavailable while loading more',async()=>{
  const first=Array.from({length:100},(_,index)=>fixture({id:'loaded-'+index,status:summaryStates[index%5]}))
  const next=Array.from({length:25},(_,index)=>fixture({id:'additional-'+index,status:summaryStates[index%5]}))
  let release
  const h=harness(async()=>Response.json({}),officer,false,async url=>url.includes('cursor=')?new Promise(resolve=>{release=resolve}):Response.json({observations:first,page:{has_more:true,next_cursor:'next-page'}}))
  try{
    await h.state.loadObservations();assert.ok(h.state.summaryCounts.value.every(item=>item.count===null))
    const pending=h.state.loadObservations(true);await vue.nextTick()
    assert.ok(h.state.summaryCounts.value.every(item=>item.count===null))
    release(Response.json({observations:[first[0],...next],page:{has_more:false,next_cursor:null}}));await pending
    assert.equal(h.state.observations.value.length,125);assert.deepEqual(Array.from(h.state.summaryCounts.value,item=>item.count),[25,25,25,25,25])
  }finally{h.stop()}
})

test('loading, errors and unauthorized sessions display unavailable summary values; an authorized empty result displays genuine zeros',async()=>{
  const h=harness(async()=>Response.json({observations:[]}));try{
    assert.ok(h.state.summaryCounts.value.every(item=>item.count===null))
    assert.ok(summaryCards(h).every(card=>nodes(card).find(node=>node.type==='strong').children==='\u2014'))
    await h.state.loadObservations();assert.ok(h.state.summaryCounts.value.every(item=>item.count===0))
    h.state.loadError.value='Unavailable';assert.ok(h.state.summaryCounts.value.every(item=>item.count===null))
    h.state.loadError.value='';h.changeSession(null);assert.ok(h.state.summaryCounts.value.every(item=>item.count===null))
  }finally{h.stop()}
})

test('summary palette, icons and responsive layout match Review Submissions without modifying its stylesheet',()=>{
  const own=[];postcss.parse(descriptor.styles[0].content).walkRules(rule=>own.push(rule))
  const reviewSource=readFileSync(new URL('../src/views/conservation/ReviewSubmissionsView.vue',import.meta.url),'utf8'),review=[]
  postcss.parse(parse(reviewSource).descriptor.styles[0].content).walkRules(rule=>review.push(rule))
  const declarations=rule=>Object.fromEntries(rule.nodes.filter(node=>node.type==='decl').map(node=>[node.prop,node.value]))
  for(const status of summaryStates){
    const actual=declarations(own.find(rule=>rule.selector.endsWith(`[data-status="${status}"]`)))
    const theme=status.toLowerCase().replaceAll(' ','-')
    const expected=declarations(review.find(rule=>rule.selector===`.review-summary-${theme}`))
    assert.equal(actual['--observation-summary-background'],expected['--review-summary-background']);assert.equal(actual['--observation-summary-ink'],expected['--review-summary-ink'])
  }
  assert.equal(declarations(own.find(rule=>rule.selector==='.observation-summary-grid'))['grid-template-columns'],'repeat(5, minmax(0, 1fr))')
  assert.equal(declarations(own.find(rule=>rule.selector==='.observation-summary-card')).border,'1px solid currentColor')
  for(const[width,columns]of [[1150,'repeat(3, minmax(0, 1fr))'],[760,'repeat(2, minmax(0, 1fr))'],[420,'minmax(0, 1fr)']])assert.ok(own.some(rule=>rule.parent.params===`(max-width: ${width}px)`&&declarations(rule)['grid-template-columns']===columns))
})

test('status labels stay localized without the removed scope note in all supported languages',async()=>{
  for(const language of ['en','ms','zh-CN']){
    const h=harness(async()=>Response.json({observations:[]}),officer,false,null,language)
    try{
      await h.state.loadObservations();const locale=JSON.parse(readFileSync(new URL(`../src/locales/${language}.json`,import.meta.url),'utf8'))
      assert.ok(locale.conservationPages.observations.summaryTitle);assert.equal(locale.conservationPages.observations.summaryScope,undefined)
      const tree=nodes(h.render());assert.ok(!tree.some(node=>node.props?.id==='observation-summary-scope'))
      assert.ok(summaryCards(h).every(card=>!nodes(card).some(node=>typeof node.children==='string'&&node.children.startsWith('conservationPages.'))))
    }finally{h.stop()}
  }
})
function harness(fetchHandler, initialUser = officer, pending = false, queueHandler = null, language = 'en', options = {}) {
  const messages = JSON.parse(readFileSync(new URL(`../src/locales/${language}.json`, import.meta.url), 'utf8'))
  let session = { user: initialUser, pending }
  const sessionListeners = new Set()
  const scope = vue.effectScope()
  const calls = [], unmount = [], mounted = []
  const route = vue.reactive({ query: options.query || {} })
  const t = (key, params = {}) => {
    const found = key.split('.').reduce((entry, part) => entry?.[part], messages)
    const value = typeof found === 'string' ? found : key
    return Object.entries(params).reduce((text, [name, replacement]) =>
      text.replaceAll(`{${name}}`, String(replacement)), value)
  }
  const summaryCalls = []
  const exports = {}
  const context = {
    exports,
    Error,
    AbortSignal,
    AbortController,
    console,
    window: { setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {}, ...options.window },
    document: options.document || { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
    Date: options.Date || Date,
    navigator: { clipboard: options.clipboard },
    fetch: async (url, requestOptions) => {
      if (url.startsWith('/api/observations?') && requestOptions?.cache === 'no-store') {
        summaryCalls.push({ url, options: requestOptions })
        return options.summaryHandler ? options.summaryHandler(url, requestOptions) : Response.json({ error: 'No summary fixture' }, { status: 503 })
      }
      calls.push({ url, options: requestOptions })
      if (url.startsWith('/api/observations?')) {
        if (queueHandler) return queueHandler(url, requestOptions)
        const response = await fetchHandler('/api/observations', requestOptions)
        if (!response.ok) return response
        const result = await response.json()
        return Response.json({ ...result, page: { has_more: false, next_cursor: null } })
      }
      return fetchHandler(url, requestOptions)
    },
    require(name) {
    if (name.endsWith('.css')) return {}
    if (name.includes('useOfficerCopyConfirmation')) return { useOfficerCopyConfirmation }
      if (name.endsWith('officerDropdown')) return { vOfficerDropdown: {} }
    if (name.endsWith('workflowBadge')) return { workflowBadgeStyle }
      if (name.endsWith('databaseTranslation')) return { trackDatabaseTranslationFields() {} }
      if (name === 'vue') return {
        ...vue,
        onMounted(callback) { mounted.push(callback) },
        onBeforeUnmount(callback) { unmount.push(callback) },
        resolveComponent: (component) => component,
        withDirectives: (node) => node,
      }
      if (name === 'vue-router') return { useRoute: () => route }
      if (name === 'vue-i18n') return { useI18n: () => ({ t, te: (key) => typeof key.split('.').reduce((entry, part) => entry?.[part], messages) === 'string', locale: vue.ref('en') }) }
      if (name.endsWith('/auth')) return { currentUser: async () => session.user, sessionSnapshot: () => session, subscribeSession: fn => { sessionListeners.add(fn); return () => sessionListeners.delete(fn) } }
      if (name.endsWith('observationReview')) return observationReview
      if (name.endsWith('observationQueue')) return observationQueue
      if (name.endsWith('observationReviewHistory')) return { formatReviewTimestamp }
      if (name.endsWith('reviewSpeciesRequest')) return speciesRequestIntegration
      if (name.endsWith('plantId')) return { formatPlantId }
      if (name.endsWith('.vue')) return { name }
      throw Error(`Unexpected import: ${name}`)
    },
  }
  const testableScript = script.content.replaceAll('void refreshSummary()', 'exports.summaryTask = refreshSummary()')
  vm.runInNewContext(`(function () { ${transpile(testableScript)} })()`, context)
  const state = scope.run(() => exports.default.setup({}, { expose() {} }))
  Object.defineProperty(state, 'summaryTask', { get: () => exports.summaryTask })
  // The child queue is stubbed here; emulate its completed empty state by default.
  state.receiveProposalState({rows:[],names:{},loading:false,error:''})
  vm.runInNewContext(`(function () { ${transpile(template.code)} })()`, context)
  let didMount = false
  return { state, calls, summaryCalls, route, mount() { if (!didMount) { didMount = true; mounted.forEach(callback => callback()) } }, changeSession(user, pending = false) { session = { user, pending }; for (const fn of sessionListeners) fn(user, pending) }, render: () => exports.render({}, [], {}, vue.proxyRefs(state), {}, {}), stop: () => { unmount.forEach(callback => callback()); scope.stop() } }
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
    const reviewButtons = nodes(h.render()).filter(node => node.type === 'button' && String(node.props?.class).split(/\s+/).includes('observation-icon-action') && node.props?.['aria-label'] === messages.conservationPages.observations.review)
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
    assert.ok(nodes(empty.render()).some((node) => node.children === messages.unifiedObservations.empty))
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

test('review comments are optional for approval and required for non-approval decisions; eligibility checks remain enforced', async () => {
  const { h } = reviewHarness()
  try {
    await h.state.open(h.state.mapObservation(fixture()), true)
    for (const decision of ['Rejected', 'Correction Required', 'Flagged']) {
      h.state.reviewComment.value = ' '
      await h.state.decide(decision)
      assert.ok(!h.calls.some(c => c.options?.method === 'POST'))
    }
  } finally { h.stop() }
  {
    const { h } = reviewHarness()
    try {
      await h.state.open(h.state.mapObservation(fixture()), true)
      h.state.reviewComment.value = ''
      await h.state.decide('Approved')
      assert.ok(h.calls.some(c => c.options?.method === 'POST' && JSON.parse(c.options.body).comment === ''))
    } finally { h.stop() }
  }
  for (const changes of [{ revision: 0 }, { revision: null }, { owner_subject: 'staff:officer' }, { species_request_id: '12' }, { species_request_id: '12', species_request: { request_id: '12', request_status: 'Pending Review' } }]) {
    const { h } = reviewHarness(fixture(changes))
    try { await h.state.open(h.state.mapObservation(fixture(changes)), true); assert.equal(h.state.reviewAllowed.value, false); await h.state.decide('Approved'); assert.ok(!h.calls.some(c => c.options?.method === 'POST')) }
    finally { h.stop() }
  }
})

test('Observation review comment label is concise and localized without changing the shared optional suffix', async () => {
  for (const language of ['en', 'ms', 'zh-CN']) {
    const h = harness(identityHandler([fixture()]), officer, false, null, language)
    try {
      await h.state.loadObservations()
      await h.state.open(h.state.observations.value[0], true)
      const field = nodes(h.render()).find(node => node.props?.id === 'observation-review-comment')
      const dictionary = JSON.parse(readFileSync(new URL(`../src/locales/${language}.json`, import.meta.url), 'utf8'))
      assert.equal(field.props.label, dictionary.conservationPages.observations.reviewComment)
      assert.ok(!field.props.label.includes('required for rejection'))
    } finally { h.stop() }
  }
  const sharedField = readFileSync(new URL('../src/components/conservation/ReviewCommentField.vue', import.meta.url), 'utf8')
  assert.match(sharedField, /t\('reviewComments\.optionalForApproval'\)/)
})

test('modal-wide bottom-right decision footer follows history and preserves all four submission handlers', async () => {
  for (const decision of ['Approved', 'Rejected', 'Correction Required', 'Flagged']) {
    const { h } = reviewHarness(fixture(), (_url, _options, set) => {
      set(fixture({ status: decision, revision: 5 }))
      return Response.json({ reviewed: true })
    })
    try {
      await h.state.loadObservations()
      await h.state.open(h.state.observations.value[0], true)
      h.state.reviewComment.value = 'Verified with field evidence'
      const rendered = nodes(h.render())
      const footer = rendered.find(node => String(node.props?.class).includes('observation-decision-actions'))
      const form = rendered.find(node => node.props?.class === 'officer-review')
      const history = rendered.find(node => node.type === 'ObservationReviewHistory')
      assert.ok(footer)
      assert.ok(!nodes(form).includes(footer))
      const columns = rendered.find(node => node.props?.class === 'observation-dialog-columns')
      assert.ok(!nodes(columns).includes(footer))
      assert.ok(rendered.indexOf(history) < rendered.indexOf(footer))
      const buttons = nodes(footer).filter(node => node.type === 'button')
      assert.equal(buttons.length, 4)
      const button = buttons.find(node => node.key === decision)
      assert.equal(button.props.disabled, false)
      await button.props.onClick()
      const posts = h.calls.filter(call => call.options?.method === 'POST')
      assert.equal(posts.length, 1)
      assert.equal(posts[0].url, '/api/observations/' + uuid + '/review')
      assert.deepEqual(JSON.parse(posts[0].options.body), { decision, comment: 'Verified with field evidence', revision: 4 })
      assert.equal(h.state.reviewHistoryRefresh.value, 1)
    } finally { h.stop() }
  }
})

test('missing comments focus one inline validation message without a duplicate toast', async () => {
  const { h } = reviewHarness()
  try {
    await h.state.open(h.state.mapObservation(fixture()), true)
    for (const decision of ['Rejected', 'Correction Required', 'Flagged']) {
      h.state.reviewComment.value = ' '
      await h.state.decide(decision)
      const rendered = nodes(h.render())
      const field = rendered.find(node => node.props?.id === 'observation-review-comment')
      assert.equal(field.props.placeholder, 'Record the observation decision or required action')
      assert.equal(field.props.invalid, true)
      assert.match(readFileSync(filename, 'utf8'), /:described-by="reviewCommentError \? 'observation-review-comment-error' : undefined"/)
      const error = rendered.find(node => node.props?.id === 'observation-review-comment-error')
      assert.equal(error.props.role, 'alert')
      assert.ok(!rendered.some(node => node.props?.variant === 'error' && node.props?.message === h.state.rt('feedback.commentRequired')))
      assert.ok(!h.calls.some(call => call.options?.method === 'POST'))
    }
    h.state.closeModal()
    assert.equal(h.state.reviewFeedback.value, '')
  } finally { h.stop() }
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
    assert.equal(h.state.reviewHistoryRefresh.value, 1)
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

test('the subsequent queue excludes registration and legacy rows without the removed historical access panel', async () => {
  const field=fixture(), initial=fixture({id:'21',origin_type:'initial_registration'}), legacy=fixture({id:'22',origin_type:'unknown'})
  const h=harness(async()=>Response.json({observation:field}),officer,false,async()=>Response.json({observations:[field,initial,legacy],page:{has_more:false,next_cursor:null}}))
  try {
    await h.state.loadObservations()
    assert.deepEqual(Array.from(h.state.filtered.value,row=>row.id),[field.id])
    assert.ok(h.calls[0].url.includes('origin_type=subsequent_observation'))
    await h.state.open(h.state.filtered.value[0],true); assert.equal(h.state.reviewAllowed.value,true)
    assert.ok(!nodes(h.render()).some(n=>n.props?.to?.name==='conservation-reviews'&&n.props.to.query.legacy==='1'))
    assert.ok(!h.calls.some(call=>call.options.method==='POST'))
  } finally {h.stop()}
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

const queueResponse = (observations = [], cursor = null) => Response.json({ observations, page: { has_more: cursor !== null, next_cursor: cursor } })
const queueCalls = h => h.calls.filter(call => call.url.startsWith('/api/observations?'))

test('bounded scanning advances through empty/nonmatching pages and stops on real subsequent records without changing filters or review', async () => {
  const pages = [queueResponse([], 'a'), queueResponse([fixture({ id: 'initial', origin_type: 'initial_registration' }), fixture({ id: 'legacy', origin_type: 'unknown' })], 'b'),
    queueResponse([fixture(), fixture({ id: 'rejected', status: 'Rejected' })], 'c')]
  const h = harness(async () => Response.json({}), officer, false, async () => pages.shift())
  try {
    h.state.queueOrigin.value = 'subsequent_observation' // Only verified subsequent records belong to this page.

    h.state.search.value = 'PL007'; h.state.species.value = '3'; h.state.owner.value = 'staff:real-botanist-subject'; h.state.date.value = h.state.dateKey(fixture().created_at)
    await h.state.loadObservations()
    assert.equal(queueCalls(h).length, 3)
    assert.ok(queueCalls(h).every(call => new URL(call.url, 'https://fixture.invalid').searchParams.get('origin_type') === 'subsequent_observation'))
    assert.ok(queueCalls(h)[1].url.includes('cursor=a')); assert.ok(queueCalls(h)[2].url.includes('cursor=b'))
    assert.deepEqual(Array.from(h.state.filtered.value, item => item.id), [uuid, 'rejected'])
    assert.equal(h.state.canReviewField(h.state.filtered.value[0]), true); assert.equal(h.state.canReviewField(h.state.filtered.value[1]), false)
    assert.ok(h.state.summaryCounts.value.every(item => item.count === null), 'a partial queue cannot supply complete summary totals')
    assert.equal(h.state.hasMore.value, true); assert.equal(h.state.nextCursor.value, 'c'); assert.equal(h.state.autoScanLimited.value, false)
    assert.equal(h.state.search.value, 'PL007'); assert.equal(h.state.species.value, '3'); assert.equal(h.state.owner.value, 'staff:real-botanist-subject')
  } finally { h.stop() }
})

test('automatic scans stop on exhaustion, matching non-reviewable statuses, or the five-request cap with a working continuation', async () => {
  for (const rows of [[], [fixture({ status: 'Correction Required' })], [fixture({ status: 'Rejected' })]]) {
    const pages = [queueResponse([], 'a'), queueResponse(rows)]
    const h = harness(async () => Response.json({}), officer, false, async () => pages.shift())
    try { await h.state.loadObservations(); assert.equal(queueCalls(h).length, 2); assert.equal(h.state.hasMore.value, false); assert.equal(h.state.nextCursor.value, null); assert.equal(h.state.autoScanLimited.value, false) } finally { h.stop() }
  }
  let count = 0
  const h = harness(async () => Response.json({}), officer, false, async () => ++count <= 5 ? queueResponse([], 'page-' + count) : queueResponse([fixture()]))
  try {
    await h.state.loadObservations(); assert.equal(queueCalls(h).length, 5); assert.equal(h.state.AUTO_SCAN_PAGE_LIMIT, 5)
    assert.equal(h.state.autoScanLimited.value, true); assert.equal(h.state.nextCursor.value, 'page-5'); assert.equal(h.state.hasMore.value, true)
    const tree = nodes(h.render())
    assert.ok(tree.some(n => n.children === messages.conservationPages.observations.paginationPaused))
    assert.ok(tree.some(n => n.children === messages.conservationPages.observations.emptyMore))
    assert.ok(!tree.some(n => n.children === messages.conservationPages.reviews.queues.noFieldObservations))
    const more = tree.find(n => n.type === 'button' && n.children === messages.conservationPages.reviews.queues.loadMore)
    assert.ok(more); assert.equal(more.props.disabled, false)
    more.props.onClick(); await flush()
    assert.equal(queueCalls(h).length, 6); assert.ok(queueCalls(h)[5].url.includes('cursor=page-5'))
    assert.equal(h.state.filtered.value[0].id, uuid); assert.equal(h.state.hasMore.value, false)
  } finally { h.stop() }
})

test('repeated and cyclic cursors terminate scanning, retain loaded rows and require a fresh queue', async () => {
  for (const cursors of [['a', 'a'], ['a', 'b', 'a']]) {
    const h = harness(async () => Response.json({}), officer, false, async () => queueResponse([], cursors.shift()))
    try {
      await h.state.loadObservations(); assert.ok(queueCalls(h).length <= 3)
      assert.equal(h.state.loadError.value, messages.conservationPages.observations.paginationInvalid)
      assert.equal(h.state.nextCursor.value, null); assert.equal(h.state.hasMore.value, false)
      const requests = queueCalls(h).length; await h.state.loadObservations(true); assert.equal(queueCalls(h).length, requests)
    } finally { h.stop() }
  }
  const pages = [queueResponse([fixture()], 'a'), queueResponse([], 'b'), queueResponse([], 'a')]
  const h = harness(async () => Response.json({}), officer, false, async () => pages.shift())
  try {
    await h.state.loadObservations(); await h.state.loadObservations(true)
    assert.equal(h.state.observations.value.length, 1); assert.ok(h.state.loadError.value); assert.equal(queueCalls(h).length, 3)
  } finally { h.stop() }
})

test('later-page errors preserve loaded records and the latest successful cursor; Retry resumes there', async () => {
  const pages = [queueResponse([fixture()], 'a'), queueResponse([], 'b'), Response.json({ error: 'Temporary queue failure' }, { status: 503 }),
    queueResponse([fixture(), fixture({ id: 'older', status: 'Rejected' })])]
  const h = harness(async () => Response.json({}), officer, false, async () => pages.shift())
  try {
    await h.state.loadObservations(); await h.state.loadObservations(true)
    assert.equal(h.state.filtered.value.length, 1); assert.equal(h.state.nextCursor.value, 'b'); assert.equal(h.state.hasMore.value, true)
    assert.equal(h.state.loadError.value, messages.conservationPages.observations.errors.requestFailed.replace('{status}','503'))
    nodes(h.render()).find(n => n.type === 'button' && n.children === messages.conservationPages.observations.retry).props.onClick(); await flush()
    assert.ok(queueCalls(h)[3].url.includes('cursor=b')); assert.equal(h.state.filtered.value.length, 2)
    assert.equal(h.state.observations.value.filter(item => item.id === uuid).length, 1); assert.equal(h.state.loadError.value, '')
  } finally { h.stop() }
})

test('duplicate-only pages do not stop discovery or duplicate records', async () => {
  const pages = [queueResponse([fixture()], 'a'), queueResponse([fixture()], 'b'), queueResponse([fixture({ id: 'new' })])]
  const h = harness(async () => Response.json({}), officer, false, async () => pages.shift())
  try {
    await h.state.loadObservations(); await h.state.loadObservations(true)
    assert.equal(queueCalls(h).length, 3); assert.deepEqual(Array.from(h.state.filtered.value, item => item.id), [uuid, 'new'])
  } finally { h.stop() }
})

test('automatic scanning stays sequential, preserves the server status filter and reports loading until a match arrives', async () => {
  let release
  const h = harness(async () => Response.json({}), officer, false, async url => {
    if (url.includes('cursor=')) return new Promise(resolve => { release = resolve })
    return queueResponse([], 'next')
  })
  try {
    h.state.status.value = 'Rejected'
    const work = h.state.loadObservations(); await flush()
    assert.equal(h.state.isLoading.value, true); assert.equal(queueCalls(h).length, 2)
    assert.ok(nodes(h.render()).some(n => n.children === messages.conservationPages.observations.scanning))
    assert.ok(h.state.summaryCounts.value.every(item => item.count === null))
    await h.state.loadObservations(true); assert.equal(queueCalls(h).length, 2)
    release(queueResponse([fixture({ status: 'Rejected' })], 'later')); await work
    assert.ok(queueCalls(h).every(call => new URL(call.url, 'https://fixture.invalid').searchParams.get('status') === 'Rejected'))
    assert.equal(h.state.filtered.value[0].status, 'Rejected'); assert.equal(h.state.canReviewField(h.state.filtered.value[0]), false)
    assert.equal(h.state.isLoading.value, false); assert.equal(queueCalls(h).length, 2)
  } finally { h.stop() }
})

test('queue/status changes abort an automatic scan immediately and late pages cannot replace the new queue', async () => {
  for (const change of ['status']) {
    let release, oldSignal
    const h = harness(async () => Response.json({}), officer, false, async (url, options) => {
      const query = new URL(url, 'https://fixture.invalid').searchParams
      if (query.get('cursor') === 'old') { oldSignal = options.signal; return new Promise(resolve => { release = resolve }) }
      if (query.get('origin_type') === 'unknown' || query.get('status') === 'Rejected') return queueResponse([fixture({ id: 'current', origin_type: change === 'origin' ? 'unknown' : 'subsequent_observation', status: 'Rejected' })])
      return queueResponse([], 'old')
    })
    try {
      const old = h.state.loadObservations(); await flush(); assert.equal(h.state.isLoading.value, true)
      if (change === 'origin') h.state.queueOrigin.value = 'unknown'; else h.state.status.value = 'Rejected'
      assert.equal(oldSignal.aborted, true)
      await h.state.loadObservations(); release(queueResponse([fixture()], 'stale')); await old
      assert.deepEqual(Array.from(h.state.filtered.value, item => item.id), ['current'])
      assert.equal(h.state.hasMore.value, false); assert.equal(h.state.nextCursor.value, null); assert.equal(queueCalls(h).length, 3)
    } finally { h.stop() }
  }
})

test('logout, account switching and unmount abort scans without errors or late private rows', async () => {
  for (const change of ['logout', 'account', 'unmount']) {
    let release, signal, count = 0
    const h = harness(async () => Response.json({}), officer, false, async (url, options) => {
      if (++count === 1) return queueResponse([], 'next')
      signal = options.signal; return new Promise(resolve => { release = resolve })
    })
    let stopped = false
    try {
      const old = h.state.loadObservations(); await flush()
      if (change === 'unmount') { h.stop(); stopped = true }
      else h.changeSession(change === 'logout' ? null : { ...officer, id: 'another-officer' })
      assert.equal(signal.aborted, true)
      release(queueResponse([fixture()], 'stale')); await old
      assert.equal(h.state.observations.value.length, 0); assert.equal(h.state.loadError.value, ''); assert.equal(h.state.hasMore.value, false); assert.equal(count, 2)
    } finally { if (!stopped) h.stop() }
  }
})

test('local filters preserve table scanning and recalculate summaries only after complete verification', async () => {
  for (const more of [true, false]) {
    const h = harness(async () => Response.json({}), officer, false, async () => queueResponse([fixture()], more ? 'next' : null))
    try {
      h.state.search.value = 'not matching'; await h.state.loadObservations()
      assert.equal(queueCalls(h).length, 1); assert.equal(h.state.filtered.value.length, 0); assert.equal(h.state.filtersHideLoaded.value, true)
      assert.equal(h.state.summaryCounts.value.find(item => item.status === 'Pending Review').count, more ? null : 0)
      assert.ok(nodes(h.render()).some(n => n.children === messages.conservationPages.observations[more ? 'filteredMore' : 'filteredLoaded']))
      h.state.search.value = ''; assert.equal(h.state.filtered.value.length, 1); assert.equal(queueCalls(h).length, 1);assert.equal(h.state.summaryCounts.value.find(item=>item.status==='Pending Review').count,more?null:1)
    } finally { h.stop() }
  }
})

test('scanning and continuation guidance is translated in every supported locale', async () => {
  const keys = ['scanning', 'paginationMore', 'paginationPaused', 'emptyMore', 'filteredLoaded', 'filteredMore', 'paginationInvalid']
  for (const language of ['en', 'ms', 'zh-CN']) {
    const localized = JSON.parse(readFileSync(new URL(`../src/locales/${language}.json`, import.meta.url), 'utf8'))
    assert.ok(keys.every(key => typeof localized.conservationPages.observations[key] === 'string' && localized.conservationPages.observations[key].length > 0))
    let page = 0
    const h = harness(async () => Response.json({}), officer, false, async () => queueResponse([], 'next-' + ++page), language)
    try { await h.state.loadObservations(); assert.ok(nodes(h.render()).some(n => n.children === localized.conservationPages.observations.paginationPaused)) } finally { h.stop() }
  }
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
      const buttons = nodes(h.render()).filter(n => n.type === 'button' && [messages.conservationPages.observations.review, messages.common.viewDetails].includes(n.props?.['aria-label']) && String(n.props?.class).split(/\s+/).includes('observation-icon-action'))
      assert.equal(buttons.length, 1, JSON.stringify(changes))
      assert.equal(buttons[0].props['aria-label'], eligible ? messages.conservationPages.observations.review : messages.common.viewDetails)
      await buttons[0].props.onClick(); await flush()
      assert.equal(h.state.selected.value.id, uuid)
      assert.equal(h.state.reviewMode.value, eligible)
      assert.equal(Boolean(nodes(h.render()).find(n => n.props?.class === 'officer-review')), eligible)
      assert.equal(h.calls.filter(c => c.options?.method === 'POST').length, 0)
      assert.equal(h.state.selected.value.latitude, '0'); assert.equal(h.state.selected.value.assets.length, 2)
    } finally { h.stop() }
  }
})

test('initial and legacy records cannot acquire normal Observation actions', async () => {
  for(const origin of ['initial_registration','unknown']) {
    const h=harness(async()=>Response.json({observation:fixture({origin_type:origin})}))
    try {
      h.state.isLoading.value=false; h.state.observations.value=[h.state.mapObservation(fixture({origin_type:origin}))]
      assert.equal(h.state.filtered.value.length,0)
      assert.ok(!nodes(h.render()).some(n=>n.props?.class==='action-group'))
      assert.ok(!nodes(h.render()).some(n=>n.props?.to?.name==='conservation-reviews'&&n.props.to.query.legacy==='1'))
      assert.ok(!h.calls.some(call=>call.options.method==='POST'))
    } finally {h.stop()}
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
        assert.ok(nodes(h.render()).some(n => n.type === 'button' && n.props?.['aria-label'] === expected))
      }
    } finally { h.stop() }
  }
})

const identityHandler = rows => async url => Response.json(url === '/api/observations' ? { observations: rows }
  : { observation: rows.find(row => url === `/api/observations/${row.id}`) || rows[0] })
const copyButtons = h => nodes(h.render()).filter(node => node.type === 'button' && node.props?.class === 'identifier-copy')

test('observation aliases extend loaded collisions, handle legacy IDs and remain distinct without changing raw identities', async () => {
  const ids = ['00d5ddca-1111-4111-8111-111111111111', '00d5ddca-2222-4222-8222-222222222222', '00d5ddca-1111-4333-8333-333333333333', 'legacy-prefix-first', 'legacy-prefix-second', '17']
  const rows = ids.map((id, index) => fixture({ id, scientific_name: `Species ${index}` }))
  const h = harness(identityHandler(rows))
  try {
    await h.state.loadObservations()
    assert.deepEqual(Array.from(h.state.observations.value, item => item.id), ids)
    const labels = ids.map(id => h.state.observationLabel(id))
    assert.equal(new Set(labels).size, ids.length)
    assert.equal(labels[0], 'OBS-00D5DDCA11114111')
    assert.equal(labels[1], 'OBS-00D5DDCA2222')
    assert.equal(labels[2], 'OBS-00D5DDCA11114333')
    assert.equal(labels[5], 'OBS-17')
    h.state.search.value = 'Species 0'
    assert.equal(h.state.filtered.value.length, 1)
    assert.equal(h.state.observationLabel(ids[0]), labels[0], 'aliases use all loaded rows, not filtered rows')
    const caseVariant = ids[0].toUpperCase()
    const caseLabels = h.state.compactIdentifierTokens([ids[0], caseVariant])
    assert.notEqual(caseLabels.get(ids[0]), caseLabels.get(caseVariant))
    assert.equal(h.calls.filter(call=>call.url.startsWith('/api/observations')).length, 1)
  assertReadOnlyObservationSources(h)
  } finally { h.stop() }
})

test('single UUID display ignores uncontracted names and uses only the authorized directory lookup', async () => {
  const owner = 'staff:2ace382f-1010-4010-8010-101010101010'
  const rows = [fixture({ owner_subject: owner, owner_name: 'Uncontracted account name' })]
  const h = harness(identityHandler(rows))
  try {
    await h.state.loadObservations()
    assert.equal(h.state.observationLabel(uuid), 'OBS-5D8A3647')
    assert.equal(h.state.submitterLabel(owner), 'Staff \u00b7 2ACE382F')
    assert.equal(h.state.observations.value[0].ownerSubject, owner)
    assert.deepEqual(Array.from(h.state.ownerOptions.value), [owner])
    const tree = nodes(h.render())
    assert.ok(tree.some(node => node.type === 'strong' && node.children === 'OBS-5D8A3647' && node.props.title === uuid))
    assert.ok(tree.some(node => node.type === 'option' && node.props?.value === owner && node.children === 'Staff \u00b7 2ACE382F'))
    assert.ok(!tree.some(node => node.children === 'Uncontracted account name'))
    assert.ok(h.calls.every(call => call.url.startsWith('/api/observations') || call.url.startsWith('/api/conservation/submitter-names?')))
    const namesRequest=h.calls.find(call=>call.url.startsWith('/api/conservation/submitter-names?'));assert.ok(namesRequest);assert.equal(new URL(namesRequest.url,'https://fixture.invalid').searchParams.get('ids'),owner.slice(6));assert.equal(namesRequest.options.credentials,'same-origin')
    assert.equal(h.calls.filter(call=>call.url.startsWith('/api/observations')).length, 1)
    h.state.owner.value = owner; assert.equal(h.state.filtered.value.length, 1)
  assertReadOnlyObservationSources(h)
  } finally { h.stop() }
})

test('copy buttons write the exact full UUID and subject and give accessible success feedback without API writes', async () => {
  const owner = 'staff:2ace382f-1010-4010-8010-101010101010', writes = []
  const h = harness(identityHandler([fixture({ owner_subject: owner })]), officer, false, null, 'en', { clipboard: { writeText: async value => { writes.push(value) } } })
  try {
    await h.state.loadObservations()
    const requestsBeforeCopy = h.calls.length
    const buttons = copyButtons(h)
    assert.equal(buttons.length, 2)
    assert.match(buttons[0].props['aria-label'], /Copy full observation ID for OBS-5D8A3647/)
    assert.equal(buttons[0].props.type, 'button')
    await buttons[0].props.onClick()
    assert.deepEqual(writes, [uuid])
    assert.equal(h.state.copyFeedback.value, ''); assert.ok(h.state.controlToastKey.value)
    await copyButtons(h)[1].props.onClick()
    assert.deepEqual(writes, [uuid, owner])
    assert.equal(h.state.copyFeedback.value, ''); assert.ok(h.state.controlToastKey.value)
    const feedback = nodes(h.render()).find(node => String(node.props?.class).includes('copy-feedback'))
    assert.equal(feedback.props.role, 'status'); assert.equal(feedback.props['aria-live'], 'polite')
    assert.equal(feedback.props['aria-atomic'], 'true')
    assert.equal(h.calls.length, requestsBeforeCopy)
    assert.ok(h.calls.every(call => !call.options.method || call.options.method === 'GET'))
  } finally { h.stop() }
})

test('clipboard unavailable/denied leaves full identity available in compact observation detail tooltips', async () => {
  for (const clipboard of [undefined, { writeText: async () => { throw Error('Denied') } }]) {
    const h = harness(identityHandler([fixture()]), officer, false, null, 'en', { clipboard })
    try {
      await h.state.loadObservations(); await copyButtons(h)[0].props.onClick()
      assert.equal(h.state.copyFailed.value, true)
      assert.match(h.state.copyFeedback.value, /Open observation details/)
      await h.state.open(h.state.observations.value[0])
      const fullValues = nodes(h.render()).map(node => node.props?.title)
      assert.ok(fullValues.includes(uuid)); assert.ok(fullValues.includes(fixture().owner_subject))
      assert.ok(h.calls.some(call => call.url === `/api/observations/${uuid}`))
      assert.ok(h.calls.every(call => !call.options.method || call.options.method === 'GET'))
    } finally { h.stop() }
  }
})

test('modal identifiers match table labels and copy canonical observation and staff identities', async () => {
  const owner = 'staff:2ace382f-1010-4010-8010-101010101010', writes = []
  const h = harness(identityHandler([fixture({ owner_subject: owner })]), officer, false, null, 'en', { clipboard: { writeText: async value => { writes.push(value) } } })
  try {
    await h.state.loadObservations()
    const tableLabels = copyButtons(h).map(button => button.props['aria-label'])
    await h.state.open(h.state.observations.value[0], true)
    const buttons = copyButtons(h).slice(2)
    assert.equal(buttons.length, 2)
    assert.deepEqual(buttons.map(button => button.props['aria-label']), tableLabels)
    for (const button of buttons) await button.props.onClick()
    assert.deepEqual(writes, [uuid, owner])
    assert.ok(h.calls.every(call => !call.options.method || call.options.method === 'GET'))
  } finally { h.stop() }
})

test('search accepts canonical IDs, compact observation labels, plants, species and submitters while filters retain raw subjects', async () => {
  const owner = 'staff:2ace382f-1010-4010-8010-101010101010'
  const rows = [fixture({ owner_subject: owner }), fixture({ id: '6a8a3647-e3c3-43fa-b355-aabdddf05f71', owner_subject: 'staff:other', plant_id: 9, scientific_name: 'Other species', common_name: 'Other common' })]
  const h = harness(identityHandler(rows))
  try {
    await h.state.loadObservations()
    for (const query of [uuid, 'obs-5d8a3647', 'PL007', 'Shorea actualis', owner, 'Staff \u00b7 2ACE382F']) {
      h.state.search.value = query
      assert.deepEqual(Array.from(h.state.filtered.value, item => item.id), [uuid], query)
    }
    h.state.owner.value = 'staff:other'; assert.equal(h.state.filtered.value.length, 0)
    h.state.search.value = ''; assert.equal(h.state.filtered.value[0].ownerSubject, 'staff:other')
    h.state.owner.value = owner; assert.equal(h.state.filtered.value[0].id, uuid)
    await h.state.open(h.state.filtered.value[0])
    assert.equal(h.state.selected.value.id, uuid)
    assert.ok(h.calls.every(call => !call.url.includes('OBS-')))
  } finally { h.stop() }
})

test('copy honors Officer session state, suppresses duplicate pending operations and discards stale feedback after logout', async () => {
  for (const [user, pending] of [[null, false], [{ ...officer, role: 'Administrator' }, false], [{ ...officer, role: 'Botanist' }, false], [{ ...officer, status: 'Inactive' }, false], [{ ...officer, mustChangePassword: true }, false], [officer, true]]) {
    const copied = []
    const h = harness(identityHandler([fixture()]), user, pending, null, 'en', { clipboard: { writeText: async value => copied.push(value) } })
    try {
      await h.state.loadObservations(); await h.state.copyIdentifier(uuid, 'observation')
      assert.equal(copied.length, 0)
      assert.ok(copyButtons(h).every(button => button.props.disabled))
      assert.ok(h.calls.every(call => call.url.startsWith('/api/observations')))
    } finally { h.stop() }
  }
  let release, calls = 0
  const h = harness(identityHandler([fixture()]), officer, false, null, 'en', { clipboard: { writeText: () => { calls++; return new Promise(resolve => { release = resolve }) } } })
  try {
    await h.state.loadObservations()
    const copying = h.state.copyIdentifier(uuid, 'observation')
    await h.state.copyIdentifier(uuid, 'observation'); assert.equal(calls, 1)
    assert.ok(copyButtons(h).every(button => button.props.disabled))
    h.changeSession(null, true); release(); await copying
    assert.equal(h.state.copyFeedback.value, ''); assert.equal(h.state.copiedKey.value, '')
    assert.equal(h.state.observations.value.length, 0)
    assert.equal(copyButtons(h).length, 0)
  } finally { h.stop() }
})

test('compact identifier UI keeps bounded columns, touch/focus targets and complete translations', async () => {
  const css = descriptor.styles[0].content
  assert.match(css, /\.identity-cell\s*\{[^}]*white-space: normal/)
  assert.match(css, /\.observations-table \.observation-column\s*\{ width: 24%/)
  assert.match(css, /\.observations-table \.plant-column\s*\{ width: 14%/)
  assert.match(css, /\.observations-table \.submitter-column\s*\{ width: 13%/)
  assert.match(css, /\.identifier-line\s*\{[^}]*display: inline-flex; align-items: center; justify-content: flex-start; flex-wrap: nowrap; gap: 7px/)
  assert.match(css, /\.identifier-copy\s*\{[^}]*width: 44px; height: 44px/)
  assert.match(css, /\.identifier-copy:focus-visible\s*\{[^}]*outline:/)
  for (const language of ['en', 'ms', 'zh-CN']) {
    const h = harness(identityHandler([fixture()]), officer, false, null, language)
    try {
      await h.state.loadObservations()
      assert.equal(copyButtons(h).length, 2)
      for (const button of copyButtons(h)) assert.ok(!button.props['aria-label'].includes('conservationPages.'))
      const translated = JSON.parse(readFileSync(new URL(`../src/locales/${language}.json`, import.meta.url), 'utf8')).conservationPages.observations
      for (const key of ['staffIdentifier', 'visitorIdentifier', 'submitterIdentifier', 'copyObservationId', 'copySubject', 'copiedObservation', 'copiedSubject', 'copyUnavailable']) assert.ok(translated[key]?.trim(), `${language}.${key}`)
    } finally { h.stop() }
  }
})

test('submitter collisions extend their aliases, distinguish subject namespaces and keep full filter values', async () => {
  const subjects = ['staff:2ace382f-1111-4111-8111-111111111111', 'staff:2ace382f-2222-4222-8222-222222222222', 'visitor:abcd1234-1111-4111-8111-111111111111', 'imported-subject-long-value']
  const rows = subjects.map((owner_subject, index) => fixture({ id: `${index + 1}`, owner_subject }))
  const h = harness(identityHandler(rows))
  try {
    await h.state.loadObservations()
    assert.equal(h.state.submitterLabel(subjects[0]), 'Staff \u00b7 2ACE382F1111')
    assert.equal(h.state.submitterLabel(subjects[1]), 'Staff \u00b7 2ACE382F2222')
    assert.equal(h.state.submitterLabel(subjects[2]), 'Visitor \u00b7 ABCD1234')
    assert.equal(h.state.submitterLabel(subjects[3]), 'Submitter \u00b7 imported\u2026')
    for (const subject of subjects) {
      h.state.owner.value = subject
      assert.equal(h.state.filtered.value.length, 1)
      assert.equal(h.state.filtered.value[0].ownerSubject, subject)
    }
    assert.deepEqual(Array.from(h.state.ownerOptions.value), subjects)
    assert.equal(h.calls.filter(call=>call.url.startsWith('/api/observations')).length, 1)
  assertReadOnlyObservationSources(h)
  } finally { h.stop() }
})

test('only an exact current-Officer subject match can use the authenticated session name', async () => {
  const account = { ...officer, name: 'Aina Actual' }
  const rows = [fixture({ owner_subject: 'staff:officer' }), fixture({ id: '6a8a3647-e3c3-43fa-b355-aabdddf05f71', owner_subject: 'staff:someone-else', owner_name: 'Unauthorized name' })]
  const h = harness(identityHandler(rows), account)
  try {
    await h.state.loadObservations()
    assert.equal(h.state.submitterLabel('staff:officer'), 'Aina Actual')
    assert.notEqual(h.state.submitterLabel('staff:someone-else'), 'Aina Actual')
    assert.notEqual(h.state.submitterLabel('staff:someone-else'), 'Unauthorized name')
    h.state.search.value = 'aina actual'
    assert.deepEqual(Array.from(h.state.filtered.value, item => item.id), [uuid])
    assert.equal(h.state.observations.value[0].ownerSubject, 'staff:officer')
    assert.equal(h.state.canReviewField(h.state.observations.value[0]), false, 'self-review still uses the full subject')
    assert.equal(h.calls.filter(call=>call.url.startsWith('/api/observations')).length, 1)
    h.changeSession(account, true)
    assert.notEqual(h.state.submitterLabel('staff:officer'), 'Aina Actual', 'unverified sessions do not resolve names')
  assertReadOnlyObservationSources(h)
  } finally { h.stop() }
})

const mainObservationTable = h => nodes(h.render()).find(node => node.type === 'table' && node.props?.class === 'observations-table')
const observationCells = row => nodes(row).filter(node => node.type === 'td')
const renderedText = node => typeof node === 'string' ? node : typeof node?.children === 'string' ? node.children : Array.isArray(node?.children) ? node.children.map(renderedText).join('') : ''

test('main table has seven columns and keeps Plant identity in its own column, with existing action access', async () => {
  const longName = 'Long species name '.repeat(35) + 'UnbrokenName'.repeat(40)
  const rows = ['Draft', 'Pending Review', 'Approved', 'Rejected', 'Correction Required', 'Flagged'].map((status, index) => fixture({ id: String(index + 1), status, scientific_name: longName, plant_scientific_name: 'Yellow Simpoh Air' }))
  const h = harness(identityHandler(rows))
  try {
    await h.state.loadObservations()
    const table = mainObservationTable(h), headers = nodes(table).filter(node => node.type === 'th')
    assert.deepEqual(headers.map(node => node.children), ['Submission ID', 'Plant ID', 'Species', 'Submitted By', 'Status', 'Created', 'Actions'])
    assert.equal(headers.filter(node => node.children === 'Status').length, 1)
    assert.ok(!headers.some(node => node.children === 'Review State'))
    assert.ok(headers.every(node => node.props.scope === 'col'))
    assert.equal(nodes(table).filter(node => node.type === 'col').length, 7)
    const dataRows = nodes(table).filter(node => node.type === 'tr' && observationCells(node).length)
    assert.equal(dataRows.length, rows.length)
    dataRows.forEach((row, index) => {
      const cells = observationCells(row), item = h.state.observations.value[index]
      assert.equal(cells.length, headers.length)
      assert.ok(nodes(cells[0]).some(node => node.children === h.state.observationLabel(item.id)))
      const identityNodes = nodes(cells[0]), typeIndex = identityNodes.findIndex(node => node.props?.class === 'submission-type-badge submission-type-original')
      assert.ok(typeIndex >= 0, 'submission type remains below the submission ID')
      const plantNodes = nodes(cells[1])
      assert.ok(renderedText(cells[1]).includes(item.plantDisplayId))
      assert.ok(plantNodes.some(node => node.type === 'strong' && node.children === item.plantDisplayId))
      assert.ok(plantNodes.some(node => node.type === 'em' && node.children === item.plantScientificName))
      assert.ok(plantNodes.some(node => node.props?.class === 'plant-id-value'))
      assert.ok(nodes(cells[2]).some(node => node.type === 'em'))
      assert.ok(nodes(cells[3]).some(node => node.children === h.state.submitterLabel(item.ownerSubject)))
      assert.ok(nodes(cells[4]).some(node => String(node.props?.class).split(/\s+/).includes('badge') && node.children === h.state.label(item.status)))
      assert.ok(renderedText(cells[5]).length > 0)
      assert.ok(nodes(cells[0]).some(node => node.props?.class === 'observation-cell-label'))
      const actions = nodes(cells[6])
      assert.ok(actions.some(node => node.type === 'button' && ['Review', 'View Details'].includes(node.props?.['aria-label'])))
      assert.ok(actions.some(node => node.props?.to === '/plant/PL007'))
      assert.ok(actions.some(node => node.type === 'button' && node.props?.['aria-label'] === 'History'))
      assert.ok(!actions.some(node => node.props?.to?.name === 'conservation-map'))
      assert.equal(nodes(cells[0]).filter(node => node.props?.class === 'identifier-copy').length, 1)
      assert.equal(nodes(cells[3]).filter(node => node.props?.class === 'identifier-copy').length, 1)
    })
    assert.equal(h.calls.filter(call=>call.url.startsWith('/api/observations')).length, 1)
  assertReadOnlyObservationSources(h)
  } finally { h.stop() }
})

test('review details use the dedicated history section and Observation History stays available', async () => {
  const row = fixture({ status: 'Rejected', review_decision: 'Rejected', review_comment: 'Please verify the recorded measurements.' })
  const h = harness(identityHandler([row]))
  try {
    await h.state.loadObservations()
    const view = nodes(mainObservationTable(h)).find(node => node.type === 'button' && node.props?.['aria-label'] === messages.common.viewDetails)
    await view.props.onClick()
    assert.equal(h.state.selected.value.reviewedAt, row.reviewed_at)
    assert.equal(h.state.selected.value.reviewComment, row.review_comment)
    const details = nodes(h.render()).find(node => node.type === 'dl' && node.props?.class === 'detail-list')
    const historySection = nodes(h.render()).find(node => node.type?.name?.endsWith('ObservationReviewHistory.vue'))
    assert.ok(historySection)
    assert.equal(historySection.props['observation-id'], uuid)
    assert.ok(!nodes(details).some(node => node.type === 'dt' && node.children === messages.conservationPages.observations.reviewComments))
    h.state.closeModal()
    const history = nodes(mainObservationTable(h)).find(node => node.type === 'button' && node.props?.['aria-label'] === messages.conservationPages.observations.history)
    history.props.onClick(); await flush()
    assert.equal(h.state.historyModal.value, true)
    assert.equal(h.state.history.value[0].id, uuid)
    assert.ok(nodes(h.render()).some(node => node.type === 'td' && node.children === uuid))
    assert.ok(!nodes(h.render()).some(node => typeof node.children === 'string' && node.children.includes(messages.conservationPages.reviews.queues.loadedScope)))
    assert.ok(!nodes(h.render()).some(node => node.props?.class === 'dataset-note'))
    h.state.skippedRecords.value = 2
    const skipped = nodes(h.render()).find(node => node.props?.class === 'dataset-note')
    assert.equal(skipped.props.role, 'status')
    assert.ok(skipped.children.includes('2'))
    assert.ok(h.calls.every(call => !call.options.method || call.options.method === 'GET'))
    assert.ok(h.calls.every(call => !call.url.includes('OBS-')))
  } finally { h.stop() }
})

test('Observation modal opts into accessibility and its own two-column theme with explicit Kuching dates', async () => {
  const h = harness(identityHandler([fixture()]))
  try {
    await h.state.loadObservations()
    await h.state.open(h.state.observations.value[0])
    const modal = nodes(h.render()).find(node => node.props?.class === 'observation-dialog')
    assert.ok(modal)
    assert.equal(modal.props.accessible, '')
    assert.equal(modal.props.title, 'Plant Observation')
    assert.equal(h.state.modalDate('2026-11-07T06:20:00Z'), '7 November 2026, 14:20')
    assert.equal(h.state.modalDate('bad'), '\u2014')
    assert.ok(nodes(modal).some(node => node.props?.class === 'observation-information-column'))
    assert.ok(nodes(modal).some(node => String(node.props?.class).includes('observation-review-column')))
    assert.equal(nodes(modal).filter(node => node.type === 'h3' && node.props?.class === 'observation-section-heading').length, 5)
    assert.ok(!nodes(modal).some(node => node.props?.class === 'officer-review'))
    h.state.reviewMode.value = true
    assert.equal(nodes(h.render()).filter(node => node.type === 'h3' && node.props?.class === 'observation-section-heading').length, 6)
    const style = readFileSync(new URL('../src/styles/observation-dialog.css', import.meta.url), 'utf8')
    assert.match(style, /position: sticky/)
    assert.match(style, /scroll-padding-block-start/)
    const source = readFileSync(filename, 'utf8')
    const observationHistoryModal = source.slice(source.indexOf('<AppModal v-if="selected && historyModal"'))
    assert.match(observationHistoryModal.split('</AppModal>')[0], /\baccessible\b/)
    assert.doesNotMatch(observationHistoryModal.split('</AppModal>')[0], /observation-dialog/)
  } finally { h.stop() }
})

test('loading, unavailable and empty main-table states span the seven retained columns', async () => {
  for (const fail of [false, true]) {
    const h = harness(async () => fail ? Response.json({ error: 'Unavailable' }, { status: 503 }) : Response.json({ observations: [] }))
    try {
      const loading = nodes(mainObservationTable(h)).filter(node => node.type === 'td')
      assert.equal(loading.length, 1); assert.equal(loading[0].props.colspan, '7')
      await h.state.loadObservations()
      const cells = nodes(mainObservationTable(h)).filter(node => node.type === 'td')
      assert.equal(cells.length, 1); assert.equal(cells[0].props.colspan, '7')
    } finally { h.stop() }
  }
})

test('table layout uses consistent spacing, compact actions and a responsive mobile card layout', async () => {
  const css = descriptor.styles[0].content
  assert.match(css, /\.officer-layout\.officer-layout\.officer-layout \.observations-scroll \.observations-table\s*\{[^}]*width: 100%; min-width: 78rem; table-layout: fixed; white-space: normal/)
  assert.match(css, /\.observations-table th, \.observations-table td\s*\{ padding: 10px; text-align: center; vertical-align: middle/)
  assert.match(css, /\.observations-table \.status-column\s*\{ width: 11%/)
  assert.match(css, /\.observations-table \.observation-column\s*\{ width: 24%/)
  assert.match(css, /\.submission-identity-stack\s*\{ display: grid/)
  assert.match(css, /\.observations-table \.plant-id-value\s*\{ display: flex; flex-direction: column/)
  assert.match(css, /\.observations-table \.plant-id-value\s*\{[^}]*flex-direction: column/)
  assert.match(css, /\.identifier-line\s*\{[^}]*display: inline-flex;[^}]*justify-content: flex-start;[^}]*gap: 7px/)
  assert.doesNotMatch(/\.identifier-line\s*\{([^}]+)\}/.exec(css)[1], /width: 180px/)
  assert.match(css, /\.observations-scroll \.observations-table \.action-group\s*\{[^}]*flex-wrap: wrap;[^}]*justify-content: center/)
  assert.match(css, /\.observations-table \.action-group > \.action-button\.observation-icon-action\s*\{[^}]*width: 36px;[^}]*height: 36px/)
  assert.match(css, /@container \(max-width: 1248px\)[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/)
  assert.match(css, /nth-child\(2\).*nth-child\(5\).*display: flex; align-items: center/)
  assert.match(css, /content: attr\(aria-label\)/)
  const compiled = compileStyle({ source: css, id: 'data-v-observation-table', scoped: true })
  assert.equal(compiled.errors.length, 0)
  assert.match(compiled.code, /\.observations-scroll \.observations-table \.action-group\[data-v-observation-table\]/)
  assert.match(compiled.code, /\.observations-scroll \.observations-table \.identifier-copy\[data-v-observation-table\]/)
  const h = harness(identityHandler([fixture()]))
  try {
    await h.state.loadObservations()
    const scroll = nodes(h.render()).find(node => String(node.props?.class).includes('observations-scroll'))
    assert.equal(scroll.props.role, 'region'); assert.equal(scroll.props.tabindex, '0')
    assert.equal(scroll.props['aria-label'], messages.conservationPages.observations.title)
    assert.ok(!nodes(mainObservationTable(h)).some(node => node.props?.class?.includes('review-state')))
  } finally { h.stop() }
})

test('mobile Observation cards match the Plant Species identity, field-row and action-strip pattern', async () => {
  const h = harness(identityHandler([fixture({ status: 'Cancelled' })]))
  try {
    await h.state.loadObservations()
    const table = mainObservationTable(h)
    assert.ok(nodes(table).some(node => node.props?.class === 'observation-card-emblem'))
    const css = descriptor.styles[0].content
    assert.match(css, /\.observation-card-emblem\s*\{[^}]*width: 52px; height: 52px/)
    assert.match(css, /tbody tr > td:first-child \{ display: flex; align-items: center; gap: 14px/)
    assert.match(css, /tbody tr > td:nth-child\(2\), \.observations-table tbody tr > td:nth-child\(3\), \.observations-table tbody tr > td:nth-child\(4\), \.observations-table tbody tr > td:nth-child\(5\) \{ display: flex; align-items: center/)
    assert.match(css, /\.observations-table \.terminal-read-only > td, \.observations-table tr\.terminal-read-only > td, \.observations-table tr\.superseded > td \{ background: #fff/)
    assert.match(css, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/)
    assert.match(css, /observation-icon-action:hover:not\(:disabled\).*background: #33745d; color: #fff/)
  } finally { h.stop() }
})

test('main observation header is continuous forest green and row content is vertically centered', () => {
  const css = descriptor.styles[0].content
  const table = /\.observations-table\s*\{([^}]+)\}/.exec(css)[1]
  assert.match(table, /border-collapse: separate; border-spacing: 0/)
  const header = /\.observations-table th\s*\{([^}]+)\}/.exec(css)[1]
  assert.match(header, /background: #245443; color: #fff; border-bottom-color: #245443/)
  assert.match(header, /font-weight: 700/)
  assert.match(css, /\.observations-table thead th:first-child\s*\{ border-top-left-radius: 10px/)
  assert.match(css, /\.observations-table thead th:last-child\s*\{ border-top-right-radius: 10px/)
  assert.match(css, /\.observations-table th, \.observations-table td\s*\{[^}]*vertical-align: middle/)
  const identifiers = /(?:^|\n)\.identifier-line\s*\{([^}]+)\}/.exec(css)[1]
  assert.match(identifiers, /align-items: center/)
  assert.match(identifiers, /vertical-align: middle/)
  assert.match(css, /\.observations-table \.badge\s*\{[^}]*align-items: center;[^}]*vertical-align: middle/)
  assert.match(css, /\.observations-table \.submitter-column\s*\{ width: 13%/)
  assert.doesNotMatch(css, /(?:^|\n)\s*(?:thead|th)\s*\{/, 'header styling stays scoped to the main table')
})

test('status badges and action rows retain intrinsic single-line widths without truncation or shrinking', () => {
  const css = descriptor.styles[0].content
  const badge = /\.observations-table \.badge\s*\{([^}]+)\}/.exec(css)[1]
  assert.match(badge, /display: inline-flex; align-items: center; width: max-content; max-width: none/)
  assert.match(badge, /white-space: nowrap/)
  assert.match(badge, /font-size: 11px/)
  assert.doesNotMatch(badge, /overflow: hidden|text-overflow|background:|color:|border-radius:|padding:/)
  const actions = /\.observations-scroll \.observations-table \.action-group\s*\{([^}]+)\}/.exec(css)[1]
  assert.match(actions, /display: flex; flex-wrap: wrap; align-items: center/)
  assert.match(actions, /justify-content: center; gap: 6px; width: 100%; min-width: 0/)
  const buttons = /\.observations-table \.action-group > \.action-button\.observation-icon-action\s*\{([^}]+)\}/.exec(css)[1]
  assert.match(buttons, /flex: 0 0 36px; width: 36px; min-width: 36px; height: 36px/)
  assert.match(css, /\.observations-table \.observation-icon-action:hover::after, \.observations-table \.observation-icon-action:focus-visible::after/)
  assert.doesNotMatch(buttons, /overflow: hidden|text-overflow/)
  assert.match(css, /\.observations-scroll\s*\{ min-width: 0; max-width: 100%; overflow-x: auto/)
  assert.doesNotMatch(/\.observations-table\s*\{([^}]+)\}/.exec(css)[1], /overflow:/)
})

test('pending and completed observations keep every action and full localized status label in the single-row group', async () => {
  for (const language of ['en', 'ms', 'zh-CN']) for (const status of ['Pending Review', 'Approved', 'Rejected', 'Correction Required']) {
    for (const origin of ['subsequent_observation']) {
      const row = fixture({ status, origin_type: origin })
      const h = harness(identityHandler([row]), officer, false, null, language)
      try {
        await h.state.loadObservations(); h.state.queueOrigin.value = 'all'
        const table = mainObservationTable(h)
        const badge = nodes(table).find(node => node.type === 'span' && String(node.props?.class).split(/\s+/).includes('badge'))
        assert.equal(badge.children, h.state.label(status))
        const cell = nodes(table).find(node => node.props?.class === 'actions-cell')
        const group = nodes(cell).find(node => node.props?.class === 'action-group')
        const actions = nodes(group).filter(node => String(node.props?.class).split(/\s+/).includes('observation-icon-action'))
        assert.equal(actions.length, 3)
        assert.ok(actions.every(node => node.props?.['aria-label'] && node.props?.title))
        assert.ok(actions.some(node => node.props?.to === '/plant/PL007'))
        assert.ok(!actions.some(node => node.props?.to?.name === 'conservation-map'))
        assert.equal(nodes(table).filter(node => node.type === 'th').length, 7)
        const scroll = nodes(h.render()).find(node => String(node.props?.class).includes('observations-scroll'))
        assert.equal(scroll.props.tabindex, '0')
        assert.equal(nodes(scroll).filter(node => String(node.props?.class).includes('table-scroll')).length, 1, 'only one table scroll container')
        assert.equal(copyButtons(h).length, 2)
        assert.equal(h.calls.filter(call=>call.url.startsWith('/api/observations')).length, 1)
        assert.ok(h.calls.every(call => !call.options.method || call.options.method === 'GET'))
      assertReadOnlyObservationSources(h)
  } finally { h.stop() }
    }
  }
})

test('notification query opens the full subsequent observation beyond loaded pages and preserves filters', async()=>{
 const id='4451e4cb-0000-4000-8000-123456789012'
 const h=harness(async url=>url==='/api/observations'?Response.json({observations:[]}):Response.json({observation:fixture({id})}),officer,false,null,'en',{query:{observation:id}})
 try{
  await flush();assert.equal(h.state.selected.value.id,id);assert.equal(h.state.reviewMode.value,true)
  h.state.search.value='retained';h.state.status.value='Rejected';h.state.closeModal();await flush()
  assert.equal(h.state.selected.value,null)
  const reads=h.calls.length;h.route.query.unrelated='x';await flush();assert.equal(h.calls.length,reads)
  h.route.query.observation='4451e4cb-0000-4000-8000-123456789013';await flush()
  assert.equal(h.state.search.value,'retained');assert.equal(h.state.status.value,'Rejected')
  assert.ok(h.state.navigationError.value);assert.ok(h.calls.every(call=>!call.options?.method||call.options.method==='GET'))
 }finally{h.stop()}
})
test('notification query rejects invalid, inaccessible, wrong-origin and unauthorized targets safely',async()=>{
 for(const mode of ['invalid','missing','initial','unknown','unauthorized']){
  const id=mode==='invalid'?'OBS-4451':fixture().id
  const h=harness(async()=>mode==='missing'?Response.json({error:'Unavailable'},{status:404}):Response.json({observation:fixture({origin_type:mode==='initial'?'initial_registration':mode==='unknown'?'unknown':'subsequent_observation'})}),mode==='unauthorized'?null:officer,false,null,'en',{query:{observation:id}})
  try{await flush();assert.equal(h.state.selected.value,null);if(!['unauthorized'].includes(mode))assert.ok(h.state.navigationError.value);if(['invalid','unauthorized'].includes(mode))assert.equal(h.calls.length,0)}finally{h.stop()}
 }
})

test('mounted query navigation ignores stale targets and account changes without duplicate modal opening',async()=>{
 const oldId=fixture().id,newId='4451e4cb-0000-4000-8000-123456789014'
 let release
 const h=harness(async url=>url.endsWith(oldId)?new Promise(resolve=>{release=resolve}):Response.json({observation:fixture({id:newId,status:'Rejected'})}))
 try{
  h.route.query.observation=oldId;await flush()
  h.route.query.observation=newId;await flush();assert.equal(h.state.selected.value.id,newId)
  release(Response.json({observation:fixture()}));await flush();assert.equal(h.state.selected.value.id,newId)
  assert.equal(h.state.selected.value.status,'Rejected');assert.equal(h.state.reviewAllowed.value,false)
  h.changeSession(null);await flush();assert.equal(h.state.selected.value,null)
  assert.ok(h.calls.every(call=>!call.options?.method||call.options.method==='GET'))
 }finally{h.stop()}
})

test('Resubmitted is informational, localized and strictly limited to verified Pending Review rows',async()=>{
 for(const language of ['en','ms','zh-CN'])for(const row of [
  {},{revision:9,review_decision:'Correction Required'},{is_correction_resubmission:false},{is_correction_resubmission:null},
  {is_correction_resubmission:'true'},{is_correction_resubmission:true},
  ...['Draft','Approved','Rejected','Correction Required','Flagged'].map(status=>({status,is_correction_resubmission:true})),
  {origin_type:'unknown',is_correction_resubmission:true}
 ]){
  const h=harness(async()=>Response.json({observations:[fixture(row)]}), officer,false,null,language)
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


test('all Observation copy icons use control-specific checkmarks and the same anchored two-second toast',async()=>{
 let now=0,id=0;const timers=new Map(),copied=[]
 const window={setTimeout(fn,ms){const key=++id;timers.set(key,{fn,due:now+ms});return key},clearTimeout(key){timers.delete(key)}}
 const owner='staff:shared-owner',other='6d8a3647-e3c3-43fa-b355-aabdddf05f72'
 const h=harness(identityHandler([fixture({owner_subject:owner}),fixture({id:other,owner_subject:owner})]),officer,false,null,'en',{window,clipboard:{writeText:async value=>copied.push(value)}})
 const checks=()=>nodes(h.render()).filter(n=>n.type==='span'&&n.props?.class==='officer-copy-anchor').filter(n=>nodes(n).some(c=>c.type==='button'&&nodes(c).some(svg=>svg.type==='path'&&svg.props?.d==='m5 12 4 4 10-10')))
 const toasts=()=>nodes(h.render()).filter(n=>n.props?.class==='officer-copy-toast')
 try{
  await h.state.loadObservations();const buttons=copyButtons(h)
  await buttons[1].props.onClick();assert.deepEqual(copied,[owner]);assert.equal(checks().length,1);assert.equal(toasts().length,1)
  assert.equal(h.state.copyFeedback.value,'')
  await buttons[3].props.onClick();assert.deepEqual(copied,[owner,owner]);assert.equal(checks().length,2);assert.equal(toasts().length,1)
  const old=[...timers.values()][0].fn
  now=1500;await buttons[1].props.onClick();old();assert.equal(checks().length,2)
  now=2000;for(const [key,t] of timers)if(t.due<=now){timers.delete(key);t.fn()}
  assert.equal(checks().length,1);assert.equal(toasts().length,1)
  now=3500;for(const [key,t] of timers)if(t.due<=now){timers.delete(key);t.fn()}
  assert.equal(checks().length,0);assert.equal(toasts().length,0)
 }finally{h.stop()}
 assert.equal(timers.size,0)
})


test('temporary authentication verification preserves field-review drafts and blocks decisions until recovery',async()=>{
 const h=harness(async url=>Response.json(url.startsWith('/api/observations?')?{observations:[fixture()],page:{has_more:false,next_cursor:null}}:url==='/api/observations'?{observations:[fixture()]}:{observation:fixture()}))
 try{
  await h.state.loadObservations()
  await h.state.open(h.state.observations.value[0],true)
  h.state.reviewComment.value='Keep field review draft'
  const officer=h.state.session.value.user
  h.changeSession(officer,true)
  assert.equal(h.state.selected.value.id,uuid)
  assert.equal(h.state.reviewComment.value,'Keep field review draft')
  assert.equal(h.state.authorizedOfficer.value,false)
  await h.state.decide('Approved')
  assert.equal(h.calls.filter(call=>call.options?.method==='POST').length,0)
  h.changeSession(officer,false)
  assert.equal(h.state.reviewComment.value,'Keep field review draft')
  assert.equal(h.state.authorizedOfficer.value,true)
  h.changeSession(null,false);assert.equal(h.state.selected.value,null)
 }finally{h.stop()}
})

const observationText = h => nodes(h.render()).map(n => typeof n.children === 'string' ? n.children : '').join(' ')

test('unchanged observation reload preserves drafts and acknowledgement with info styling in every locale', async () => {
  for (const language of ['en', 'ms', 'zh-CN']) {
    let row = fixture({ revision: 1 })
    const h = harness(url => Response.json(url === '/api/observations' ? { observations: [row] } : { observation: row }), officer, false, null, language)
    try {
      await h.state.open(h.state.mapObservation(row), true)
      h.state.reviewComment.value = 'Unsent Officer comment'
      row = { ...row, updated_at: '2026-11-03T18:00:00+08:00', assets: [...row.assets].reverse(), content: Object.fromEntries(Object.entries(row.content).reverse()) }
      await h.state.reloadReview()
      assert.equal(h.state.reviewComment.value, 'Unsent Officer comment')
      assert.equal(h.state.reviewAcknowledged.value, true)
      assert.equal(h.state.reviewAllowed.value, true)
      assert.equal(h.state.reviewNeedsReload.value, false)
      assert.equal(h.state.reviewFeedbackVariant.value, 'info')
      const labels = JSON.parse(readFileSync(new URL(`../src/locales/${language}.json`, import.meta.url), 'utf8'))
      assert.equal(h.state.reviewFeedback.value, labels.observationModal.upToDate)
      const info = nodes(h.render()).find(n => n.type === 'p' && String(n.props?.class).includes('observation-review-feedback'))
      assert.equal(info.props.role, 'status'); assert.ok(info.props.class.includes('info')); assert.ok(!info.props.class.includes('error'))
      assert.ok(!nodes(h.render()).some(n => n.props?.class === 'review-feedback error'))
      assert.ok(!nodes(h.render()).some(n => n.type?.name?.endsWith('SubmissionChanges.vue')), 'the removed History disclosure is not rendered')
      assert.equal(h.calls.filter(c => c.options?.method === 'POST').length, 0)
    } finally { h.stop() }
  }
})

for (const [name, patch] of [
  ['revision', { revision: 5 }], ['content', { content: { ...fixture().content, heightCm: 77 } }],
  ['photos', { assets: [{ id: 'different-image', content_type: 'image/jpeg' }] }],
  ['approval', { status: 'Approved', revision: 5 }], ['rejection', { status: 'Rejected', revision: 5 }],
  ['origin', { origin_type: 'initial_registration' }],
]) test(`changed observation ${name} requires reinspection without resubmitting a decision`, async () => {
  const { h, set } = reviewHarness()
  try {
    await h.state.open(h.state.mapObservation(fixture()), true); h.state.reviewComment.value = 'Preserve draft'
    set(fixture(patch)); await h.state.reloadReview()
    assert.equal(h.state.reviewAcknowledged.value, false)
    assert.equal(h.state.reviewAllowed.value, false)
    assert.equal(h.state.reviewComment.value, 'Preserve draft')
    assert.equal(h.state.reviewFeedbackVariant.value, 'error')
    h.state.reviewAcknowledged.value = true
    assert.equal(h.state.reviewAllowed.value, !['approval', 'rejection', 'origin'].includes(name))
    assert.equal(h.calls.filter(c => c.options?.method === 'POST').length, 0)
  } finally { h.stop() }
})

for (const invalid of [null, undefined, '4', 0, 1.5, 'http-error']) test(`failed or malformed observation reload ${String(invalid)} blocks review until a successful read`, async () => {
  let row = fixture(), fail = false
  const h = harness(url => fail && invalid === 'http-error'
    ? Response.json({ error: 'Latest read failed' }, { status: 503 })
    : Response.json(url === '/api/observations' ? { observations: [row] } : { observation: row }))
  try {
    await h.state.open(h.state.mapObservation(row), true); h.state.reviewComment.value = 'Preserve failed-read draft'
    fail = true; if (invalid !== 'http-error') row = fixture({ revision: invalid })
    await h.state.reloadReview()
    assert.equal(h.state.reviewNeedsReload.value, true); assert.equal(h.state.reviewAllowed.value, false)
    assert.equal(h.state.reviewFeedbackVariant.value, 'error')
    assert.equal(h.state.reviewComment.value, 'Preserve failed-read draft')
    assert.ok(observationText(h).includes(messages.submissionChanges.reloadRequired))
    assert.ok(!observationText(h).includes(messages.submissionChanges.conflict))
    await h.state.decide('Rejected'); assert.equal(h.calls.filter(c => c.options?.method === 'POST').length, 0)
    fail = false; row = fixture(); await h.state.reloadReview()
    assert.equal(h.state.reviewNeedsReload.value, false); assert.equal(h.state.reviewAllowed.value, true)
    assert.equal(h.state.reviewFeedbackVariant.value, 'info')
  } finally { h.stop() }
})

test('an unchanged reload cannot clear inspection required by an actual HTTP 409', async () => {
  const { h } = reviewHarness(fixture(), () => Response.json({ error: 'Stale review' }, { status: 409 }))
  try {
    await h.state.open(h.state.mapObservation(fixture()), true); h.state.reviewComment.value = 'Keep conflict draft'
    await h.state.decide('Rejected'); assert.equal(h.state.reviewAcknowledged.value, false)
    await h.state.reloadReview()
    assert.equal(h.state.reviewAcknowledged.value, false); assert.equal(h.state.reviewAllowed.value, false)
    assert.equal(h.state.reviewComment.value, 'Keep conflict draft'); assert.equal(h.state.reviewFeedbackVariant.value, 'error')
    assert.equal(h.calls.filter(c => c.options?.method === 'POST').length, 1)
    h.state.reviewAcknowledged.value = true; assert.equal(h.state.reviewAllowed.value, true)
  } finally { h.stop() }
})

test('validation after an unchanged info reload still uses real error feedback', async () => {
  const { h } = reviewHarness()
  try {
    await h.state.open(h.state.mapObservation(fixture()), true); await h.state.reloadReview()
    assert.equal(h.state.reviewFeedbackVariant.value, 'info')
    h.state.reviewComment.value = ''; await h.state.decide('Correction Required')
    assert.equal(h.state.reviewFeedbackVariant.value, 'error'); assert.equal(h.state.reviewCommentError.value, true)
    assert.equal(h.calls.filter(c => c.options?.method === 'POST').length, 0)
  } finally { h.stop() }
})



test('Observation provenance identifies current content and the separate history view stays read-only in every locale',async()=>{
  for(const language of ['en','ms','zh-CN']){
    const row=fixture({status:'Approved',historical_review:{state:'available',fields:{content:{heightCm:999}}}})
    const h=harness(async()=>Response.json({observation:row}),officer,false,null,language)
    try{
      await h.state.open(h.state.mapObservation(row))
      const labels=JSON.parse(readFileSync(new URL('../src/locales/'+language+'.json',import.meta.url),'utf8'))
      const notices=nodes(h.render()).filter(n=>n.props?.class==='observation-data-provenance')
      assert.ok(!notices.some(n=>n.children===labels.observationModal.currentRecordNotice))
      assert.notEqual(h.state.selected.value.height,'999')
      h.state.openHistory(h.state.selected.value);await flush()
      assert.equal(h.state.reviewAllowed.value,false)
      assert.ok(nodes(h.render()).some(n=>n.props?.class==='observation-data-provenance'&&n.children===labels.observationModal.historyReadOnly))
      await h.state.decide('Approved');assert.equal(h.calls.filter(c=>c.options?.method==='POST').length,0)
    }finally{h.stop()}
  }
})

test('Superseded and terminal Observation records cannot initiate review decisions',async()=>{
  for(const status of ['Superseded','Withdrawn','Rejected','Approved','Correction Required']){
    const row=fixture({status}),h=harness(async()=>Response.json({observation:row}))
    try{
      await h.state.open(h.state.mapObservation(row),true)
      assert.equal(h.state.reviewAllowed.value,false)
      await h.state.decide('Approved')
      assert.equal(h.calls.filter(c=>c.options?.method==='POST').length,0)
    }finally{h.stop()}
  }
})


test('one Submission Type filter has exactly the three subsequent-workflow choices in every locale',async()=>{
 for(const language of ['en','ms','zh-CN']){
  const h=harness(identityHandler([]),officer,false,null,language)
  try {await h.state.loadObservations();const dictionary=JSON.parse(readFileSync(new URL('../src/locales/'+language+'.json',import.meta.url),'utf8'));const tree=nodes(h.render());
   assert.equal(h.state.queueOrigin.value,'subsequent_observation');assert.ok(!tree.some(n=>n.props?.class==='field observation-type-field'));
   const select=tree.find(n=>n.type==='select'&&nodes(n).some(o=>o.type==='option'&&o.props?.value==='original'));
   assert.deepEqual(nodes(select).filter(n=>n.type==='option').map(n=>n.children),[dictionary.finalOfficerWorkflow.all,dictionary.finalOfficerWorkflow.original,dictionary.finalOfficerWorkflow.edit]);
   assert.equal(nodes(mainObservationTable(h)).filter(n=>n.type==='th').length,7);
  }finally{h.stop()}
 }
})

test('registration and unclassified originals never enter the normal queue, even if an API returns mixed origins',async()=>{
 const rows=['initial_registration','subsequent_observation','unknown'].map((origin_type,i)=>fixture({id:'origin-'+i,origin_type}));const h=harness(identityHandler(rows));
 try{await h.state.loadObservations();assert.deepEqual(Array.from(h.state.filtered.value,r=>r.id),['origin-1']);assert.equal(h.state.summaryCounts.value.find(c=>c.status==='Pending Review').count,1);
  assert.ok(!nodes(h.render()).some(n=>n.type==='RouterLink'&&n.props?.to?.query?.legacy==='1'));
 }finally{h.stop()}
})

test('Created formatter remains available for details and the compact table uses seven columns',()=>{
 const h=harness(identityHandler([]));try{assert.equal(h.state.formatDate('2026-11-03T20:30:00Z'),'4 November 2026, 04:30');assert.equal(h.state.formatDate('invalid'),'\u2014');}finally{h.stop()}
 const h2=harness(identityHandler([fixture()]));try{assert.equal(nodes(mainObservationTable(h2)).filter(n=>n.type==='th').length,7)}finally{h2.stop()}
})

async function unifiedProposal(status='Pending Review',origin='subsequent_observation') {
 const baseline=fixture({status:'Approved',origin_type:origin,created_at:'2026-10-01T00:00:00Z'})
 return mapObservationEdit({id:uuid,observation_id:uuid,owner_subject:baseline.owner_subject,status,revision:7,base_revision:3,created_at:'2026-11-17T00:00:00Z',base_snapshot:{content:baseline.content},proposed_content:{...baseline.content,notes:'Proposal draft'},retained_photo_ids:[],added_photo_count:0},async()=>({observation:baseline}))
}
test('unified Observation table renders both distinct submission identities and accurate original counts',async()=>{
 const canonical=[fixture({status:'Approved',plant_scientific_name:'Yellow Simpoh Air'}),fixture({id:'pending-original'})],h=harness(identityHandler(canonical))
 try{await h.state.loadObservations();const edit=await unifiedProposal();h.state.receiveProposalState({rows:[edit],names:{'real-botanist-subject':'Botanist Aina'},loading:false,error:''});await flush()
 assert.equal(h.state.displayedRows.value.length,3);assert.equal(new Set(h.state.displayedRows.value.map(row=>row.key)).size,3)
 assert.ok(h.state.displayedRows.value.some(row=>row.key==='observation:'+uuid));assert.ok(h.state.displayedRows.value.some(row=>row.key==='observation-edit:'+uuid))
 assert.equal(h.state.observations.value.length,2);assert.equal(h.state.summaryCounts.value.find(card=>card.status==='Pending Review').count,2)
 const table=mainObservationTable(h),headers=nodes(table).filter(n=>n.type==='th');assert.deepEqual(headers.map(n=>n.children),['Submission ID','Plant ID','Species','Submitted By','Status','Created','Actions'])
 const rows=nodes(table).filter(n=>n.type==='tr'&&observationCells(n).length===7);assert.equal(rows.length,3)
 const originalRow=rows.find(n=>nodes(observationCells(n)[0]).some(x=>x.props?.class==='submission-type-badge submission-type-original'))
 const editRow=rows.find(n=>nodes(observationCells(n)[0]).some(x=>x.props?.class==='submission-type-badge submission-type-edit'))
 assert.ok(originalRow && editRow);assert.ok(renderedText(observationCells(originalRow)[1]).includes('PL007'));assert.ok(renderedText(observationCells(editRow)[1]).includes('PL007'))
 const originalIdentity=observationCells(originalRow)[0]
 assert.deepEqual(nodes(originalIdentity).filter(n=>n.props?.class==='submission-type-badge submission-type-original').map(n=>n.children),[messages.finalOfficerWorkflow.original])
 const proposalIdentity=observationCells(editRow)[0]
 assert.deepEqual(nodes(proposalIdentity).filter(n=>n.props?.class==='submission-type-badge submission-type-edit').map(n=>n.children),[messages.finalOfficerWorkflow.edit])
 const plantIdentity=observationCells(originalRow)[1]
 assert.ok(nodes(plantIdentity).some(n=>n.type==='strong'&&n.children==='PL007'))
 assert.ok(nodes(plantIdentity).some(n=>n.type==='em'&&n.children===h.state.observations.value[0].plantScientificName))
 assert.ok(nodes(table).some(n=>n.children===messages.finalOfficerWorkflow.edit));assert.ok(nodes(table).some(n=>n.children===messages.finalOfficerWorkflow.original))
 assert.equal(h.state.proposalItems.value[0].proposal.revision,7);assert.equal(h.state.proposalItems.value[0].baseline.status,'Approved')
 assert.ok(!nodes(h.render()).some(n=>n.type==='section'&&n.props?.class==='panel observation-edit-queue'))
 }finally{h.stop()}
})
test('unified filters use proposal status, owner and date with genuine baseline origin and Species',async()=>{
 const h=harness(identityHandler([fixture()]));try{await h.state.loadObservations();h.state.receiveProposalState({rows:[await unifiedProposal('Pending Review','subsequent_observation')],names:{'real-botanist-subject':'Botanist Aina'},loading:false,error:''})
 h.state.submissionType.value='edit';assert.equal(h.state.displayedRows.value.length,1)
 h.state.status.value='Approved';assert.equal(h.state.displayedRows.value.length,0)
 h.state.status.value='Pending Review';assert.equal(h.state.displayedRows.value.length,1)
 h.state.queueOrigin.value='all';h.state.search.value='Botanist Aina';assert.equal(h.state.displayedRows.value.length,1)
 h.state.search.value='CHANGE-'+uuid;assert.equal(h.state.displayedRows.value.length,1)
 h.state.species.value=h.state.proposalItems.value[0].baseline.speciesId;h.state.owner.value='staff:real-botanist-subject';h.state.date.value='2026-11-17';assert.equal(h.state.displayedRows.value.length,1)
 h.state.date.value='2026-10-01';assert.equal(h.state.displayedRows.value.length,0)
 h.state.date.value='';h.state.search.value='';h.state.submissionType.value='original';assert.equal(h.state.displayedRows.value.length,1)
 assert.ok(h.state.speciesOptions.value.some(item=>item.id===h.state.proposalItems.value[0].baseline.speciesId))
 }finally{h.stop()}
})
test('unified proposal actions preserve exact identity and terminal grey/read-only presentation',async()=>{
 for(const status of ['Pending Review','Cancelled','Withdrawn','Superseded']){
 const h=harness(identityHandler([]));try{await h.state.loadObservations();const edit=await unifiedProposal(status),opened=[];h.state.proposalQueue.value={view:row=>opened.push(row)}
 h.state.receiveProposalState({rows:[edit],names:{},loading:false,error:''});await flush()
 const row=nodes(mainObservationTable(h)).find(n=>n.type==='tr'&&observationCells(n).length===7),cells=observationCells(row),button=nodes(cells[6]).find(n=>n.type==='button')
 assert.equal(h.state.proposalReviewable(edit),status==='Pending Review');assert.equal(button.props['aria-label'],status==='Pending Review'?messages.dashboardObservationEdits.review:messages.common.viewDetails)
 if(status!=='Pending Review')assert.ok(row.props.class.includes(status==='Superseded'?'superseded':'terminal-read-only'))
 button.props.onClick();assert.equal(opened[0].id,uuid);assert.equal(opened[0].revision,7);assert.equal(h.state.selected.value,null);assert.equal(h.calls.filter(c=>c.options?.method==='POST').length,0)
 }finally{h.stop()}
 }
})
test('unified source warning is compact; retry touches only edit requests and filters never hide deep-link handling',async()=>{
 const h=harness(identityHandler([fixture()]));try{await h.state.loadObservations();let retries=0;h.state.proposalQueue.value={load:()=>retries++}
 h.state.receiveProposalState({rows:[],names:{},loading:false,error:'HTTP 503 unavailable'});h.state.submissionType.value='original';h.state.status.value='Rejected';await flush()
 const warning=nodes(h.render()).find(n=>n.props?.class==='proposal-warning');assert.ok(warning);assert.equal(warning.props.role,'alert')
 const before=h.calls.length;nodes(warning).find(n=>n.type==='button').props.onClick();assert.equal(retries,1);assert.equal(h.calls.length,before)
 assert.equal(h.state.observations.value.length,1)
 const controller=nodes(h.render()).find(n=>n.type?.name?.endsWith('ObservationEditQueue.vue'));assert.ok(controller,'controller and deep-link dialog stay mounted regardless of filters')
 }finally{h.stop()}
})
test('Cancelled proposal filter never sends an unsupported canonical status to the backend',async()=>{
 const h=harness(identityHandler([fixture()]));try{h.state.status.value='Cancelled';await h.state.loadObservations();assert.ok(!h.calls.some(c=>c.url?.includes('status=Cancelled')));assert.equal(h.state.filtered.value.length,0)}finally{h.stop()}
})


test('initial and unknown edit proposals stay out of normal rows without becoming canonical observations',async()=>{
 const h=harness(identityHandler([fixture()]));try{await h.state.loadObservations();h.state.receiveProposalState({rows:[await unifiedProposal('Pending Review','initial_registration'),await unifiedProposal('Pending Review','unknown')],names:{},loading:false,error:''});assert.equal(h.state.proposalItems.value.length,0);assert.equal(h.state.displayedRows.value.length,1);assert.equal(h.state.observations.value.length,1)}finally{h.stop()}
})

test('Observation submission types use full localized labels and distinct high-contrast fixed badge colors',async()=>{
 for(const language of ['en','ms','zh-CN']){
  const labels=JSON.parse(readFileSync(new URL('../src/locales/'+language+'.json',import.meta.url),'utf8'))
  const h=harness(identityHandler([fixture()]),officer,false,null,language)
  try{await h.state.loadObservations();h.state.receiveProposalState({rows:[await unifiedProposal()],names:{},loading:false,error:''});const table=mainObservationTable(h)
   for(const [kind,label] of [['original',labels.finalOfficerWorkflow.original],['edit',labels.finalOfficerWorkflow.edit]]){const badges=nodes(table).filter(n=>n.props?.class==='submission-type-badge submission-type-'+kind);assert.equal(badges.length,1);assert.equal(badges[0].children,label)}
   const statusBadges=nodes(table).filter(n=>n.type==='span'&&String(n.props?.class).split(/\s+/).includes('badge'));assert.equal(statusBadges.length,2);assert.ok(statusBadges.every(n=>JSON.stringify(n.props.style)===JSON.stringify(workflowBadgeStyle('Pending Review'))))
  }finally{h.stop()}
 }
 const css=descriptor.styles.map(s=>s.content).join('\n');const pairs=[['original','#e0f2fe','#075985'],['edit','#f3e8ff','#6b21a8']]
 const luminance=hex=>{const rgb=hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return .2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2]}
 for(const[kind,bg,fg]of pairs){assert.ok(css.includes('.submission-type-'+kind+' { background-color: '+bg+'; color: '+fg+'; }'));assert.ok((luminance(bg)+.05)/(luminance(fg)+.05)>=4.5)}
 assert.match(css,/submission-type-badge[^}]*overflow-wrap: normal/)
})
test('removed historical access and loaded-filter notices stay absent in every locale',()=>{
 for(const language of ['en','ms','zh-CN']){const h=harness(identityHandler([]),officer,false,null,language)
 try{const tree=nodes(h.render());assert.ok(!tree.some(n=>n.props?.class==='historical-access'));assert.ok(!tree.some(n=>n.props?.class==='filter-scope-note'));assert.ok(!tree.some(n=>n.props?.id==='observation-summary-scope'));assert.ok(!tree.some(n=>n.props?.['aria-describedby']==='observation-summary-scope'))}finally{h.stop()}}
})

test('edit submission IDs reuse canonical row markup, copy the full request ID and retain exact detail routing',async()=>{
 const writes=[],h=harness(identityHandler([fixture()]),officer,false,null,'en',{clipboard:{writeText:async value=>writes.push(value)}})
 try{await h.state.loadObservations();const edit=await unifiedProposal();edit.id='535b4db9-a9b4-42fc-9739-1d093d1ed957';let opened
 h.state.proposalQueue.value={view:row=>{opened=row}};h.state.receiveProposalState({rows:[edit],names:{},loading:false,error:''});await flush()
 const rows=nodes(mainObservationTable(h)).filter(n=>n.type==='tr'&&observationCells(n).length===7)
 for(const row of rows){const cell=observationCells(row)[0];assert.ok(nodes(cell).some(n=>n.props?.class==='identifier-line'));assert.ok(nodes(cell).filter(n=>n.type==='strong').length>=1);assert.equal(nodes(cell).filter(n=>n.type==='small').length,0);assert.ok(nodes(cell).some(n=>n.props?.class==='identifier-copy'))}
 const row=rows.find(r=>nodes(observationCells(r)[0]).some(n=>n.type==='strong'&&n.props?.title===edit.id));assert.ok(row)
 const cell=observationCells(row)[0];assert.ok(nodes(cell).some(n=>n.type==='strong'&&n.children===h.state.proposalLabels.value.get(edit.id)))
 await nodes(cell).find(n=>n.props?.class==='identifier-copy').props.onClick();assert.deepEqual(writes,[edit.id]);assert.notEqual(writes[0],edit.observation_edit.observation_id)
 nodes(observationCells(row)[6]).find(n=>n.type==='button').props.onClick();assert.equal(opened.id,edit.id);assert.equal(opened.observation_edit.observation_id,edit.observation_edit.observation_id)
 }finally{h.stop()}
})

test('unverified photo evidence warning remains visible with no invented proposals and a source-only retry',async()=>{
 const h=harness(identityHandler([fixture()]));try{await h.state.loadObservations();let retries=0;h.state.proposalQueue.value={load:()=>{retries++}};h.state.receiveProposalState({rows:[],names:{},loading:false,error:messages.unifiedObservations.invalidEvidence});const warning=nodes(h.render()).find(n=>n.props?.class==='proposal-warning');assert.equal(warning.props.role,'alert');assert.ok(nodes(warning).some(n=>typeof n.children==='string'&&n.children.includes(messages.unifiedObservations.invalidEvidence)));assert.equal(h.state.displayedRows.value.length,1);assert.equal(h.state.displayedRows.value[0].kind,'original');const calls=h.calls.length;nodes(warning).find(n=>n.type==='button').props.onClick();assert.equal(retries,1);assert.equal(h.calls.length,calls);assert.ok(h.calls.every(c=>!c.options.method||c.options.method==='GET'))}finally{h.stop()}
})


test('Observation media follows Location in the information column and opens the shared private photo viewer without UUID captions',async()=>{
 const row=fixture({assets:[{id:'private-photo-one',content_type:'image/jpeg'},{id:'private-photo-two',content_type:'image/png'},{id:'attachment',content_type:'application/pdf'}]})
 const h=harness(async()=>Response.json({observation:row}));try{
  await h.state.open(h.state.mapObservation(row),true)
  const tree=nodes(h.render()),left=tree.find(n=>n.props?.class==='observation-information-column'),right=tree.find(n=>String(n.props?.class).includes('observation-review-column'))
  const sections=nodes(left).filter(n=>n.type==='section'),media=sections.at(-1)
  assert.ok(media.props.class.includes('observation-media'));assert.ok(nodes(sections.at(-2)).some(n=>n.type==='h3'&&nodes(n).some(c=>c.children===messages.observationModal.location)))
  assert.ok(!nodes(right).some(n=>String(n.props?.class).includes('observation-media')))
  const buttons=nodes(media).filter(n=>String(n.props?.class).includes('observation-photo-button'));assert.equal(buttons.length,2)
  assert.ok(!nodes(media).some(n=>n.type==='strong'&&n.props?.title==='private-photo-one'))
  assert.ok(!nodes(media).some(n=>n.type==='img'&&n.props.alt.includes('private-photo-')))
  const viewer=tree.find(n=>n.type?.name?.endsWith('PlantPhotoLightbox.vue'));assert.ok(viewer);assert.equal(viewer.props['root-scroll-lock'],'')
  let opened,closed=0;h.state.observationPhotoPreview.value={open:(...args)=>{opened=args},reconcile:()=>{},close:()=>{closed++}}
  const target={isConnected:true};buttons[1].props.onClick({currentTarget:target})
  assert.deepEqual(Array.from(opened[0],p=>p.id),['private-photo-one','private-photo-two']);assert.equal(opened[1],1);assert.equal(opened[3],target)
  assert.equal(opened[0][1].url,'/api/data/assets/private-photo-two')
  h.state.closeModal();assert.ok(closed>0)
 }finally{h.stop()}
})

function observationHeaderRefresh(h) {
 const modal=nodes(h.render()).find(n=>n.props?.class==='observation-dialog')
 return nodes(modal.children.title()).find(n=>n.props?.class==='observation-refresh-button')
}

test('Observation header refresh is always accessible, preserves drafts and keeps real stale-data safeguards',async()=>{
 let row=fixture();const h=harness(async()=>Response.json({observation:row}));try{
  await h.state.open(h.state.mapObservation(row),true);h.state.reviewComment.value='Preserve this draft'
  let button=observationHeaderRefresh(h);assert.ok(button)
  assert.equal(button.props['aria-label'],messages.submissionChanges.reload);assert.equal(button.props.disabled,false)
  await button.props.onClick();assert.equal(h.state.reviewComment.value,'Preserve this draft');assert.equal(h.state.reviewAcknowledged.value,true)
  row=fixture({revision:5});await button.props.onClick();assert.equal(h.state.selected.value.revision,5);assert.equal(h.state.reviewAcknowledged.value,false);assert.equal(h.state.reviewAllowed.value,false)
  assert.ok(nodes(h.render()).some(n=>n.props?.role==='alert'&&String(n.props?.class).includes('review-feedback')))
  h.state.reviewSaving.value=true;button=observationHeaderRefresh(h);assert.equal(button.props.disabled,true);assert.equal(button.props['aria-busy'],true)
 }finally{h.stop()}
})

test('unwanted change-history disclosure is absent while actual review history and true failures remain',async()=>{
 const row=fixture({revision:2,submission_update:{state:'unavailable'}}),h=harness(async()=>Response.json({observation:row}));try{
  await h.state.open(h.state.mapObservation(row),true)
  const tree=nodes(h.render());assert.ok(!tree.some(n=>n.type==='details'&&n.props?.class==='observation-change-history'))
  assert.ok(!tree.some(n=>n.type?.name?.endsWith('SubmissionChanges.vue')))
  assert.ok(tree.some(n=>n.type?.name?.endsWith('ObservationReviewHistory.vue')))
  h.state.reviewNeedsReload.value=true;h.state.detailError.value='Loading failed';await flush()
  assert.ok(nodes(h.render()).some(n=>n.props?.role==='alert'&&n.children==='Loading failed'));assert.equal(h.state.reviewAllowed.value,false)
  const css=readFileSync(new URL('../src/styles/observation-dialog.css',import.meta.url),'utf8')
  assert.doesNotMatch(css,/overflow-y:\s*auto|--observation-review-height/)
  assert.match(css,/grid-template-columns: minmax\(0, 1fr\)/)
 }finally{h.stop()}
})


test('Observation summary and title follow search, Plant ID, Species, owner, date, Status and submission-type filters in every locale',async()=>{
 const rows=[fixture({id:'pending-a',plant_id:12,plant_display_id:'PL012',species_id:3,status:'Pending Review',created_at:'2026-11-02T10:00:00Z'}),fixture({id:'approved-b',plant_id:13,plant_display_id:'PL013',species_id:4,status:'Approved',created_at:'2026-11-03T10:00:00Z'}),fixture({id:'flagged-c',plant_id:12,plant_display_id:'PL012',species_id:3,status:'Flagged',created_at:'2026-11-02T10:00:00Z'})]
 for(const language of ['en','ms','zh-CN']){
  const h=harness(identityHandler(rows),officer,false,null,language),counts=()=>Array.from(h.state.summaryCounts.value,c=>c.count)
  const labels=JSON.parse(readFileSync(new URL('../src/locales/'+language+'.json',import.meta.url),'utf8')).unifiedObservations
  try{
   await h.state.loadObservations();assert.deepEqual(counts(),[1,0,1,0,1]);assert.equal(h.state.summaryHasFilters.value,false)
   assert.ok(nodes(h.render()).some(n=>n.type==='h3'&&n.children===labels.summaryTitle))
   h.state.search.value='pending-a';assert.deepEqual(counts(),[1,0,0,0,0]);assert.equal(h.state.filtered.value.length,1)
   assert.ok(nodes(h.render()).some(n=>n.type==='h3'&&n.children===labels.filteredSummaryTitle))
   h.state.search.value='PL012';assert.deepEqual(counts(),[1,0,1,0,0])
   h.state.search.value='';h.state.species.value='4';assert.deepEqual(counts(),[0,0,0,0,1])
   h.state.species.value='3';h.state.date.value='2026-11-02';h.state.owner.value='staff:real-botanist-subject';assert.equal(h.state.filtered.value.length,2);assert.deepEqual(counts(),[1,0,1,0,0])
   h.state.status.value='Flagged';await h.state.loadObservations();assert.deepEqual(counts(),[0,0,1,0,0]);assert.equal(h.state.filtered.value.length,1)
   h.state.submissionType.value='edit';assert.deepEqual(counts(),[0,0,0,0,0])
   h.state.submissionType.value='all';h.state.search.value='';h.state.species.value='';h.state.owner.value='';h.state.date.value='';h.state.status.value='';await h.state.loadObservations()
   assert.equal(h.state.summaryHasFilters.value,false);assert.deepEqual(counts(),[1,0,1,0,1]);assert.equal(h.state.summaryScope.value,labels.summaryScope)
  }finally{h.stop()}
 }
})

test('all-page summary deduplicates and filters unseen rows without advancing table pagination',async()=>{
 const first=fixture({id:'first',status:'Pending Review'}),later=fixture({id:'later',status:'Approved',plant_id:99,plant_display_id:'PL099'})
 const pageHandler=async url=>Response.json(url.includes('cursor=')?{observations:[first,later],page:{has_more:false,next_cursor:null}}:{observations:[first],page:{has_more:true,next_cursor:'next'}})
 const h=harness(identityHandler([]),officer,false,pageHandler,'en',{summaryHandler:pageHandler})
 try{
  await h.state.loadObservations();await h.state.summaryTask;await flush()
  assert.equal(h.state.summaryComplete.value,true);assert.deepEqual(Array.from(h.state.summaryCounts.value,c=>c.count),[1,0,0,0,1])
  assert.equal(h.state.observations.value.length,1);assert.equal(h.state.hasMore.value,true);assert.equal(h.state.nextCursor.value,'next');assert.equal(h.summaryCalls.length,1)
  h.state.search.value='PL099';assert.equal(h.state.displayedRows.value.length,0);assert.deepEqual(Array.from(h.state.summaryCounts.value,c=>c.count),[0,0,0,0,1])
  await h.state.loadObservations(true);assert.equal(h.state.displayedRows.value.length,1);assert.deepEqual(Array.from(h.state.summaryCounts.value,c=>c.count),[0,0,0,0,1])
 }finally{h.stop()}
})

test('failed, malformed, looping and over-budget summary pages never expose partial totals or break the main table',async()=>{
 for(const kind of ['http','malformed','loop','budget']){
  let page=0
  const pageHandler=async url=>{
   if(!url.includes('cursor='))return Response.json({observations:[fixture()],page:{has_more:true,next_cursor:'1'}})
   if(kind==='http')return Response.json({error:'Unavailable'},{status:503})
   if(kind==='malformed')return Response.json({observations:[{id:'bad'}],page:{has_more:false,next_cursor:null}})
   return Response.json({observations:[],page:{has_more:true,next_cursor:kind==='loop'?'1':String(++page+1)}})
  }
  const h=harness(identityHandler([]),officer,false,pageHandler,'en',{summaryHandler:pageHandler})
  try{await h.state.loadObservations();await h.state.summaryTask;assert.equal(h.state.summaryComplete.value,false);assert.ok(h.state.summaryError.value);assert.ok(h.state.summaryCounts.value.every(c=>c.count===null));assert.equal(h.state.observations.value.length,1);assert.equal(h.state.loadError.value,'');assert.equal(h.state.hasMore.value,true);assert.ok(page<=h.state.SUMMARY_PAGE_LIMIT);assert.ok(h.summaryCalls.length<=h.state.SUMMARY_PAGE_LIMIT)}finally{h.stop()}
 }
})

test('summary counts separate Observation and Edit Request submissions using their own statuses',async()=>{
 const h=harness(identityHandler([fixture({status:'Pending Review'})]));try{
  await h.state.loadObservations();h.state.receiveProposalState({rows:[await unifiedProposal()],names:{},loading:false,error:''})
  assert.equal(h.state.displayedRows.value.length,2);assert.deepEqual(Array.from(h.state.summaryCounts.value,c=>c.count),[2,0,0,0,0])
  h.state.updateObservation(h.state.mapObservation(fixture({status:'Approved',revision:5})));assert.deepEqual(Array.from(h.state.summaryCounts.value,c=>c.count),[1,0,0,0,1])
 h.state.submissionType.value='original';assert.deepEqual(Array.from(h.state.summaryCounts.value,c=>c.count),[0,0,0,0,1])
 h.state.submissionType.value='edit';assert.deepEqual(Array.from(h.state.summaryCounts.value,c=>c.count),[1,0,0,0,0])
 }finally{h.stop()}
})


test('summary ignores stale pages after logout and can retry a failed count without changing table pagination',async()=>{
 let release,fail=true
 const first=fixture({id:'summary-first'}),later=fixture({id:'summary-later',status:'Approved'})
 const main=async()=>Response.json({observations:[first],page:{has_more:true,next_cursor:'summary-next'}})
 const h=harness(identityHandler([]),officer,false,main,'en',{summaryHandler:async()=>fail?Response.json({error:'Failed'},{status:503}):Response.json({observations:[later],page:{has_more:false,next_cursor:null}})})
 try{await h.state.loadObservations();await h.state.summaryTask;assert.equal(h.state.summaryError.value,'unavailable');assert.ok(h.state.summaryCounts.value.every(c=>c.count===null))
  fail=false;await h.state.refreshSummary();assert.equal(h.state.summaryComplete.value,true);assert.deepEqual(Array.from(h.state.summaryCounts.value,c=>c.count),[1,0,0,0,1]);assert.equal(h.state.observations.value.length,1);assert.equal(h.state.nextCursor.value,'summary-next')
 }finally{h.stop()}
 const stale=harness(identityHandler([]),officer,false,main,'en',{summaryHandler:()=>new Promise(resolve=>{release=resolve})})
 try{await stale.state.loadObservations();const pending=stale.state.summaryTask;assert.equal(stale.state.summaryLoading.value,true);stale.changeSession(null);release(Response.json({observations:[later],page:{has_more:false,next_cursor:null}}));await pending
  assert.equal(stale.state.summaryRows.value.length,0);assert.equal(stale.state.summaryComplete.value,false);assert.ok(stale.state.summaryCounts.value.every(c=>c.count===null))
 }finally{stale.stop()}
})


test('edit summaries share table filters and use request status, date and typed identity rather than the baseline',async()=>{
 const h=harness(identityHandler([fixture({status:'Approved'})]));try{
  await h.state.loadObservations();const edit=await unifiedProposal('Pending Review');h.state.receiveProposalState({rows:[edit],names:{},loading:false,error:''})
  assert.equal(edit.id,uuid);assert.equal(edit.observation_edit.observation_id,uuid)
  assert.deepEqual(Array.from(h.state.summaryCounts.value,c=>c.count),[1,0,0,0,1])
  h.state.submissionType.value='edit';h.state.search.value='CHANGE-'+uuid;assert.deepEqual(Array.from(h.state.summaryCounts.value,c=>c.count),[1,0,0,0,0])
  h.state.search.value='';h.state.date.value='2026-11-17';assert.equal(h.state.displayedRows.value.length,1);assert.equal(h.state.summaryCounts.value[0].count,1)
  h.state.date.value='2026-11-02';assert.equal(h.state.displayedRows.value.length,0);assert.equal(h.state.summaryCounts.value[0].count,0)
  h.state.date.value='';h.state.owner.value='missing';assert.equal(h.state.summaryCounts.value[0].count,0);h.state.owner.value=''
  h.state.receiveProposalState({rows:[{...edit,status:'Rejected'}],names:{},loading:false,error:''});assert.deepEqual(Array.from(h.state.summaryCounts.value,c=>c.count),[0,0,0,1,0])
  h.state.status.value='Approved';assert.deepEqual(Array.from(h.state.summaryCounts.value,c=>c.count),[0,0,0,0,0]);h.state.status.value='Rejected';assert.deepEqual(Array.from(h.state.summaryCounts.value,c=>c.count),[0,0,0,1,0])
 }finally{h.stop()}
})

test('combined summaries never substitute partial counts when either selected source is loading or failed',async()=>{
 const h=harness(identityHandler([fixture()]));try{
  await h.state.loadObservations();h.state.receiveProposalState({rows:[],names:{},loading:true,error:''});assert.ok(h.state.summaryCounts.value.every(c=>c.count===null))
  h.state.submissionType.value='original';assert.equal(h.state.summaryCounts.value[0].count,1)
  h.state.receiveProposalState({rows:[],names:{},loading:false,error:'Evidence unavailable'});assert.equal(h.state.summaryCounts.value[0].count,1)
  h.state.submissionType.value='all';assert.ok(h.state.summaryCounts.value.every(c=>c.count===null))
  h.state.submissionType.value='edit';assert.ok(h.state.summaryCounts.value.every(c=>c.count===null))
  h.state.receiveProposalState({rows:[await unifiedProposal()],names:{},loading:false,error:''});h.state.loadError.value='Observation source failed';assert.equal(h.state.summaryCounts.value[0].count,1)
  h.state.submissionType.value='all';assert.ok(h.state.summaryCounts.value.every(c=>c.count===null))
 }finally{h.stop()}
})


test('normal summary explanation and media captions are absent without removing genuine count errors or photo zoom',async()=>{
 const h=harness(identityHandler([fixture()]));try{
  await h.state.loadObservations();assert.ok(!nodes(h.render()).some(n=>n.props?.id==='observation-summary-definition'))
  await h.state.open(h.state.observations.value[0]);const tree=nodes(h.render())
  assert.ok(!tree.some(n=>String(n.props?.class).includes('asset-caption')))
  assert.ok(tree.some(n=>String(n.props?.class).includes('observation-photo-button')))
  assert.ok(!tree.some(n=>n.props?.class==='observation-data-provenance'))
  h.state.receiveProposalState({rows:[],names:{},loading:false,error:'Unavailable'});assert.ok(nodes(h.render()).some(n=>n.props?.id==='observation-summary-definition'))
 }finally{h.stop()}
})

test('Approved and Rejected help is localized, compact and never reopens review permissions',async()=>{
 for(const language of ['en','ms','zh-CN'])for(const status of ['Approved','Rejected','Pending Review']){
  const row=fixture({status}),h=harness(async()=>Response.json({observation:row}),officer,false,null,language)
  try{
   await h.state.open(h.state.mapObservation(row));const tree=nodes(h.render()),button=tree.find(n=>n.props?.class==='observation-status-help-button')
   assert.equal(!!button,status!=='Pending Review')
   if(!button)continue
   const labels=JSON.parse(readFileSync(new URL('../src/locales/'+language+'.json',import.meta.url),'utf8'))
   assert.equal(button.props['aria-label'],labels.observationModal[status==='Approved'?'aboutApproved':'aboutRejected'])
   assert.equal(h.state.reviewAllowed.value,false);assert.equal(h.state.statusHelpOpen.value,false)
   button.props.onFocus();await flush();assert.equal(h.state.statusHelpOpen.value,true)
   let tooltip=nodes(h.render()).find(n=>n.props?.id==='observation-status-tooltip');assert.ok(tooltip);assert.equal(tooltip.props.role,'tooltip');assert.equal(tooltip.props.popover,'manual')
   assert.ok(nodes(tooltip).some(n=>n.type==='p'&&n.children===(status==='Approved'?labels.observationModal.approvedDescription:labels.submissionChanges.finalRejected)))
   if(status==='Approved')assert.ok(nodes(tooltip).some(n=>n.children===labels.observationModal.approvedEditNote))
   assert.ok(!nodes(h.render()).some(n=>n.type==='p'&&n.props?.class==='review-feedback error'&&n.children===labels.submissionChanges.finalRejected))
   button.props.onKeydown({key:'Escape',stopPropagation(){},preventDefault(){}});assert.equal(h.state.statusHelpOpen.value,false)
   button.props.onClick();assert.equal(h.state.statusHelpOpen.value,true);button.props.onBlur();assert.equal(h.state.statusHelpOpen.value,false)
   await h.state.decide('Approved');assert.equal(h.calls.filter(c=>c.options?.method==='POST').length,0)
  }finally{h.stop()}
 }
})

test('status help uses an unclipped viewport-clamped popover and title layout keeps refresh beside the title/ID',async()=>{
 const row=fixture({status:'Approved'}),h=harness(async()=>Response.json({observation:row}),officer,false,null,'en',{window:{innerWidth:360,innerHeight:300}})
 try{
  await h.state.open(h.state.mapObservation(row));let opened=0,hidden=0
  h.state.statusHelpButton.value={getBoundingClientRect:()=>({left:320,top:250,bottom:274}),contains:()=>false}
  const tooltip={style:{},showPopover:()=>{opened++},hidePopover:()=>{hidden++},getBoundingClientRect:()=>({height:120}),contains:()=>false}
  h.state.statusHelpTooltip.value=tooltip;h.state.showStatusHelp();await flush()
  assert.equal(opened,1);assert.equal(tooltip.style.width,'320px');assert.equal(tooltip.style.left,'28px');assert.equal(tooltip.style.top,'122px')
  h.state.dismissOutsideStatusHelp({target:{}});assert.equal(h.state.statusHelpOpen.value,false);await flush();assert.ok(hidden>0)
  h.state.showStatusHelp();let stopped=false;h.state.dismissStatusHelpKey({key:'Escape',preventDefault(){},stopPropagation(){stopped=true}});assert.equal(stopped,true);assert.equal(h.state.statusHelpOpen.value,false)
  const css=readFileSync(new URL('../src/styles/observation-dialog.css',import.meta.url),'utf8')
  assert.match(css,/grid-template-columns: 52px minmax\(0, 1fr\) 36px/);assert.match(css,/grid-template-columns: 40px minmax\(0, 1fr\) 36px/)
  assert.match(css,/observation-status-tooltip[^}]*position: fixed[^}]*z-index: 2147483647/)
  const source=readFileSync(filename,'utf8');assert.match(source,/<Teleport to="body">/)
 }finally{h.stop()}
})


test('terminal help belongs to a separate full-width status strip above details, while the original status badge stays unchanged',async()=>{
 for(const status of ['Approved','Rejected']){
  const row=fixture({status}),h=harness(async()=>Response.json({observation:row}));try{
   await h.state.open(h.state.mapObservation(row));const tree=nodes(h.render()),strip=tree.find(n=>String(n.props?.class).split(' ').includes('observation-status-strip'))
   assert.ok(strip);assert.ok(strip.props.class.includes(status==='Rejected'?'is-rejected':'is-approved'))
   assert.ok(nodes(strip).some(n=>n.props?.class==='observation-status-help-button'));assert.ok(nodes(strip).some(n=>n.type==='strong'&&n.children===status))
   assert.ok(tree.indexOf(strip)<tree.findIndex(n=>n.props?.class==='observation-dialog-columns'))
   const details=tree.find(n=>n.type==='dl'&&n.props?.class==='detail-list observation-details');assert.ok(details)
   assert.ok(nodes(details).some(n=>n.props?.class==='badge'&&n.children===status));assert.ok(!nodes(details).some(n=>n.props?.class==='observation-status-help-button'))
   const css=readFileSync(new URL('../src/styles/observation-dialog.css',import.meta.url),'utf8');assert.match(css,/observation-title-layout[^}]*max-width: none/);assert.match(css,/grid-template-columns: minmax\(0, 1fr\) 36px/);assert.match(css,/observation-refresh-control::after[^}]*border-right/)
  }finally{h.stop()}
 }
})

function fakeRefreshClock() {
  let now = 1_000_000, sequence = 0, visibility = 'visible'
  const intervals = new Map(), listeners = new Map()
  const window = {
    setInterval(fn, delay) { const id = ++sequence; intervals.set(id, { fn, delay, due: now + delay }); return id },
    clearInterval(id) { intervals.delete(id) },
    addEventListener() {}, removeEventListener() {},
  }
  const document = {
    get visibilityState() { return visibility },
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn) },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn) },
  }
  const ClockDate = class extends Date { static now() { return now } }
  return {
    window, document, Date: ClockDate, intervals,
    advance(ms) {
      now += ms
      for (const timer of intervals.values()) if (timer.due <= now) {
        timer.due += (Math.floor((now - timer.due) / timer.delay) + 1) * timer.delay
        timer.fn()
      }
    },
    setVisibility(value) { visibility = value; for (const fn of listeners.get('visibilitychange') || []) fn() },
  }
}
const observationListCalls = h => h.calls.filter(call => call.url.startsWith('/api/observations?'))

test('Observations mount loads normally and refreshes one minute later without hiding verified rows', async () => {
  const clock = fakeRefreshClock(), oldRow = fixture({ id: 'before-refresh' }), newRow = fixture({ id: 'after-refresh', status: 'Approved' })
  let release
  const h = harness(async () => Response.json({}), officer, false, async (url, options) => {
    if (options.cache === 'reload') return new Promise(resolve => { release = resolve })
    return queueResponse([oldRow])
  }, 'en', { ...clock })
  try {
    h.mount(); await flush()
    assert.equal(observationListCalls(h).length, 1, 'mount preserves the single initial list load')
    assert.equal(clock.intervals.size, 1, 'only one periodic timer is active')
    clock.advance(59_999); await flush(); assert.equal(observationListCalls(h).length, 1)
    clock.advance(1); await flush()
    assert.equal(observationListCalls(h).length, 2)
    assert.equal(h.state.isRefreshing.value, true)
    assert.deepEqual(Array.from(h.state.observations.value, row => row.id), ['before-refresh'])
    assert.ok(nodes(h.render()).some(node => node.props?.role === 'status' && node.children === messages.conservationPages.observations.autoRefreshing))
    release(queueResponse([newRow]))
    await flush()
    assert.equal(h.state.isRefreshing.value, false)
    assert.deepEqual(Array.from(h.state.observations.value, row => row.id), ['after-refresh'])
  } finally { h.stop(); assert.equal(clock.intervals.size, 0, 'unmount clears the timer') }
})

test('hidden tabs skip polling and visibility recovery refreshes stale data once without duplicate timers', async () => {
  const clock = fakeRefreshClock(), h = harness(async () => Response.json({}), officer, false,
    async () => queueResponse([fixture()]), 'en', { ...clock })
  try {
    h.mount(); await flush(); h.changeSession(officer, false); h.changeSession(officer, false)
    assert.equal(clock.intervals.size, 1)
    clock.setVisibility('hidden'); clock.advance(60_000); await flush()
    assert.equal(observationListCalls(h).length, 1)
    clock.setVisibility('visible'); await flush()
    assert.equal(observationListCalls(h).length, 2)
    assert.equal(clock.intervals.size, 1)
    clock.advance(60_000); await flush()
    assert.equal(observationListCalls(h).length, 3, 'the timer does not duplicate the visibility-triggered refresh')
    h.changeSession(null); assert.equal(clock.intervals.size, 0)
  } finally { h.stop(); assert.equal(clock.intervals.size, 0) }
})

test('background refresh preserves local filters and pagination, removes status-moved rows and defers during review drafts', async () => {
  const clock = fakeRefreshClock(), first = fixture({ id: 'pending-first' }), second = fixture({ id: 'pending-second' })
  const newest = fixture({ id: 'pending-new' }), older = fixture({ id: 'pending-older', created_at: '2026-10-02T10:00:00Z' })
  let queueNumber = 0, refreshPage = 0
  const h = harness(async () => Response.json({}), officer, false, async (url, options) => {
    if (options.cache === 'reload') return ++refreshPage === 1
      ? queueResponse([newest], 'refresh-next')
      : queueResponse([older], null)
    if (++queueNumber === 1) return queueResponse([first], 'older')
    return queueResponse([second], null)
  }, 'en', { ...clock })
  try {
    h.state.status.value = 'Pending Review'; h.state.search.value = 'pending'
    h.state.species.value = '3'; h.state.owner.value = 'staff:real-botanist-subject'; h.state.date.value = '2026-11-02'
    h.mount(); await flush(); await h.state.loadObservations(true)
    h.state.selected.value = h.state.observations.value[0]; h.state.reviewMode.value = true; h.state.reviewComment.value = 'Unsaved reviewer note'
    clock.advance(60_000); await flush()
    assert.equal(observationListCalls(h).length, 2, 'an open review dialog defers refresh')
    assert.equal(h.state.reviewComment.value, 'Unsaved reviewer note')
    h.state.selected.value = null; h.state.reviewMode.value = false
    clock.advance(60_000); await flush()
    assert.equal(observationListCalls(h).length, 4, 'refresh rebuilds the same two-page window')
    assert.deepEqual(Array.from(h.state.observations.value, row => row.id), ['pending-new', 'pending-older'])
    assert.deepEqual([h.state.status.value, h.state.search.value, h.state.species.value, h.state.owner.value, h.state.date.value],
      ['Pending Review', 'pending', '3', 'staff:real-botanist-subject', '2026-11-02'])
    assert.equal(h.state.hasMore.value, false)
    assert.equal(h.state.filtered.value.length, 1)
    assert.ok(observationListCalls(h).slice(2).every(call => new URL(call.url, 'https://fixture.invalid').searchParams.get('status') === 'Pending Review'))
  } finally { h.stop() }
})

test('background refresh failure retains rows, exposes retry, and successful retry recovers with authorized reads', async () => {
  const clock = fakeRefreshClock(), original = fixture({ id: 'verified-old' }), recovered = fixture({ id: 'verified-new' })
  let attempts = 0
  const h = harness(async () => Response.json({}), officer, false, async (_url, options) => {
    if (options.cache === 'reload' && ++attempts === 1) return Response.json({ error: 'Temporary failure' }, { status: 503 })
    return queueResponse([options.cache === 'reload' ? recovered : original])
  }, 'en', { ...clock })
  try {
    h.mount(); await flush(); clock.advance(60_000); await flush()
    assert.deepEqual(Array.from(h.state.observations.value, row => row.id), ['verified-old'])
    assert.ok(h.state.automaticRefreshError.value)
    assert.equal(h.state.summaryCounts.value.every(item => item.count === null), true)
    const retry = nodes(h.render()).find(node => node.type === 'button' && node.children === messages.conservationPages.observations.retry)
    assert.ok(retry); retry.props.onClick(); await flush()
    assert.equal(h.state.automaticRefreshError.value, '')
    assert.deepEqual(Array.from(h.state.observations.value, row => row.id), ['verified-new'])
    assert.ok(observationListCalls(h).every(call => (!call.options.method || call.options.method === 'GET') && call.options.credentials === 'same-origin'))
  } finally { h.stop() }
})

test('a user status change supersedes an in-flight automatic refresh and a late old page cannot overwrite it', async () => {
  const clock = fakeRefreshClock(), waiting = fixture({ id: 'still-pending' }), approved = fixture({ id: 'new-approved', status: 'Approved' })
  let release, oldSignal
  const h = harness(async () => Response.json({}), officer, false, async (url, options) => {
    if (options.cache === 'reload') { oldSignal = options.signal; return new Promise(resolve => { release = resolve }) }
    const query = new URL(url, 'https://fixture.invalid').searchParams
    if (query.get('status') === 'Approved') return queueResponse([approved])
    return queueResponse([waiting], 'pending-next')
  }, 'en', { ...clock })
  try {
    h.mount(); await flush(); clock.advance(60_000); await flush()
    assert.equal(h.state.isRefreshing.value, true)
    h.state.status.value = 'Approved'; await h.state.loadObservations()
    assert.equal(oldSignal.aborted, true)
    release(queueResponse([waiting]))
    await flush()
    assert.deepEqual(Array.from(h.state.observations.value, row => row.id), ['new-approved'])
    assert.equal(h.state.status.value, 'Approved')
    assert.equal(h.state.isRefreshing.value, false)
  } finally { h.stop() }
})

test('logout, account switch and permission revocation stop polling and clear private records during an in-flight refresh', async () => {
  for (const change of ['logout', 'account', 'permission']) {
    const clock = fakeRefreshClock(), original = fixture(), h = harness(async () => Response.json({}), officer, false, async (_url, options) => {
      if (options.cache === 'reload') return new Promise(resolve => { release = resolve })
      return queueResponse([original])
    }, 'en', { ...clock })
    let release
    try {
      h.mount(); await flush(); clock.advance(60_000); await flush()
      const pending = release
      if (change === 'logout') h.changeSession(null)
      else if (change === 'account') h.changeSession({ ...officer, id: 'other-officer' })
      else h.changeSession({ ...officer, role: 'Botanist' })
      assert.equal(h.state.observations.value.length, 0)
      assert.equal(clock.intervals.size, change === 'account' ? 1 : 0)
      pending(queueResponse([fixture({ id: 'private-stale' })])); await flush()
      assert.equal(h.state.observations.value.length, 0)
      assert.equal(observationListCalls(h).length, 2)
    } finally { h.stop() }
  }
})

test('automatic refresh is bounded to 20 loaded pages and offers an explicit full-window refresh', async () => {
  let page = 0, refreshed = 0
  const h = harness(async () => Response.json({}), officer, false, async (_url, options) => {
    if (options.cache === 'reload') {
      refreshed++
      return queueResponse([fixture({ id: `refresh-${refreshed}` })], refreshed < 21 ? `refresh-cursor-${refreshed}` : null)
    }
    page++
    return queueResponse([fixture({ id: `loaded-${page}` })], `loaded-cursor-${page}`)
  })
  try {
    await h.state.loadObservations()
    for (let index = 0; index < 20; index++) await h.state.loadObservations(true)
    assert.equal(observationListCalls(h).length, 21)
    await h.state.refreshObservations()
    assert.equal(observationListCalls(h).length, 21, 'automatic refresh does not issue an expensive partial page-window request')
    assert.equal(h.state.automaticRefreshDeferred.value, true)
    assert.ok(nodes(h.render()).some(node => node.children === messages.conservationPages.observations.autoRefreshDeferred))
    await h.state.refreshObservations(true)
    assert.equal(refreshed, 21, 'explicit refresh verifies the entire loaded page window')
    assert.deepEqual(Array.from(h.state.observations.value, row => row.id), Array.from({ length: 21 }, (_, index) => `refresh-${index + 1}`))
    assert.equal(h.state.automaticRefreshDeferred.value, false)
  } finally { h.stop() }
})

test('automatic refresh status, failure and deferred messages are translated in EN/MS/ZH', () => {
  for (const language of ['en', 'ms', 'zh-CN']) {
    const dictionary = JSON.parse(readFileSync(new URL(`../src/locales/${language}.json`, import.meta.url), 'utf8'))
    const labels = dictionary.conservationPages.observations
    for (const key of ['autoRefreshing', 'autoRefreshFailed', 'autoRefreshDeferred', 'refreshNow'])
      assert.ok(typeof labels[key] === 'string' && labels[key].length > 0, `${language} provides ${key}`)
    const h = harness(async () => Response.json({}), officer, false, null, language)
    try {
      h.state.isRefreshing.value = true
      assert.ok(nodes(h.render()).some(node => node.props?.role === 'status' && node.children === labels.autoRefreshing))
      h.state.isRefreshing.value = false; h.state.automaticRefreshError.value = 'Unavailable'
      assert.ok(nodes(h.render()).some(node => node.props?.role === 'alert' && nodes(node).some(child => child.children === labels.autoRefreshFailed)))
      h.state.automaticRefreshError.value = ''; h.state.automaticRefreshDeferred.value = true
      assert.ok(nodes(h.render()).some(node => nodes(node).some(child => child.children === labels.autoRefreshDeferred)))
    } finally { h.stop() }
  }
})
