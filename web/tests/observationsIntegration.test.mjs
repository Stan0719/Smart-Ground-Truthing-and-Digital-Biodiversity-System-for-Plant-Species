import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { parse, compileScript, compileTemplate, compileStyle } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as vue from 'vue'
import * as observationReview from '../src/services/observationReview.ts'
import * as observationQueue from '../src/services/observationQueue.ts'
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
const flush = async () => {
  for (let i = 0; i < 4; i++) {
    await vue.nextTick()
    await new Promise(setImmediate)
  }
}
const officer = { id: 'officer', role: 'Conservation Officer', status: 'Active', mustChangePassword: false }
const summaryStates = ['Pending Review','Correction Required','Flagged','Rejected','Approved']
const summaryCards = h => nodes(h.render()).filter(node => node.type === 'article' && String(node.props?.class).includes('observation-summary-card'))

test('five informational status cards count each loaded observation once in the selected origin scope, including normalized statuses',async()=>{
  const rows=['subsequent_observation','initial_registration','unknown'].flatMap(origin=>summaryStates.map((status,index)=>fixture({id:origin+'-'+index,origin_type:origin,status:status.toUpperCase().replaceAll(' ','_')})))
  rows.push(fixture({id:'draft',status:'Draft'}));rows.push(rows[0])
  const h=harness(async()=>Response.json({observations:rows}));try{
    await h.state.loadObservations()
    assert.deepEqual(Array.from(h.state.summaryCounts.value,item=>item.status),summaryStates)
    assert.deepEqual(Array.from(h.state.summaryCounts.value,item=>item.count),[1,1,1,1,1])
    h.state.queueOrigin.value='all';assert.deepEqual(Array.from(h.state.summaryCounts.value,item=>item.count),[3,3,3,3,3])
    h.state.queueOrigin.value='unknown';assert.deepEqual(Array.from(h.state.summaryCounts.value,item=>item.count),[1,1,1,1,1])
    h.state.queueOrigin.value='subsequent_observation';h.state.search.value='no matches';h.state.species.value='missing';h.state.owner.value='missing';h.state.date.value='2026-01-01'
    assert.equal(h.state.filtered.value.length,0);assert.deepEqual(Array.from(h.state.summaryCounts.value,item=>item.count),[1,1,1,1,1])
    const cards=summaryCards(h);assert.equal(cards.length,5);assert.ok(cards.every(card=>nodes(card).filter(node=>node.type==='svg').length===1))
    assert.ok(cards.every(card=>!card.props.onClick&&!nodes(card).some(node=>node.type==='button'||node.type==='a')))
    const tree=nodes(h.render());assert.ok(tree.findIndex(node=>node.props?.class==='observation-summary')<tree.findIndex(node=>node.props?.class==='control-bar'))
    assert.equal(h.calls.length,1,'cards never issue a count request or change filters')
  }finally{h.stop()}
})

test('summary totals include every loaded page, deduplicate page overlaps and show unavailable while loading more',async()=>{
  const first=Array.from({length:100},(_,index)=>fixture({id:'loaded-'+index,status:summaryStates[index%5]}))
  const next=Array.from({length:25},(_,index)=>fixture({id:'additional-'+index,status:summaryStates[index%5]}))
  let release
  const h=harness(async()=>Response.json({}),officer,false,async url=>url.includes('cursor=')?new Promise(resolve=>{release=resolve}):Response.json({observations:first,page:{has_more:true,next_cursor:'next-page'}}))
  try{
    await h.state.loadObservations();assert.deepEqual(Array.from(h.state.summaryCounts.value,item=>item.count),[20,20,20,20,20])
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
    const theme=status==='Approved'?'approved-today':status.toLowerCase().replaceAll(' ','-')
    const expected=declarations(review.find(rule=>rule.selector===`.review-summary-${theme}`))
    assert.equal(actual['--observation-summary-background'],expected['--review-summary-background']);assert.equal(actual['--observation-summary-ink'],expected['--review-summary-ink'])
  }
  assert.equal(declarations(own.find(rule=>rule.selector==='.observation-summary-grid'))['grid-template-columns'],'repeat(5, minmax(0, 1fr))')
  assert.equal(declarations(own.find(rule=>rule.selector==='.observation-summary-card')).border,'1px solid currentColor')
  for(const[width,columns]of [[1150,'repeat(3, minmax(0, 1fr))'],[760,'repeat(2, minmax(0, 1fr))'],[420,'minmax(0, 1fr)']])assert.ok(own.some(rule=>rule.parent.params===`(max-width: ${width}px)`&&declarations(rule)['grid-template-columns']===columns))
})

test('status labels reuse existing translations and the concise scope note is localized in all supported languages',async()=>{
  for(const language of ['en','ms','zh-CN']){
    const h=harness(async()=>Response.json({observations:[]}),officer,false,null,language)
    try{
      await h.state.loadObservations();const locale=JSON.parse(readFileSync(new URL(`../src/locales/${language}.json`,import.meta.url),'utf8'))
      assert.ok(locale.conservationPages.observations.summaryTitle);assert.ok(locale.conservationPages.observations.summaryScope)
      const tree=nodes(h.render());assert.equal(tree.find(node=>node.props?.id==='observation-summary-scope').children,locale.conservationPages.observations.summaryScope)
      assert.ok(summaryCards(h).every(card=>!nodes(card).some(node=>typeof node.children==='string'&&node.children.startsWith('conservationPages.'))))
    }finally{h.stop()}
  }
})
function harness(fetchHandler, initialUser = officer, pending = false, queueHandler = null, language = 'en', options = {}) {
  const messages = JSON.parse(readFileSync(new URL(`../src/locales/${language}.json`, import.meta.url), 'utf8'))
  let session = { user: initialUser, pending }
  const sessionListeners = new Set()
  const scope = vue.effectScope()
  const calls = [], unmount = []
  const route = vue.reactive({ query: options.query || {} })
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
    navigator: { clipboard: options.clipboard },
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
        onBeforeUnmount(callback) { unmount.push(callback) },
        resolveComponent: (component) => component,
        withDirectives: (node) => node,
      }
      if (name === 'vue-router') return { useRoute: () => route }
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
  return { state, calls, route, changeSession(user, pending = false) { session = { user, pending }; for (const fn of sessionListeners) fn(user, pending) }, render: () => exports.render({}, [], {}, vue.proxyRefs(state), {}, {}), stop: () => { unmount.forEach(callback => callback()); scope.stop() } }
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
    assert.equal(h.calls.length, 1)
  } finally { h.stop() }
})

test('single UUID display is compact and submitter labels use only existing subjects, never unauthorized names/lookups', async () => {
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
    assert.ok(h.calls.every(call => call.url.startsWith('/api/observations')))
    assert.equal(h.calls.length, 1)
    h.state.owner.value = owner; assert.equal(h.state.filtered.value.length, 1)
  } finally { h.stop() }
})

test('copy buttons write the exact full UUID and subject and give accessible success feedback without API writes', async () => {
  const owner = 'staff:2ace382f-1010-4010-8010-101010101010', writes = []
  const h = harness(identityHandler([fixture({ owner_subject: owner })]), officer, false, null, 'en', { clipboard: { writeText: async value => { writes.push(value) } } })
  try {
    await h.state.loadObservations()
    const buttons = copyButtons(h)
    assert.equal(buttons.length, 2)
    assert.match(buttons[0].props['aria-label'], /Copy full observation ID for OBS-5D8A3647/)
    assert.equal(buttons[0].props.type, 'button')
    await buttons[0].props.onClick()
    assert.deepEqual(writes, [uuid])
    assert.match(h.state.copyFeedback.value, /Full observation ID copied/)
    await copyButtons(h)[1].props.onClick()
    assert.deepEqual(writes, [uuid, owner])
    assert.match(h.state.copyFeedback.value, /Full submitter identifier copied/)
    const feedback = nodes(h.render()).find(node => String(node.props?.class).includes('copy-feedback'))
    assert.equal(feedback.props.role, 'status'); assert.equal(feedback.props['aria-live'], 'polite')
    assert.equal(feedback.props['aria-atomic'], 'true')
    assert.equal(h.calls.length, 1)
    assert.ok(h.calls.every(call => !call.options.method || call.options.method === 'GET'))
  } finally { h.stop() }
})

test('clipboard unavailable/denied leaves full identity available in refreshed observation details', async () => {
  for (const clipboard of [undefined, { writeText: async () => { throw Error('Denied') } }]) {
    const h = harness(identityHandler([fixture()]), officer, false, null, 'en', { clipboard })
    try {
      await h.state.loadObservations(); await copyButtons(h)[0].props.onClick()
      assert.equal(h.state.copyFailed.value, true)
      assert.match(h.state.copyFeedback.value, /Open observation details/)
      await h.state.open(h.state.observations.value[0])
      const fullValues = nodes(h.render()).filter(node => node.props?.class === 'full-identifier').map(node => node.children)
      assert.ok(fullValues.includes(uuid)); assert.ok(fullValues.includes(fixture().owner_subject))
      assert.ok(h.calls.some(call => call.url === `/api/observations/${uuid}`))
      assert.ok(h.calls.every(call => !call.options.method || call.options.method === 'GET'))
    } finally { h.stop() }
  }
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
  assert.match(css, /\.observations-table \.observation-column\s*\{ width: 11rem/)
  assert.match(css, /\.observations-table \.submitter-column\s*\{ width: 13rem/)
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
    assert.equal(h.calls.length, 1)
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
    assert.equal(h.calls.length, 1)
    h.changeSession(account, true)
    assert.notEqual(h.state.submitterLabel('staff:officer'), 'Aina Actual', 'unverified sessions do not resolve names')
  } finally { h.stop() }
})

const mainObservationTable = h => nodes(h.render()).find(node => node.type === 'table' && node.props?.class === 'observations-table')
const observationCells = row => nodes(row).filter(node => node.type === 'td')

test('main table has seven matching columns with one Status, full action access and no duplicate Review State', async () => {
  const longName = 'Long species name '.repeat(35) + 'UnbrokenName'.repeat(40)
  const rows = ['Draft', 'Pending Review', 'Approved', 'Rejected', 'Correction Required', 'Flagged'].map((status, index) => fixture({ id: String(index + 1), status, scientific_name: longName }))
  const h = harness(identityHandler(rows))
  try {
    await h.state.loadObservations()
    const table = mainObservationTable(h), headers = nodes(table).filter(node => node.type === 'th')
    assert.deepEqual(headers.map(node => node.children), ['Observation ID', 'Plant ID', 'Species', 'Submitted By', 'Status', 'Created', 'Actions'])
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
      assert.equal(cells[1].children, item.plantDisplayId)
      assert.ok(nodes(cells[2]).some(node => node.children === longName))
      assert.ok(nodes(cells[3]).some(node => node.children === h.state.submitterLabel(item.ownerSubject)))
      assert.ok(nodes(cells[4]).some(node => String(node.props?.class).includes('badge') && node.children === h.state.label(item.status)))
      assert.equal(cells[5].children, h.state.formatDate(item.createdAt))
      const actions = nodes(cells[6])
      assert.ok(actions.some(node => node.type === 'button' && ['Review', 'View Details'].includes(node.children)))
      assert.ok(actions.some(node => node.props?.to === '/plant/PL007'))
      assert.ok(actions.some(node => node.type === 'button' && node.children === 'History'))
      assert.ok(actions.some(node => node.props?.to?.name === 'conservation-map' && node.props.to.query.plant === '7'))
      assert.equal(nodes(cells[0]).filter(node => node.props?.class === 'identifier-copy').length, 1)
      assert.equal(nodes(cells[3]).filter(node => node.props?.class === 'identifier-copy').length, 1)
    })
    assert.equal(h.calls.length, 1)
  } finally { h.stop() }
})

test('latest review timestamp, decision and rejection reason remain in refreshed Details and History stays available', async () => {
  const row = fixture({ status: 'Rejected', review_decision: 'Rejected', review_comment: 'Please verify the recorded measurements.' })
  const h = harness(identityHandler([row]))
  try {
    await h.state.loadObservations()
    const view = nodes(mainObservationTable(h)).find(node => node.type === 'button' && node.children === 'View Details')
    await view.props.onClick()
    assert.equal(h.state.selected.value.reviewedAt, row.reviewed_at)
    assert.equal(h.state.selected.value.reviewComment, row.review_comment)
    const details = nodes(h.render()).find(node => node.type === 'dl' && node.props?.class === 'detail-list')
    const assertDetail = (title, value) => assert.ok(nodes(details).filter(node => node.type === 'div').some(node => nodes(node).some(child => child.type === 'dt' && child.children === title) && nodes(node).some(child => child.type === 'dd' && child.children === value)), title)
    assertDetail(messages.conservationPages.observations.reviewedAt, h.state.formatDate(row.reviewed_at))
    assertDetail(messages.conservationPages.observations.reviewState, 'Rejected')
    assertDetail(messages.conservationPages.observations.reviewComments, row.review_comment)
    h.state.closeModal()
    const history = nodes(mainObservationTable(h)).find(node => node.type === 'button' && node.children === 'History')
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

test('table layout reserves intrinsic status/action widths, consistent padding and internal horizontal scrolling', async () => {
  const css = descriptor.styles[0].content
  assert.match(css, /\.observations-table\s*\{[^}]*width: 100%; min-width: 80rem; table-layout: auto; white-space: normal/)
  assert.match(css, /\.observations-table th, \.observations-table td\s*\{ padding: 12px 14px; text-align: left; vertical-align: middle/)
  assert.match(css, /\.observations-table \.status-column, \.observations-table \.actions-column\s*\{ width: 1%/)
  assert.match(css, /\.observations-table \.species-column\s*\{ width: 20%/)
  assert.match(css, /\.observations-table \.plant-column\s*\{ width: 6rem/)
  assert.match(css, /\.identifier-line\s*\{[^}]*display: inline-flex;[^}]*justify-content: flex-start;[^}]*gap: 7px/)
  assert.doesNotMatch(/\.identifier-line\s*\{([^}]+)\}/.exec(css)[1], /width: 180px/)
  assert.match(css, /\.observations-scroll \.observations-table \.action-group\s*\{[^}]*flex-wrap: nowrap;[^}]*gap: 7px; width: max-content; min-width: max-content/)
  assert.match(css, /\.observations-table \.action-group > \.action-button\s*\{[^}]*max-width: none; height: auto;[^}]*white-space: nowrap/)
  assert.match(css, /@media \(max-width: 767px\)[^\n]*min-height: 44px/)
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
  const identifiers = /\.identifier-line\s*\{([^}]+)\}/.exec(css)[1]
  assert.match(identifiers, /align-items: center/)
  assert.match(identifiers, /vertical-align: middle/)
  assert.match(css, /\.observations-table \.badge\s*\{[^}]*align-items: center;[^}]*vertical-align: middle/)
  assert.match(css, /\.observations-table \.submitter-column\s*\{ width: 13rem/)
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
  assert.match(actions, /display: flex; flex-wrap: nowrap; align-items: center/)
  assert.match(actions, /gap: 7px; width: max-content; min-width: max-content/)
  const buttons = /\.observations-table \.action-group > \.action-button\s*\{([^}]+)\}/.exec(css)[1]
  assert.match(buttons, /flex: 0 0 auto; width: max-content; min-width: max-content; max-width: none/)
  assert.match(buttons, /white-space: nowrap/)
  assert.doesNotMatch(buttons, /overflow: hidden|text-overflow|font-size: [0-9]px/)
  assert.match(css, /\.observations-scroll\s*\{ min-width: 0; max-width: 100%; overflow-x: auto/)
  assert.doesNotMatch(/\.observations-table\s*\{([^}]+)\}/.exec(css)[1], /overflow:/)
})

test('pending and completed observations keep every action and full localized status label in the single-row group', async () => {
  for (const language of ['en', 'ms', 'zh-CN']) for (const status of ['Pending Review', 'Approved', 'Rejected', 'Correction Required']) {
    for (const origin of ['subsequent_observation', 'initial_registration']) {
      const row = fixture({ status, origin_type: origin })
      const h = harness(identityHandler([row]), officer, false, null, language)
      try {
        await h.state.loadObservations(); h.state.queueOrigin.value = 'all'
        const table = mainObservationTable(h)
        const badge = nodes(table).find(node => node.type === 'span' && String(node.props?.class).includes('badge'))
        assert.equal(badge.children, h.state.label(status))
        const cell = nodes(table).find(node => node.props?.class === 'actions-cell')
        const group = nodes(cell).find(node => node.props?.class === 'action-group')
        const actions = nodes(group).filter(node => node.props?.class === 'action-button')
        assert.equal(actions.length, origin === 'initial_registration' && status === 'Pending Review' ? 5 : 4)
        assert.ok(actions.every(node => nodes(node).some(child => typeof child.children === 'string' && child.children.trim())))
        assert.ok(actions.some(node => node.props?.to === '/plant/PL007'))
        assert.ok(actions.some(node => node.props?.to?.name === 'conservation-map'))
        assert.equal(nodes(table).filter(node => node.type === 'th').length, 7)
        const scroll = nodes(h.render()).find(node => String(node.props?.class).includes('observations-scroll'))
        assert.equal(scroll.props.tabindex, '0')
        assert.equal(nodes(scroll).filter(node => String(node.props?.class).includes('table-scroll')).length, 1, 'only one table scroll container')
        assert.equal(copyButtons(h).length, 2)
        assert.equal(h.calls.length, 1)
        assert.ok(h.calls.every(call => !call.options.method || call.options.method === 'GET'))
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
