import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { parse, compileScript, compileTemplate, compileStyle } from '@vue/compiler-sfc'
import postcss from 'postcss'
import * as service from '../src/services/iotMonitoring.ts'
import * as alertsService from '../src/services/threatAlerts.ts'
import { iotDate, deviceDisplayTitle, soilCondition, surfaceCondition } from '../src/utils/iotDisplay.ts'
import { monitoringLabels } from '../src/utils/officerMonitoringDisplay.ts'
import { formatPlantId } from '../src/utils/plantId.ts'

const source = readFileSync(new URL('../src/views/conservation/IoTMonitoringView.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const script = compileScript(descriptor, { id: 'iot-refresh' })
const template = compileTemplate({ source: descriptor.template.content, filename: 'iot.vue', id: 'iot-refresh', compilerOptions: { bindingMetadata: script.bindings } })
const js = code => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const reading = (id = 'old', values = { movement: 0, soilMoisture: 4095, rainfall: 123 }) => ({ id, device_id: '11111111-1111-4111-8111-111111111111', values, created_at: '2026-11-10T08:20:00Z' })
const device = () => ({ id: '11111111-1111-4111-8111-111111111111', name: 'Sensor', device_type: 'Sensor', plant_id: 8, status: 'Active', latest_reading: reading() })
const alertFixture = (deviceId = device().id, overrides = {}) => ({ id: 'real-alert', device_id: deviceId, reading_id: null, camera_id: null, video_path: null, detected_at: '2026-11-10T08:20:00Z', metric: 'temperature', value: 30, status: 'New', created_at: '2026-11-10T08:20:00Z', ...overrides })
const officer = { id: 'one', role: 'Conservation Officer', status: 'Active', mustChangePassword: false }
const flat = root => {
  const result = []
  const walk = n => { if (Array.isArray(n)) return n.forEach(walk); if (!n || typeof n !== 'object') return; result.push(n); if (Array.isArray(n.children)) walk(n.children); else if (n.children?.default) walk(n.children.default()) }
  walk(root); return result
}
function harness() {
  const scope = vue.effectScope(), exports = {}, cleanup = [], destinations = []
  let listener, session = { user: officer, pending: false }
  const context = { exports, AbortController, Error, require(name) {
    if (name === 'vue') return { ...vue, onMounted() {}, withDirectives: n => n, onBeforeUnmount: fn => cleanup.push(fn), resolveComponent: name => ({ name }) }
    if (name === 'vue-i18n') return { useI18n: () => ({ t: key => key }) }
    if (name === 'vue-router') return { useRouter: () => ({ push: target => destinations.push(target) }) }
    if (name.endsWith('/auth')) return { sessionSnapshot: () => session, subscribeSession: fn => { listener = fn; return () => { listener = null } } }
    if (name.endsWith('iotMonitoring')) return service
    if (name.endsWith('threatAlerts')) return alertsService
    if (name.endsWith('iotDisplay')) return { iotDate, deviceDisplayTitle, soilCondition, surfaceCondition }
    if (name.endsWith('officerMonitoringDisplay')) return { monitoringLabels }
    if (name.endsWith('plantId')) return { formatPlantId }
    if (name.includes('useConservationText')) return { useConservationText: () => ({ ct: value => value }) }
    if (name.endsWith('.vue')) return { name: name.split('/').at(-1) }
    throw Error(name)
  } }
  vm.runInNewContext(`(function(){${js(script.content)}})()`, context)
  const state = scope.run(() => exports.default.setup({}, { expose() {} }))
  vm.runInNewContext(`(function(){${js(template.code)}})()`, context)
  return { state, destinations, render: () => flat(exports.render({}, [], {}, vue.proxyRefs(state), {}, {})),
    session(user, pending = false) { session = { user, pending }; listener?.(user, pending) },
    stop() { cleanup.forEach(fn => fn()); scope.stop() } }
}
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b }); return { promise, resolve, reject } }

test('soil and surface conditions match firmware thresholds, including boundaries and missing readings', () => {
  for (const [value, expected] of [[0, 'Wet'], [2299, 'Wet'], [2300, 'Slightly moist'], [2500, 'Slightly moist'], [2700, 'Slightly moist'], [2701, 'Dry'], [4095, 'Dry']]) {
    assert.equal(soilCondition(value), expected)
  }
  for (const [value, expected] of [[0, 'Wet surface'], [2199, 'Wet surface'], [2200, 'Water present'], [2600, 'Water present'], [3000, 'Water present'], [3001, 'Dry'], [4095, 'Dry']]) {
    assert.equal(surfaceCondition(value), expected)
  }
  for (const value of [null, undefined, NaN, Infinity, -Infinity]) {
    assert.equal(soilCondition(value), '\u2014')
    assert.equal(surfaceCondition(value), '\u2014')
  }
})

test('latest and historical tables derive conditions from each row without changing the readings', async () => {
  const original = globalThis.fetch, h = harness()
  globalThis.fetch = async () => Response.json({ devices: [device()] })
  try {
    await h.state.loadDevices()
    for (const [soil, rain, expectedSoil, expectedSurface] of [[4095, 4095, 'Dry', 'Dry'], [2500, 2600, 'Slightly moist', 'Water present'], [0, 0, 'Wet', 'Wet surface'], [null, null, '\u2014', '\u2014']]) {
      const current = service.mapCanonicalDevice({ ...device(), latest_reading: reading('condition', { soilMoisture: soil, rainfall: rain }) })
      h.state.readingDevices.value = [current]
      h.state.historyDevice.value = current
      h.state.historyReadings.value = [current.latest_reading]
      h.state.selectedReading.value = current.latest_reading
      for (const tableClass of ['iot-reading-table', 'iot-history-table']) {
        const table = h.render().find(n => n.type === 'table' && n.props.class.includes(tableClass))
        const cells = flat(table).filter(n => n.type === 'td')
        assert.equal(cells[5].children, soil === null ? '\u2014' : String(soil))
        assert.equal(cells[6].children, expectedSoil)
        assert.equal(cells[7].children, rain === null ? '\u2014' : String(rain))
        assert.equal(cells[8].children, expectedSurface)
      }
      const modal = h.render().find(n => n.type?.name === 'AppModal.vue' && n.props?.title === 'Sensor Reading Details')
      const values = flat(modal).filter(n => n.type === 'dd')
      assert.equal(values[4].children, expectedSoil)
      assert.equal(values[5].children, expectedSurface)
      assert.equal(current.latest_reading.soil_moisture, soil)
      assert.equal(current.latest_reading.rainfall_mm, rain)
    }
  } finally { h.stop(); globalThis.fetch = original }
})

test('reading View and Details share the reference layout, single ID, dynamic data and existing actions', async () => {
  const original = globalThis.fetch, h = harness()
  const id = '422246b4-1111-4111-8111-111111111111'
  const nodeText = root => flat(root).filter(n => typeof n.children === 'string').map(n => n.children).join('').trim()
  globalThis.fetch = async () => Response.json({ devices: [{ ...device(), latest_reading: reading(id, { temperature: 22.1, humidity: 64, soilMoisture: 4095, rainfall: 123, movement: 0 }) }] })
  try {
    await h.state.loadDevices()
    for (const entry of ['View Reading', 'common.details']) {
      const button = h.render().find(n => n.type === 'button' && typeof n.children === 'string' && n.children.trim() === entry)
      assert.ok(button, entry); button.props.onClick()
      const modal = h.render().find(n => n.type?.name === 'AppModal.vue' && n.props?.title === 'Sensor Reading Details')
      assert.ok(modal)
      assert.equal(modal.props.subtitle, 'Plant PL008')
      assert.ok(Object.hasOwn(modal.props, 'accessible'))
      const body = flat(modal)
      const identifiers = body.filter(n => n.type?.name === 'MonitoringIdentifier.vue')
      assert.equal(identifiers.length, 1)
      assert.equal(identifiers[0].props.value, id)
      assert.equal(identifiers[0].props['copy-label'], 'Copy full Reading ID')
      assert.equal(identifiers[0].props['feedback-duration'], 3000)
      const title = flat(modal.children.title())
      assert.equal(title.filter(n => n.type?.name === 'MonitoringIdentifier.vue').length, 0)
      assert.equal(title.filter(n => n.props?.class === 'reading-header-icon').length, 1)
      assert.deepEqual(body.filter(n => n.type === 'dt').map(nodeText), ['Temperature', 'Humidity', 'Soil Raw (ADC)', 'Rain Raw (ADC)', 'Soil Condition', 'Surface Condition', 'Motion', 'GPS', 'Recorded At'])
      assert.equal(body.filter(n => n.props?.class === 'reading-field-icon').length, 9)
      assert.deepEqual(body.filter(n => n.type === 'dd').map(nodeText), ['22.1 \u00b0C', '64%', '4095', '123', 'Dry', 'Wet surface', 'No motion', '\u2014', '10 Nov 2026, 16:20'])
      const actions = body.filter(n => n.type === 'button')
      assert.deepEqual(actions.map(nodeText), ['View Alerts', 'View on Map'])
      assert.ok(actions.every(n => flat(n).some(child => child.type === 'svg')))
      actions[1].props.onClick()
      assert.equal(h.destinations.at(-1).name, 'conservation-map')
      assert.equal(h.destinations.at(-1).query.plant, 'PL008')
      button.props.onClick()
      actions[0].props.onClick()
      assert.equal(h.destinations.at(-1).name, 'conservation-alerts')
      assert.equal(h.destinations.at(-1).query.reading, id)
      button.props.onClick(); modal.props.onClose()
      assert.equal(h.state.selectedReading.value, null)
    }
    const css = descriptor.styles[0].content
    assert.match(css, /\.reading-details-modal :deep\(\.modal-card\)\s*\{ width: min\(800px, 100%\); padding: 24px 28px/)
    assert.match(css, /\.reading-measurement\s*\{[^}]*min-height: 80px/)
    assert.match(css, /\.reading-actions \.action-button\s*\{[^}]*min-height: 44px/)
    assert.match(css, /\.reading-id-row\s*\{[^}]*background: transparent/)
    assert.match(css, /\.reading-id-row :deep\(\.monitoring-copy-feedback\)[^{]*\{[^}]*position: absolute;[^}]*bottom: 0/)
    assert.match(css, /\.reading-measurements\s*\{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/)
    assert.match(css, /@media \(max-width: 620px\)[\s\S]*\.reading-measurements\s*\{ grid-template-columns: minmax\(0, 1fr\)/)
    assert.match(css, /\.reading-measurement\s*\{[^}]*border-bottom: 1px solid/)
    assert.doesNotMatch(css, /\.reading-measurement\s*\{[^}]*border-(left|right)/)
    assert.deepEqual(compileStyle({ source: css, id: 'data-v-iot', scoped: true }).errors, [])
  } finally { h.stop(); globalThis.fetch = original }
})

test('reading modal motion colors and missing-value behavior preserve the existing data contract', () => {
  const h = harness()
  const nodeText = root => flat(root).filter(n => typeof n.children === 'string').map(n => n.children).join('').trim()
  try {
    for (const [motion, label, badgeClass] of [[false, 'No motion', 'quiet'], [true, 'Detected', 'detected'], [null, '—', 'quiet']]) {
      h.state.selectedReading.value = { reading_id: 'legacy-reading', plant_id: null, temperature_c: null, humidity: null, soil_moisture: null, rainfall_mm: null, motion_detected: motion, gps_latitude: null, gps_longitude: null, recorded_at: 'invalid' }
      const modal = h.render().find(n => n.type?.name === 'AppModal.vue' && n.props?.title === 'Sensor Reading Details')
      const body = flat(modal), badge = body.find(n => n.props?.class?.includes('reading-motion'))
      assert.equal(nodeText(badge), label)
      assert.ok(badge.props.class.includes(badgeClass))
      assert.equal(modal.props.subtitle, 'Plant —')
      assert.equal(body.filter(n => n.type === 'button').length, 1)
      assert.equal(nodeText(body.find(n => n.type === 'button')), 'View Alerts')
      assert.equal(body.filter(n => n.type === 'dd').map(nodeText).filter(value => value === '—').length, motion === null ? 9 : 8)
    }
    const rules = []; postcss.parse(descriptor.styles[0].content).walkRules(rule => rules.push(rule))
    for (const [selector, background, color] of [['.reading-motion', '#E5E7EB', '#374151'], ['.reading-motion.detected', '#FFEDD5', '#9A3412']]) {
      const declarations = Object.fromEntries(rules.find(rule => rule.selector === selector).nodes.map(n => [n.prop, n.value]))
      assert.equal(declarations.background, background); assert.equal(declarations.color, color)
    }
  } finally { h.stop() }
})

test('shared modal title slot is optional and keeps the existing fallback title, subtitle and close action', () => {
  const source = readFileSync(new URL('../src/components/conservation/AppModal.vue', import.meta.url), 'utf8')
  const { descriptor } = parse(source), script = compileScript(descriptor, { id: 'reading-modal-title' })
  const template = compileTemplate({ source: descriptor.template.content, filename: 'AppModal.vue', id: 'reading-modal-title', compilerOptions: { bindingMetadata: script.bindings } })
  for (const custom of [false, true]) {
    const exports = {}, emitted = []
    const context = { exports, require(name) {
      if (name === 'vue') return { ...vue, onMounted() {}, onBeforeUnmount() {}, renderSlot: (slots, name, _props, fallback) => slots[name]?.() ?? fallback?.() }
      if (name === 'vue-i18n') return { useI18n: () => ({ t: key => key }) }
      throw Error(name)
    } }
    vm.runInNewContext(`(function(){${js(script.content)}})()`, context)
    const props = { title: 'Reading compact-ID', subtitle: 'Plant PL001' }
    const state = exports.default.setup(props, { emit: (...args) => emitted.push(args), expose() {} })
    vm.runInNewContext(`(function(){${js(template.code)}})()`, context)
    const slots = { default: () => [vue.h('div', 'Unchanged body')], ...(custom ? { title: () => [vue.h('span', 'Custom reading title')] } : {}) }
    const ctx = { $slots: slots, $emit: (...args) => emitted.push(args) }
    const rendered = flat(exports.render(ctx, [], props, vue.proxyRefs(state), {}, {}))
    const heading = rendered.find(n => n.type === 'h2')
    assert.ok(flat(heading).some(n => n.children === (custom ? 'Custom reading title' : props.title)))
    assert.ok(rendered.some(n => n.type === 'p' && n.children === 'Plant PL001'))
    assert.equal(rendered.find(n => n.props?.role === 'dialog').props['aria-label'], props.title)
    rendered.find(n => n.props?.class === 'close-button').props.onClick()
    assert.deepEqual(emitted, [['close']])
  }
})

test('accessible modal locks the root without changing body/sticky layout, traps focus and restores the opener without scrolling', async () => {
  const source = readFileSync(new URL('../src/components/conservation/AppModal.vue', import.meta.url), 'utf8')
  const { descriptor } = parse(source), script = compileScript(descriptor, { id: 'modal-scroll-lock' })
  for (const accessible of [true, false]) {
    const exports = {}, mounted = [], cleanup = [], emitted = [], focused = []
    class Element {
      constructor(name) { this.name = name; this.children = []; this.parentElement = null; this.inert = false; this.style = { overflow: 'visible' }; this.isConnected = true }
      focus(options) { focused.push({ name: this.name, preventScroll: options?.preventScroll }); document.activeElement = this }
    }
    const body = new Element('body'), root = new Element('html'), layout = new Element('layout'), sidebar = new Element('sidebar'), main = new Element('main'), topbar = new Element('topbar'), page = new Element('page'), background = new Element('background'), backdrop = new Element('backdrop')
    const append = (parent, ...children) => { parent.children.push(...children); for (const child of children) child.parentElement = parent }
    append(body, layout); append(layout, sidebar, main); append(main, topbar, page); append(page, background, backdrop)
    const first = new Element('close'), last = new Element('last-action'), opener = new Element('opener')
    const document = { body, documentElement: root, activeElement: opener }
    root.style.overflow = 'auto'
    const context = { exports, HTMLElement: Element, document, require(name) {
      if (name === 'vue') return { ...vue, onMounted: fn => mounted.push(fn), onBeforeUnmount: fn => cleanup.push(fn) }
      if (name === 'vue-i18n') return { useI18n: () => ({ t: key => key }) }
      throw Error(name)
    } }
    vm.runInNewContext(`(function(){${js(script.content)}})()`, context)
    const state = exports.default.setup({ title: 'Modal', accessible }, { emit: (...args) => emitted.push(args), expose() {} })
    state.backdrop.value = backdrop
    state.card.value = { querySelectorAll: () => [first, last] }
    await mounted[0]()
    assert.equal(body.style.overflow, 'visible')
    assert.equal(root.style.overflow, accessible ? 'hidden' : 'auto')
    assert.equal(sidebar.inert, accessible)
    assert.equal(topbar.inert, accessible)
    if (accessible) {
      assert.equal(focused[0].name, 'close'); assert.equal(focused[0].preventScroll, true)
      document.activeElement = last
      state.keyboard({ key: 'Tab', shiftKey: false, preventDefault() {} })
      assert.equal(document.activeElement.name, 'close')
      state.keyboard({ key: 'Escape', preventDefault() {} })
      assert.deepEqual(emitted, [['close']])
    }
    cleanup.forEach(fn => fn())
    assert.equal(root.style.overflow, 'auto'); assert.equal(body.style.overflow, 'visible')
    assert.equal(sidebar.inert, false); assert.equal(topbar.inert, false)
    if (accessible) assert.deepEqual(focused.at(-1), { name: 'opener', preventScroll: true })
    else assert.equal(focused.length, 0)
  }
})

test('no canonical alerts shows one informational toast and keeps the modal open; only exact device IDs navigate', async () => {
  const original = globalThis.fetch, calls = [], pending = deferred()
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    if (url === service.IOT_DEVICES_PATH) return Response.json({ devices: [device()] })
    return pending.promise
  }
  const h = harness()
  try {
    await h.state.loadDevices()
    h.state.selectedDevice.value = h.state.devices.value[0]
    const selected = h.state.selectedDevice.value
    const work = h.state.viewDeviceAlerts(selected)
    await h.state.viewDeviceAlerts(selected)
    assert.equal(calls.length, 2)
    assert.equal(h.state.isLookingDeviceAlerts.value, true)
    assert.ok(h.render().some(n => n.type === 'button' && n.props?.['aria-busy'] === true && n.props.disabled))
    // Matching camera ID or a frontend camera example is not a device alert.
    pending.resolve(Response.json({ alerts: [alertFixture('another-device', { camera_id: selected.sensor_id })], responses: [] }))
    await work
    assert.equal(h.destinations.length, 0)
    assert.equal(h.state.selectedDevice.value.sensor_id, selected.sensor_id)
    const feedback = h.state.deviceAlertFeedback.value
    assert.equal(feedback.variant, 'info')
    assert.equal(feedback.title, 'No threat alerts found')
    assert.equal(feedback.message, 'There are currently no recorded threat alerts for this device.')
    await h.state.viewDeviceAlerts(selected)
    assert.equal(calls.length, 2)
    assert.equal(h.state.deviceAlertFeedback.value.id, feedback.id)
    h.state.dismissDeviceAlertFeedback(feedback.id)
    globalThis.fetch = async () => Response.json({ alerts: [alertFixture(selected.sensor_id)], responses: [] })
    await h.state.viewDeviceAlerts(selected)
    assert.equal(h.state.selectedDevice.value, null)
    assert.equal(h.destinations[0].name, 'conservation-alerts')
    assert.equal(h.destinations[0].query.device, selected.sensor_id)
    assert.equal(calls[1].url, '/api/data/alerts')
    assert.equal(calls[1].options.credentials, 'same-origin')
    assert.equal(calls[1].options.cache, 'no-store')
  } finally { h.stop(); globalThis.fetch = original }
})

test('empty authorized list succeeds, while network, malformed and unauthorized lookups show errors and allow retry', async () => {
  const original = globalThis.fetch
  const h = harness()
  globalThis.fetch = async () => Response.json({ devices: [device()] })
  try {
    await h.state.loadDevices()
    h.state.selectedDevice.value = h.state.devices.value[0]
    for (const result of ['network', 401, 403, 500, 'malformed']) {
      globalThis.fetch = async () => {
        if (result === 'network') throw Error('offline')
        if (result === 'malformed') return Response.json({ alerts: 'invalid', responses: [] })
        return Response.json({ error: 'Denied' }, { status: result })
      }
      await h.state.viewDeviceAlerts(h.state.selectedDevice.value)
      assert.equal(h.state.deviceAlertFeedback.value.variant, 'error')
      assert.equal(h.state.deviceAlertFeedback.value.message, 'Unable to load threat alerts. Please try again.')
      assert.ok(h.state.selectedDevice.value)
      assert.equal(h.state.isLookingDeviceAlerts.value, false)
      assert.equal(h.destinations.length, 0)
    }
    globalThis.fetch = async () => Response.json({ alerts: [], responses: [] })
    await h.state.viewDeviceAlerts(h.state.selectedDevice.value)
    assert.equal(h.state.deviceAlertFeedback.value.variant, 'info')
  } finally { h.stop(); globalThis.fetch = original }
})

test('the canonical cap cannot produce a false no-alert conclusion', async () => {
  const original = globalThis.fetch, h = harness()
  globalThis.fetch = async () => Response.json({ devices: [device()] })
  try {
    await h.state.loadDevices(); h.state.selectedDevice.value = h.state.devices.value[0]
    const capped = Array.from({ length: alertsService.CANONICAL_ALERT_CAP }, (_, i) => alertFixture('another-device', { id: `alert-${i}` }))
    globalThis.fetch = async () => Response.json({ alerts: capped, responses: [] })
    await h.state.viewDeviceAlerts(h.state.selectedDevice.value)
    assert.equal(h.state.deviceAlertFeedback.value.variant, 'error')
    assert.match(h.state.deviceAlertFeedback.value.message, /Unable to confirm/)
    assert.equal(h.destinations.length, 0)
    capped[0] = alertFixture(h.state.selectedDevice.value.sensor_id)
    await h.state.viewDeviceAlerts(h.state.selectedDevice.value)
    assert.equal(h.destinations.length, 1)
  } finally { h.stop(); globalThis.fetch = original }
})

test('late device alert lookups cannot navigate or notify after modal changes, logout, account changes or unmount', async () => {
  const original = globalThis.fetch
  try {
    for (const action of ['close', 'replace', 'logout', 'account', 'unmount']) {
      const pending = deferred(), h = harness(); let signal
      globalThis.fetch = async (url, options) => {
        if (url === service.IOT_DEVICES_PATH) return Response.json({ devices: [device()] })
        signal = options.signal; return pending.promise
      }
      try {
        await h.state.loadDevices(); h.state.selectedDevice.value = h.state.devices.value[0]
        const work = h.state.viewDeviceAlerts(h.state.selectedDevice.value)
        if (action === 'close') h.state.selectedDevice.value = null
        if (action === 'replace') h.state.selectedDevice.value = { ...h.state.selectedDevice.value, sensor_id: 'another-device' }
        if (action === 'logout') h.session(null)
        if (action === 'account') h.session({ ...officer, id: 'two' })
        if (action === 'unmount') h.stop()
        assert.equal(signal.aborted, true)
        pending.resolve(Response.json({ alerts: [alertFixture()], responses: [] }))
        await work
        assert.equal(h.destinations.length, 0)
        assert.equal(h.state.deviceAlertFeedback.value, null)
      } finally { if (action !== 'unmount') h.stop() }
    }
  } finally { globalThis.fetch = original }
})

test('shared feedback adds an accessible info icon/title and preserves existing success/error presentation and dismissal', () => {
  const source = readFileSync(new URL('../src/components/ActionFeedback.vue', import.meta.url), 'utf8')
  const { descriptor } = parse(source)
  const script = compileScript(descriptor, { id: 'iot-feedback' })
  const template = compileTemplate({ source: descriptor.template.content, filename: 'ActionFeedback.vue', id: 'iot-feedback', compilerOptions: { bindingMetadata: script.bindings } })
  for (const variant of ['info', 'success', 'error']) {
    const exports = {}, mounted = [], cleanup = [], timers = [], cleared = [], emitted = []
    const props = { feedbackId: 7, variant, title: variant === 'info' ? 'No threat alerts found' : undefined, message: 'Message' }
    const context = { exports, setTimeout: (callback, duration) => { timers.push({ callback, duration }); return 1 }, clearTimeout: id => cleared.push(id), require(name) {
      if (name === 'vue') return { ...vue, onMounted: fn => mounted.push(fn), onBeforeUnmount: fn => cleanup.push(fn) }
      throw Error(name)
    } }
    vm.runInNewContext(`(function(){${js(script.content)}})()`, context)
    const state = exports.default.setup(props, { emit: (...args) => emitted.push(args), expose() {} })
    vm.runInNewContext(`(function(){${js(template.code)}})()`, context)
    const rendered = flat(exports.render({}, [], props, vue.proxyRefs(state), {}, {}))
    const root = rendered.find(n => n.props?.class?.includes('action-feedback--'))
    assert.equal(root.props.role, variant === 'error' ? 'alert' : 'status')
    assert.equal(root.props['aria-live'], variant === 'error' ? 'assertive' : 'polite')
    assert.equal(rendered.find(n => n.type === 'strong').children, variant === 'info' ? 'No threat alerts found' : variant === 'success' ? 'Success' : 'Error')
    if (variant === 'info') {
      assert.ok(rendered.some(n => n.type === 'path' && n.props?.d === 'M12 11v6'))
      assert.ok(!rendered.some(n => n.type === 'path' && n.props?.d === 'M12 8v5'))
    }
    mounted.forEach(fn => fn())
    assert.equal(timers.length, 1)
    timers[0].callback()
    assert.deepEqual(emitted, [['dismiss', 7]])
    cleanup.forEach(fn => fn())
    assert.deepEqual(cleared, [1])
  }
})

test('device display title expands the known compact name without changing readable or unrecognized names', () => {
  for (const name of ['plantsensordevice', 'plantSensorDevice', 'PLANTSENSORDEVICE']) {
    assert.equal(deviceDisplayTitle(name), 'Plant Sensor Device')
    assert.equal(name.toLowerCase(), 'plantsensordevice')
  }
  for (const name of ['Plant Sensor Device', 'Canopy Sensor Alpha', 'MPU6050 Sensor', 'customcompactname', 'Sensor-01']) {
    assert.equal(deviceDisplayTitle(name), name)
  }
})

test('device modal has one copy-enabled identifier, device-only details and unchanged actions', async () => {
  const nodeText = root => flat(root).filter(n => typeof n.children === 'string').map(n => n.children).join('').trim()
  const original = globalThis.fetch
  globalThis.fetch = async url => url === service.IOT_DEVICES_PATH
    ? Response.json({ devices: [device()] })
    : url === alertsService.CANONICAL_ALERTS_PATH ? Response.json({ alerts: [alertFixture()], responses: [] })
    : Response.json({ readings: [reading()], page: 1, limit: 100, hasMore: false })
  const h = harness()
  try {
    await h.state.loadDevices()
    const selected = h.state.devices.value[0]
    selected.device_name = 'plantsensordevice'
    h.state.selectedDevice.value = selected
    const modal = h.render().find(n => n.type?.name === 'AppModal.vue' && n.props?.title === 'Plant Sensor Device')
    assert.ok(modal)
    assert.equal(modal.props.subtitle, 'Sensor Device')
    assert.equal(modal.props.accessible, '')
    assert.equal(modal.props.class, 'reading-details-modal device-details-modal')
    assert.equal(selected.device_name, 'plantsensordevice')
    const content = flat(modal)
    const identifiers = content.filter(n => n.type?.name === 'MonitoringIdentifier.vue')
    assert.equal(identifiers.length, 1)
    assert.equal(identifiers[0].props.value, selected.sensor_id)
    assert.equal(identifiers[0].props.labels.get(selected.sensor_id), h.state.deviceLabels.value.get(selected.sensor_id))
    assert.equal(identifiers[0].props['copy-label'], 'Copy full Device ID')
    assert.equal(identifiers[0].props['feedback-duration'], 3000)
    assert.equal(content.filter(n => n.props?.class === 'reading-field-icon').length, 7)
    const title = flat(modal.children.title())
    assert.equal(title.filter(n => n.props?.class === 'reading-header-icon').length, 1)
    assert.deepEqual(content.filter(n => n.type === 'dt').map(nodeText), [
      'Device Type', 'Serial Number', 'Status', 'Location Description', 'Installed At', 'Related Plant', 'Latest Reading',
    ])
    const actions = content.filter(n => n.type === 'button')
    assert.deepEqual(actions.map(nodeText), ['View Reading History', 'View Alerts', 'View on Map'])
    assert.ok(actions.every(n => flat(n).some(child => child.type === 'svg')))
    const savedReading = selected.latest_reading
    for (const status of ['Active', 'Inactive']) {
      selected.status = status
      selected.latest_reading = null
      const current = h.render().find(n => n.type?.name === 'AppModal.vue' && n.props?.class === 'reading-details-modal device-details-modal')
      const fields = flat(current)
      const badge = fields.find(n => String(n.props?.class).includes('device-registration-status'))
      assert.equal(badge.children, status)
      assert.ok(badge.props.class.includes(status.toLowerCase()))
      assert.equal(fields.filter(n => n.type === 'dd').at(-1).children.trim(), 'No reading available')
      assert.equal(fields.filter(n => n.type === 'button').length, 2)
    }
    selected.status = 'Active'; selected.latest_reading = savedReading
    actions[2].props.onClick()
    assert.equal(h.destinations[0].name, 'conservation-map')
    assert.equal(h.destinations[0].query.plant, 'PL008')
    h.state.selectedDevice.value = selected
    await actions[1].props.onClick()
    assert.equal(h.destinations[1].name, 'conservation-alerts')
    assert.equal(h.destinations[1].query.device, selected.sensor_id)
    h.state.selectedDevice.value = selected
    await actions[0].props.onClick()
    assert.equal(h.state.historyDevice.value.sensor_id, selected.sensor_id)
    assert.equal(h.state.historyReadings.value.length, 1)
    assert.equal(h.state.selectedDevice.value, null)
  } finally { h.stop(); globalThis.fetch = original }
})

test('IoT table badge overrides change only colors and compile with page scoping', () => {
  const css = descriptor.styles[0].content, sheet = postcss.parse(css)
  const expected = {
    '.iot-device-table .badge.active': ['#DCFCE7', '#166534'],
    '.iot-device-table .badge.inactive': ['#E5E7EB', '#374151'],
    '.iot-reading-table .badge.approved': ['#E5E7EB', '#374151'],
    '.iot-reading-table .badge.high': ['#FFEDD5', '#9A3412'],
  }
  const found = []
  sheet.walkRules(rule => {
    if (!rule.selector.includes('.badge')) return
    const declarations = Object.fromEntries(rule.nodes.map(n => [n.prop, n.value]))
    for (const selector of rule.selector.split(',').map(s => s.trim())) {
      assert.ok(Object.hasOwn(expected, selector), selector)
      assert.deepEqual(declarations, { background: expected[selector][0], color: expected[selector][1] })
      found.push(selector)
    }
  })
  assert.deepEqual(found.sort(), Object.keys(expected).sort())
  const compiled = compileStyle({ source: css, id: 'data-v-iot-badges', scoped: true })
  assert.deepEqual(compiled.errors, [])
  assert.match(compiled.code, /\.badge\.active\[data-v-iot-badges\]/)
  assert.match(compiled.code, /\.badge\.high\[data-v-iot-badges\]/)
})

test('motion/device badge classes retain the original labels and fallback mapping', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () => Response.json({ devices: [device()] })
  const h = harness()
  try {
    await h.state.loadDevices()
    for (const status of ['Active', 'Inactive']) {
      h.state.devices.value[0].status = status
      const table = h.render().find(n => n.type === 'table' && n.props?.class.includes('iot-device-table'))
      const badge = flat(table).find(n => n.type === 'span' && n.props?.class.includes('badge'))
      assert.equal(badge.children, status)
      assert.ok(badge.props.class.includes(status.toLowerCase()))
    }
    for (const [value, label, badgeClass] of [[0, 'No motion', 'approved'], [1, 'Detected', 'high'], [2, 'No motion', 'approved'], [null, '—', 'approved'], [undefined, '—', 'approved'], ['1', '—', 'approved']]) {
      h.state.readingDevices.value = [service.mapCanonicalDevice({ ...device(), latest_reading: reading('motion', { movement: value }) })]
      const table = h.render().find(n => n.type === 'table' && n.props?.class.includes('iot-reading-table'))
      const badge = flat(table).find(n => n.type === 'span' && n.props?.class.includes('badge'))
      assert.equal(badge.children.trim(), label)
      assert.ok(badge.props.class.includes(badgeClass))
    }
  } finally { h.stop(); globalThis.fetch = original }
})

test('IoT dates are fixed DD MMM YYYY HH:mm in Kuching, including rollover and invalid inputs', () => {
  assert.equal(iotDate('2026-11-10T08:20:00Z'), '10 Nov 2026, 16:20')
  assert.equal(iotDate('2026-12-31T16:01:00Z'), '01 Jan 2027, 00:01')
  assert.equal(iotDate('2026-11-10T16:20:00+08:00'), '10 Nov 2026, 16:20')
  for (const value of [null, undefined, '', 'invalid', '2026-02-30T00:00:00Z', '2026-11-10', '2026-11-10T16:20:00']) assert.equal(iotDate(value), '—')
  const old = process.env.TZ
  try { for (const tz of ['UTC', 'America/New_York']) { process.env.TZ = tz; assert.equal(iotDate('2026-11-10T08:20:00Z'), '10 Nov 2026, 16:20') } }
  finally { if (old === undefined) delete process.env.TZ; else process.env.TZ = old }
})

test('refresh reads only latest history rows, preserves inventory/filter/camera and visible rows, and blocks overlaps', async () => {
  const original = globalThis.fetch, pending = deferred(), calls = []
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options })
    if (url === service.IOT_DEVICES_PATH) return Response.json({ devices: [device()] })
    return pending.promise
  }
  const h = harness()
  try {
    await h.state.loadDevices()
    const inventory = h.state.devices.value
    h.state.search.value = 'Sensor'; h.state.status.value = 'Active'; h.state.type.value = 'Sensor'
    const refresh = h.state.refreshReadings()
    await h.state.refreshReadings()
    assert.equal(calls.length, 2)
    assert.equal(h.state.latestReadings.value[0].reading.reading_id, 'old')
    assert.equal(h.state.isRefreshing.value, true)
    assert.ok(h.render().some(n => n.type === 'button' && n.props?.['aria-busy'] === true && n.props.disabled))
    pending.resolve(Response.json({ readings: [reading('new')], page: 1, limit: 1, hasMore: true }))
    await refresh
    assert.equal(h.state.latestReadings.value[0].reading.reading_id, 'new')
    assert.equal(h.state.devices.value, inventory)
    assert.equal(inventory[0].latest_reading.reading_id, 'old')
    assert.equal(h.state.filteredDevices.value.length, 1)
    assert.equal(h.state.search.value, 'Sensor')
    assert.equal(h.state.status.value, 'Active'); assert.equal(h.state.type.value, 'Sensor')
    assert.equal(calls[1].url, '/api/data/devices/11111111-1111-4111-8111-111111111111/readings?page=1&limit=1')
    for (const call of calls) { assert.equal(call.options.cache, 'no-store'); assert.equal(call.options.credentials, 'same-origin') }
    assert.equal(h.render().filter(n => n.type?.name === 'CameraMonitoringSection.vue').length, 1)
    assert.ok(calls.every(c => !c.url.includes('camera')))
  } finally { h.stop(); globalThis.fetch = original }
})

test('failed refresh retains readings and exposes retry; retry can return a genuinely empty latest result', async () => {
  const original = globalThis.fetch
  let fail = true
  globalThis.fetch = async url => {
    if (url === service.IOT_DEVICES_PATH) return Response.json({ devices: [device()] })
    if (fail) throw Error('offline')
    return Response.json({ readings: [], page: 1, limit: 1, hasMore: false })
  }
  const h = harness()
  try {
    await h.state.loadDevices(); await h.state.refreshReadings()
    assert.equal(h.state.latestReadings.value[0].reading.reading_id, 'old')
    assert.match(h.state.refreshError.value, /could not be reached/)
    assert.ok(h.render().some(n => n.props?.role === 'alert'))
    assert.equal(h.state.isRefreshing.value, false)
    fail = false; await h.state.refreshReadings()
    assert.equal(h.state.refreshError.value, ''); assert.equal(h.state.latestReadings.value.length, 0)
  } finally { h.stop(); globalThis.fetch = original }
})

test('logout, pending session, account change and unmount abort/invalidate late refresh responses', async () => {
  const original = globalThis.fetch
  try {
    for (const action of ['logout', 'pending', 'account', 'unmount']) {
      const pending = deferred(); let signal
      globalThis.fetch = async (url, options) => {
        if (url === service.IOT_DEVICES_PATH) return Response.json({ devices: [device()] })
        signal = options.signal; return pending.promise
      }
      const h = harness()
      try {
        await h.state.loadDevices(); const work = h.state.refreshReadings()
        if (action === 'unmount') h.stop()
        else h.session(action === 'logout' ? null : action === 'pending' ? officer : { ...officer, id: 'two' }, action === 'pending')
        assert.equal(signal.aborted, true)
        pending.resolve(Response.json({ readings: [reading('stale-response')], page: 1, limit: 1, hasMore: false }))
        await work
        assert.ok(!h.state.latestReadings.value.some(item => item.reading.reading_id === 'stale-response'))
        assert.equal(h.state.selectedReading.value, null)
      } finally { if (action !== 'unmount') h.stop() }
    }
  } finally { globalThis.fetch = original }
})

test('raw ADC presentation preserves motion mapping and inventory actions', async () => {
  for (const [value, expected] of [[0,false], [1,true], [2,false], [-1,false], [true,null], ['1',null], [null,null]]) {
    assert.equal(service.mapCanonicalDevice({ ...device(), latest_reading: reading('motion', { movement: value }) }).latest_reading.motion_detected, expected)
  }
  const original = globalThis.fetch
  globalThis.fetch = async url => url === alertsService.CANONICAL_ALERTS_PATH ? Response.json({ alerts: [alertFixture()], responses: [] }) : Response.json({ devices: [device()] })
  const h = harness()
  try {
    await h.state.loadDevices()
    const nodes = h.render()
    assert.ok(nodes.some(n => n.children === '4095'))
    assert.ok(nodes.some(n => n.children === '123'))
    assert.ok(nodes.some(n => n.children === 'No motion'))
    assert.ok(nodes.some(n => n.children === 'Dry'))
    assert.ok(nodes.some(n => n.children === 'Wet surface'))
    assert.ok(!nodes.some(n => n.children === '4095%' || n.children === '123 mm'))
    assert.equal(h.state.motionValue({ motion_detected: null }), '—')
    assert.equal(h.state.motionValue({ motion_detected: true }), 'Detected')
    assert.equal(h.state.gpsValue(h.state.devices.value[0].latest_reading), '—')
    h.state.selectedDevice.value = h.state.devices.value[0]
    assert.ok(h.render().some(n => typeof n.children === 'string' && n.children.trim() === 'View Reading History'))
    await h.state.viewDeviceAlerts(h.state.selectedDevice.value)
    assert.equal(h.destinations[0].query.device, device().id)
  } finally { h.stop(); globalThis.fetch = original }
})

test('latest-row reads bound concurrency to four and reject malformed partial results', async () => {
  const original = globalThis.fetch, pending = [], calls = []
  const devices = Array.from({ length: 9 }, (_, index) => ({ ...service.mapCanonicalDevice(device()), sensor_id: `device-${index}` }))
  globalThis.fetch = async (url, options) => {
    const item = deferred(); pending.push(item); calls.push({ url, options })
    return item.promise
  }
  try {
    const controller = new AbortController()
    const work = service.loadLatestReadings(devices, controller.signal)
    assert.equal(calls.length, 4)
    let resolved = 0
    while (resolved < devices.length) {
      const batch = pending.splice(0)
      for (const item of batch) { item.resolve(Response.json({ readings: [reading('latest')], page: 1, limit: 1, hasMore: false })); resolved++ }
      await new Promise(resolve => setImmediate(resolve))
      assert.ok(pending.length <= 4)
    }
    assert.equal((await work).length, 9)
    assert.equal(calls.length, 9)
    globalThis.fetch = async () => Response.json({ readings: 'invalid' })
    await assert.rejects(service.loadLatestReadings(devices, new AbortController().signal), { kind: 'invalid' })
  } finally { globalThis.fetch = original }
})

test('a partial refresh failure never replaces any of the previous snapshot', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async url => {
    if (url === service.IOT_DEVICES_PATH) return Response.json({ devices: [device(), { ...device(), id: '22222222-2222-4222-8222-222222222222' }] })
    if (url.includes('22222222')) return Response.json({ error: 'Unavailable' }, { status: 503 })
    return Response.json({ readings: [reading('partial-new')], page: 1, limit: 1, hasMore: false })
  }
  const h = harness()
  try {
    await h.state.loadDevices(); await h.state.refreshReadings()
    assert.equal(h.state.latestReadings.value.length, 2)
    assert.ok(h.state.latestReadings.value.every(item => item.reading.reading_id === 'old'))
    assert.equal(h.state.refreshError.value, 'Unavailable')
  } finally { h.stop(); globalThis.fetch = original }
})

test('unauthorized sessions cannot refresh; session loss also invalidates an initial device load', async () => {
  const original = globalThis.fetch, pending = deferred()
  let calls = 0, signal
  globalThis.fetch = async (_url, options) => { calls++; signal = options.signal; return pending.promise }
  const h = harness()
  try {
    const initial = h.state.loadDevices()
    h.session(null)
    assert.equal(signal.aborted, true)
    pending.resolve(Response.json({ devices: [device()] }))
    await initial
    assert.equal(h.state.devices.value.length, 0)
    for (const user of [null, { ...officer, role: 'Visitor' }, { ...officer, role: 'Botanist' }, { ...officer, status: 'Inactive' }, { ...officer, mustChangePassword: true }]) {
      h.session(user)
      await h.state.refreshReadings(); await h.state.loadDevices()
    }
    assert.equal(calls, 1)
  } finally { h.stop(); globalThis.fetch = original }
})

test('reading details and charts retain Malaysia dates and display raw ADC units', async () => {
  const chart = readFileSync(new URL('../src/components/conservation/SensorHistoryChart.vue', import.meta.url), 'utf8')
  assert.match(chart, /const formatTimestamp = iotDate/)
  assert.match(source, /title="Soil raw readings over time"\s+unit="ADC"/)
  assert.match(source, /title="Rain raw readings over time"\s+unit="ADC"/)
  assert.doesNotMatch(source, /soil_moisture, '%'|rainfall_mm, ' mm'/)
  const original = globalThis.fetch
  globalThis.fetch = async () => Response.json({ devices: [device()] })
  const h = harness()
  try {
    await h.state.loadDevices()
    h.state.selectedReading.value = h.state.latestReadings.value[0].reading
    assert.ok(h.render().some(n => n.type === 'dd' && n.children === '10 Nov 2026, 16:20'))
    assert.ok(h.render().some(n => n.type === 'dd' && n.children === '4095'))
    assert.equal(h.state.dt(null), '—')
    assert.equal(h.state.cards.value.find(card => card[0] === 'onlineDevices')[1], '—')
    assert.equal(h.state.cards.value.find(card => card[0] === 'offlineDevices')[1], '—')
  } finally { h.stop(); globalThis.fetch = original }
})
