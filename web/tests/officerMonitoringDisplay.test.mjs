import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import * as Vue from 'vue'
import ts from 'typescript'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { monitoringDate, monitoringLabels, reviewDateTime, submitterIdentifierLabels } from '../src/utils/officerMonitoringDisplay.ts'

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

test('review modal dates use numeric day-first Kuching time and the existing safe date contract', () => {
  for (const [value, expected] of [
    ['2026-11-04T13:28:00Z', '4 Nov 2026, 21:28'],
    ['2026-11-04T17:18:00Z', '5 Nov 2026, 01:18'],
    ['2026-11-05T01:18:00+08:00', '5 Nov 2026, 01:18'],
    ['2026-12-31T16:00:00Z', '1 Jan 2027, 00:00'],
    ['2026-11-04', '4 Nov 2026'],
  ]) assert.equal(reviewDateTime(value), expected)
  for (const value of [null, undefined, '', 'invalid', '2026-02-30T00:00:00Z', '2026-11-05T25:00:00Z', '2026-11-05T01:18:00']) assert.equal(reviewDateTime(value), '—')
})

test('submitter labels preserve prefixes and UUID case, distinguish collisions and handle missing/unknown IDs', () => {
  const id = 'staff:2ace382f-1737-463a-aff1-8e4b88308d04'
  assert.equal(submitterIdentifierLabels([id]).get(id), 'staff:2ace382f…')
  const other = 'staff:2ace382f-2222-463a-aff1-8e4b88308d04'
  const labels = submitterIdentifierLabels([id, other, 'unknown', '', null, undefined])
  assert.notEqual(labels.get(id), labels.get(other))
  assert.ok(labels.get(id).startsWith('staff:2ace382f'))
  assert.equal(labels.get('unknown'), 'unknown')
  assert.equal(labels.has(''), false)
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
  let timerId = 0
  const timers = new Map()
  let session = { pending: false, user: { id: 'officer', role: authorized ? 'Conservation Officer' : 'Botanist', status: 'Active', mustChangePassword: false } }
  const context = { exports: {}, navigator: { clipboard }, Error, setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback: () => { timers.delete(id); callback() }, delay }); return id }, clearTimeout: id => timers.delete(id), require(name) {
    if (name === 'vue') return { ...Vue, watch: (...args) => Vue.watch(...args), onBeforeUnmount: fn => { cleanup = fn } }
    if (name === 'vue-i18n') return { useI18n: () => ({ t: key => key }) }
    if (name.includes('/auth')) return { sessionSnapshot: () => session, subscribeSession: fn => { listener = fn; return () => {} } }
    throw Error(name)
  } }
  vm.runInNewContext(code, context)
  const props = Vue.reactive({ value: first, labels: monitoringLabels([first, second]) })
  const state = context.exports.default.setup(props, { expose() {} })
  return { state, props, timers, cleanup: () => cleanup(), logout: () => { session = { pending: false, user: null }; listener() } }
}

test('reading title success feedback expires after three seconds and timers reset on recopy, logout and close', async () => {
  const h = identifierHarness({ clipboard: { writeText: async () => {} } })
  h.props.feedbackDuration = 3000
  try {
    await h.state.copy()
    assert.equal(h.state.feedback.value, 'monitoringDisplay.copied')
    assert.equal(h.timers.size, 1)
    const [firstId, firstTimer] = [...h.timers][0]
    assert.equal(firstTimer.delay, 3000)
    await h.state.copy()
    assert.equal(h.timers.has(firstId), false)
    firstTimer.callback()
    assert.equal(h.state.feedback.value, 'monitoringDisplay.copied')
    const timer = [...h.timers.values()][0]
    timer.callback()
    assert.equal(h.state.feedback.value, '')
    await h.state.copy(); h.logout()
    assert.equal(h.timers.size, 0)
    assert.equal(h.state.feedback.value, '')
  } finally { h.cleanup() }
  const closing = identifierHarness({ clipboard: { writeText: async () => {} } })
  closing.props.feedbackDuration = 3000
  await closing.state.copy(); closing.cleanup()
  assert.equal(closing.timers.size, 0)
  const failed = identifierHarness()
  failed.props.feedbackDuration = 3000
  await failed.state.copy()
  assert.equal(failed.timers.size, 0)
  assert.equal(failed.state.feedback.value, 'monitoringDisplay.copyUnavailable')
  failed.cleanup()
})

test('copy writes the exact full ID and supplies copied feedback, not the label', async () => {
  const copied = []
  const h = identifierHarness({ clipboard: { writeText: async value => copied.push(value) } })
  assert.equal(h.state.shortened.value, true)
  await h.state.copy()
  assert.deepEqual(copied, [first])
  assert.equal(h.state.feedback.value, 'monitoringDisplay.copied')
  h.cleanup()
})

test('submitter copy preserves the complete staff prefix and only reports success after clipboard completion', async () => {
  const id = 'staff:2ace382f-1737-463a-aff1-8e4b88308d04', copied = []
  let resolve
  const h = identifierHarness({ clipboard: { writeText: value => { copied.push(value); return new Promise(done => { resolve = done }) } } })
  h.props.value = id; h.props.labels = submitterIdentifierLabels([id]); await Vue.nextTick()
  try {
    assert.equal(h.state.label.value, 'staff:2ace382f…')
    const work = h.state.copy()
    assert.equal(h.state.feedback.value, '')
    assert.deepEqual(copied, [id])
    resolve(); await work
    assert.equal(h.state.feedback.value, 'monitoringDisplay.copied')
  } finally { h.cleanup() }
  const failed = identifierHarness({ clipboard: { writeText: async () => { throw Error('denied') } } })
  failed.props.value = id; failed.props.labels = submitterIdentifierLabels([id]); await Vue.nextTick()
  try {
    await failed.state.copy()
    assert.equal(failed.state.raw.value, id)
    assert.equal(failed.state.failed.value, true)
    assert.equal(failed.state.feedback.value, 'monitoringDisplay.copyUnavailable')
  } finally { failed.cleanup() }
})

test('reading-title copy retains full-ID behavior, pending feedback and accessible keyboard button', async () => {
  let resolve
  const copied = []
  const h = identifierHarness({ clipboard: { writeText: value => { copied.push(value); return new Promise(done => { resolve = done }) } } })
  const source = read('components/conservation/MonitoringIdentifier.vue')
  const { descriptor } = parse(source)
  const script = compileScript(descriptor, { id: 'reading-title-copy' })
  const template = compileTemplate({ source: descriptor.template.content, filename: 'MonitoringIdentifier.vue', id: 'reading-title-copy', compilerOptions: { bindingMetadata: script.bindings } })
  const context = { exports: {}, require: name => { if (name === 'vue') return Vue; throw Error(name) } }
  const compiled = ts.transpileModule(template.code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(compiled, context)
  h.props.copyLabel = 'Copy full Reading ID'
  const flatten = root => {
    const out = []
    const walk = n => { if (Array.isArray(n)) return n.forEach(walk); if (!n || typeof n !== 'object') return; out.push(n); if (Array.isArray(n.children)) walk(n.children) }
    walk(root); return out
  }
  const render = () => flatten(context.exports.render({}, [], h.props, Vue.proxyRefs(h.state), {}, {}))
  try {
    const button = render().find(n => n.type === 'button')
    assert.equal(button.props.type, 'button')
    assert.equal(button.props['aria-label'], 'Copy full Reading ID')
    assert.equal(button.props.disabled, false)
    const work = button.props.onClick({ stopPropagation() {} })
    assert.equal(h.state.feedback.value, '')
    assert.deepEqual(copied, [first])
    assert.notEqual(copied[0], h.state.label.value)
    resolve(); await work
    assert.equal(h.state.feedback.value, 'monitoringDisplay.copied')
    assert.ok(render().some(n => n.props?.role === 'status' && n.children === 'monitoringDisplay.copied'))
    assert.match(descriptor.styles[0].content, /\.monitoring-id-copy:focus-visible/)
  } finally { h.cleanup() }
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
    if (source === iot) assert.match(source, /const dt = iotDate/)
    else assert.match(source, /monitoringDate\(value, locale.value\)/)
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
  assert.match(source, /:aria-label="copyLabel \|\| t\('monitoringDisplay.copy'/)
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
