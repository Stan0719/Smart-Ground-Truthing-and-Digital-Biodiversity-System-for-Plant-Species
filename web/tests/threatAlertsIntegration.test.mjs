import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import postcss from 'postcss'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { threatAlertBadgeStyle } from '../src/utils/workflowBadge.ts'
import { monitoringDate, monitoringLabels } from '../src/utils/officerMonitoringDisplay.ts'
import * as alertService from '../src/services/threatAlerts.ts'
import * as cameraService from '../src/services/cameraEvents.ts'
import * as evidenceService from '../src/services/alertEvidence.ts'
import { sensorAlertFixture } from './fixtures/sensorAlertContext.mjs'
import * as alertDisplay from '../src/utils/threatAlertDisplay.ts'
import * as alertRefresh from '../src/services/threatAlertRefresh.ts'
import * as previewModule from '../src/data/threatAlertPreview.ts'
import {
  alertResponsePath,
  loadCanonicalAlerts,
  saveAlertResponse,
} from '../src/services/threatAlerts.ts'

const page = readFileSync(new URL('../src/views/conservation/ThreatAlertsView.vue', import.meta.url), 'utf8')
const iotPage = readFileSync(new URL('../src/views/conservation/IoTMonitoringView.vue', import.meta.url), 'utf8')

const alert = (overrides = {}) => ({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  device_id: 'device-uuid-real',
  reading_id: 'reading-uuid-real',
  camera_id: null,
  video_path: null,
  detected_at: '2026-11-03T05:00:00.000Z',
  metric: 'temperature',
  value: 31.5,
  status: 'New',
  created_at: '2026-11-03T05:00:01.000Z',
  ...overrides,
})
const response = {
  id: 'response-uuid-real', alert_id: alert().id, officer_subject: 'officer-subject',
  note: 'Checked the sensor location', status: 'Reviewing', created_at: '2026-11-03T05:10:00.000Z',
}

test('canonical list preserves raw IDs, real status, timestamps and response history', async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async (url) => {
      assert.equal(url, '/api/data/alerts')
      return Response.json({ alerts: [alert()], responses: [response] })
    }
    const rows = await loadCanonicalAlerts()
    assert.equal(rows[0].id, alert().id)
    assert.equal(rows[0].deviceId, 'device-uuid-real')
    assert.equal(rows[0].readingId, 'reading-uuid-real')
    assert.equal(rows[0].metric, 'temperature')
    assert.equal(rows[0].value, 31.5)
    assert.equal(rows[0].status, 'New')
    assert.equal(rows[0].detectedAt, '2026-11-03T05:00:00.000Z')
    assert.equal(rows[0].responses[0].note, 'Checked the sensor location')
  } finally { globalThis.fetch = originalFetch }
})

test('successful empty canonical dataset remains distinct from failure', async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => Response.json({ alerts: [], responses: [] })
    assert.deepEqual(await loadCanonicalAlerts(), [])
  } finally { globalThis.fetch = originalFetch }
})

test('response action uses exact proxy path and exact supported payload', async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, `/api/data/alerts/${alert().id}/responses`)
      assert.equal(options.method, 'POST')
      assert.deepEqual(JSON.parse(options.body), { note: 'Investigated in field', status: 'Resolved' })
      return Response.json({ updated: true })
    }
    await saveAlertResponse(alert().id, '  Investigated in field  ', 'Resolved')
    assert.equal(alertResponsePath(alert().id), `/api/data/alerts/${alert().id}/responses`)
  } finally { globalThis.fetch = originalFetch }
})

test('400, 401, 403, 404 and 409 preserve structured failures', async () => {
  const originalFetch = globalThis.fetch
  try {
    for (const status of [400, 401, 403, 404, 409]) {
      globalThis.fetch = async () => Response.json({ error: `Saved backend ${status}` }, { status })
      await assert.rejects(saveAlertResponse(alert().id, 'Keep this note', 'Reviewing'), {
        status, message: `Saved backend ${status}`,
      })
    }
  } finally { globalThis.fetch = originalFetch }
})

test('malformed list, malformed save and network failures are rejected distinctly', async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => Response.json({ alerts: 'bad', responses: [] })
    await assert.rejects(loadCanonicalAlerts(), { kind: 'invalid' })
    globalThis.fetch = async () => Response.json({ updated: false })
    await assert.rejects(saveAlertResponse(alert().id, 'note', 'Reviewing'), { kind: 'invalid' })
    globalThis.fetch = async () => { throw Error('offline') }
    await assert.rejects(loadCanonicalAlerts(), { kind: 'network' })
  } finally { globalThis.fetch = originalFetch }
})

test('save flow refetches canonical state and source preserves note after failures', () => {
  assert.match(page, /await saveAlertResponse\(id, responseNote\.value, responseStatus\.value\)/)
  assert.match(page, /const result = await withLinkedAlert\(queue\)/)
  assert.match(page, /responseNote\.value = ''/)
  assert.match(page, /committed[\s\S]*Response saved, but latest data could not be verified/)
})

test('legacy alert route is no longer authoritative and canonical deep links are supported', () => {
  assert.doesNotMatch(page, /\/api\/iot\/alerts/)
  assert.match(page, /route\.query\.device/)
  assert.match(page, /route\.query\.reading/)
  assert.match(iotPage, /query: \{ device: String\(device\.sensor_id\) \}/)
})

test('one canonical table replaces all demonstration rendering and uses accessible details', () => {
  assert.equal((page.match(/class="officer-data-table threat-alert-table"/g) || []).length, 1)
  assert.equal((page.match(/class="same-event-readings"/g) || []).length, 1)
  assert.equal((page.match(/<AppModal\b/g) || []).length, 1)
  assert.doesNotMatch(page, /prototypeCameraEvents|cameraMonitoringPrototype|selectedCameraEvent|CAM-EVT-|Suspicious Camera Events|Demonstration camera events/)
  assert.match(page, /v-if="selectedAlert"[\s\S]*?wide\s+accessible/)
  assert.match(page, /Alert ID, device, reading, type or status/)
  assert.match(page, /Severity is unavailable from the alert service/)
})

test('design structure and styling remain in place', () => {
  assert.match(page, /class="summary-grid"/)
  assert.match(page, /class="control-bar"/)
  assert.match(page, /class="panel"/)
  assert.match(page, /class="table-scroll officer-table-scroll threat-alert-scroll"/)
  assert.match(page, /\.threat-alert-table td \{ display: flex; flex-wrap: nowrap; align-items: center;/)
  assert.match(page, /class="evidence-fields"/)
  assert.match(page, /<style scoped>/)
})

test('summary cards omit technical helper text and use four distinct status color themes', () => {
  const { descriptor } = parse(page), rules = []
  postcss.parse(descriptor.styles[0].content).walkRules(rule => rules.push(rule))
  const palette = { 'Active Alerts': ['#fbe8e5', '#a33f35'], 'New Alerts': ['#e8f0f5', '#315d78'], 'Under Review': ['#fff1db', '#926119'], Resolved: ['#e7f3e9', '#287347'] }
  for (const [status, [background, ink]] of Object.entries(palette)) {
    const rule = rules.find(rule => rule.selector.endsWith(`[data-status="${status}"]`))
    const values = Object.fromEntries(rule.nodes.map(node => [node.prop, node.value]))
    assert.equal(values['--alert-card-background'], background); assert.equal(values['--alert-card-ink'], ink)
  }
  const card = rules.find(rule => rule.selector === '.alert-summary-card')
  assert.ok(card.nodes.some(node => node.prop === 'border' && node.value === '1px solid var(--alert-card-ink)'))
  assert.match(page, /:data-status="String\(card\[0\]\)"/)
  assert.match(page, /<strong>\{\{ card\[1\] \}\}<\/strong>/)
  assert.doesNotMatch(page, /PostgreSQL alert register|Frontend prototype events|Canonical alerts and response records|PostgreSQL Threat Alerts/)
})

test('Threat Alerts heading and scroll label use existing localization; updated template compiles', () => {
  assert.match(page, /<h2>\{\{ ct\('Threat Alerts'\) \}\}<\/h2>/)
  assert.match(page, /:aria-label="ct\('Threat Alerts'\)"/)
  const { descriptor } = parse(page), script = compileScript(descriptor, { id: 'threat-summary' })
  assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename: 'ThreatAlertsView.vue', id: 'threat-summary', compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
})

function pageHarness({ dev = false, hostname = 'localhost', withEvidence = false, withCamera = false } = {}) {
  const { descriptor } = parse(page)
  const script = compileScript(descriptor, { id: 'threat-badges' })
  const template = compileTemplate({ source: descriptor.template.content, filename: 'ThreatAlertsView.vue', id: 'threat-badges', compilerOptions: { bindingMetadata: script.bindings } })
  const js = value => ts.transpileModule(value.replaceAll('import.meta.env.DEV', String(dev)).replace("import('../../data/threatAlertPreview')", 'Promise.resolve(__previewModule)'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const scope = vue.effectScope(), exports = {}
  const route = vue.reactive({ query: {} })
  let session = { pending: false, user: { id: 'test-officer', role: 'Conservation Officer', status: 'Active', mustChangePassword: false } }
  const listeners = new Set(), cleanup = [], mounted = [], events = new Map(), timers = new Map()
  let timerSequence = 0
  const browserEvents = { addEventListener: (key, fn) => events.set(key, fn), removeEventListener: key => events.delete(key) }
  const browserWindow = { ...browserEvents, location: { hostname }, navigator: { onLine: true }, setTimeout: (fn, delay) => { timers.set(++timerSequence, { fn, delay }); return timerSequence }, clearTimeout: id => timers.delete(id) }
  const browserDocument = { ...browserEvents, visibilityState: 'visible' }
  const context = { exports, Error, URL, AbortController, window: browserWindow, document: browserDocument, __previewModule: previewModule, require(name) {
      if (name === 'vue-i18n') return {useI18n:()=>({t:key=>key.split('.').reduce((v,k)=>v?.[k],JSON.parse(readFileSync(new URL('../src/locales/en.json',import.meta.url),'utf8')))||key})}
      if (name.endsWith('officerDropdown')) return { vOfficerDropdown: {} }
    if (name === 'vue') return { ...vue, onMounted(fn) { mounted.push(fn) }, onBeforeUnmount(fn) { cleanup.push(fn) }, withDirectives: n => n, resolveComponent: name => ({ name }) }
    if (name.endsWith('/auth')) return { sessionSnapshot: () => session, subscribeSession: fn => { listeners.add(fn); return () => listeners.delete(fn) } }
    if (name === 'vue-router') return { useRoute: () => route }
    if (name.endsWith('workflowBadge')) return { threatAlertBadgeStyle }
    if (name.endsWith('officerMonitoringDisplay')) return { monitoringDate, monitoringLabels }
    if (name.endsWith('alertEvidence')) return withEvidence ? evidenceService : { ...evidenceService,
      loadCurrentAssignments: async rows => ({ assignments: Object.fromEntries(rows.map(row => [row.id, evidenceService.unavailableAssignment(row.deviceId)])), partial: false }),
      loadAlertContext: async row => ({ alert: { id: row.id, device_id: row.deviceId, reading_id: row.readingId, metric: row.metric, value: row.value }, current_assignment: evidenceService.unavailableAssignment(row.deviceId), historical_threshold: null,
        reading: { state: 'missing', id: row.readingId, device_id: null, received_at: null, values: null } }) }
    if (name.endsWith('threatAlerts')) return alertService
    if (name.endsWith('cameraEvents')) return withCamera ? cameraService : { loadCameraEvents: async () => ({ events: [], hasMore: false }) }
    if (name.endsWith('threatAlertDisplay')) return alertDisplay
    if (name.endsWith('threatAlertRefresh')) return alertRefresh
    if (name.includes('useConservationText')) return { useConservationText: () => ({ ct: x => x, locale: vue.ref('en') }) }
    if (name.endsWith('.vue')) return { name: name.split('/').at(-1) }
    throw Error(name)
  } }
  vm.runInNewContext(`(function(){${js(script.content)}})()`, context)
  const state = scope.run(() => exports.default.setup({}, { expose() {} }))
  vm.runInNewContext(`(function(){${js(template.code)}})()`, context)
  return { state, route, events, timers, browserDocument, mount: () => mounted.forEach(fn => fn()), render: () => exports.render({}, [], {}, vue.proxyRefs(state), {}, {}), changeSession: next => { session = next; for (const fn of listeners) fn() }, stop: () => { cleanup.forEach(fn => fn()); scope.stop() } }
}
function nodes(root) {
  const result = []
  const walk = n => {
    if (Array.isArray(n)) return n.forEach(walk)
    if (!n || typeof n !== 'object') return
    result.push(n)
    if (Array.isArray(n.children)) walk(n.children)
    else if (n.children?.default) walk(n.children.default())
  }
  walk(root); return result
}
const canonicalRow = status => ({ id: 'canonical-real', deviceId: 'sensor-real', readingId: null, cameraId: null, metric: 'temperature', value: 31.5, status, detectedAt: alert().detected_at, createdAt: alert().created_at, videoPath: null, responses: [] })
const savedCameraEvent = (overrides = {}) => ({ eventId: '1'.repeat(32), cameraId: 'registered-camera', plantId: '32',
  eventType: 'possible_plant_contact', title: 'Possible contact', description: 'Camera contact plus MPU movement', confidence: null,
  detectedAt: '2026-11-13T00:00:00Z', recordingStartedAt: '2026-11-13T00:00:00Z', recordingEndedAt: '2026-11-13T00:00:10Z',
  durationSeconds: 10, recordingStatus: 'ready', status: 'New', videoUrl: 'https://untrusted.example/clip.mp4', ...overrides })
const cameraRow = () => ({ ...canonicalRow('New'), id: savedCameraEvent().eventId, cameraId: savedCameraEvent().cameraId,
  metric: 'possible_plant_contact', value: 1, detectedAt: savedCameraEvent().detectedAt })

test('camera deep link opens one canonical investigation with its protected recording and canonical response', async () => {
  const h = pageHarness({ withCamera: true }), original = globalThis.fetch, calls = []
  let status = 'New'
  globalThis.fetch = async (url, options) => {
    calls.push([url, options?.method || 'GET'])
    if (options?.method === 'POST') { status = 'Reviewing'; return Response.json({ updated: true }) }
    if (url === cameraService.CAMERA_EVENTS_PATH) return Response.json({ events: [savedCameraEvent()], hasMore: false })
    assert.equal(url, '/api/data/alerts')
    return Response.json({ alerts: [alert({ id: cameraRow().id, camera_id: cameraRow().cameraId, metric: 'possible_plant_contact',
      detected_at: cameraRow().detectedAt, status, value: 1 })], responses: [] })
  }
  try {
    h.route.query.alert = cameraRow().id
    await h.state.loadAlerts(); await new Promise(setImmediate)
    assert.equal(h.state.selectedAlert.value.id, cameraRow().id)
    const tree = nodes(h.render()), video = tree.find(n => n.type === 'video')
    assert.equal(tree.filter(n => n.props?.class === 'officer-data-table threat-alert-table').length, 1)
    assert.equal(tree.filter(n => n.type?.name === 'AppModal.vue').length, 1)
    assert.equal(video.props.src, `/api/data/camera-events/${cameraRow().id}/video`)
    assert.ok(video.props.controls !== undefined)
    assert.ok(tree.some(n => n.children === '00:10'))
    assert.ok(tree.some(n => n.children === 'Available'))
    assert.ok(!JSON.stringify(tree).includes('untrusted.example'))
    h.state.responseNote.value = 'Reviewed the exact recording'
    await h.state.submitResponse(); await new Promise(setImmediate)
    assert.deepEqual(calls.filter(([, method]) => method === 'POST'), [[`/api/data/alerts/${cameraRow().id}/responses`, 'POST']])
    assert.equal(h.state.selectedAlert.value.status, 'Reviewing')
    assert.equal(h.state.verificationRequired.value, false)
  } finally { h.stop(); globalThis.fetch = original }
})

test('camera recording states refresh without losing investigation notes or inventing a playable clip', async () => {
  const h = pageHarness({ withCamera: true }), original = globalThis.fetch
  let recordingStatus = 'recording', fail = false
  globalThis.fetch = async url => {
    assert.equal(url, cameraService.CAMERA_EVENTS_PATH)
    if (fail) throw Error('offline')
    return Response.json({ events: [savedCameraEvent({ recordingStatus })], hasMore: false })
  }
  try {
    h.state.alerts.value = [cameraRow()]; h.state.openAlert(h.state.alerts.value[0]); await new Promise(setImmediate)
    h.state.responseNote.value = 'Investigation in progress'
    for (const [state, label] of [['recording','Recording'], ['processing','Processing'], ['failed','Interrupted'], ['unavailable','Unavailable'], ['ready','Available']]) {
      recordingStatus = state
      await h.state.loadCameraEvidence(h.state.selectedAlert.value)
      const tree = nodes(h.render())
      assert.equal(tree.some(n => n.type === 'video'), state === 'ready')
      assert.ok(tree.some(n => n.children === label))
      assert.equal(h.state.responseNote.value, 'Investigation in progress')
    }
    nodes(h.render()).find(n => n.type === 'video').props.onError()
    assert.equal(h.state.playbackError.value, true)
    fail = true; await h.state.loadCameraEvidence(h.state.selectedAlert.value)
    assert.equal(h.state.cameraError.value, 'Unable to retrieve camera events.')
    assert.equal(h.state.cameraEvent.value.eventId, cameraRow().id)
    assert.ok(nodes(h.render()).some(n => n.type === 'video'))
    assert.equal(h.state.responseNote.value, 'Investigation in progress')
  } finally { h.stop(); globalThis.fetch = original }
})

test('camera evidence shows trigger measurements, preserves zero confidence, and keeps legacy evidence unavailable', async () => {
  const h = pageHarness({ withCamera: true }), original = globalThis.fetch
  let evidence = { confidence: 0.91, confidenceKind: 'wrist_keypoint', contactDurationSeconds: 2.1, contactThresholdSeconds: 2 }
  globalThis.fetch = async () => Response.json({ events: [savedCameraEvent(evidence)], hasMore: false })
  try {
    h.state.alerts.value = [cameraRow()]
    h.state.openAlert(h.state.alerts.value[0]); await new Promise(setImmediate)
    let tree = nodes(h.render())
    for (const value of ['91%', '2.1 s', '2.0 s']) assert.ok(tree.some(n => n.children === value), value)
    evidence = { ...evidence, confidence: 0 }
    await h.state.loadCameraEvidence(h.state.selectedAlert.value)
    assert.ok(nodes(h.render()).some(n => n.children === '0%'))
    evidence = {}
    await h.state.loadCameraEvidence(h.state.selectedAlert.value)
    tree = nodes(h.render())
    assert.ok(tree.some(n => n.children === 'Threshold unavailable'))
    assert.ok(!tree.some(n => n.children === '91%'))
  } finally { h.stop(); globalThis.fetch = original }
})

test('camera evidence requires the exact event, camera and detection time and discloses the bounded lookup', async () => {
  const h = pageHarness({ withCamera: true }), original = globalThis.fetch
  try {
    for (const mismatch of [{ eventId: '2'.repeat(32) }, { cameraId: 'another-camera' }, { detectedAt: '2026-11-14T00:00:00Z' }]) {
      globalThis.fetch = async () => Response.json({ events: [savedCameraEvent(mismatch)], hasMore: true })
      h.state.alerts.value = [cameraRow()]; h.state.openAlert(h.state.alerts.value[0]); await new Promise(setImmediate)
      assert.equal(h.state.cameraEvent.value, null)
      const tree = nodes(h.render())
      assert.ok(!tree.some(n => n.type === 'video'))
      assert.ok(tree.some(n => n.children === 'No authorized recording is available for this alert.'))
      assert.ok(tree.some(n => n.children === 'Only the latest 100 camera events were checked for this recording.'))
    }
  } finally { h.stop(); globalThis.fetch = original }
})

test('an unrelated failed queue refresh cannot strand a pending recording lookup', async () => {
  const h = pageHarness({ withCamera: true }), original = globalThis.fetch
  let release
  globalThis.fetch = async url => url === cameraService.CAMERA_EVENTS_PATH
    ? new Promise(resolve => { release = resolve }) : Response.json({}, { status: 503 })
  try {
    h.state.alerts.value = [cameraRow()]; h.state.openAlert(h.state.alerts.value[0])
    h.state.hasLoaded.value = true; h.state.responseNote.value = 'Keep investigating'
    await h.state.loadAlerts(true)
    release(Response.json({ events: [savedCameraEvent()], hasMore: false })); await new Promise(setImmediate)
    assert.equal(h.state.cameraLoading.value, false)
    assert.equal(h.state.cameraEvent.value.eventId, cameraRow().id)
    assert.equal(h.state.responseNote.value, 'Keep investigating')
  } finally { h.stop(); globalThis.fetch = original }
})

for (const boundary of ['selection', 'logout', 'pending', 'account', 'unmount']) test(`late camera recording requests are aborted and discarded after ${boundary}`, async () => {
  const h = pageHarness({ withCamera: true }), original = globalThis.fetch
  let release, signal
  globalThis.fetch = (_url, options) => { signal = options.signal; return new Promise(resolve => { release = resolve }) }
  try {
    h.state.alerts.value = [cameraRow(), canonicalRow('New')]; h.state.openAlert(h.state.alerts.value[0])
    if (boundary === 'selection') h.state.openAlert(h.state.alerts.value[1])
    else if (boundary === 'logout') h.changeSession({ user: null, pending: false })
    else if (boundary === 'pending') h.changeSession({ ...officerSession, pending: true })
    else if (boundary === 'account') h.changeSession({ ...officerSession, user: { ...officerSession.user, id: 'other-officer' } })
    else h.stop()
    assert.equal(signal.aborted, true)
    release(Response.json({ events: [savedCameraEvent()], hasMore: false })); await new Promise(setImmediate)
    assert.equal(h.state.cameraEvent.value, null)
    assert.equal(h.state.cameraLoading.value, false)
    assert.ok(!nodes(h.render()).some(n => n.type === 'video'))
  } finally { h.stop(); globalThis.fetch = original }
})

test('saved Sensor evidence renders original Plant, threshold, direction and capture time', async () => {
  const h = pageHarness({ withEvidence: true }), original = globalThis.fetch
  const fixture = sensorAlertFixture()
  fixture.alert.reading_id = null; fixture.context.alert.reading_id = null; fixture.context.reading.id = null
  fixture.context.reading.basis = 'alert_snapshot'; fixture.context.reading.captured_at = '2026-11-18T06:28:59Z'
  fixture.context.historical_threshold = { min: 20, max: 35, direction: 'high', limit: 35 }
  fixture.context.plant_at_detection = { state: 'verified', plant_id: '1' }
  globalThis.fetch = async url => url.includes('current-assignments') ? Response.json({ contract_version: 1, assignments: [{ alert_id: fixture.alert.id, ...fixture.assignment }] })
    : url.endsWith('/context') ? Response.json(fixture.context) : Response.json({ alerts: [fixture.alert], responses: [] })
  try {
    await h.state.loadAlerts(); await new Promise(setImmediate)
    h.state.openAlert(h.state.alerts.value[0]); await new Promise(setImmediate)
    const tree = nodes(h.render())
    assert.ok(tree.some(n => n.props?.to === '/plant/1'))
    assert.ok(tree.some(n => n.props?.to === '/plant/32'))
    assert.ok(tree.some(n => n.children === 'Above maximum'))
    assert.ok(tree.some(n => n.children === 'Plant at detection'))
    assert.ok(tree.some(n => n.children === 'Captured at'))
    assert.ok(!tree.some(n => n.children === 'Threshold unavailable'))
    assert.equal(h.state.savedThreshold.value.limit, 35)
    assert.equal(h.state.eventReadings.value[0].value, 38)
  } finally { h.stop(); globalThis.fetch = original }
})

test('isolated Sensor fixture renders exact frame roles and verified current Plant without writes', async () => {
  const h = pageHarness({ withEvidence: true }), original = globalThis.fetch
  const fixture = sensorAlertFixture(), calls = []
  globalThis.fetch = async (url, options) => {
    calls.push(url); assert.notEqual(options?.method, 'POST')
    if (url.includes('current-assignments')) return Response.json({ contract_version: 1, assignments: [{ alert_id: fixture.alert.id, ...fixture.assignment }] })
    if (url.endsWith('/context')) return Response.json(fixture.context)
    return Response.json({ alerts: [fixture.alert], responses: [] })
  }
  try {
    await h.state.loadAlerts(); await new Promise(setImmediate)
    h.state.openAlert(h.state.alerts.value[0]); await new Promise(setImmediate)
    const tree = nodes(h.render())
    assert.equal(h.state.eventReadings.value.length, 5)
    assert.ok(!tree.some(n => n.children === 'Sound'))
    assert.ok(tree.some(n => n.children === 'Trigger'))
    assert.equal(tree.filter(n => n.children === 'Context').length, 4)
    assert.ok(tree.some(n => n.props?.to === '/plant/32'))
    const chips = tree.filter(n => n.props?.class === 'assigned-plant-chip')
    assert.equal(chips.length, 2)
    assert.ok(chips.every(n => n.props['aria-label'] === 'Current Assigned Plant: PL032' && n.props.to === '/plant/32'))
    assert.equal(evidenceService.assignedPlantLabel(h.state.selectedAssignment.value), 'PL032')
    assert.ok(tree.some(n => n.children === 'Threshold unavailable'))
    assert.equal(h.state.selectedAlert.value.status, 'New')
    assert.equal(h.state.selectedAlert.value.responses.length, 0)
    assert.equal(calls.filter(url => url.endsWith('/context')).length, 1)
  } finally { h.stop(); globalThis.fetch = original }
})

test('Plant chips have keyboard focus and neutral missing-assignment states without guessed links', () => {
  const h = pageHarness()
  try {
    const row = canonicalRow('New'); h.state.alerts.value = [row]; h.state.isLoading.value = false
    h.state.assignmentRows.value = { [row.id]: { state: 'not_linked', basis: 'current_device_assignment', device_id: row.deviceId, plant_id: null } }
    assert.ok(nodes(h.render()).some(n => n.children === 'Not linked'))
    assert.ok(!nodes(h.render()).some(n => n.props?.class === 'assigned-plant-chip'))
    h.state.assignmentRows.value = {}
    assert.ok(nodes(h.render()).some(n => n.children === 'Unavailable'))
    assert.ok(!nodes(h.render()).some(n => n.props?.class === 'assigned-plant-chip'))
    for (const selector of ['.assigned-plant-chip', '.assigned-plant-chip:hover', '.assigned-plant-chip:focus-visible']) assert.ok(page.includes(selector))
    const rules = []; postcss.parse(parse(page).descriptor.styles[0].content).walkRules(rule => rules.push(rule))
    assert.ok(rules.find(r => r.selector === '.assigned-plant-chip').nodes.some(n => n.prop === 'text-decoration' && n.value === 'none'))
    assert.ok(rules.find(r => r.selector === '.assigned-plant-chip:focus-visible').nodes.some(n => n.prop === 'outline' && n.value.includes('3px')))
    assert.match(page, /class="plant-chip-leaf"[^>]*aria-hidden="true"/)
    assert.match(page, /class="plant-chip-arrow"[^>]*aria-hidden="true"/)
  } finally { h.stop() }
})

test('missing Sensor context permits existing review, retries GET only, and Camera skips sensor lookup', async () => {
  const h = pageHarness({ withEvidence: true }), original = globalThis.fetch, calls = []
  globalThis.fetch = async (url, options) => { calls.push(url); assert.notEqual(options?.method, 'POST'); return Response.json({}, { status: 503 }) }
  try {
    h.state.isLoading.value = false; h.state.alerts.value = [canonicalRow('New')]
    h.state.openAlert(h.state.alerts.value[0]); await new Promise(setImmediate)
    assert.equal(h.state.evidenceError.value, true)
    assert.equal(h.state.selectedAlert.value.status, 'New')
    assert.equal(h.state.verificationRequired.value, false)
    await h.state.loadEvidence(h.state.selectedAlert.value)
    assert.equal(calls.length, 2)
    h.state.alerts.value = [{ ...canonicalRow('New'), metric: 'possible_plant_contact', cameraId: 'camera' }]
    h.state.openAlert(h.state.alerts.value[0])
    await new Promise(setImmediate); assert.equal(calls.length, 2)
    assert.ok(nodes(h.render()).some(n => n.children === 'No authorized recording is available for this alert.'))
  } finally { h.stop(); globalThis.fetch = original }
})

for (const boundary of ['selection', 'logout', 'pending', 'unmount']) test(`late exact evidence is discarded after ${boundary}`, async () => {
  const h = pageHarness({ withEvidence: true }), original = globalThis.fetch, fixture = sensorAlertFixture()
  let release
  globalThis.fetch = () => new Promise(resolve => { release = resolve })
  try {
    h.state.alerts.value = [{ ...canonicalRow('New'), id: fixture.alert.id, deviceId: fixture.alert.device_id, readingId: fixture.alert.reading_id, value: 38 }]
    h.state.openAlert(h.state.alerts.value[0])
    if (boundary === 'selection') h.state.closeAlert()
    if (boundary === 'logout') h.changeSession({ pending: false, user: null })
    if (boundary === 'pending') h.changeSession({ pending: true, user: { id: 'test-officer', role: 'Conservation Officer', status: 'Active' } })
    if (boundary === 'unmount') h.stop()
    release(Response.json(fixture.context)); await new Promise(setImmediate)
    assert.equal(h.state.evidence.value, null)
  } finally { if (boundary !== 'unmount') h.stop(); globalThis.fetch = original }
})

test('canonical table preserves status palettes, IDs and exact View selection', () => {
  const h = pageHarness()
  try {
    h.state.isLoading.value = false
    for (const status of ['New', 'Reviewing', 'Resolved', 'Unexpected']) {
      const row = { ...canonicalRow(status), readingId: 'reading-real' }
      h.state.alerts.value = [row]
      const rendered = nodes(h.render())
      assert.equal(rendered.filter(n => n.type === 'table').length, 1)
      const badge = rendered.find(n => n.type === 'span' && n.props?.style)
      assert.deepEqual(badge.props.style, threatAlertBadgeStyle(status))
      assert.equal(badge.children, alertDisplay.alertStatusLabel(status))
      for (const value of [row.id, row.deviceId]) assert.ok(rendered.some(n => n.props?.value === value))
      rendered.find(n => n.type === 'button' && n.children === 'View').props.onClick()
      assert.equal(h.state.selectedAlert.value.id, row.id)
      const modal = nodes(h.render()).find(n => n.type?.name === 'AppModal.vue')
      assert.ok(modal); assert.equal(modal.props.accessible, '')
      assert.ok(nodes(h.render()).some(n => n.props?.value === row.readingId))
    }
    assert.doesNotMatch(page, /selectedAlert\.value \*|badge unavailable/)
  } finally { h.stop() }
})

test('canonical load, empty, loading, API error and retry stay inside the single panel', async () => {
  const original = globalThis.fetch, h = pageHarness(), calls = []
  try {
    assert.ok(nodes(h.render()).some(n => n.props?.role === 'status' && n.children.includes('Loading')))
    globalThis.fetch = async url => { calls.push(url); return Response.json({ alerts: [], responses: [] }) }
    await h.state.loadAlerts()
    assert.deepEqual(calls, ['/api/data/alerts'])
    assert.ok(nodes(h.render()).some(n => n.children === 'No threat alerts found.'))
    globalThis.fetch = async () => Response.json({ error: 'Unavailable' }, { status: 503 })
    await h.state.loadAlerts()
    assert.ok(nodes(h.render()).some(n => n.props?.role === 'alert'))
    const retry = nodes(h.render()).find(n => n.type === 'button' && n.children === 'Retry')
    globalThis.fetch = async () => Response.json({ alerts: [alert()], responses: [response] })
    await retry.props.onClick()
    assert.equal(h.state.alerts.value[0].id, alert().id)
    assert.equal(h.state.alerts.value[0].responses[0].note, response.note)
    assert.equal(nodes(h.render()).filter(n => n.type === 'table').length, 1)
  } finally { h.stop(); globalThis.fetch = original }
})

test('combined real-data filters match Malaysia detection date rather than UTC creation date', () => {
  const h = pageHarness()
  try {
    const first = { ...canonicalRow('New'), readingId: 'reading-one', detectedAt: '2026-11-04T20:00:00Z', createdAt: '2026-11-06T00:00:00Z' }
    h.state.alerts.value = [first, { ...canonicalRow('Resolved'), id: 'other', deviceId: 'other-device' }]
    h.state.date.value = '2026-11-05'
    h.state.search.value = 'temperature'
    h.state.status.value = 'New'
    h.route.query.device = 'sensor-real'; h.route.query.reading = 'reading-one'
    assert.deepEqual(Array.from(h.state.filteredAlerts.value, x => x.id), [first.id])
    h.state.date.value = '2026-11-04'; assert.equal(h.state.filteredAlerts.value.length, 0)
    h.state.date.value = ''; h.state.search.value = ''; h.state.status.value = ''; h.route.query = {}
    assert.equal(h.state.filteredAlerts.value.length, 2)
    assert.equal(h.state.detectionDate('2026-11-05T08:00:00+08:00'), '2026-11-05')
    assert.equal(h.state.detectionDate('invalid'), '')
    assert.equal(h.state.detectionDate('2026-11-05'), '2026-11-05')
    assert.equal(h.state.cards.value[0][1], 1)
  } finally { h.stop() }
})

test('canonical response UI still allows direct New to Resolved and retains resolved restrictions', async () => {
  const original = globalThis.fetch, h = pageHarness(), calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    if (options?.method === 'POST') return Response.json({ updated: true })
    return Response.json({ alerts: [alert({ id: 'canonical-real', status: 'Resolved' })], responses: [] })
  }
  try {
    h.state.alerts.value = [canonicalRow('New')]
    h.state.openAlert(h.state.alerts.value[0])
    h.state.responseStatus.value = 'Resolved'
    await h.state.submitResponse()
    assert.equal(calls.length, 0)
    assert.match(h.state.responseError.value, /Enter a response note/)
    h.state.responseNote.value = 'Investigated and resolved'
    await h.state.submitResponse()
    assert.deepEqual(JSON.parse(calls[0].options.body), { status: 'Resolved', note: 'Investigated and resolved' })
    assert.equal(calls[0].url, '/api/data/alerts/canonical-real/responses')
    assert.equal(h.state.selectedAlert.value.status, 'Resolved')
    const button = nodes(h.render()).find(n => n.type === 'button' && typeof n.children === 'string' && n.children.trim() === 'Resolve Alert')
    assert.equal(button.props.disabled, true)
  } finally { h.stop(); globalThis.fetch = original }
})


test('Reviewing keeps the full UUID, response history and conflict note handling', async () => {
  const original = globalThis.fetch, h = pageHarness(), calls = []
  let conflict = false
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    if (options?.method === 'POST') return conflict
      ? Response.json({ error: 'Alert is already resolved.' }, { status: 409 })
      : Response.json({ updated: true })
    return Response.json({ alerts: [alert({ status: conflict ? 'Resolved' : 'Reviewing' })], responses: [response] })
  }
  try {
    h.state.alerts.value = [{ ...canonicalRow('New'), id: alert().id }]
    h.state.openAlert(h.state.alerts.value[0])
    h.state.responseNote.value = 'Inspecting the device'
    await h.state.submitResponse()
    assert.equal(calls[0].url, `/api/data/alerts/${alert().id}/responses`)
    assert.deepEqual(JSON.parse(calls[0].options.body), { note: 'Inspecting the device', status: 'Reviewing' })
    assert.equal(h.state.selectedAlert.value.status, 'Reviewing')
    assert.equal(h.state.selectedAlert.value.responses[0].note, response.note)
    conflict = true
    h.state.responseNote.value = 'Preserve my investigation'
    await h.state.submitResponse()
    assert.equal(h.state.responseNote.value, 'Preserve my investigation')
    assert.equal(h.state.selectedAlert.value.status, 'Resolved')
    assert.match(h.state.responseError.value, /changed while you were responding/)
  } finally { h.stop(); globalThis.fetch = original }
})

test('reduced table width is page-scoped and backend response authorization stays Officer-only', () => {
  const { descriptor } = parse(page)
  const rules = []
  postcss.parse(descriptor.styles[0].content).walkRules(rule => rules.push(rule))
  const width = rules.find(rule => rule.selector === '.officer-layout.officer-layout .officer-table-scroll .threat-alert-table')
  assert.ok(width.nodes.some(node => node.prop === 'min-width' && node.value === '82rem'))
  const grants = readFileSync(new URL('../../shared/rbac.cjs', import.meta.url), 'utf8')
  const backend = readFileSync(new URL('../../plant-conservation-backend/iot.cjs', import.meta.url), 'utf8')
  assert.match(grants, /"responses.manage": \["Conservation Officer"\]/)
  assert.match(backend, /"\/api\/alerts\/:id\/responses",\s*allow\("responses.manage"\)/)
})


const officerSession = { pending: false, user: { id: 'preview-officer', role: 'Conservation Officer', status: 'Active', mustChangePassword: false } }
const hasButton = (h, label) => nodes(h.render()).some(n => n.type === 'button' && n.children === label)
async function enablePreview(h) {
  await h.state.loadAlerts()
  await h.state.startPreview()
}

test('preview requires localhost development, successful empty API and an active Officer', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => Response.json({ alerts: [], responses: [] })
  try {
    for (const options of [{ dev: false }, { dev: true, hostname: 'example.com' }, { dev: true }]) {
      const h = pageHarness(options)
      try {
        assert.equal(hasButton(h, 'Preview Sample Alerts'), false)
        await h.state.loadAlerts()
        assert.equal(hasButton(h, 'Preview Sample Alerts'), options.dev && options.hostname !== 'example.com')
        await h.state.startPreview()
        assert.equal(h.state.previewActive.value, options.dev && options.hostname !== 'example.com')
      } finally { h.stop() }
    }
    for (const user of [null, { ...officerSession.user, role: 'Administrator' }, { ...officerSession.user, status: 'Inactive' }]) {
      const h = pageHarness({ dev: true })
      try {
        h.changeSession({ pending: false, user }); await h.state.loadAlerts()
        assert.equal(hasButton(h, 'Preview Sample Alerts'), false)
        await h.state.startPreview(); assert.equal(h.state.preview.value, null)
      } finally { h.stop() }
    }
  } finally { globalThis.fetch = original }
})

test('failed API never offers preview and genuine alerts take priority over samples', async () => {
  const original = globalThis.fetch, h = pageHarness({ dev: true })
  try {
    globalThis.fetch = async () => Response.json({ error: 'Offline' }, { status: 503 })
    await enablePreview(h)
    assert.equal(h.state.previewActive.value, false); assert.equal(hasButton(h, 'Preview Sample Alerts'), false)
    globalThis.fetch = async () => Response.json({ alerts: [], responses: [] })
    await enablePreview(h)
    assert.equal(h.state.displayedAlerts.value.length, 3)
    h.state.alerts.value = [canonicalRow('New')]
    assert.equal(h.state.previewActive.value, false)
    assert.equal(h.state.displayedAlerts.value[0].id, 'canonical-real')
    assert.equal(hasButton(h, 'Preview Sample Alerts'), false)
  } finally { h.stop(); globalThis.fetch = original }
})

test('samples reuse one table, existing View modal, unavailable fields and real-only summary counts', async () => {
  const original = globalThis.fetch, h = pageHarness({ dev: true }), calls = []
  globalThis.fetch = async url => { calls.push(url); return Response.json({ alerts: [], responses: [] }) }
  try {
    await enablePreview(h)
    assert.deepEqual(Array.from(h.state.displayedAlerts.value, x => x.id), ['DEMO-ALERT-001', 'DEMO-ALERT-002', 'DEMO-ALERT-003'])
    assert.equal(h.state.alerts.value.length, 0)
    assert.ok(h.state.cards.value.every(card => card[1] === 0))
    let rendered = nodes(h.render())
    assert.equal(rendered.filter(n => n.type === 'table').length, 1)
    assert.ok(rendered.some(n => typeof n.children === 'string' && n.children.includes('SAMPLE DATA')))
    const badges = rendered.filter(n => n.type === 'span' && n.props?.style)
    assert.deepEqual(badges.map(n => n.props.style), ['Resolved', 'Reviewing', 'New'].map(threatAlertBadgeStyle))
    rendered.find(n => n.type === 'button' && n.children === 'View').props.onClick()
    rendered = nodes(h.render())
    assert.ok(rendered.some(n => n.type?.name === 'AppModal.vue' && n.props.accessible === ''))
    assert.ok(rendered.some(n => typeof n.children === 'string' && n.children.includes('SAMPLE PREVIEW')))
    assert.ok(rendered.some(n => n.children === 'Threshold unavailable'))
    assert.equal(h.state.selectedAlert.value.cameraId, null)
    h.state.search.value = 'movement'; assert.equal(h.state.filteredAlerts.value.length, 1)
    h.state.status.value = 'Resolved'; assert.equal(h.state.filteredAlerts.value.length, 0)
    h.state.search.value = ''; assert.equal(h.state.filteredAlerts.value[0].metric, 'humidity')
    assert.deepEqual(calls, ['/api/data/alerts'])
  } finally { h.stop(); globalThis.fetch = original }
})

for (const [initial, next] of [['New', 'Reviewing'], ['New', 'Resolved'], ['Reviewing', 'Resolved'], ['Reviewing', 'Reviewing']]) {
  test(`sample ${initial} to ${next} updates only local history without any mutation request`, async () => {
    const original = globalThis.fetch, h = pageHarness({ dev: true })
    globalThis.fetch = async () => Response.json({ alerts: [], responses: [] })
    try {
      await enablePreview(h)
      globalThis.fetch = () => { throw Error('Sample decisions must never use transport') }
      const row = h.state.displayedAlerts.value.find(row => row.status === initial), previous = row.responses.length
      h.state.openAlert(row); h.state.responseStatus.value = next; h.state.responseNote.value = '  Sample inspection note  '
      await h.state.submitResponse()
      assert.equal(row.status, next); assert.equal(row.responses.length, previous + 1)
      assert.equal(row.responses[0].note, 'Sample inspection note')
      assert.equal(row.responses[0].alertId, row.id)
      assert.equal(row.responses[0].status, next)
      assert.match(h.state.responseFeedback.value, /locally.*Not saved to database/)
      assert.equal(h.state.responseNote.value, '')
      assert.equal(h.state.alerts.value.length, 0)
    } finally { h.stop(); globalThis.fetch = original }
  })
}

test('sample validation rejects blank, oversized, invalid and resolved responses', async () => {
  const original = globalThis.fetch, h = pageHarness({ dev: true })
  globalThis.fetch = async () => Response.json({ alerts: [], responses: [] })
  try {
    await enablePreview(h)
    globalThis.fetch = () => { throw Error('Unexpected transport') }
    const row = h.state.displayedAlerts.value[0]
    h.state.openAlert(row)
    for (const [note, message] of [['   ', /Enter a response note/], ['x'.repeat(4001), /4,000/]]) {
      h.state.responseNote.value = note; await h.state.submitResponse()
      assert.match(h.state.responseError.value, message); assert.equal(row.responses.length, 0)
    }
    h.state.responseNote.value = 'Valid note'; h.state.responseStatus.value = 'New'
    await h.state.submitResponse(); assert.match(h.state.responseError.value, /Invalid response status/)
    h.state.responseStatus.value = 'Reviewing'; h.state.responseNote.value = 'x'.repeat(4000)
    await h.state.submitResponse(); assert.equal(row.responses.length, 1)
    const resolved = h.state.displayedAlerts.value[2], previous = resolved.responses.length
    h.state.openAlert(resolved); h.state.responseNote.value = 'Again'
    await h.state.submitResponse(); assert.equal(h.state.reviewBlocked.value, true)
    assert.equal(resolved.responses.length, previous)
    const button = nodes(h.render()).find(n => n.type === 'button' && n.children?.trim?.() === 'Save Response')
    assert.equal(button.props.disabled, true)
  } finally { h.stop(); globalThis.fetch = original }
})

test('preview exit, reload and account/session changes discard local decisions and notes', async () => {
  const original = globalThis.fetch, h = pageHarness({ dev: true })
  globalThis.fetch = async () => Response.json({ alerts: [], responses: [] })
  try {
    await enablePreview(h)
    h.state.openAlert(h.state.displayedAlerts.value[0]); h.state.responseNote.value = 'Draft sample note'
    h.state.exitPreview()
    assert.equal(h.state.preview.value, null); assert.equal(h.state.selectedAlert.value, null); assert.equal(h.state.responseNote.value, '')
    assert.ok(nodes(h.render()).some(n => n.children === 'No threat alerts found.'))
    await h.state.startPreview(); assert.equal(h.state.displayedAlerts.value[0].status, 'New')
    await h.state.loadAlerts(); assert.equal(h.state.preview.value, null)
    for (const session of [{ pending: true, user: null }, { pending: false, user: null }, officerSession]) {
      h.changeSession(officerSession); await enablePreview(h)
      h.changeSession(session)
      assert.equal(h.state.preview.value, null); assert.equal(h.state.selectedAlert.value, null)
      assert.equal(h.state.canPreview.value, false)
    }
    const fresh = pageHarness({ dev: true })
    try { assert.equal(fresh.state.preview.value, null); assert.equal(fresh.state.hasLoaded.value, false) } finally { fresh.stop() }
  } finally { h.stop(); globalThis.fetch = original }
})

test('changing sample ID or preview flags cannot route a sample to a canonical mutation', async () => {
  const original = globalThis.fetch, h = pageHarness({ dev: true })
  globalThis.fetch = async () => Response.json({ alerts: [], responses: [] })
  try {
    await enablePreview(h)
    const row = h.state.displayedAlerts.value[0]
    row.id = alert().id
    h.state.openAlert(row); h.state.responseNote.value = 'Local only'
    globalThis.fetch = () => { throw Error('Sample escaped to transport') }
    await h.state.submitResponse(); assert.equal(row.status, 'Reviewing')
    h.state.preview.value = null
    h.state.responseNote.value = 'Cannot send this sample'
    await h.state.submitResponse()
    assert.match(h.state.responseError.value, /not a current backend record/)
  } finally { h.stop(); globalThis.fetch = original }
})


test('session change invalidates pending preview initialization and canonical empty loads', async () => {
  const original = globalThis.fetch, h = pageHarness({ dev: true })
  try {
    globalThis.fetch = async () => Response.json({ alerts: [], responses: [] })
    await h.state.loadAlerts()
    const start = h.state.startPreview()
    h.changeSession({ pending: true, user: null })
    await start
    assert.equal(h.state.preview.value, null)
    h.changeSession(officerSession)
    let finish
    globalThis.fetch = () => new Promise(resolve => { finish = resolve })
    const load = h.state.loadAlerts()
    h.changeSession({ pending: false, user: null })
    finish(Response.json({ alerts: [], responses: [] }))
    await load
    assert.equal(h.state.hasLoaded.value, false); assert.equal(h.state.canPreview.value, false)
  } finally { h.stop(); globalThis.fetch = original }
})

test('sample controller has no transport/storage and preview controls preserve semantic layout', () => {
  const source = readFileSync(new URL('../src/data/threatAlertPreview.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /fetch\(|saveAlertResponse|localStorage|sessionStorage|\/api\//)
  assert.match(page, /import\.meta\.env\.DEV/)
  assert.match(page, /class="action-button" type="button"[^>]*@click="startPreview"/)
  assert.match(page, /class="action-button" type="button" @click="exitPreview"/)
  assert.match(page, /preview-controls \{ display: flex; flex-wrap: wrap;/)
  assert.match(page, /sample-marker[^\n]*overflow-wrap: anywhere/)
})


test('unified source/status/date/search filters use actual metric provenance and retain real camera identities', async () => {
  const h = pageHarness()
  try {
    h.state.isLoading.value = false
    h.state.alerts.value = [canonicalRow('New'), { ...canonicalRow('Reviewing'), id: 'camera-record', metric: 'possible_plant_contact', cameraId: 'camera-reference' }]
    h.state.sourceFilter.value = 'Camera'
    assert.deepEqual(Array.from(h.state.filteredAlerts.value, x => x.id), ['camera-record'])
    h.state.search.value = 'Possible Plant Contact'; h.state.status.value = 'Reviewing'
    assert.equal(h.state.filteredAlerts.value.length, 1)
    h.state.sourceFilter.value = 'Sensor'; assert.equal(h.state.filteredAlerts.value.length, 0)
    h.state.search.value = ''; h.state.status.value = ''; assert.equal(h.state.filteredAlerts.value.length, 1)
    h.state.sourceFilter.value = ''; assert.equal(h.state.filteredAlerts.value.length, 2)
    h.state.openAlert(h.state.alerts.value[1])
    await new Promise(setImmediate)
    const tree = nodes(h.render())
    assert.ok(tree.some(n => n.children === 'No authorized recording is available for this alert.'))
    assert.ok(!tree.some(n => n.type === 'video' || n.type === 'iframe' || n.children === '92%'))
    assert.ok(tree.some(n => n.children === 'Threshold unavailable'))
  } finally { h.stop() }
})

for (const [initial, decision] of [['New','Reviewing'], ['New','Resolved'], ['Reviewing','Reviewing'], ['Reviewing','Resolved']]) {
  test(`canonical ${initial} to ${decision} uses one POST, then authoritative GET and real response history`, async () => {
    const h = pageHarness(), original = globalThis.fetch, calls = []
    globalThis.fetch = async (url, options) => {
      calls.push([url, options?.method || 'GET'])
      return options?.method === 'POST' ? Response.json({ updated: true }) : Response.json({ alerts: [alert({ status: decision })], responses: [{ ...response, status: decision }] })
    }
    try {
      h.state.alerts.value = [{ ...canonicalRow(initial), id: alert().id }]
      h.state.openAlert(h.state.alerts.value[0]); assert.equal(calls.length, 0)
      assert.equal(h.state.selectedAlert.value.status, initial)
      h.state.responseStatus.value = decision; h.state.responseNote.value = 'Actual investigation note'
      await h.state.submitResponse()
      assert.deepEqual(calls.map(x => x[1]), ['POST','GET'])
      assert.equal(h.state.selectedAlert.value.status, decision)
      assert.equal(h.state.selectedAlert.value.responses[0].note, response.note)
      assert.equal(h.state.verificationRequired.value, false)
      if (decision === 'Resolved') { await h.state.submitResponse(); assert.equal(calls.length, 2) }
    } finally { h.stop(); globalThis.fetch = original }
  })
}

for (const boundary of ['logout','pending','account','selection','close','unmount']) {
  test(`late successful save/readback cannot cross ${boundary} boundary`, async () => {
    const h = pageHarness(), original = globalThis.fetch
    let release, posts = 0
    globalThis.fetch = async (_url, options) => options?.method === 'POST' ? (posts++, Response.json({ updated: true })) : new Promise(resolve => { release = resolve })
    try {
      const first = { ...canonicalRow('New'), id: alert().id }, other = { ...canonicalRow('New'), id: 'another-alert' }
      h.state.alerts.value = [first, other]; h.state.openAlert(h.state.alerts.value[0]); h.state.responseNote.value = 'Private first draft'
      const saving = h.state.submitResponse(); await new Promise(setImmediate)
      if (boundary === 'logout') h.changeSession({ user: null, pending: false })
      else if (boundary === 'pending') h.changeSession({ user: officerSession.user, pending: true })
      else if (boundary === 'account') h.changeSession({ ...officerSession, user: { ...officerSession.user, id: 'other-officer' } })
      else if (boundary === 'selection') { h.state.openAlert(h.state.alerts.value[1]); h.state.responseNote.value = 'Second draft' }
      else if (boundary === 'close') h.state.closeAlert()
      else h.stop()
      release(Response.json({ alerts: [alert({ status: 'Resolved' })], responses: [response] })); await saving
      assert.equal(posts, 1)
      if (boundary === 'selection') { assert.equal(h.state.selectedAlert.value.id, other.id); assert.equal(h.state.responseNote.value, 'Second draft') }
      else { assert.equal(h.state.selectedAlert.value, null); assert.equal(h.state.responseNote.value, '') }
      if (['logout','pending','account','unmount'].includes(boundary)) assert.equal(h.state.alerts.value.length, 0)
    } finally { h.stop(); globalThis.fetch = original }
  })
}

test('saved-but-unverified and uncertain POST outcomes enforce GET-only recovery even after closing details', async () => {
  for (const failPost of [false, true]) {
    const h = pageHarness(), original = globalThis.fetch, calls = []
    let allowRead = false
    globalThis.fetch = async (url, options) => {
      calls.push(options?.method || 'GET')
      if (options?.method === 'POST') { if (failPost) throw Error('Uncertain network outcome'); return Response.json({ updated: true }) }
      return allowRead ? Response.json({ alerts: [alert({ status: 'Reviewing' })], responses: [response] }) : Response.json({ error: 'Unavailable' }, { status: 503 })
    }
    try {
      h.state.alerts.value = [{ ...canonicalRow('New'), id: alert().id }]; h.state.openAlert(h.state.alerts.value[0]); h.state.responseNote.value = 'Keep this draft'
      await h.state.submitResponse()
      assert.equal(h.state.selectedAlert.value.status, 'New'); assert.equal(h.state.verificationRequired.value, true)
      await h.state.submitResponse(); assert.equal(calls.filter(x => x === 'POST').length, 1)
      h.state.closeAlert(); h.state.openAlert(h.state.alerts.value[0]); assert.equal(h.state.verificationRequired.value, true)
      h.state.responseNote.value = 'Retained review'; allowRead = true
      await h.state.verifyResponse()
      assert.equal(h.state.verificationRequired.value, false); assert.equal(h.state.inspectionRequired.value, true)
      assert.equal(h.state.selectedAlert.value.status, 'Reviewing'); assert.equal(h.state.responseNote.value, 'Retained review')
      await h.state.submitResponse(); assert.equal(calls.filter(x => x === 'POST').length, 1)
      assert.ok(calls.includes('GET'))
    } finally { h.stop(); globalThis.fetch = original }
  }
})

test('409 recovery requires inspection and preserves notes; a failed reload stays blocked', async () => {
  const original = globalThis.fetch, h = pageHarness(); let readsWork = true, posts = 0
  globalThis.fetch = async (_url, options) => options?.method === 'POST' ? (posts++, Response.json({ error: 'Conflict' }, { status: 409 })) : readsWork ? Response.json({ alerts: [alert({ status: 'Reviewing' })], responses: [response] }) : Response.json({}, { status: 503 })
  try {
    h.state.alerts.value = [{ ...canonicalRow('New'), id: alert().id }]; h.state.openAlert(h.state.alerts.value[0]); h.state.responseNote.value = 'Inspect this change'
    await h.state.submitResponse(); assert.equal(posts, 1); assert.equal(h.state.inspectionRequired.value, true); assert.equal(h.state.responseNote.value, 'Inspect this change')
    await h.state.submitResponse(); assert.equal(posts, 1)
    h.state.inspectionRequired.value = false; readsWork = false; await h.state.submitResponse()
    assert.equal(posts, 2); assert.equal(h.state.verificationRequired.value, true)
  } finally { h.stop(); globalThis.fetch = original }
})

test('background refresh discovers new alerts, preserves filters/modal/draft and discloses caps', async () => {
  const original = globalThis.fetch, h = pageHarness(); let responses = []
  globalThis.fetch = async () => Response.json({ alerts: Array.from({ length: 500 }, (_, i) => alert({ id: i === 0 ? alert().id : String(i) })), responses })
  try {
    h.state.alerts.value = [{ ...canonicalRow('New'), id: alert().id }]; h.state.openAlert(h.state.alerts.value[0]); h.state.responseNote.value = 'Unsubmitted note'
    h.state.search.value = 'temperature'; h.state.sourceFilter.value = 'Sensor'; h.state.status.value = 'New'; h.state.date.value = '2026-11-03'
    await h.state.loadAlerts(true)
    assert.equal(h.state.alerts.value.length, 500); assert.equal(h.state.cards.value[0][1], 500)
    assert.equal(h.state.responseNote.value, 'Unsubmitted note'); assert.equal(h.state.selectedAlert.value.id, alert().id)
    assert.equal(h.state.search.value, 'temperature'); assert.equal(h.state.sourceFilter.value, 'Sensor'); assert.equal(h.state.status.value, 'New'); assert.equal(h.state.date.value, '2026-11-03')
    assert.equal(h.state.queueMeta.value.alertsCapped, true)
    assert.ok(nodes(h.render()).some(n => n.children === 'The service limit was reached. Alert totals or response history may be incomplete.'))
    responses = Array.from({ length: 500 }, (_, i) => ({ ...response, id: String(i) }))
    await h.state.loadAlerts(true); assert.equal(h.state.queueMeta.value.historyCapped, true)
  } finally { h.stop(); globalThis.fetch = original }
})

test('sensor evidence never reconstructs thresholds or exceeds amounts and camera paths never become playable URLs', async () => {
  const h = pageHarness()
  try {
    h.state.alerts.value = [{ ...canonicalRow('New'), metric: 'soilMoisture', value: 2150 }]; h.state.openAlert(h.state.alerts.value[0])
    let tree = nodes(h.render()); assert.ok(tree.some(n => n.children === 'Threshold unavailable')); assert.ok(tree.some(n => n.children === 'raw'))
    h.state.alerts.value = [{ ...canonicalRow('New'), metric: 'possible_plant_contact', cameraId: 'camera', videoPath: 'https://untrusted.example/private?token=secret' }]; h.state.openAlert(h.state.alerts.value[0])
    await new Promise(setImmediate)
    tree = nodes(h.render()); assert.ok(!tree.some(n => n.type === 'video' || n.props?.src || n.props?.href?.includes('untrusted')))
    assert.ok(!JSON.stringify(tree).includes('token=secret'))
    assert.ok(tree.some(n => n.children === 'No authorized recording is available for this alert.'))
  } finally { h.stop() }
})


test('mounted page polling discovers alerts and updates summaries without losing filters or a draft, then stops on logout', async () => {
  const h = pageHarness(), original = globalThis.fetch
  let records = [alert()], calls = 0
  globalThis.fetch = async () => { calls++; return Response.json({ alerts: records, responses: [] }) }
  const settle = async () => { for (let i = 0; i < 4; i++) await new Promise(setImmediate) }
  try {
    h.mount(); await settle(); assert.equal(h.state.alerts.value.length, 1)
    h.state.openAlert(h.state.alerts.value[0]); h.state.responseNote.value = 'Inspection in progress'
    h.state.sourceFilter.value = 'Sensor'; h.state.search.value = 'temperature'
    records = [alert(), alert({ id: 'second-alert', status: 'Reviewing' })]
    const [timerId, timer] = h.timers.entries().next().value
    assert.equal(timer.delay, 30000); h.timers.delete(timerId); timer.fn(); await settle()
    assert.equal(h.state.alerts.value.length, 2); assert.equal(h.state.cards.value[0][1], 2)
    assert.equal(h.state.selectedAlert.value.id, alert().id); assert.equal(h.state.responseNote.value, 'Inspection in progress')
    assert.equal(h.state.sourceFilter.value, 'Sensor'); assert.equal(h.state.search.value, 'temperature')
    h.browserDocument.visibilityState = 'hidden'; h.events.get('visibilitychange')(); assert.equal(h.timers.size, 0)
    const before = calls; h.events.get('focus')(); await settle(); assert.equal(calls, before)
    h.browserDocument.visibilityState = 'visible'; h.events.get('visibilitychange')(); await settle(); assert.equal(calls, before + 1)
    h.changeSession({ user: null, pending: false }); assert.equal(h.timers.size, 0); assert.equal(h.state.alerts.value.length, 0); assert.equal(h.state.responseNote.value, '')
  } finally { h.stop(); globalThis.fetch = original }
})


test('exact older-alert bookmark loads outside the queue, retains notes/filters during polling and supports readback',async()=>{
 const original=globalThis.fetch;const calls=[];let current=alert({id:'older-alert',status:'New'})
 globalThis.fetch=async(url,options)=>{
  calls.push({url,options})
  if(url==='/api/data/alerts')return Response.json({alerts:[alert()],responses:[]})
  if(url==='/api/data/alerts/older-alert')return Response.json({alert:current,responses:[],history_capped:false})
  throw Error('Unexpected transport '+url)
 }
 const h=pageHarness()
 try{
  h.route.query.alert='older-alert';await vue.nextTick();await h.state.loadAlerts();await new Promise(setImmediate)
  assert.equal(h.state.selectedAlert.value.id,'older-alert');assert.equal(h.state.alerts.value.length,2)
  h.state.responseNote.value='Unsaved field note';h.state.status.value='New';h.state.search.value='sensor';
  current={...current,status:'Reviewing'};await h.state.loadAlerts(true);await new Promise(setImmediate)
  assert.equal(h.state.selectedAlert.value.status,'Reviewing');assert.equal(h.state.responseNote.value,'Unsaved field note');assert.equal(h.state.status.value,'New');assert.equal(h.state.search.value,'sensor');assert.equal(h.state.inspectionRequired.value,true)
  assert.ok(calls.some(c=>c.url==='/api/data/alerts/older-alert'));assert.ok(calls.every(c=>!c.options?.method||c.options.method==='GET'))
 }finally{h.stop();globalThis.fetch=original}
})
test('exact detail validates identity, bounds history and rejects foreign response rows',async()=>{
 const old=globalThis.fetch
 try{
  for(const result of [
   {alert:alert({id:'wrong'}),responses:[],history_capped:false},
   {alert:alert(),responses:[{...response,alert_id:'other'}],history_capped:false},
   {alert:alert(),responses:[],history_capped:'yes'}
  ]){globalThis.fetch=async()=>Response.json(result);await assert.rejects(alertService.loadCanonicalAlert(alert().id),{kind:'invalid'})}
  globalThis.fetch=async()=>Response.json({alert:alert(),responses:[response],history_capped:true});const detail=await alertService.loadCanonicalAlert(alert().id);assert.equal(detail.responseHistoryCapped,true);assert.equal(detail.responses.length,1)
  await assert.rejects(alertService.loadCanonicalAlert('../public/1'),{status:400})
 }finally{globalThis.fetch=old}
})
