import { workflowBadgeStyle } from '../src/utils/workflowBadge.ts'
import { conservationBadgeStyle, conservationBadgePalette } from '../src/utils/conservationBadge.ts'
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as vue from 'vue'
import * as integration from '../src/services/plantIntegration.ts'
import * as galleryService from '../src/services/plantGallery.ts'
import * as historyService from '../src/services/plantHistory.ts'
import * as detailService from '../src/services/plantDetail.ts'
import { formatPlantId } from '../src/utils/plantId.ts'
import { formatPlantDateTime } from '../src/utils/plantDateTime.ts'
const source = readFileSync(new URL('../src/views/PlantDetailView.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source), script = compileScript(descriptor, { id: 'privacy' })
const template = compileTemplate({ source: descriptor.template.content, filename: 'PlantDetailView.vue', id: 'privacy', compilerOptions: { bindingMetadata: script.bindings } })
const js = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const officer = { id: 'officer', role: 'Conservation Officer', status: 'Active', mustChangePassword: false }
const information = { plant_id: '1', scientific_name: 'Individual name', common_name: 'Common', genus_name: 'Genus', family_name: 'Family', description: 'Description' }
const detailObservation = { status: 'Approved', created_at: '2026-11-02T08:00:00.000Z', content: { heightCm: 21, healthStatus: 'Healthy', lifeStage: 'Mature', morphology: 'Broad leaves', notes: 'Latest notes', latitude: 4.5, longitude: 113.5, accuracy_m: 6, altitude_m: 18, zone: 'Submitted zone', taxonomy: { leaf: 'Broad' } } }
const staff = { status: 'Approved', registered_at: '2026-11-01', conservation_status: 'Vulnerable', habitat: 'Staff habitat', approved_location: { latitude: 4, longitude: 113, accuracy_m: 5, altitude_m: 18, zone: 'Approved zone' }, latest_observation: { ...detailObservation, status: 'Pending Review' }, latest_approved_observation: detailObservation }
const flush = async () => { for (let i = 0; i < 8; i++) { await vue.nextTick(); await new Promise(setImmediate) } }
function nodes(value) { const out = []; function walk(n) { if (Array.isArray(n)) return n.forEach(walk); if (!n || typeof n !== 'object') return; out.push(n); if (Array.isArray(n.children)) walk(n.children) } walk(value); return out }
function text(value) { return typeof value === 'string' ? value : Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.children) : '' }
function harness(initial = null, handler = null, photoHandler = null, historyHandler = null, previous = '/species') {
  const scope = vue.effectScope(), route = vue.reactive({ params: { plantId: '1' } }), listeners = new Set(), calls = [], photoCalls = [], historyCalls = []
  let verified = initial, pending = false, unavailable = false
  let verificationFailure = 0
  const mounted = [], events = {}, timers = []
  const exports = {}, context = { exports, console, window: { addEventListener: (name, fn) => { events[name] = fn }, removeEventListener() {} }, document: { visibilityState: 'visible', addEventListener: (name, fn) => { events[name] = fn }, removeEventListener() {} }, setInterval: (fn, delay) => { timers.push({ fn, delay }); return 1 }, clearInterval() {}, require(name) {
    if (name.endsWith('workflowBadge')) return { workflowBadgeStyle }
    if (name === 'vue') return { ...vue, onMounted: fn => mounted.push(fn), onBeforeUnmount() {}, resolveComponent: name => name }
    if (name === 'vue-router') return { useRoute: () => route, useRouter: () => ({ options: { history: { state: { back: previous } } }, resolve(path) { return { name: path.startsWith('/conservation/') ? 'conservation-map' : path === '/species' ? 'species' : undefined, fullPath: path } } }) }
    if (name === 'vue-i18n') return { useI18n: () => ({ t: key => key === 'speciesLabels.habitat' ? 'Natural habitat' : key }) }
    if (name.endsWith('useConservationText')) return { useConservationText: () => ({ ct: x => String(x), dt: x => x }) }
    if (name.endsWith('/auth')) return { currentUser: async () => verified, api: async () => { if (verificationFailure) throw Object.assign(Error('Session check failed'), { status: verificationFailure }); if (!verified) throw Object.assign(Error('Guest'), { status: 401 }); return { user: verified } }, sessionSnapshot: () => ({ user: verified, pending, unavailable }), subscribeSession: fn => { listeners.add(fn); return () => listeners.delete(fn) } }
    if (name.endsWith('plantIntegration')) return integration
    if (name.endsWith('plantId')) return { formatPlantId }
    if (name.endsWith('plantDateTime')) return { formatPlantDateTime }
    if (name.endsWith('plantDetail')) return { ...detailService, readPlantDetail: (id, allowed) => detailService.readPlantDetail(id, allowed, async url => { calls.push(url); return handler ? handler(url) : { information: { ...information, plant_id: id }, staff: detailService.canReadPlantDetail(verified) ? staff : null } }) }
    if (name.endsWith('plantGallery')) return { ...galleryService, createPlantGallery: options => galleryService.createPlantGallery({ ...options, transport: async (url, options) => { photoCalls.push(url); return photoHandler ? photoHandler(url, options) : url.includes('/assets?') ? Response.json({ assets: [] }) : Response.json({ plant_id: url.match(/plants\/(\d+)/)[1], assets: [], page: { limit: 20, has_more: false, next_cursor: null } }) } }) }
    if (name.endsWith('plantHistory')) return { ...historyService, createPlantHistory: () => historyService.createPlantHistory({ transport: async (url, options) => { historyCalls.push(url); return historyHandler ? historyHandler(url, options) : Response.json({ plant_id: url.match(/plants\/(\d+)/)[1], observations: [], page: { limit: 20, has_more: false, next_cursor: null } }) } }) }
    if (name.endsWith('conservationBadge')) return { conservationBadgeStyle }
    if (name.endsWith('.vue')) return { name }
    throw Error(name)
  } }
  vm.runInNewContext(`(function(){${js(script.content)}})()`, context)
  const state = scope.run(() => exports.default.setup({}, { expose() {} }))
  vm.runInNewContext(`(function(){${js(template.code)}})()`, context)
  return { state, calls, photoCalls, historyCalls, route, events, timers, failVerification: status => { verificationFailure = status }, mount: () => mounted.forEach(fn => fn()), change(user, checking = false, outage = false) { verified = user; pending = checking; unavailable = outage; for (const fn of listeners) fn(user, checking) }, render: () => nodes(exports.render({}, [], {}, vue.proxyRefs(state), {}, {})), stop() { state.clearRecord(); scope.stop() } }
}
test('Guest adds only public photos to the existing upper layout; authenticated Visitor/Botanist behavior stays unchanged', async () => {
  for (const user of [null, { ...officer, role: 'Visitor' }, { ...officer, role: 'Botanist' }]) {
    const h = harness(user)
    try {
      await flush(); const tree = h.render()
      assert.equal(tree.filter(n => n.type === 'dt').length, user === null ? 4 : 5)
      assert.deepEqual(tree.filter(n => n.type === 'dt').map(text), ['Common name','Scientific name',...(user === null ? [] : ['Plant ID']),'Family','Genus'])
      assert.equal(tree.some(n => n.props?.class === 'plant-id'), user !== null)
      assert.equal(h.state.plant.value.information.plant_id, '1')
      assert.equal(tree.filter(n => n.props?.id === 'plant-description-title').length, 1)
      assert.equal(tree.find(n => n.type === 'h1').children, information.common_name)
      for (const cls of ['profile-badges', 'profile-habitat', 'approved-location']) assert.ok(!tree.some(n => n.props?.class === cls))
      assert.ok(!tree.some(n => n.type === 'img' || n.props?.class === 'staff-panel' || n.type?.name?.includes('PlantObservation')))
      const gallery = tree.find(n => n.type?.name?.includes('PlantPhotoGallery'))
      assert.equal(Boolean(gallery), user === null)
      if (gallery) { assert.equal(gallery.props['public-photos'], true); assert.equal(gallery.props['registration-only'], '') }
      assert.deepEqual(h.photoCalls, user === null ? ['/api/data/assets?plant_id=1'] : []); assert.deepEqual(h.historyCalls, [])
      assert.deepEqual(h.calls, ['/api/data/plants/1/detail'])
      assert.equal(h.state.plant.value.staff, null)
    } finally { h.stop() }
  }
})

test('Guest upper gallery shares Officer layout and only uses public bytes; failed public access never starts evidence reads', async () => {
  const h = harness(null, null, async url => {
    assert.equal(url, '/api/data/assets?plant_id=1')
    return Response.json({ assets: [{ id: 'public-one', content_type: 'image/jpeg' }, { id: 'public-two', content_type: 'image/png' }] })
  })
  try {
    await flush()
    assert.equal(h.state.galleryGroups.value.length, 1)
    assert.deepEqual(h.state.publicGallery.state.assets.map(a => a.url), ['/api/data/assets/public-one','/api/data/assets/public-two'])
    assert.ok(h.render().some(n => String(n.props?.class).includes('staff-hero')))
    assert.ok(!h.render().some(n => String(n.props?.class).includes('visitor-grid')))
    assert.deepEqual(h.historyCalls, [])
    h.change(officer); assert.equal(h.state.publicGallery.state.assets.length, 0)
  } finally { h.stop() }
  const denied = harness(null, async () => { throw Object.assign(Error('Plant unavailable.'), { status: 404 }) })
  try { await flush(); assert.deepEqual(denied.photoCalls, []); assert.deepEqual(denied.historyCalls, []); assert.equal(denied.state.errorStatus.value, 404) } finally { denied.stop() }
})

test('Officer/Admin information follows Species identity, taxonomy, habitat and description without duplicate record fields', async () => {
  for (const user of [officer, { ...officer, role: 'Administrator' }]) {
    const h = harness(user)
    try {
      await flush(); const tree = h.render(), informationCard = nodes(tree.find(n => n.props?.class === 'record-panel')), recordCard = nodes(tree.find(n => n.props?.class === 'staff-panel'))
      assert.equal(informationCard.find(n => n.type === 'h1').children, 'Common')
      assert.ok(informationCard.some(n => n.type === 'em' && n.children === 'Individual name'))
      assert.equal(informationCard.filter(n => n.type === 'dt').map(text).join('|'), 'Common name|Scientific name|Plant ID|Family|Genus')
      assert.equal(informationCard.filter(n => n.type === 'svg' && n.props?.class === 'taxonomy-icon').length, 3)
      assert.ok(informationCard.filter(n => n.type === 'svg').every(n => n.props['aria-hidden'] === 'true' && n.props.focusable === 'false'))
      assert.ok(informationCard.some(n => n.props?.class === 'status-badge' && n.props['data-status'] === 'approved'))
      assert.ok(informationCard.some(n => n.props?.class === 'conservation-status' && n.props['data-status'] === 'vulnerable'))
      assert.ok(informationCard.some(n => n.children === 'Staff habitat'))
      assert.ok(informationCard.findIndex(n => n.props?.class === 'profile-habitat') < informationCard.findIndex(n => n.props?.class === 'profile-description'))
      const record = tree.find(n => n.type?.name?.includes('PlantRegistrationRecord'))
      assert.ok(record)
      assert.equal(record.props.authorized,true)
      assert.equal(record.props.staff,h.state.plant.value.staff)
      assert.equal(record.props['plant-id'],'1')
      assert.equal(recordCard.filter(n => n.type === 'dt').length,0, 'lower fields render within the isolated registration component')
      assert.ok(tree.findIndex(n => n === record) < tree.findIndex(n => n.type?.name?.includes('PlantObservationHistory')))
    } finally { h.stop() }
  }
})

test('Officer/Admin delegate only lower registration and history evidence without separate latest/submitted panels',async()=>{
 const h=harness(officer);try{await flush();const tree=h.render(),record=tree.find(n=>n.type?.name?.includes('PlantRegistrationRecord'));assert.ok(record);assert.equal(record.props.staff,h.state.plant.value.staff);assert.equal(record.props.observations,h.state.history.state.observations);assert.equal(record.props.complete,h.state.history.state.complete);assert.ok(tree.some(n=>n.type?.name?.includes('PlantObservationHistory')));assert.ok(!tree.some(n=>n.props?.class==='observation-summary-panel'||n.props?.class==='submitted-gps'));assert.ok(!text(tree).includes('Latest approved observation'))}finally{h.stop()}
})

test('missing values remain honest; optional habitat/badges and unavailable official location never invent data', async () => {
  const h = harness(officer, async () => ({ information: { ...information, common_name: null, scientific_name: null, family_name: null, genus_name: null, description: null }, staff: { ...staff, conservation_status: null, habitat: null, approved_location: null } }))
  try {
    await flush(); const tree = h.render()
    assert.equal(tree.find(n => n.type === 'h1').children, 'Unavailable')
    assert.ok(!tree.some(n => n.props?.class === 'conservation-status' || n.props?.class === 'profile-habitat' || n.props?.class === 'profile-divider'))
    assert.equal(tree.find(n => n.type?.name?.includes('PlantRegistrationRecord')).props.staff.approved_location,null)
    assert.ok(!tree.some(n => n.props?.class === 'location-grid'))
    assert.ok(nodes(tree.find(n => n.props?.class === 'profile-description')).some(n => n.children === 'Unavailable'))
  } finally { h.stop() }
  const zero = harness(officer, async () => ({ information, staff: { ...staff, approved_location: { latitude: 0, longitude: 0, accuracy_m: 0, altitude_m: 0, zone: null } } }))
  try {
    await flush(); const record = zero.render().find(n => n.type?.name?.includes('PlantRegistrationRecord'))
    assert.equal(record.props.staff.approved_location.latitude,0)
    assert.equal(record.props.staff.approved_location.accuracy_m,0)
    assert.equal(record.props.staff.approved_location.altitude_m,0)
  } finally { zero.stop() }
})

test('registration component receives the genuine timestamp without altering upper taxonomy markup',async()=>{
 const stamp='2026-11-03T05:31:37.284Z',h=harness(officer,async()=>({information,staff:{...staff,registered_at:stamp}}))
 try{await flush();const tree=h.render(),record=tree.find(n=>n.type?.name?.includes('PlantRegistrationRecord'));assert.equal(record.props.staff.registered_at,stamp);assert.ok(nodes(tree.find(n=>n.props?.class==='record-panel')).some(n=>n.props?.class==='taxonomy-icon'))}finally{h.stop()}
})

test('Plant Detail keeps separate conservation/workflow palettes and hides both from visitors', async () => {
  for (const status of [...Object.keys(conservationBadgePalette), 'Unknown', null]) {
    const h = harness(officer, async () => ({ information, staff: { ...staff, conservation_status: status } }))
    try {
      await flush(); const tree = h.render(), badge = tree.find(n => n.props?.class === 'conservation-status')
      if (status) { assert.deepEqual(badge.props.style, conservationBadgeStyle(status)); assert.ok(text(badge).endsWith(status)) }
      else assert.equal(badge, undefined)
      assert.deepEqual(tree.find(n => n.props?.class === 'status-badge').props.style, workflowBadgeStyle('Approved'))
    } finally { h.stop() }
  }
  const h = harness()
  try { await flush(); assert.ok(!h.render().some(n => n.props?.class === 'conservation-status' || n.props?.class === 'status-badge')) } finally { h.stop() }
})

test('Plant Information reuses Species card, taxonomy and description design tokens and icons', () => {
  const species = readFileSync(new URL('../src/views/SpeciesDetailView.vue', import.meta.url), 'utf8'), css = descriptor.styles[0].content
  const rule = (source, selector) => source.slice(source.indexOf(selector + ' {')).split('}')[0]
  const value = (source, property) => source.match(new RegExp(`(?:[;{]\\s*)${property}:\\s*([^;]+)`))?.[1]
  for (const [plant, reference, properties] of [
    ['.record-panel, .staff-panel', '.hero-copy', ['padding','border','border-radius','background','box-shadow']],
    ['.record-panel h1', '.hero-copy h1', ['font-size','font-weight','line-height','color']],
    ['.profile-taxonomy', '.profile-taxonomy', ['grid-template-columns','gap']],
    ['.taxonomy-icon', '.taxonomy-icon', ['width','height','color']],
    ['.profile-description h2', '.profile-description h2', ['font-size','font-weight','line-height','color']],
  ]) for (const property of properties) assert.equal(value(rule(css, plant), property), value(rule(species, reference), property), `${plant}: ${property}`)
  for (const path of ['M20 4c-8-1-15 2-15 9', 'M12 21v-9M12 15C5', 'M12 22v-7M12 2l7']) assert.ok(source.includes(path) && species.includes(path))
  assert.match(css, /\.location-grid \{ grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/)
  assert.match(css, /@media \(max-width: 420px\)/)
})
test('Officer and authorized Admin get registration gallery and real history without a species image request', async () => {
  for (const user of [officer, { ...officer, role: 'Administrator' }]) {
    const h = harness(user)
    try {
      await flush(); assert.equal(h.state.canReadStaff.value, true)
      assert.equal(h.photoCalls.length, 1); assert.match(h.photoCalls[0], /plants\/1\/detail\/gallery/)
      assert.equal(h.historyCalls.length, 1); assert.match(h.historyCalls[0], /plants\/1\/detail\/history/)
      const tree = h.render(); assert.ok(tree.some(n => n.type?.name?.includes('PlantPhotoGallery') && n.props['registration-only'] === ''))
      assert.ok(tree.some(n => n.type?.name?.includes('PlantObservationHistory')))
      assert.ok(tree.some(n => n.type?.name?.includes('PlantRegistrationRecord') && n.props.authorized))
      assert.ok(!tree.some(n => n.type === 'img'))
    } finally { h.stop() }
  }
})
test('backend denial or absent authorization never starts staff reads, including Admin', async () => {
  for (const response of [async () => { throw Object.assign(Error('Access denied'), { status: 403 }) }, async () => ({ information, staff: null })]) {
    const h = harness({ ...officer, role: 'Administrator' }, response)
    try { await flush(); assert.equal(h.state.canReadStaff.value, false); assert.equal(h.photoCalls.length, 0); assert.equal(h.historyCalls.length, 0) } finally { h.stop() }
  }
  const h = harness(null, async () => ({ information, staff }))
  try { await flush(); assert.equal(h.state.plant.value, null); assert.ok(h.state.loadError.value) } finally { h.stop() }
})
test('logout clears plant, gallery and history immediately and rejects late private results', async () => {
  let resolvePhoto, resolveHistory
  const h = harness(officer, null, () => new Promise(resolve => { resolvePhoto = resolve }), () => new Promise(resolve => { resolveHistory = resolve }))
  try {
    await flush(); assert.equal(h.state.history.state.loading, true)
    h.change(null, true)
    assert.equal(h.state.plant.value, null); assert.equal(h.state.gallery.state.assets.length, 0); assert.equal(h.state.history.state.observations.length, 0)
    resolvePhoto(Response.json({})); resolveHistory(Response.json({})); await flush()
    assert.equal(h.state.gallery.state.error, ''); assert.equal(h.state.history.state.error, '')
    h.change(null); await flush(); assert.equal(h.state.canReadStaff.value, false)
    assert.equal(h.state.plant.value.staff, null)
  } finally { h.stop() }
})
test('route replacement cancels both evidence requests and account switching clears staff state', async () => {
  const signals = []
  const h = harness(officer, null, async (url, options) => { signals.push(options.signal); return Response.json({ plant_id: url.match(/plants\/(\d+)/)[1], assets: [], page: { limit: 20, has_more: false, next_cursor: null } }) })
  try {
    await flush(); h.route.params.plantId = '2'; await flush()
    assert.equal(h.state.plant.value.information.plant_id, '2'); assert.equal(h.state.history.state.plantId, '2')
    h.change({ ...officer, role: 'Visitor' }); assert.equal(h.state.plant.value, null); await flush()
    assert.equal(h.state.canReadStaff.value, false); assert.equal(h.state.history.state.plantId, '')
  } finally { h.stop() }
})
test('Back retains validated same-app navigation and falls back for public or unsafe sources', async () => {
  for (const [user, previous, expected] of [[null,'/conservation/map','/species'],[officer,'/conservation/map','/conservation/map'],[null,'https://invalid','/species'],[null,'//invalid','/species']]) {
    const h = harness(user, null, null, null, previous)
    try { await flush(); assert.equal(h.state.backTarget.value, expected) } finally { h.stop() }
  }
})

test('shared session notifications clear before logout and reject stale session verification',async()=>{
 const source=readFileSync(new URL('../src/services/auth.ts',import.meta.url),'utf8')
 let resolveMe;const events=[];let meWaiting=false
 const exports={};const context={exports,console,fetch:async url=>url==='/api/auth/me'?(meWaiting?new Promise(resolve=>{resolveMe=resolve}):Response.json({user:officer})):Response.json({})}
 vm.runInNewContext(js(source),context)
 const auth=exports;auth.subscribeSession((user,pending)=>events.push({user,pending}))
 await auth.currentUser();assert.equal(auth.sessionSnapshot().user.id,'officer')
 meWaiting=true;const old=auth.currentUser();const logout=auth.logout()
 assert.equal(auth.sessionSnapshot().pending,true);assert.equal(auth.sessionSnapshot().user,null)
 await logout;resolveMe(Response.json({user:officer}));await old
 assert.equal(auth.sessionSnapshot().user,null);assert.equal(auth.sessionSnapshot().pending,false)
 assert.ok(events.some(e=>e.pending&&e.user===null))
})


test('session checks coalesce and cannot verify an old cookie while logout is pending',async()=>{
 const source=readFileSync(new URL('../src/services/auth.ts',import.meta.url),'utf8')
 let resolveMe,resolveLogout;const calls=[];const exports={}
 vm.runInNewContext(js(source),{exports,console,fetch:async url=>{calls.push(url);return new Promise(resolve=>{if(url==='/api/auth/me')resolveMe=resolve;else resolveLogout=resolve})}})
 const a=exports.currentUser(),b=exports.currentUser();assert.equal(calls.length,1)
 resolveMe(Response.json({user:officer}));await Promise.all([a,b]);
 const out=exports.logout();assert.equal(exports.sessionSnapshot().user,null)
 assert.equal(await exports.currentUser(),null);assert.equal(calls.filter(x=>x==='/api/auth/me').length,1)
 resolveLogout(Response.json({}));await out;assert.equal(exports.sessionSnapshot().user,null)
})


test('same-record focus/visibility/timer refresh keeps Guest and staff records and gallery epochs; errors distinguish denial', async () => {
  for (const account of [null, officer, { ...officer, role: 'Administrator' }]) {
    let release, hold = false, failure = 0, reads = 0
    const h = harness(account, async () => {
      reads++
      if (hold) await new Promise(resolve => { release = resolve })
      if (failure) throw Object.assign(Error('Refresh failed'), { status: failure })
      return { information, staff: account ? staff : null }
    })
    try {
      await flush(); h.mount()
      const before = h.state.plant.value, epoch = h.state.visibleGallery.value.state.epoch
      hold = true; const count = reads
      h.events.focus(); h.events.visibilitychange(); await flush()
      assert.equal(reads, count + 1); assert.equal(h.state.plant.value, before); assert.equal(h.state.isLoading.value, false)
      hold = false; release(); await flush()
      assert.equal(h.state.plant.value, before); assert.equal(h.state.visibleGallery.value.state.epoch, epoch)
      assert.equal(h.timers[0].delay, 60000); await h.timers[0].fn(); await flush()
      assert.equal(h.state.visibleGallery.value.state.epoch, epoch)
      h.failVerification(500); await h.state.verifySession()
      assert.equal(h.state.plant.value, before); assert.ok(h.state.refreshError.value)
      h.failVerification(0)
      failure = 500; await h.state.verifySession(); await flush()
      assert.equal(h.state.plant.value, before); assert.ok(h.state.refreshError.value)
      failure = 403; await h.state.verifySession(); await flush()
      assert.equal(h.state.plant.value, null); assert.equal(h.state.gallery.state.assets.length, 0)
    } finally { h.stop() }
  }
})


test('route changes invalidate an in-flight background refresh without blocking the next record', async () => {
  let held = false, release
  const h = harness(null, async url => {
    const id = url.match(/plants\/(\d+)/)[1]
    if (held && id === '1') await new Promise(resolve => { release = resolve })
    return { information: { ...information, plant_id: id }, staff: null }
  })
  try {
    await flush(); held = true
    const work = h.state.verifySession(); await flush()
    h.route.params.plantId = '2'; await flush()
    assert.equal(h.state.plant.value.information.plant_id, '2')
    release(); await work; await flush()
    assert.equal(h.state.plant.value.information.plant_id, '2')
  } finally { h.stop() }
})


test('Guest habitat uses the existing Officer field between taxonomy and description without staff projection', async () => {
  for (const value of ['Tropical lowland rainforest', '', null]) {
    const h = harness(null, async () => ({ information: { ...information, habitat: value }, staff: null }))
    try {
      await flush(); const tree = h.render(), card = nodes(tree.find(n => n.props?.class === 'record-panel'))
      const habitat = card.find(n => n.props?.class === 'profile-habitat')
      assert.equal(Boolean(habitat), Boolean(value))
      if (value) {
        assert.ok(nodes(habitat).some(n => n.children === value))
        assert.ok(card.findIndex(n => n.props?.class === 'profile-taxonomy') < card.indexOf(habitat))
        assert.ok(card.indexOf(habitat) < card.findIndex(n => n.props?.class === 'profile-description'))
      }
      assert.ok(!tree.some(n => n.props?.class === 'profile-badges' || n.props?.class === 'staff-panel' || n.type?.name?.includes('PlantObservationHistory')))
      assert.deepEqual(h.historyCalls, []); assert.equal(h.state.plant.value.staff, null)
      await h.state.verifySession(); assert.equal(h.state.habitat.value, value)
    } finally { h.stop() }
  }
})


test('strict detail parsing accepts real correction/terminal states but rejects proposal/version states', async () => {
  for (const status of ['Approved', 'Pending Review', 'Correction Required', 'Rejected', 'Flagged', 'Withdrawn']) {
    const result = await detailService.readPlantDetail('1', true, async () => ({ information,
      staff: { ...staff, status, latest_observation: { ...detailObservation, status: 'Withdrawn' } } }))
    assert.equal(result.staff.status, status)
  }
  for (const status of ['Cancelled', 'Superseded', 'Unknown', 'Draft', ['Approved'], null, {}]) {
    await assert.rejects(detailService.readPlantDetail('1', true, async () => ({ information, staff: { ...staff, status } })), /invalid response/)
  }
  await assert.rejects(detailService.readPlantDetail('1', false, async () => ({ information, staff })), /invalid response/)
})

test('Officer background detail reload refreshes history while Guests never request private history', async () => {
  for (const user of [officer, null]) {
    const h = harness(user)
    try {
      await flush()
      const previous = h.historyCalls.length
      await h.state.verifySession(); await flush()
      assert.equal(h.historyCalls.length, user ? previous + 1 : 0)
    } finally { h.stop() }
  }
})

test('Plant Detail Retry retains verified history and pending registration during delayed refresh and outages', async () => {
  let next = () => Response.json({ plant_id:'1',observations:[{id:'initial',plant_id:'1',origin:'initial_registration',date:'2026-11-13T10:38:00Z',status:'Pending Review',recorded_by:'Botanist',content:detailObservation.content,assets:[],review:null}],page:{limit:20,has_more:false,next_cursor:null} })
  const pendingStaff = { ...staff, status:'Pending Review',current_registration:{state:'unavailable'} }
  const h = harness(officer, async () => ({ information, staff:pendingStaff }), null, () => next())
  try {
    await flush();h.mount();const rows=h.state.history.state.observations,epoch=h.state.history.state.epoch
    let resolve;next=()=>new Promise(yes=>{resolve=yes})
    h.events.focus();h.events.visibilitychange();await flush()
    assert.equal(h.state.history.state.observations,rows);assert.equal(h.state.history.state.verifiedComplete,true);assert.equal(h.state.isLoading.value,false)
    resolve(new Response('{}',{status:503}));await flush()
    h.state.retryHistory();await flush()
    assert.equal(h.state.history.state.observations,rows);assert.equal(h.state.history.state.epoch,epoch)
    resolve(new Response('{}',{status:503}));await flush()
    h.change(officer,true,true)
    assert.ok(h.state.plant.value);assert.equal(h.state.history.state.observations,rows)
    const calls=h.historyCalls.length;h.state.retryHistory();assert.equal(h.historyCalls.length,calls)
    h.change(null,true);assert.equal(h.state.plant.value,null);assert.equal(h.state.history.state.observations.length,0)
  }finally{h.stop()}
})
test('Plant status change invalidates old history before the replacement request completes', async () => {
  let status='Pending Review',hold=false,resolve
  const h=harness(officer,async()=>({information,staff:{...staff,status}}),null,async()=>{
    if(hold)await new Promise(yes=>{resolve=yes})
    return Response.json({plant_id:'1',observations:[],page:{limit:20,has_more:false,next_cursor:null}})
  })
  try{
    await flush();assert.equal(h.state.history.state.verifiedComplete,true)
    status='Rejected';hold=true;const work=h.state.verifySession();await flush()
    assert.equal(h.state.plant.value.staff.status,'Rejected');assert.equal(h.state.history.state.verifiedComplete,false)
    resolve();await work
  }finally{h.stop()}
})
