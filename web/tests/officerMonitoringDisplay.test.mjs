import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import * as Vue from 'vue'
import ts from 'typescript'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { monitoringDate, monitoringLabels } from '../src/utils/officerMonitoringDisplay.ts'

const read = path => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')
const first = '12345678-1111-4111-8111-111111111111'
const second = '12345678-2222-4222-8222-222222222222'

test('timestamps use localized Malaysia time without discarding the original offset', () => {
  assert.equal(monitoringDate('2026-11-05T03:44:59.123Z'), 'Nov 5, 2026, 11:44')
  assert.equal(monitoringDate('2026-11-05T11:44:00+08:00'), 'Nov 5, 2026, 11:44')
  assert.equal(monitoringDate('2026-11-04T23:44:00-04:00'), 'Nov 5, 2026, 11:44')
  assert.equal(monitoringDate('2026-11-05T00:44:00Z'), monitoringDate('2026-11-05T08:44:00+08:00'))
  assert.equal(monitoringDate('2026-11-04T20:44:00Z'), 'Nov 5, 2026, 04:44')
  for (const locale of ['ms', 'zh-CN']) assert.equal(monitoringDate('2026-11-05T03:44:00Z', locale), new Intl.DateTimeFormat(locale === 'ms' ? 'ms-MY' : locale, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Kuala_Lumpur' }).format(new Date('2026-11-05T03:44:00Z')))
})

test('date-only stays date-only; missing, invalid and ambiguous timestamps are unavailable', () => {
  assert.equal(monitoringDate('2026-11-05'), 'Nov 5, 2026')
  for (const value of [null, undefined, '', 'invalid', '2026-02-30', '2026-02-30T03:00:00Z', '2026-11-05T24:00:00Z', '2026-11-05T11:44:00', '2026-11-05T11:99:00Z']) assert.equal(monitoringDate(value), '\u2014', String(value))
})

test('compact labels preserve short/numeric legacy identifiers and distinguish loaded collisions', () => {
  const ids = [first, second, 'PL018', 'CAM-001', 'CAM-EVT-001', '18', '123456789012345678901234567890', 'staff:12345678-1111-4111-8111-111111111111']
  const labels = monitoringLabels(ids)
  assert.equal(labels.get(first), '123456781111\u2026')
  assert.equal(labels.get(second), '123456782222\u2026')
  assert.equal(new Set(labels.values()).size, ids.length)
  for (const id of ids.slice(2, 7)) assert.equal(labels.get(id), id)
  assert.equal(ids[0], first)
  const caseIds = ['abcdefab-1111-4111-8111-111111111111', 'ABCDEFAB-1111-4111-8111-111111111111']
  for (const [id, label] of monitoringLabels(caseIds)) assert.equal(label, id)
  const opaque = ['legacy-device-long-identifier-A', 'legacy-device-long-identifier-B', '12345678\u2026', first]
  assert.equal(new Set(monitoringLabels(opaque).values()).size, opaque.length)
})

function identifierHarness({ clipboard, authorized = true } = {}) {
  const source = read('components/conservation/MonitoringIdentifier.vue')
  const { descriptor } = parse(source)
  const script = compileScript(descriptor, { id: 'monitoring-id' })
  const code = ts.transpileModule(script.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  let listener, cleanup
  let session = { pending: false, user: { id: 'officer', role: authorized ? 'Conservation Officer' : 'Botanist', status: 'Active', mustChangePassword: false } }
  const context = { exports: {}, navigator: { clipboard }, Error, require(name) {
    if (name === 'vue') return { ...Vue, watch: (...args) => Vue.watch(...args), onBeforeUnmount: fn => { cleanup = fn } }
    if (name === 'vue-i18n') return { useI18n: () => ({ t: key => key }) }
    if (name.includes('/auth')) return { sessionSnapshot: () => session, subscribeSession: fn => { listener = fn; return () => {} } }
    throw Error(name)
  } }
  vm.runInNewContext(code, context)
  const props = Vue.reactive({ value: first, labels: monitoringLabels([first, second]) })
  const state = context.exports.default.setup(props, { expose() {} })
  return { state, props, cleanup: () => cleanup(), logout: () => { session = { pending: false, user: null }; listener() } }
}

test('copy writes the exact full ID and supplies copied feedback, not the label', async () => {
  const copied = []
  const h = identifierHarness({ clipboard: { writeText: async value => copied.push(value) } })
  assert.equal(h.state.shortened.value, true)
  await h.state.copy()
  assert.deepEqual(copied, [first])
  assert.equal(h.state.feedback.value, 'monitoringDisplay.copied')
  h.cleanup()
})

test('clipboard failure reveals selectable full ID; short IDs and unauthorized roles do not copy', async () => {
  const h = identifierHarness()
  await h.state.copy()
  assert.equal(h.state.failed.value, true)
  assert.equal(h.state.raw.value, first)
  h.props.value = 'CAM-001'; await Vue.nextTick()
  assert.equal(h.state.shortened.value, false)
  assert.equal(h.state.failed.value, false)
  const other = identifierHarness({ authorized: false, clipboard: { writeText: () => assert.fail('unauthorized copy') } })
  await other.state.copy()
  h.cleanup(); other.cleanup()
})

test('copy feedback ignores completion after session changes or unmount', async () => {
  for (const invalidate of ['logout', 'cleanup']) {
    let resolve
    const h = identifierHarness({ clipboard: { writeText: () => new Promise(done => { resolve = done }) } })
    const result = h.state.copy()
    h[invalidate](); resolve(); await result
    assert.equal(h.state.feedback.value, '')
  }
})

test('repeated pending copy does not stack clipboard operations', async () => {
  let resolve, calls = 0
  const h = identifierHarness({ clipboard: { writeText: () => { calls++; return new Promise(done => { resolve = done }) } } })
  const firstAttempt = h.state.copy()
  await h.state.copy()
  assert.equal(calls, 1)
  resolve(); await firstAttempt; h.cleanup()
})

test('pages wire display-only labels and dates while actions, keys and filters retain raw identifiers', () => {
  const iot = read('views/conservation/IoTMonitoringView.vue')
  const alerts = read('views/conservation/ThreatAlertsView.vue')
  for (const source of [iot, alerts]) {
    assert.match(source, /monitoringDate\(value, locale.value\)/)
    assert.match(source, /<MonitoringIdentifier/)
    const { descriptor } = parse(source)
    assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename: 'monitoring.vue', id: 'monitoring' }).errors, [])
  }
  assert.match(iot, /query: \{ device: String\(device.sensor_id\) \}/)
  assert.match(iot, /query: \{ reading: String\(reading.reading_id\) \}/)
  assert.match(iot, /:key="String\(reading.reading_id\)"/)
  assert.match(alerts, /const id = selectedAlert.value.id/)
  assert.match(alerts, /await saveAlertResponse\(id, responseNote.value, responseStatus.value\)/)
  assert.match(alerts, /alert.createdAt.slice\(0, 10\) === date.value/)
  assert.match(alerts, /alert.deviceId === deviceQuery/)
  for (const [value, labels] of [['alert.readingId', 'readingLabels'], ['selectedAlert.readingId', 'readingLabels'], ['selectedAlert.cameraId', 'cameraLabels']]) assert.ok(alerts.includes(`:value="${value}" :labels="${labels}"`))
  assert.match(read('components/CameraMonitoringSection.vue'), /monitoringDate\(value, locale.value\)/)
})

test('copy control keeps accessible labels, focus ring, inline spacing and responsive full-ID fallback', () => {
  const source = read('components/conservation/MonitoringIdentifier.vue')
  assert.match(source, /:aria-label="t\('monitoringDisplay.copy'/)
  assert.match(source, /role="status"/)
  assert.match(source, /gap: 7px/)
  assert.match(source, /align-items: center; justify-content: flex-start/)
  assert.match(source, /height: 44px/)
  assert.match(source, /:focus-visible/)
  assert.match(source, /overflow-wrap: anywhere/)
  assert.doesNotMatch(source, /:hover|fetch\(|api\(/)
  for (const locale of ['en', 'ms', 'zh-CN']) {
    const entries = JSON.parse(read(`locales/${locale}.json`)).monitoringDisplay
    assert.ok(entries.copy.includes('{id}'))
    assert.ok(entries.copied && entries.copyUnavailable)
    assert.doesNotMatch(entries.copy, /\?\?/)
  }
})
