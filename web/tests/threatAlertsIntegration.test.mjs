import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import postcss from 'postcss'
import {
  alertResponsePath,
  loadCanonicalAlerts,
  saveAlertResponse,
} from '../src/services/threatAlerts.ts'

const page = readFileSync(new URL('../src/views/conservation/ThreatAlertsView.vue', import.meta.url), 'utf8')
const cameraFixture = readFileSync(new URL('../src/data/cameraMonitoringPrototype.ts', import.meta.url), 'utf8')
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

test('camera prototype remains separate and cannot be posted as a canonical response', () => {
  assert.match(page, /prototypeCameraEvents/)
  assert.doesNotMatch(page, /Frontend prototype events/)
  assert.match(cameraFixture, /Frontend-only fixtures/)
  assert.doesNotMatch(cameraFixture, /saveAlertResponse|\/api\/data\/alerts/)
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
