import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import postcss from 'postcss'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { threatAlertBadgeStyle } from '../src/utils/workflowBadge.ts'
import * as cameraService from '../src/services/cameraEvents.ts'
import { formatPlantId } from '../src/utils/plantId.ts'
import { monitoringDate, monitoringLabels } from '../src/utils/officerMonitoringDisplay.ts'
import * as alertService from '../src/services/threatAlerts.ts'
import {
  alertResponsePath,
  loadCanonicalAlerts,
  saveAlertResponse,
} from '../src/services/threatAlerts.ts'

const page = readFileSync(new URL('../src/views/conservation/ThreatAlertsView.vue', import.meta.url), 'utf8')
const savedCameraEvents = [1, 2, 3].map(index => ({ eventId: String(index).repeat(32), plantId: String(index), cameraId: 'registered-camera', eventType: 'possible_plant_contact', title: 'Possible contact', description: 'Contact plus MPU movement', confidence: null, detectedAt: '2026-11-13T00:00:00Z', recordingStartedAt: '2026-11-13T00:00:00Z', recordingEndedAt: '2026-11-13T00:00:10Z', durationSeconds: 10, recordingStatus: 'ready', videoUrl: `/api/data/camera-events/${String(index).repeat(32)}/video`, status: 'New' }))
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
  assert.match(page, /const refreshed = await loadCanonicalAlerts\(\)/)
  assert.match(page, /responseNote\.value = ''/)
  assert.match(page, /committed[\s\S]*saved, but refreshed alert data could not be loaded/)
})

test('legacy alert route is no longer authoritative and canonical deep links are supported', () => {
  assert.doesNotMatch(page, /\/api\/iot\/alerts/)
  assert.match(page, /route\.query\.device/)
  assert.match(page, /route\.query\.reading/)
  assert.match(iotPage, /query: \{ device: String\(device\.sensor_id\) \}/)
})

test('saved camera events replace fixtures and cannot be posted as sensor responses', () => {
  assert.doesNotMatch(page, /prototypeCameraEvents|cameraMonitoringPrototype/)
  assert.match(page, /loadCameraEvents/)
  assert.match(page, /recordingLabel\(event\)/)
  assert.match(page, /if \(selectedCameraEvent\.value\) return/)
})

test('design structure and styling remain in place', () => {
  assert.match(page, /class="summary-grid"/)
  assert.match(page, /class="control-bar"/)
  assert.match(page, /class="panel camera-alert-panel"/)
  assert.match(page, /class="table-scroll officer-table-scroll"/)
  assert.match(page, /class="detail-list real-alert-details"/)
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

function pageHarness() {
  const { descriptor } = parse(page)
  const script = compileScript(descriptor, { id: 'threat-badges' })
  const template = compileTemplate({ source: descriptor.template.content, filename: 'ThreatAlertsView.vue', id: 'threat-badges', compilerOptions: { bindingMetadata: script.bindings } })
  const js = value => ts.transpileModule(value, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const scope = vue.effectScope(), exports = {}, cleanup = []
  let sessionListener
  const officer = { id: 'officer', role: 'Conservation Officer', status: 'Active', mustChangePassword: false }
  const route = vue.reactive({ query: {} })
  const context = { exports, Error, URL, AbortController, require(name) {
    if (name === 'vue') return { ...vue, onMounted() {}, onBeforeUnmount: fn => cleanup.push(fn), withDirectives: n => n, resolveComponent: name => ({ name }) }
    if (name === 'vue-router') return { useRoute: () => route }
    if (name.endsWith('workflowBadge')) return { threatAlertBadgeStyle }
    if (name.endsWith('cameraEvents')) return cameraService
    if (name.endsWith('plantId')) return { formatPlantId }
    if (name.endsWith('/auth')) return { sessionSnapshot: () => ({ user: officer, pending: false }), subscribeSession: fn => { sessionListener = fn; return () => { sessionListener = null } } }
    if (name.endsWith('officerMonitoringDisplay')) return { monitoringDate, monitoringLabels }
    if (name.endsWith('threatAlerts')) return alertService
    if (name.includes('useConservationText')) return { useConservationText: () => ({ ct: x => x, locale: vue.ref('en') }) }
    if (name.endsWith('.vue')) return { name: name.split('/').at(-1) }
    throw Error(name)
  } }
  vm.runInNewContext(`(function(){${js(script.content)}})()`, context)
  const state = scope.run(() => exports.default.setup({}, { expose() {} }))
  vm.runInNewContext(`(function(){${js(template.code)}})()`, context)
  state.cameraEvents.value = savedCameraEvents.map(item => ({ ...item }))
  return { state, events: state.cameraEvents.value, session: (user, pending = false) => sessionListener?.(user, pending), render: () => exports.render({}, [], {}, vue.proxyRefs(state), {}, {}), stop: () => { cleanup.forEach(fn => fn()); scope.stop() } }
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

test('both tables render the exact same alert palette, visible labels and neutral unknown/null fallback', () => {
  const h = pageHarness()
  try {
    h.state.isLoading.value = false
    for (const status of ['New', 'Reviewing', 'Resolved', 'Unexpected', null]) {
      h.events[0].status = status
      // Canonical API validation rejects null statuses; test missing-status styling
      // on the prototype side without bypassing that existing data contract.
      const canonicalStatus = status ?? 'Unexpected'
      h.state.alerts.value = [canonicalRow(canonicalStatus)]
      const rendered = nodes(h.render())
      for (const table of ['camera-event-table', 'threat-alert-table']) {
        const tableNode = rendered.find(n => n.type === 'table' && n.props?.class.includes(table))
        const badge = nodes(tableNode).find(n => n.type === 'span' && n.props?.class.includes('badge') && n.props?.style)
        assert.deepEqual(badge.props.style, threatAlertBadgeStyle(status))
        assert.equal(badge.children.trim(), table === 'camera-event-table' ? status ?? '' : canonicalStatus)
      }
    }
  } finally { h.stop() }
})

test('saved camera View actions play protected recordings and remain separate from sensor responses', () => {
  const original = globalThis.fetch, h = pageHarness()
  globalThis.fetch = () => { throw Error('View actions must not send writes') }
  try {
    h.state.isLoading.value = false
    let rendered = nodes(h.render())
    assert.ok(rendered.some(n => typeof n.children === 'string' && n.children.includes('Saved camera events and their local recordings')))
    const table = rendered.find(n => n.type === 'table' && n.props?.class.includes('camera-event-table'))
    const actions = nodes(table).filter(n => n.type === 'button')
    assert.equal(actions.length, 3)
    assert.ok(actions.every(n => n.children.trim() === 'View'))
    actions[0].props.onClick()
    assert.equal(h.state.selectedCameraEvent.value.eventId, '1'.repeat(32))
    rendered = nodes(h.render())
    assert.ok(rendered.some(n => n.props?.to === '/plant/PL001'))
    assert.ok(!rendered.some(n => ['Save Response', 'Start Review', 'Mark Resolved', 'Reopen', 'Delete', 'Edit'].includes(typeof n.children === 'string' ? n.children.trim() : '')))
    assert.deepEqual(h.events, savedCameraEvents)
    const video = rendered.find(n => n.type === 'video')
    assert.equal(video.props.src, savedCameraEvents[0].videoUrl)
    assert.ok(video.props.controls !== undefined)
    assert.equal(h.state.isWebVideoUrl('/camera-api/recordings/secret.mp4'), false)
  } finally { h.stop(); globalThis.fetch = original }
})

test('camera refresh preserves visible events on failure and invalidates delayed results after logout or unmount', async () => {
  const original = globalThis.fetch
  try {
    const h = pageHarness()
    try {
      globalThis.fetch = async () => { throw Error('offline') }
      await h.state.refreshCameraEvents()
      assert.equal(h.state.cameraEvents.value.length, 3)
      assert.match(h.state.cameraError.value, /Unable to reach/)
      globalThis.fetch = async () => Response.json({ events: [], hasMore: false })
      await h.state.refreshCameraEvents()
      assert.equal(h.state.cameraEvents.value.length, 0)
      assert.equal(h.state.cameraError.value, '')
    } finally { h.stop() }
    for (const action of ['logout', 'unmount']) {
      const h = pageHarness()
      let resolve, signal
      globalThis.fetch = (_url, options) => { signal = options.signal; return new Promise(done => { resolve = done }) }
      const request = h.state.refreshCameraEvents()
      if (action === 'logout') h.session(null)
      else h.stop()
      assert.equal(signal.aborted, true)
      resolve(Response.json({ events: savedCameraEvents, hasMore: false }))
      await request
      assert.equal(h.state.cameraEvents.value.length, 0)
      assert.equal(h.state.selectedCameraEvent.value, null)
      if (action === 'logout') h.stop()
    }
  } finally { globalThis.fetch = original }
})

test('canonical response UI still allows direct New to Resolved and retains resolved restrictions', async () => {
  const original = globalThis.fetch, h = pageHarness(), calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    if (options?.method === 'POST') return Response.json({ updated: true })
    return Response.json({ alerts: [alert({ id: 'canonical-real', status: 'Resolved' })], responses: [] })
  }
  try {
    h.state.openAlert(canonicalRow('New'))
    h.state.responseStatus.value = 'Resolved'
    await h.state.submitResponse()
    assert.equal(calls.length, 0)
    assert.match(h.state.responseError.value, /note is required/)
    h.state.responseNote.value = 'Investigated and resolved'
    await h.state.submitResponse()
    assert.deepEqual(JSON.parse(calls[0].options.body), { status: 'Resolved', note: 'Investigated and resolved' })
    assert.equal(calls[0].url, '/api/data/alerts/canonical-real/responses')
    assert.equal(h.state.selectedAlert.value.status, 'Resolved')
    const button = nodes(h.render()).find(n => n.type === 'button' && typeof n.children === 'string' && n.children.trim() === 'Save Response')
    assert.equal(button.props.disabled, true)
  } finally { h.stop(); globalThis.fetch = original }
})
