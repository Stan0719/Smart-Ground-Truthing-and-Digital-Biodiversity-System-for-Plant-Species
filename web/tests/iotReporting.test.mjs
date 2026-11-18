import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { Chart as RealChart, registerables as realRegisterables } from 'chart.js'
import { parse, compileScript, compileTemplate, compileStyle } from '@vue/compiler-sfc'
import * as reporting from '../src/services/reporting.ts'
import { reportCsv, reportFilename } from '../src/utils/reportExport.ts'
import { iotBucketLabel, iotAxisLabel, iotDate, iotTimestamp, iotVisibleTickIndexes } from '../src/utils/iotBucketDisplay.ts'
const read = path => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')
const apiContext = { exports: {}, URLSearchParams, AbortSignal, Error, Date, Number, fetch: (...args) => globalThis.fetch(...args), require: () => reporting }
vm.runInNewContext(ts.transpileModule(read('services/iotReporting.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, apiContext)
const { validIoTSummary, requestIoTSummary, measurementUnits } = apiContext.exports
const filters = { period: 'custom', start: '2026-11-01', end: '2026-11-01' }
const statistics = { receivedRows: 3, validMeasurements: 2, missingMeasurements: 1, absentOrNullMeasurements: 1, invalidMeasurements: 0, average: 0, minimum: -2, maximum: 2 }
function fixture(metric = 'temperature') {
  const stats = metric === 'movement' ? { ...statistics, average: .5, minimum: 0, maximum: 1, detectedSampleCount: 1, noMovementSampleCount: 1 } : statistics
  return { contractVersion: 1, category: 'iot', complete: true, generatedAt: '2026-11-15T04:00:00Z', device: { id: 'sensor', name: 'Sensor One' }, measurement: { key: metric, unit: measurementUnits[metric] }, scope: { ...filters, startDate: filters.start, endDate: filters.end, timezone: 'Asia/Kuala_Lumpur', timestampBasis: 'sensor_reading.created_at', asOf: '2026-11-15T04:00:00Z', startInclusive: '2026-10-31T16:00:00Z', endExclusive: '2026-11-01T16:00:00Z', effectiveStartInclusive: '2026-10-31T16:00:00Z', effectiveEndExclusive: '2026-11-01T16:00:00Z' }, aggregation: { interval: 'day', step: 1, maximumBuckets: 520, bucketCount: 1, emptyBucketsIncluded: true }, summary: { ...stats }, buckets: [{ ...stats, startInclusive: '2026-10-31T16:00:00Z', endExclusive: '2026-11-01T16:00:00Z' }], observedSpan: { firstReceivedAt: '2026-10-31T16:00:00Z', lastReceivedAt: '2026-10-31T17:00:00Z', firstValidAt: '2026-10-31T16:00:00Z', lastValidAt: '2026-10-31T17:00:00Z' }, limitations: ['receipt_time_not_capture_time', 'missing_counts_apply_to_received_rows', 'expected_sampling_schedule_unavailable', 'availability_not_calculated', 'sample_weighted_average', 'uncalibrated_raw_units'] }
}
test('strict response validation preserves zero/negative values and authoritative units for all six metrics', () => {
  for (const key of Object.keys(measurementUnits)) assert.ok(validIoTSummary(fixture(key), filters, 'sensor', key))
  for (const mutate of [r => r.complete = false, r => r.contractVersion = 2, r => r.device.id = 'other', r => r.measurement.unit = 'mm', r => r.summary.average = NaN, r => r.summary.missingMeasurements = 0, r => r.buckets = Array(521).fill(r.buckets[0]), r => r.scope.timezone = 'UTC', r => r.buckets[0].startInclusive = 'bad', r => r.buckets[0].validMeasurements = 1]) {
    const r = fixture(); mutate(r); assert.equal(validIoTSummary(r, filters, 'sensor', 'temperature'), false)
  }
})
test('empty/null buckets are valid without manufacturing measurements', () => {
  const r = fixture()
  for (const stats of [r.summary, r.buckets[0]]) Object.assign(stats, { receivedRows: 0, validMeasurements: 0, missingMeasurements: 0, absentOrNullMeasurements: 0, invalidMeasurements: 0, average: null, minimum: null, maximum: null })
  assert.ok(validIoTSummary(r, filters, 'sensor', 'temperature'))
})
test('transport sends versioned summary path with exact custom dates, device and metric; maps structured failures', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async (url, init) => {
      const u = new URL(url, 'http://offline.test'); assert.equal(u.pathname, '/api/data/reports/iot-summary')
      for (const [key, value] of Object.entries({ contractVersion: '1', device: 'sensor', measurement: 'humidity', interval: 'auto', ...filters })) assert.equal(u.searchParams.get(key), value)
      assert.equal(init.credentials, 'same-origin'); return Response.json(fixture('humidity'))
    }
    assert.equal((await requestIoTSummary(filters, 'sensor', 'humidity')).measurement.unit, '%')
    for (const [status, code] of [[401, 'unauthorized'], [403, 'unauthorized'], [422, 'limit'], [400, 'invalidRequest'], [503, 'unavailable']]) {
      globalThis.fetch = async () => Response.json({ error: { code: 'SERVER_CODE' } }, { status })
      await assert.rejects(requestIoTSummary(filters, 'sensor', 'temperature'), e => e.code === code)
    }
    globalThis.fetch = async () => Response.json({})
    await assert.rejects(requestIoTSummary(filters, 'sensor', 'temperature'), e => e.code === 'invalidResponse')
  } finally { globalThis.fetch = original }
})
const transpile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function harness(responder = async (_filters, _device, metric) => fixture(metric), language = 'en') {
  const filename = 'components/conservation/IoTEnvironmentalReport.vue', { descriptor } = parse(read(filename))
  const script = compileScript(descriptor, { id: 'iot-summary' })
  const template = compileTemplate({ source: descriptor.template.content, filename, id: 'iot-summary', compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  const messages = JSON.parse(read(`locales/${language}.json`)), locale = vue.ref(language), calls = [], models = [], saves = []
  const resolve = key => key.split('.').reduce((v, k) => v?.[k], messages)
  let cleanup
  const downloads = [], revoked = []
  let blob, downloadName
  const context = { exports: {}, Intl, AbortController, Error, Blob, setTimeout: fn => fn(),
    URL: { createObjectURL: value => { blob = value; return 'blob:summary' }, revokeObjectURL: value => revoked.push(value) },
    document: { body: { appendChild() {} }, createElement: () => ({ set href(value) {}, set download(value) { downloadName = value }, click() { downloads.push({ blob, filename: downloadName }) }, remove() {} }) },
    require(name) {
    if (name === 'vue') return { ...vue, onBeforeUnmount: fn => cleanup = fn, resolveComponent: name => name, withDirectives: node => node }
    if (name === 'vue-i18n') return { useI18n: () => ({ t: (key, params = {}) => (resolve(key) || key).replace(/\{(\w+)\}/g, (_, name) => params[name] ?? `{${name}}`), te: key => !!resolve(key), locale }) }
    if (name === 'jspdf') return { jsPDF: class { save(name) { saves.push(name) } } }
    if (name.includes('iotMonitoring')) return { loadCanonicalDevices: async () => [{ sensor_id: 'sensor', device_name: 'Sensor One' }, { sensor_id: 'second', device_name: 'Second' }] }
    if (name.includes('iotReporting')) return { measurementUnits, IoTReportError: class extends Error {}, requestIoTSummary: async (...args) => { calls.push(args); return responder(...args) } }
    if (name.includes('officerMonitoringDisplay')) return { monitoringDate: (date, lang) => new Intl.DateTimeFormat(lang, { timeZone: 'Asia/Kuala_Lumpur', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(date)) }
    if (name.includes('iotBucketDisplay')) return { iotBucketLabel, iotAxisLabel, iotDate, iotTimestamp, iotVisibleTickIndexes }
    if (name.includes('reportExport')) return { renderReportPdf: async model => { models.push(model); return true }, reportCsv, reportFilename }
    if (name.endsWith('.vue')) return { name }
    if (name.includes('officerDropdown')) return { vOfficerDropdown: {} }
    throw Error(name)
  } }
  vm.runInNewContext(`(function(){${transpile(script.content)}})()`, context)
  const props = vue.reactive({ filters: { ...filters } }), scope = vue.effectScope()
  const state = scope.run(() => context.exports.default.setup(props, { expose() {}, emit() {} }))
  state.chart.value = { toPrintDataUrl: async () => 'data:image/png;base64,mock' }
  vm.runInNewContext(`(function(){${transpile(template.code)}})()`, context)
  return { state, props, locale, calls, models, saves, downloads, revoked, render: () => context.exports.render({}, [], props, vue.proxyRefs(state), {}, {}), stop() { cleanup(); scope.stop() } }
}
const flush = async () => { await vue.nextTick(); await new Promise(resolve => setImmediate(resolve)); await vue.nextTick() }
function nodes(root) { const result = []; function walk(v) { if (Array.isArray(v)) return v.forEach(walk); if (!v || typeof v !== 'object') return; result.push(v); if (Array.isArray(v.children)) walk(v.children) } walk(root); return result }
test('rendered report has four cards, seven columns, honest CSV, quality explanations and bounded PDF', async () => {
  const h = harness(); await flush()
  const tree = nodes(h.render())
  assert.equal(tree.filter(n => n.props?.class === 'iot-card').length, 4)
  assert.equal(tree.filter(n => n.type === 'th').length, 7)
  assert.ok(tree.some(n => n.type === 'button' && n.props?.disabled === false && n.props?.['aria-describedby'] === 'iot-csv-note'))
  assert.equal(h.state.report.value.summary.average, 0)
  assert.ok(h.state.technicalRows.value.some(s => s.value.includes('never arrived')))
  await h.state.exportPdf()
  assert.equal(h.models.length, 1); assert.equal(h.models[0].statistics.length, 4); assert.equal(h.models[0].rows.length, 1)
  assert.equal(h.models[0].columns.length, 7); assert.equal(h.models[0].chart.length, 2)
  assert.ok(h.models[0].notes.some(c => c.value.includes('Sensor availability has not been verified.')))
  assert.ok(!h.models[0].notes.some(c => c.value.includes('never arrived')))
  assert.equal(h.saves.length, 1); h.stop()
})
test('selection, filters, stale results, errors and stale PDF language changes', async () => {
  let pending
  const h = harness(async (...args) => pending ? await pending : fixture(args[2])); await flush()
  h.state.measurement.value = 'humidity'; await h.state.load(); assert.equal(h.calls.at(-1)[2], 'humidity')
  let resolve
  pending = new Promise(r => resolve = r)
  const old = h.state.load(); await flush()
  pending = null; h.state.measurement.value = 'rainfall'; await h.state.load()
  resolve(fixture('humidity')); await old; assert.equal(h.state.report.value.measurement.key, 'rainfall')
  h.props.filters = { period: 'all-time' }; await flush(); assert.equal(h.calls.at(-1)[0].period, 'all-time')
  let finish
  h.state.chart.value = { toPrintDataUrl: () => new Promise(r => finish = r) }
  const exportPending = h.state.exportPdf(); await flush(); h.locale.value = 'ms'; finish('mock'); await exportPending
  assert.equal(h.saves.length, 0); h.stop()
  const failed = harness(async () => { throw Error('offline') }); await flush()
  assert.equal(failed.state.report.value, null); assert.equal(failed.state.error.value, 'unavailable'); failed.stop()
})
test('all locales, six metrics, dual series, null gaps, responsive containment and category isolation', async () => {
  for (const lang of ['en', 'ms', 'zh-CN']) {
    const h = harness(undefined, lang); await flush(); assert.ok(!h.state.text('title').includes('iotSummary.'))
    for (const code of fixture().limitations) assert.ok(!h.state.text(`limitations.${code}`).includes('iotSummary.'))
    assert.ok(!h.state.text('title').includes('?')); h.stop()
  }
  const chart = read('components/conservation/IoTSummaryChart.vue')
  assert.match(chart, /\['average', 'maximum'\]/); assert.match(chart, /spanGaps: false/); assert.match(chart, /tension: 0/); assert.match(chart, /position: 'bottom'/)
  for (const file of ['IoTSummaryChart.vue', 'IoTEnvironmentalReport.vue']) {
    const { descriptor } = parse(read('components/conservation/' + file))
    assert.deepEqual(compileStyle({ source: descriptor.styles[0].content, filename: file, id: 'summary' }).errors, [])
  }
  const source = read('components/conservation/IoTEnvironmentalReport.vue')
  assert.match(source, /overflow-x: auto/); assert.match(source, /@container/)
  assert.doesNotMatch(source, /requestOperationalReport|threshold|Last 7 Days/)
  const parent = read('views/conservation/ReportsView.vue')
  assert.match(parent, /IoTEnvironmentalReport v-if="reportType === 'iot-summary'"/)
  assert.match(parent, /OperationalReport v-else-if="reportType !== 'species-approved'"/)
})

test('quality summary handles all-valid, missing, no records, no valid values and unavailable dates in every locale', async () => {
  for (const lang of ['en', 'ms', 'zh-CN']) {
    const h = harness(undefined, lang); await flush()
    const originalCards = JSON.stringify(h.state.cards.value), originalRows = JSON.stringify(h.state.rows.value)
    assert.ok(h.state.qualitySummary.value.includes(h.state.format(3)))
    assert.ok(h.state.qualitySummary.value.includes(h.state.metricLabel('temperature')))
    assert.doesNotMatch(h.state.qualitySummary.value, /\{\w+\}/)
    assert.equal(JSON.stringify(h.state.cards.value), originalCards); assert.equal(JSON.stringify(h.state.rows.value), originalRows)
    h.state.report.value.observedSpan.firstReceivedAt = null
    h.state.report.value.observedSpan.lastReceivedAt = null
    assert.ok(!h.state.qualitySummary.value.includes('2026'))
    Object.assign(h.state.report.value.summary, { receivedRows: 15175, validMeasurements: 15175, missingMeasurements: 0 })
    assert.ok(h.state.qualitySummary.value.includes(h.state.format(15175)))
    h.state.report.value.measurement.key = 'humidity'
    assert.ok(h.state.qualitySummary.value.includes(h.state.metricLabel('humidity')))
    Object.assign(h.state.report.value.summary, { receivedRows: 3, validMeasurements: 0, missingMeasurements: 3 })
    assert.ok(h.state.qualitySummary.value.includes(h.state.format(3)))
    h.state.report.value.summary.receivedRows = 0
    assert.equal(h.state.qualitySummary.value, h.state.text('qualityNoRecords'))
    const tree = nodes(h.render()), disclosure = tree.find(n => n.type === 'details')
    assert.ok(disclosure); assert.ok(!disclosure.props?.open)
    assert.ok(tree.some(n => n.type === 'summary' && Array.isArray(n.children)))
    const model = h.state.exportDocument()
    assert.equal(model.notes[0].value, `${h.state.qualitySummary.value}\n${h.state.text('qualityEssential')}`)
    assert.ok(!model.notes[0].value.includes(h.state.text('receiptTime')))
    h.stop()
  }
  const source = read('components/conservation/IoTEnvironmentalReport.vue')
  assert.match(source, /summary:focus-visible/)
  assert.doesNotMatch(source, /<details[^>]*\sopen(?:\s|>)/)
  // Native details/summary provides browser Enter/Space toggling and expanded
  // semantics; no custom key handler or competing aria-expanded is installed.
  assert.match(source, /<details class="quality-details"><summary>/)
  assert.doesNotMatch(source, /100% uptime|uninterrupted monitoring/)
})

test('reference quality panel has two real badges, five definition rows and neutral empty styling', async () => {
  for (const lang of ['en', 'ms', 'zh-CN']) {
    const h = harness(undefined, lang); await flush()
    let tree = nodes(h.render())
    const badges = tree.filter(n => n.type === 'span' && (Array.isArray(n.props?.class) ? n.props.class.includes('quality-badge') : String(n.props?.class).includes('quality-badge')))
    assert.equal(badges.length, 2)
    assert.ok(badges[0].children.includes(h.state.format(2))); assert.ok(badges[1].children.includes(h.state.format(1)))
    assert.equal(tree.filter(n => n.type === 'dt').length, 5)
    assert.equal(h.state.technicalRows.value.length, 5)
    assert.ok(h.state.qualityDescription.value.includes(h.state.metricLabel('temperature')))
    const pdfBefore = h.state.exportDocument().notes[0].value
    assert.ok(!h.state.qualityDescription.value.includes(h.state.format(3)))
    h.state.report.value.summary.validMeasurements = 0; h.state.report.value.summary.receivedRows = 0
    tree = nodes(h.render())
    const validBadge = tree.find(n => n.type === 'span' && String(n.props?.class).includes('quality-badge'))
    assert.ok(!String(validBadge.props.class).includes('quality-badge-valid'))
    assert.equal(h.state.qualityDescription.value, h.state.text('qualityNoRecords'))
    assert.ok(pdfBefore.includes(h.state.text('qualityEssential')))
    h.stop()
  }
  const source = read('components/conservation/IoTEnvironmentalReport.vue')
  assert.match(source, /\.iot-quality \{ background: #fff;/)
  assert.match(source, /\[open\] \.quality-chevron/)
  assert.match(source, /summary:hover/)
})

test('bucket dates use Malaysia calendar boundaries, 24-hour hours and complete weekly ranges', () => {
  const bucket = (start, end) => ({ startInclusive: start, endExclusive: end })
  for (const locale of ['en', 'ms', 'zh-CN']) {
    const hour = bucket('2026-11-03T16:00:00Z', '2026-11-03T17:00:00Z')
    const hourly = iotBucketLabel(hour, 'hour', locale, 'Asia/Kuala_Lumpur')
    assert.match(hourly, /00:00/); assert.doesNotMatch(hourly, /AM|PM|24:00/i)
    const daily = iotBucketLabel(hour, 'day', locale, 'Asia/Kuala_Lumpur', true)
    assert.ok(daily.includes('04') || daily.includes('4日')); assert.doesNotMatch(daily, /\d\d:\d\d/)
    const weekly = bucket('2026-11-01T16:00:00Z', '2026-11-08T16:00:00Z')
    assert.equal(iotBucketLabel(weekly, 'week', locale, 'Asia/Kuala_Lumpur', true), `02–${iotDate('2026-11-08T15:59:59.999Z', locale, 'Asia/Kuala_Lumpur')}`)
    for (const end of ['2026-11-04T16:00:00Z', '2026-11-15T16:00:00Z']) {
      const partialOrMulti = { ...weekly, endExclusive: end }
      assert.equal(iotBucketLabel(partialOrMulti, 'week', locale, 'Asia/Kuala_Lumpur', true), `02–${iotDate(new Date(Date.parse(end) - 1).toISOString(), locale, 'Asia/Kuala_Lumpur')}`)
    }
    assert.match(iotBucketLabel(hour, 'hour', locale, 'Asia/Kuala_Lumpur', true), /00:00.*01:00/)
  }
})

test('IoT dates use explicit day-month-year and h23 consistently in header, quality, table and PDF', async () => {
  const instant = '2026-11-04T00:30:00Z', zone = 'Asia/Kuala_Lumpur'
  assert.equal(iotTimestamp(instant, 'en', zone), '04 Nov 2026, 08:30')
  assert.equal(iotBucketLabel({ startInclusive: instant, endExclusive: '2026-11-04T01:30:00Z' }, 'hour', 'en', zone), '04 Nov, 08:30')
  for (const locale of ['en', 'ms', 'zh-CN']) {
    const month = new Intl.DateTimeFormat(locale, { timeZone: zone, month: 'short' }).format(new Date(instant))
    assert.equal(iotDate(instant, locale, zone), `04 ${month} 2026`)
    assert.equal(iotTimestamp(instant, locale, zone), `04 ${month} 2026, 08:30`)
    assert.match(iotTimestamp('2026-11-03T16:00:00Z', locale, zone), /, 00:00$/)
    const h = harness(undefined, locale); await flush()
    const generated = iotTimestamp(fixture().generatedAt, locale, zone)
    assert.equal(h.state.date(fixture().generatedAt), generated)
    assert.ok(h.state.exportDocument().generatedLabel.endsWith(generated))
    assert.ok(h.state.qualityDescription.value.includes(iotTimestamp(fixture().observedSpan.firstReceivedAt, locale, zone)))
    assert.ok(h.state.technicalRows.value[1].value.includes('00:00'))
    assert.equal(h.state.exportDocument().period, h.state.period.value)
    assert.doesNotMatch(h.state.rows.value[0][0], /\d\d:\d\d/)
    assert.ok(h.state.rows.value[0][0].endsWith('2026'))
    h.stop()
  }
})

test('chart categories are equally spaced ordered buckets with compact labels and full table/PDF details', async () => {
  const buckets = Array.from({ length: 520 }, (_, index) => ({ startInclusive: new Date(Date.UTC(2026, 0, 1, index)).toISOString(), endExclusive: new Date(Date.UTC(2026, 0, 1, index + 1)).toISOString() }))
  for (const locale of ['en', 'ms', 'zh-CN']) {
    for (const interval of ['hour', 'day', 'week']) {
      const label = iotAxisLabel(buckets[0], interval, locale, 'Asia/Kuala_Lumpur')
      assert.doesNotMatch(label, /2026/)
      assert.ok(iotBucketLabel(buckets[0], interval, locale, 'Asia/Kuala_Lumpur', true).includes('2026'))
    }
  }
  assert.equal(iotAxisLabel({startInclusive:'2026-11-13T16:00:00Z',endExclusive:'2026-11-14T16:00:00Z'}, 'day', 'en', 'Asia/Kuala_Lumpur'), '14 Nov')
  const source = read('components/conservation/IoTSummaryChart.vue')
  assert.match(source, /type: 'category'/); assert.match(source, /autoSkip: false/)
  assert.match(source, /align: movement \? 'center' : 'inner'/); assert.match(source, /x: bucketIndex/)
  assert.doesNotMatch(source, /x: Date.parse/)
  assert.match(source, /y: b\[key\]/); assert.match(source, /spanGaps: false/)
  assert.match(source, /return printChart\(config\)/)
  const h = harness(); await flush()
  assert.equal(h.state.rows.value[0][0], iotBucketLabel(fixture().buckets[0], 'day', 'en', 'Asia/Kuala_Lumpur', true))
  assert.equal(h.state.exportDocument().displayRows[0][0], h.state.rows.value[0][0]); h.stop()
})

test('responsive tick selection retains endpoints without overlapping intermediate labels', () => {
  assert.deepEqual(iotVisibleTickIndexes([], 300), [])
  assert.deepEqual(iotVisibleTickIndexes([45], 300), [0])
  for (const count of [2, 5, 7, 11, 12, 13, 24, 30, 90, 120, 365, 520]) {
    for (const width of [240, 320, 600, 768, 1000, 1024, 1440]) {
      for (const labelWidth of [42, 85, 100]) {
        const widths = Array(count).fill(labelWidth), visible = iotVisibleTickIndexes(widths, width)
        assert.equal(visible[0], 0); assert.equal(visible.at(-1), count - 1)
        assert.equal(new Set(visible).size, visible.length)
        if (count > 31) assert.ok(visible.length <= 10)
        const boxes = visible.map(index => index === 0 ? [0, labelWidth] : index === count - 1 ? [width - labelWidth, width] : [index * width / (count - 1) - labelWidth / 2, index * width / (count - 1) + labelWidth / 2])
        boxes.forEach(([left, right], index) => { assert.ok(left >= 0 && right <= width); if (index) assert.ok(left >= boxes[index - 1][1] + 12) })
      }
    }
  }
  assert.deepEqual(iotVisibleTickIndexes(Array(12).fill(42), 1000), Array.from({ length: 12 }, (_, i) => i))
  assert.ok(iotVisibleTickIndexes(Array(12).fill(42), 240).length < iotVisibleTickIndexes(Array(12).fill(42), 1000).length)
  const dates = Array.from({ length: 12 }, (_, i) => ({ startInclusive: new Date(Date.UTC(2026, 10, 3 + i, 16)).toISOString(), endExclusive: new Date(Date.UTC(2026, 10, 4 + i, 16)).toISOString() }))
  const visible = iotVisibleTickIndexes(Array(12).fill(42), 320)
  assert.equal(iotAxisLabel(dates[visible[0]], 'day', 'en', 'Asia/Kuala_Lumpur'), '04 Nov')
  assert.equal(iotAxisLabel(dates[visible.at(-1)], 'day', 'en', 'Asia/Kuala_Lumpur'), '15 Nov')
})

function chartHarness(report) {
  const { descriptor } = parse(read('components/conservation/IoTSummaryChart.vue'))
  const script = compileScript(descriptor, { id: 'adaptive-iot-chart' })
  let printConfig
  const context = { exports: {}, Intl, Math, Number, Set, require(name) {
    if (name === 'vue') return { ...vue, onBeforeUnmount() {} }
    if (name === 'vue-i18n') return { useI18n: () => ({ locale: vue.ref('en'), t: key => key.split('.').at(-1) }) }
    if (name === 'chart.js') return { Chart: class { static register() {} static defaults = { font: { size: 12, family: 'sans-serif' } } }, registerables: [] }
    if (name.includes('iotBucketDisplay')) return { iotTimestamp, iotAxisLabel, iotVisibleTickIndexes }
    if (name.includes('reportExport')) return { printChart: async config => { printConfig = config; return 'mock-png' } }
    throw Error(name)
  } }
  vm.runInNewContext(`(function(){${transpile(script.content)}})()`, context)
  const scope = vue.effectScope(), exposed = {}
  const state = scope.run(() => context.exports.default.setup({ report }, { expose: value => Object.assign(exposed, value) }))
  const template = compileTemplate({ source: descriptor.template.content, filename: 'IoTSummaryChart.vue', id: 'adaptive-iot-chart', compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  vm.runInNewContext(`(function(){${transpile(template.code)}})()`, context)
  return { state, exposed, printed: () => printConfig, render: () => context.exports.render({}, [], { report }, vue.proxyRefs(state), {}, {}), stop: () => scope.stop() }
}

test('actual chart configurations preserve every bucket, null and spike across website and print', async () => {
  for (const count of [0, 1, 2, 7, 12, 30, 90, 365, 520]) {
    const report = fixture()
    report.buckets = Array.from({ length: count }, (_, index) => ({ ...statistics, startInclusive: new Date(Date.UTC(2026, 10, 3 + index, 16)).toISOString(), endExclusive: new Date(Date.UTC(2026, 10, 4 + index, 16)).toISOString(), average: index % 4 === 2 ? null : index, maximum: index % 4 === 2 ? null : index === 3 ? 999 : index + 1, validMeasurements: index % 4 === 2 ? 0 : 2 }))
    const h = chartHarness(report), config = h.state.configuration()
    assert.equal(config.data.labels.length, count)
    for (const [series, key] of ['average', 'maximum'].entries()) {
      assert.deepEqual(Array.from(config.data.datasets[series].data, p => p.y), report.buckets.map(b => b[key]))
      assert.deepEqual(Array.from(config.data.datasets[series].data, p => p.x), Array.from({ length: count }, (_, i) => i))
      assert.equal(config.data.datasets[series].spanGaps, false)
    }
    const tickValues = (width, fontSize) => {
      let font = ''
      const scale = { width, chart: { options: { font: { size: fontSize, family: 'sans-serif' } } }, ctx: { save() {}, restore() {}, get font() { return font }, set font(v) { font = v }, measureText: value => ({ width: value.length * parseFloat(font) * .6 }) }, ticks: Array.from({ length: count }, (_, value) => ({ value })) }
      config.options.scales.x.afterBuildTicks(scale)
      return Array.from(scale.ticks, tick => tick.value)
    }
    for (const width of [240, 375, 768, 1024, 1440]) {
      const ticks = tickValues(width, 12)
      assert.equal(ticks.length, count === 0 ? 0 : ticks.length)
      if (count) { assert.equal(ticks[0], 0); assert.equal(ticks.at(-1), count - 1) }
      if (count > 31) assert.ok(ticks.length <= 10)
    }
    assert.ok(tickValues(1000, 16).length <= tickValues(1000, 12).length)
    await h.exposed.toPrintDataUrl()
    assert.deepEqual(h.printed().data, config.data)
    if (count) {
      assert.equal(config.options.plugins.tooltip.callbacks.title([{ dataIndex: 0 }]), `${iotTimestamp(report.buckets[0].startInclusive, 'en', report.scope.timezone)} – ${iotTimestamp(report.buckets[0].endExclusive, 'en', report.scope.timezone)}`)
      const event = key => ({ key, preventDefault() {} })
      h.state.inspectKey(event('End')); assert.equal(h.state.selectedIndex.value, count - 1)
      h.state.inspectKey(event('Home')); assert.equal(h.state.selectedIndex.value, 0)
      if (count > 2) {
        h.state.inspectKey(event('ArrowRight')); h.state.inspectKey(event('ArrowRight'))
        assert.equal(h.state.selectedIndex.value, 2); assert.ok(h.state.inspection.value.includes('noValid'))
      }
    }
    h.stop()
  }
})

test('IoT labels and interval wording use singular/multiple units consistently in website and PDF', async () => {
  for (const lang of ['en', 'ms', 'zh-CN']) {
    const h = harness(undefined, lang); await flush()
    assert.equal(h.state.headers.value[0], h.state.text('bucket'))
    assert.ok(h.state.exportDocument().generatedLabel.startsWith(h.state.text('reportGenerated') + ':'))
    for (const interval of ['hour', 'day', 'week']) for (const step of [1, 3]) {
      h.state.report.value.aggregation.interval = interval; h.state.report.value.aggregation.step = step
      assert.ok(!h.state.interval.value.includes('×'))
      assert.ok(!h.state.interval.value.includes('summarized_'))
      if (step > 1) assert.ok(h.state.interval.value.includes('3'))
      assert.equal(h.state.technicalRows.value[0].value, h.state.interval.value)
      assert.equal(h.state.exportDocument().context.at(-1).value, h.state.interval.value)
    }
    h.stop()
  }
  const zone = 'Asia/Kuala_Lumpur'
  assert.equal(iotBucketLabel({ startInclusive: '2026-11-04T00:00:00Z', endExclusive: '2026-11-04T01:00:00Z' }, 'hour', 'en', zone, true), '04 Nov 2026, 08:00–09:00')
  assert.equal(iotBucketLabel({ startInclusive: '2026-11-01T16:00:00Z', endExclusive: '2026-11-08T16:00:00Z' }, 'week', 'en', zone, true), '02–08 Nov 2026')
  assert.equal(iotBucketLabel({ startInclusive: '2026-11-30T16:00:00Z', endExclusive: '2026-12-01T00:00:00Z' }, 'hour', 'en', zone, true), '01 Dec 2026, 00:00–08:00')
  assert.equal(iotBucketLabel({ startInclusive: '2026-12-30T16:00:00Z', endExclusive: '2027-01-03T16:00:00Z' }, 'week', 'en', zone, true), '31 Dec 2026 – 03 Jan 2027')
})

test('Movement rejects missing, fractional or inconsistent authoritative counts', () => {
  for (const mutate of [r => delete r.summary.detectedSampleCount, r => r.summary.detectedSampleCount = .5, r => r.buckets[0].noMovementSampleCount = -1, r => r.summary.detectedSampleCount = 2, r => { r.buckets[0].detectedSampleCount = 2; r.buckets[0].noMovementSampleCount = 0 }]) {
    const r = fixture('movement'); mutate(r)
    assert.equal(validIoTSummary(r, filters, 'sensor', 'movement'), false)
  }
})

test('Movement cards, five-column table, quality caveat and PDF use backend counts in all locales', async () => {
  for (const language of ['en', 'ms', 'zh-CN']) {
    const h = harness(undefined, language); await flush()
    h.state.measurement.value = 'movement'; await h.state.load()
    assert.equal(h.state.isMovement.value, true)
    assert.deepEqual(Array.from(h.state.cards.value, c => c.key), ['validReadings', 'movementDetected', 'missingMeasurements', 'detectionRate'])
    assert.deepEqual(Array.from(h.state.cards.value, c => c.value), [2, 1, 1, 50])
    assert.equal(h.state.cards.value[3].unit, '%')
    assert.equal(h.state.headers.value.length, 5); assert.equal(h.state.rows.value[0].length, 5)
    assert.equal(h.state.rows.value[0][2], h.state.format(1))
    assert.equal(nodes(h.render()).filter(n => n.type === 'th').length, 5)
    for (const key of ['movementDetected', 'detectionRate', 'movementTrend', 'movementDetectedReadings', 'movementCaveat', 'detectionRateNote']) assert.ok(!h.state.text(key).includes('iotSummary.'))
    const pdf = h.state.exportDocument()
    assert.equal(pdf.columns.length, 5); assert.equal(pdf.statistics[3].value, 50)
    assert.equal(pdf.chart.length, 1); assert.equal(pdf.chart[0].value, 1)
    assert.ok(pdf.notes[0].value.includes(h.state.text('movementCaveat')))
    await h.state.exportPdf(); assert.equal(h.saves.length, 1)
    for (const detected of [0, 2]) {
      h.state.report.value.summary.detectedSampleCount = detected
      h.state.report.value.summary.noMovementSampleCount = 2 - detected
      assert.equal(h.state.cards.value[3].value, detected ? 100 : 0)
    }
    h.state.report.value.summary.validMeasurements = 0; h.state.report.value.summary.detectedSampleCount = 0
    assert.equal(h.state.cards.value[3].value, null)
    h.stop()
  }
})

test('Movement bars preserve valid-zero versus missing buckets, tooltip counts and print data', async () => {
  for (const length of [4, 520]) {
    const r = fixture('movement')
    r.buckets = Array.from({ length }, (_, i) => ({ ...r.buckets[0], startInclusive: new Date(Date.UTC(2026, 10, 1 + i)).toISOString(), endExclusive: new Date(Date.UTC(2026, 10, 2 + i)).toISOString(), detectedSampleCount: i % 4 === 0 ? 0 : i % 4 === 1 ? 2 : i % 4 === 2 ? 1 : 0, validMeasurements: i % 4 === 3 ? 0 : 2, missingMeasurements: i % 4 === 3 ? 3 : 0 }))
    const h = chartHarness(r), config = h.state.configuration()
    assert.equal(config.type, 'bar'); assert.equal(config.data.datasets.length, 1)
    assert.deepEqual(Array.from(config.data.datasets[0].data.slice(0, 4), p => p.y), [0, 2, 1, null])
    assert.equal(config.data.datasets[0].data.length, length)
    assert.equal(config.options.scales.y.beginAtZero, true); assert.equal(config.options.scales.y.ticks.precision, 0)
    assert.ok(config.options.plugins.tooltip.callbacks.afterBody([{ dataIndex: 3 }]).some(s => s.includes('3')))
    h.state.inspectKey({ key: 'Home', preventDefault() {} }); assert.ok(h.state.inspection.value.includes('movementDetectedReadings: 0'))
    h.state.selectedIndex.value = 3; assert.ok(h.state.inspection.value.includes('noValid'))
    await h.exposed.toPrintDataUrl(); assert.equal(h.printed().type, 'bar')
    assert.equal(h.printed().options.plugins.title.text, 'movementTrend')
    assert.deepEqual(h.printed().data, config.data); h.stop()
  }
  for (const metric of ['temperature', 'humidity', 'soilMoisture', 'rainfall']) {
    const h = chartHarness(fixture(metric)), config = h.state.configuration()
    assert.equal(config.type, 'line'); assert.equal(config.data.datasets.length, 2)
    assert.equal(config.data.datasets[0].borderColor, '#2c9148'); assert.equal(config.data.datasets[1].borderColor, '#f18418')
    h.stop()
    const page = harness(async () => fixture(metric)); await flush()
    assert.equal(page.state.headers.value.length, 7); assert.equal(page.state.cards.value[1].key, 'average'); page.stop()
  }
})

test('Movement colour priority, ties, zero counts, missing data and print legend remain accurate', async () => {
  const cases = [
    { values: [1, 5, 2], colors: ['#D0E4D5', '#E88936', '#245A46'] },
    { values: [1, 2, 5], colors: ['#D0E4D5', '#D0E4D5', '#E88936'], latestHighest: 2 },
    { values: [5, 1, 5], colors: ['#E88936', '#D0E4D5', '#E88936'], latestHighest: 2 },
    { values: [0, 0, 0], colors: ['#D0E4D5', '#D0E4D5', '#245A46'] },
    { values: [0, 0, null], colors: ['#D0E4D5', '#245A46', 'transparent'], fallback: 1 },
    { values: [1, 5, null], colors: ['#D0E4D5', '#E88936', 'transparent'] },
    { values: [null, null], colors: ['transparent', 'transparent'] },
    { values: [7], colors: ['#E88936'], latestHighest: 0 },
  ]
  for (const entry of cases) {
    const r = fixture('movement')
    r.buckets = entry.values.map((value, index) => ({ ...r.buckets[0], startInclusive: new Date(Date.UTC(2026, 10, 1 + index)).toISOString(), endExclusive: new Date(Date.UTC(2026, 10, 2 + index)).toISOString(), validMeasurements: value === null ? 0 : 10, detectedSampleCount: value ?? 0 }))
    const h = chartHarness(r), config = h.state.configuration()
    assert.deepEqual(Array.from(config.data.datasets[0].backgroundColor), entry.colors)
    assert.deepEqual(Array.from(config.data.datasets[0].data, p => p.y), entry.values)
    const legend = config.options.plugins.legend.labels.generateLabels()
    assert.deepEqual(Array.from(legend, item => item.text), ['otherPeriods', 'latestPeriod', 'highestDetectionCount'])
    assert.deepEqual(Array.from(legend, item => item.fillStyle), ['#D0E4D5', '#245A46', '#E88936'])
    if (entry.latestHighest !== undefined) {
      const tooltip = config.options.plugins.tooltip.callbacks.afterBody([{ dataIndex: entry.latestHighest }])
      assert.ok(tooltip.includes('latestPeriod')); assert.ok(tooltip.includes('highestDetectionCount'))
    }
    if (entry.fallback !== undefined) assert.ok(config.options.plugins.tooltip.callbacks.afterBody([{ dataIndex: entry.fallback }]).includes('latestValidPeriod'))
    if (entry.values.every(v => v === null || v === 0)) assert.ok(!h.state.movementHighlights.value.some(v => v.highest))
    await h.exposed.toPrintDataUrl()
    assert.deepEqual(h.printed().data, config.data)
    assert.deepEqual(h.printed().options.plugins.legend.labels.generateLabels(), legend)
    h.stop()
  }
  for (const language of ['en', 'ms', 'zh-CN']) {
    const h = harness(undefined, language); await flush()
    for (const key of ['otherPeriods', 'latestPeriod', 'latestValidPeriod', 'highestDetectionCount']) assert.ok(!h.state.text(key).includes('iotSummary.'))
    h.stop()
  }
})

test('real Chart.js keeps Movement bars and date ticks centered at desktop, tablet, mobile and print widths', async () => {
  RealChart.register(...realRegisterables)
  // The component harness runs in a VM. Chart.js option inheritance expects
  // plain objects in its own realm; retain functions while bridging containers.
  const hostOptions = value => Array.isArray(value) ? Array.from(value, hostOptions) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, hostOptions(entry)])) : value
  for (const count of [12, 13]) for (const width of [1440, 768, 375, 1000]) {
    const report = fixture('movement')
    report.buckets = Array.from({ length: count }, (_, index) => ({ ...report.buckets[0], startInclusive: new Date(Date.UTC(2026, 10, 3 + index, 16)).toISOString(), endExclusive: new Date(Date.UTC(2026, 10, 4 + index, 16)).toISOString(), detectedSampleCount: index % 3, validMeasurements: index === 2 ? 0 : 10 }))
    const h = chartHarness(report), config = hostOptions(h.state.configuration())
    config.options.responsive = false; config.options.animation = false
    if (width === 1000) { config.options.font = { size: 16 }; await h.exposed.toPrintDataUrl() }
    const canvas = { width, height: 340, style: {}, getContext: () => context }
    const context = new Proxy({ canvas, measureText: value => ({ width: String(value).length * (width === 1000 ? 9 : 7) }), getLineDash: () => [] }, { get: (target, key) => key in target ? target[key] : () => {}, set: (target, key, value) => { target[key] = value; return true } })
    const chart = new RealChart(canvas, config)
    try {
      h.state.chart = chart
      h.state.focusChart()
      assert.equal(chart.tooltip.getActiveElements()[0].index, 0)
      h.state.inspectKey({ key: 'End', preventDefault() {} })
      assert.equal(chart.tooltip.getActiveElements()[0].index, count - 1)
      h.state.blurChart(); assert.equal(chart.tooltip.getActiveElements().length, 0)
      const x = chart.scales.x, bars = chart.getDatasetMeta(0).data
      assert.equal(x.ticks.length, count, 'all category ticks remain, including hidden text')
      assert.ok(x.ticks[0].label); assert.ok(x.ticks.at(-1).label)
      assert.equal(x.options.ticks.align, 'center')
      const distance = x.getPixelForValue(1) - x.getPixelForValue(0)
      for (let i = 0; i < count; i++) {
        assert.ok(Math.abs(bars[i].x - x.getPixelForValue(i)) < .001)
        assert.ok(Math.abs(x.getPixelForTick(i) - bars[i].x) < .001)
        if (i) assert.ok(Math.abs(x.getPixelForValue(i) - x.getPixelForValue(i - 1) - distance) < .001)
        assert.equal(config.options.plugins.tooltip.callbacks.title([{ dataIndex: i }]), `${iotTimestamp(report.buckets[i].startInclusive, 'en', report.scope.timezone)} – ${iotTimestamp(report.buckets[i].endExclusive, 'en', report.scope.timezone)}`)
      }
      const visible = x.ticks.filter(t => t.label)
      assert.ok(visible.length <= count)
      // Chart.js fit reserves canvas space for centered boundary labels.
      const leftWidth = context.measureText(x.ticks[0].label).width
      const rightWidth = context.measureText(x.ticks.at(-1).label).width
      assert.ok(x.getPixelForValue(0) - leftWidth / 2 >= 0)
      assert.ok(x.getPixelForValue(count - 1) + rightWidth / 2 <= width)
      assert.equal(config.data.datasets[0].data[2].y, null)
    } finally { chart.destroy(); h.stop() }
  }
  for (const lang of ['en', 'ms', 'zh-CN']) {
    const h = harness(undefined, lang); await flush()
    assert.ok(!h.state.text('movementPeriodNote').includes('iotSummary.')); h.stop()
  }
})

test('Movement hover has no bottom details; keyboard uses floating tooltip and hidden live announcement', async () => {
  const h = chartHarness(fixture('movement'))
  h.state.configuration().options.onHover({ x: 10 }, [], { scales: { x: { getValueForPixel: () => 0 } } })
  assert.ok(h.state.inspection.value.includes('movementDetectedReadings'))
  assert.ok(!nodes(h.render()).some(n => String(n.props?.class).includes('iot-chart-inspection')))
  h.state.focusChart()
  const live = nodes(h.render()).find(n => String(n.props?.class).includes('iot-chart-inspection'))
  assert.ok(live); assert.ok(live.props.class.includes('chart-screen-reader'))
  assert.equal(live.props['aria-live'], 'polite')
  h.state.blurChart()
  assert.ok(!nodes(h.render()).some(n => String(n.props?.class).includes('iot-chart-inspection')))
  const config = h.state.configuration()
  assert.ok(config.options.plugins.tooltip.callbacks.title([{dataIndex:0}]).includes('2026'))
  assert.ok(config.options.plugins.tooltip.callbacks.afterBody([{dataIndex:0}]).some(s => s.includes('validReadings')))
  assert.ok(RealChart.defaults.events.includes('touchstart')); assert.ok(RealChart.defaults.events.includes('touchmove'))
  assert.equal(config.options.events, undefined, 'default touch/click events remain enabled')
  await h.exposed.toPrintDataUrl(); assert.deepEqual(h.printed().data, config.data)
  h.stop()
  for (const metric of ['temperature', 'humidity', 'soilMoisture', 'rainfall']) {
    const other = chartHarness(fixture(metric)); other.state.selectedIndex.value = 0
    const visible = nodes(other.render()).find(n => String(n.props?.class).includes('iot-chart-inspection'))
    assert.equal(visible, undefined, 'pointer selection has no duplicate bottom details')
    other.state.focusChart()
    const announcement = nodes(other.render()).find(n => String(n.props?.class).includes('iot-chart-inspection'))
    assert.ok(announcement.props.class.includes('chart-screen-reader'))
    assert.equal(announcement.props['aria-live'], 'polite')
    assert.ok(other.state.inspection.value.includes('average'))
    other.state.blurChart()
    assert.ok(!nodes(other.render()).some(n => String(n.props?.class).includes('iot-chart-inspection')))
    const config = other.state.configuration()
    assert.equal(config.data.datasets[0].borderColor, '#2c9148')
    assert.equal(config.data.datasets[1].borderColor, '#f18418')
    assert.equal(config.data.datasets[0].spanGaps, false)
    assert.ok(config.options.plugins.tooltip.callbacks.title([{ dataIndex: 0 }]).includes('2026'))
    assert.ok(config.options.plugins.tooltip.callbacks.afterBody([{ dataIndex: 0 }]).includes('validMeasurements'))
    assert.equal(config.options.events, undefined)
    other.stop()
  }
  const source = read('components/conservation/IoTSummaryChart.vue')
  assert.match(source, /\.chart-screen-reader \{ position: absolute;/)
  assert.match(source, /clip-path: inset\(50%\)/)
})


test('CSV downloads authoritative ordered numeric aggregates for all continuous metrics and locales', async () => {
  for (const language of ['en', 'ms', 'zh-CN']) for (const metric of ['temperature', 'humidity', 'soilMoisture', 'rainfall']) {
    const h = harness(undefined, language); await flush()
    h.state.measurement.value = metric; await h.state.load()
    const r = h.state.report.value
    r.device.name = 'Sensor, "中文"\nMelayu'
    r.buckets[0].average = -1.123456789
    r.buckets.push({ ...r.buckets[0], startInclusive: r.buckets[0].endExclusive, endExclusive: '2026-11-02T16:00:00Z', average: null, minimum: null, maximum: null, validMeasurements: 0, missingMeasurements: 3 })
    const model = h.state.csvDocument()
    assert.equal(model.columns.length, 7); assert.equal(model.rows.length, 2)
    assert.deepEqual(Array.from(model.rows[0].slice(2)), [-1.123456789, -2, 2, 2, 1])
    assert.deepEqual(Array.from(model.rows[1].slice(2)), [null, null, null, 0, 3])
    assert.ok(model.columns[2].includes(measurementUnits[metric]))
    h.state.exportCsv()
    assert.equal(h.downloads.length, 1)
    const csv = await h.downloads[0].blob.text()
    // Blob.text strips the BOM; reportCsv itself retains it for Excel.
    assert.equal(reportCsv(model)[0], '\uFEFF')
    assert.ok(csv.includes('"Sensor, ""中文""\nMelayu"'))
    assert.ok(csv.includes('"-1.123456789","-2","2","2","1"'))
    assert.ok(csv.includes('"","","","0","3"'))
    assert.match(h.downloads[0].filename, new RegExp(`^niah-iot-environmental-report-${metric}-.*sensor.*\\.csv$`))
    assert.doesNotMatch(h.downloads[0].filename, /[<>:"/\\|?*]/)
    assert.deepEqual(h.revoked, ['blob:summary'])
    assert.equal(h.calls.length, 2, 'CSV adds no API request')
    h.stop()
  }
})

test('Movement CSV uses backend counts including zero, never averages or no-movement columns', async () => {
  const h = harness(); await flush(); h.state.measurement.value = 'movement'; await h.state.load()
  h.state.report.value.buckets[0].average = .98765
  h.state.report.value.buckets[0].detectedSampleCount = 7
  assert.equal(h.state.csvDocument().columns.length, 5)
  assert.deepEqual(Array.from(h.state.csvDocument().rows[0].slice(2)), [7, 2, 1])
  Object.assign(h.state.report.value.buckets[0], { detectedSampleCount: 0, validMeasurements: 0 })
  assert.deepEqual(Array.from(h.state.csvDocument().rows[0].slice(2)), [0, 0, 1])
  for (const name of ['=SUM(A1)', '+cmd', '-cmd', '@SUM(A1)', '\t =cmd', '\n@cmd']) {
    h.state.report.value.device.name = name
    assert.ok(reportCsv(h.state.csvDocument()).includes('"\'' + name + '"'))
  }
  h.stop()
})

test('CSV preserves full authoritative hourly, daily, weekly and multiweek boundaries', async () => {
  const h = harness(); await flush()
  for (const [interval, end] of [['hour', '2026-10-31T17:00:00Z'], ['day', '2026-11-01T16:00:00Z'], ['week', '2026-11-07T16:00:00Z'], ['week', '2026-11-14T16:00:00Z']]) {
    const r = h.state.report.value; r.aggregation.interval = interval; r.buckets[0].endExclusive = end
    const value = h.state.csvDocument().rows[0][0]
    assert.equal(value, `${iotTimestamp(r.buckets[0].startInclusive, 'en', r.scope.timezone)} – ${iotTimestamp(end, 'en', r.scope.timezone)} [Asia/Kuala_Lumpur; end exclusive]`)
    assert.match(value, /2026, 00:00/)
  }
  h.stop()
})

test('CSV blocks no report, loading, errors, empty results, stale selections and concurrent exports', async () => {
  let finish
  const h = harness(() => new Promise(resolve => finish = resolve))
  h.state.exportCsv(); assert.equal(h.downloads.length, 0)
  await flush(); h.state.measurement.value = 'humidity'; finish(fixture()); await flush()
  assert.equal(h.state.report.value, null, 'changed selection discards late response')
  h.stop()
  const loaded = harness(); await flush()
  loaded.state.device.value = 'second'; loaded.state.exportCsv(); assert.equal(loaded.downloads.length, 0)
  loaded.state.device.value = 'sensor'; loaded.state.measurement.value = 'sound'; loaded.state.exportCsv(); assert.equal(loaded.downloads.length, 0)
  loaded.state.measurement.value = 'temperature'
  loaded.state.exporting.value = true; loaded.state.exportCsv(); assert.equal(loaded.downloads.length, 0)
  loaded.state.exporting.value = false
  loaded.state.report.value.buckets = []; loaded.state.exportCsv(); assert.equal(loaded.downloads.length, 0)
  loaded.props.filters.period = 'all-time'; loaded.state.exportCsv(); assert.equal(loaded.downloads.length, 0)
  loaded.stop()
  const failed = harness(async () => { throw Error('offline') }); await flush()
  failed.state.exportCsv(); assert.equal(failed.downloads.length, 0); failed.stop()
})


test('Officer report offers exactly five ordered metrics; old Sound selections cannot request or export Sound', async () => {
  for (const language of ['en', 'ms', 'zh-CN']) {
    const h = harness(undefined, language); await flush()
    const expected = ['temperature', 'humidity', 'soilMoisture', 'rainfall', 'movement']
    assert.deepEqual(Array.from(h.state.measurements), expected)
    const selects = nodes(h.render()).filter(n => n.type === 'select')
    assert.deepEqual(nodes(selects[1]).filter(n => n.type === 'option').map(n => n.props.value), expected)
    h.state.measurement.value = 'sound'
    h.state.exportCsv(); await h.state.exportPdf()
    assert.equal(h.downloads.length, 0); assert.equal(h.saves.length, 0)
    await h.state.load()
    assert.equal(h.state.measurement.value, 'temperature')
    assert.ok(h.calls.every(call => call[2] !== 'sound'))
    h.state.exportCsv(); await h.state.exportPdf()
    assert.equal(h.downloads.length, 1); assert.equal(h.saves.length, 1)
    assert.ok(h.downloads[0].filename.includes('temperature'))
    assert.ok(h.models[0].context.some(item => item.value.includes(h.state.metricLabel('temperature'))))
    assert.ok(!h.state.text('categorySpacing').includes('iotSummary.'))
    assert.ok(!h.state.text('movementPeriodNote').includes('iotSummary.'))
    h.stop()
  }
  const english = JSON.parse(read('locales/en.json')).conservationPages.reports.iotSummary
  assert.equal(english.categorySpacing, 'Each point represents a reporting period. See the table for exact dates.')
  assert.equal(english.movementPeriodNote, 'Each bar represents a reporting period. See the table for exact dates.')
})
