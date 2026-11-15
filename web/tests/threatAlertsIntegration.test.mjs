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

test('one canonical table replaces all demonstration rendering and uses accessible details', () => {
  assert.equal((page.match(/<table\b/g) || []).length, 1)
  assert.equal((page.match(/<AppModal\b/g) || []).length, 1)
  assert.doesNotMatch(page, /prototypeCameraEvents|cameraMonitoringPrototype|selectedCameraEvent|CAM-EVT-|Suspicious Camera Events|Demonstration camera events/)
  assert.match(page, /v-if="selectedAlert"[\s\S]*?wide\s+accessible/)
  assert.match(page, /Alert ID, device, reading, type or status/)
  assert.match(page, /v-model="severity" disabled/)
})

test('design structure and styling remain in place', () => {
  assert.match(page, /class="summary-grid"/)
  assert.match(page, /class="control-bar"/)
  assert.match(page, /class="panel"/)
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

function pageHarness({ dev = false, hostname = 'localhost' } = {}) {
  const { descriptor } = parse(page)
  const script = compileScript(descriptor, { id: 'threat-badges' })
  const template = compileTemplate({ source: descriptor.template.content, filename: 'ThreatAlertsView.vue', id: 'threat-badges', compilerOptions: { bindingMetadata: script.bindings } })
  const js = value => ts.transpileModule(value.replaceAll('import.meta.env.DEV', String(dev)).replace("import('../../data/threatAlertPreview')", 'Promise.resolve(__previewModule)'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const scope = vue.effectScope(), exports = {}
  const route = vue.reactive({ query: {} })
  let session = { pending: false, user: { id: 'test-officer', role: 'Conservation Officer', status: 'Active', mustChangePassword: false } }
  const listeners = new Set(), cleanup = []
  const context = { exports, Error, URL, window: { location: { hostname } }, __previewModule: previewModule, require(name) {
    if (name === 'vue') return { ...vue, onMounted() {}, onBeforeUnmount(fn) { cleanup.push(fn) }, withDirectives: n => n, resolveComponent: name => ({ name }) }
    if (name.endsWith('/auth')) return { sessionSnapshot: () => session, subscribeSession: fn => { listeners.add(fn); return () => listeners.delete(fn) } }
    if (name === 'vue-router') return { useRoute: () => route }
    if (name.endsWith('workflowBadge')) return { threatAlertBadgeStyle }
    if (name.endsWith('officerMonitoringDisplay')) return { monitoringDate, monitoringLabels }
    if (name.endsWith('threatAlerts')) return alertService
    if (name.includes('useConservationText')) return { useConservationText: () => ({ ct: x => x, locale: vue.ref('en') }) }
    if (name.endsWith('.vue')) return { name: name.split('/').at(-1) }
    throw Error(name)
  } }
  vm.runInNewContext(`(function(){${js(script.content)}})()`, context)
  const state = scope.run(() => exports.default.setup({}, { expose() {} }))
  vm.runInNewContext(`(function(){${js(template.code)}})()`, context)
  return { state, route, render: () => exports.render({}, [], {}, vue.proxyRefs(state), {}, {}), changeSession: next => { session = next; for (const fn of listeners) fn() }, stop: () => { cleanup.forEach(fn => fn()); scope.stop() } }
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
      assert.equal(badge.children, status)
      for (const value of [row.id, row.deviceId, row.readingId]) assert.ok(rendered.some(n => n.props?.value === value))
      rendered.find(n => n.type === 'button' && n.children === 'View').props.onClick()
      assert.equal(h.state.selectedAlert.value.id, row.id)
      const modal = nodes(h.render()).find(n => n.type?.name === 'AppModal.vue')
      assert.ok(modal); assert.equal(modal.props.accessible, '')
    }
    assert.doesNotMatch(page, /confidence \*|formatConfidence|badge unavailable/)
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
    const retry = nodes(h.render()).find(n => n.type === 'button' && n.children === 'Try again')
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
  assert.ok(width.nodes.some(node => node.prop === 'min-width' && node.value === '68rem'))
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
    assert.deepEqual(badges.map(n => n.props.style), ['New', 'Reviewing', 'Resolved'].map(threatAlertBadgeStyle))
    rendered.find(n => n.type === 'button' && n.children === 'View').props.onClick()
    rendered = nodes(h.render())
    assert.ok(rendered.some(n => n.type?.name === 'AppModal.vue' && n.props.accessible === ''))
    assert.ok(rendered.some(n => typeof n.children === 'string' && n.children.includes('SAMPLE PREVIEW')))
    assert.equal(rendered.filter(n => n.children === 'Not available').length, 2)
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
    for (const [note, message] of [['   ', /required/], ['x'.repeat(4001), /4,000/]]) {
      h.state.responseNote.value = note; await h.state.submitResponse()
      assert.match(h.state.responseError.value, message); assert.equal(row.responses.length, 0)
    }
    h.state.responseNote.value = 'Valid note'; h.state.responseStatus.value = 'New'
    await h.state.submitResponse(); assert.match(h.state.responseError.value, /Invalid response status/)
    h.state.responseStatus.value = 'Reviewing'; h.state.responseNote.value = 'x'.repeat(4000)
    await h.state.submitResponse(); assert.equal(row.responses.length, 1)
    const resolved = h.state.displayedAlerts.value[2], previous = resolved.responses.length
    h.state.openAlert(resolved); h.state.responseNote.value = 'Again'
    await h.state.submitResponse(); assert.match(h.state.responseError.value, /Resolved alerts/)
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
