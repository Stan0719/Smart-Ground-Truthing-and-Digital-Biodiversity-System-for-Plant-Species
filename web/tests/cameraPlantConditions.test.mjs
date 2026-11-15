import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { parse, compileScript, compileTemplate, compileStyle } from '@vue/compiler-sfc'
import * as context from '../src/utils/cameraPlantContext.ts'
import { iotDate, soilCondition, surfaceCondition } from '../src/utils/iotDisplay.ts'
import { monitoringDate, monitoringLabels } from '../src/utils/officerMonitoringDisplay.ts'
import { formatPlantId } from '../src/utils/plantId.ts'
import { readPlantDetail } from '../src/services/plantDetail.ts'

const officer = { id: 'officer', role: 'Conservation Officer', status: 'Active', mustChangePassword: false }
const reading = (id, plant = '1', timestamp = '2026-11-13T04:00:00Z', values = {}) => ({
  reading_id: id, plant_id: plant, recorded_at: timestamp, temperature_c: 21.4, humidity: 72,
  soil_moisture: 4095, rainfall_mm: 4095, ...values,
})
const device = (value, overrides = {}) => ({ sensor_id: 'sensor-' + value.reading_id, plant_id: value.plant_id,
  device_type: 'Sensor', latest_reading: value, ...overrides })
const location = (id, latitude) => ({ information: { plant_id: id, scientific_name: null, common_name: null, genus_name: null, family_name: null, description: null },
  staff: { status: 'Approved', registered_at: '2026-11-01T00:00:00Z', conservation_status: null, habitat: null,
    approved_location: { latitude, longitude: 113.7, accuracy_m: null, altitude_m: null, zone: 'North trail' } } })
const cameraStatus = (plantId = '1') => ({ cameraId: 'registered-camera', plantId, name: 'Plant camera', status: 'Online' })
const flush = () => new Promise(resolve => setImmediate(resolve))
const flat = root => {
  const result = []
  const walk = n => { if (Array.isArray(n)) return n.forEach(walk); if (!n || typeof n !== 'object') return; result.push(n); if (Array.isArray(n.children)) walk(n.children); else if (n.children?.default) walk(n.children.default()) }
  walk(root); return result
}
const text = root => flat(root).filter(n => typeof n.children === 'string').map(n => n.children).join('')

function harness(component = 'CameraMonitoringSection', props = {}) {
  const source = readFileSync(new URL(`../src/components/${component}.vue`, import.meta.url), 'utf8')
  const { descriptor } = parse(source), script = compileScript(descriptor, { id: component })
  const template = compileTemplate({ source: descriptor.template.content, filename: component + '.vue', id: component, compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  assert.deepEqual(compileStyle({ source: descriptor.styles[0].content, id: component, scoped: true }).errors, [])
  const scope = vue.effectScope(), exports = {}, cleanup = [], emissions = []
  let listener
  const context = { exports, Error, BigInt, setInterval, clearInterval, fetch: (...args) => globalThis.fetch(...args), require(name) {
    if (name === 'vue') return { ...vue, onMounted() {}, onBeforeUnmount: fn => cleanup.push(fn), resolveComponent: name => ({ name }) }
    if (name === 'vue-i18n') return { useI18n: () => ({ locale: vue.ref('en') }) }
    if (name === 'chart.js') return { Chart: class { static register() {} destroy() {} }, registerables: [] }
    if (name.endsWith('cameraPlantContext')) return { cameraPlantId: cameraContext.cameraPlantId, latestCameraPlantReading: cameraContext.latestCameraPlantReading }
    if (name.endsWith('iotDisplay')) return { iotDate, soilCondition, surfaceCondition }
    if (name.endsWith('officerMonitoringDisplay')) return { monitoringDate, monitoringLabels }
    if (name.endsWith('plantId')) return { formatPlantId }
    if (name.endsWith('plantDetail')) return { readPlantDetail }
    if (name.endsWith('/auth')) return { sessionSnapshot: () => ({ user: officer, pending: false }), subscribeSession: fn => { listener = fn; return () => { listener = null } } }
    if (name.endsWith('.vue')) return { name: name.split('/').at(-1) }
    throw Error(name)
  } }
  const js = code => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(`(function(){${js(script.content)}})()`, context)
  const input = vue.reactive({ devices: [], readingsBusy: false, readingsError: '', ...props })
  const state = scope.run(() => exports.default.setup(input, { expose() {}, emit: (...args) => emissions.push(args) }))
  vm.runInNewContext(`(function(){${js(template.code)}})()`, context)
  return { state, props: input, emissions, render: () => flat(exports.render({}, [], input, vue.proxyRefs(state), {}, {})),
    session: (user, pending = false) => listener?.(user, pending), stop() { cleanup.forEach(fn => fn()); scope.stop() } }
}
const cameraContext = context

test('camera plant selection normalizes IDs and takes one latest reading from matching Sensors only', () => {
  for (const [input, expected] of [['PL001', '1'], ['1', '1'], ['00042', '42'], ['9223372036854775807', '9223372036854775807'], ['PL0', ''], ['invalid', ''], [null, '']]) assert.equal(context.cameraPlantId(input), expected)
  const old = reading('old'), latest = reading('latest', '1', '2026-11-13T05:00:00Z', { temperature_c: null, humidity: 0 })
  const devices = [device(old), device(reading('other', '2', '2026-11-14T00:00:00Z')),
    device(reading('camera', '1', '2026-11-15T00:00:00Z'), { device_type: 'Camera' }), device(reading('invalid', '1', 'bad')),
    device(reading('mismatched', '2'), { plant_id: '1' }), device(latest)]
  assert.equal(context.latestCameraPlantReading(devices, 'PL001'), latest)
  assert.equal(context.latestCameraPlantReading(devices, 'PL001').temperature_c, null)
  assert.equal(context.latestCameraPlantReading(devices, '3'), null)
  assert.equal(context.latestCameraPlantReading(devices, ''), null)
})

test('the conditions panel renders sensor units, firmware labels, fixed location and recording time', () => {
  const h = harness('CameraPlantConditions', { plantId: '1', plantLabel: 'PL001', reading: reading('current'),
    location: location('1', 3.8).staff.approved_location, locationLoading: false, locationError: '' })
  try {
    const content = h.render()
    assert.deepEqual(content.filter(n => n.type === 'dd').map(n => n.children), ['21.4 °C', '72%', 'Dry', 'Dry'])
    assert.ok(text(content).includes('Fixed plant location'))
    assert.ok(text(content).includes('3.8, 113.7'))
    assert.ok(text(content).includes('13 Nov 2026, 12:00'))
    const map = content.find(n => n.props?.to)
    assert.equal(map.props.to.query.plant, 'PL001')
    h.props.reading = reading('wet', '1', undefined, { temperature_c: 0, humidity: 0, soil_moisture: 0, rainfall_mm: 0 })
    assert.deepEqual(h.render().filter(n => n.type === 'dd').map(n => n.children), ['0 °C', '0%', 'Wet', 'Wet surface'])
    h.props.reading = null; h.props.location = null
    assert.deepEqual(h.render().filter(n => n.type === 'dd').map(n => n.children), ['—', '—', '—', '—'])
    assert.ok(text(h.render()).includes('Location unavailable'))
    assert.ok(text(h.render()).includes('No sensor readings available for this plant.'))
    assert.ok(!h.render().some(n => n.props?.to))
  } finally { h.stop() }
})

test('normal and expanded previews reuse parent readings and fetch the linked plant location once', async () => {
  const original = globalThis.fetch, calls = [], h = harness('CameraMonitoringSection', { devices: [device(reading('current'))] })
  globalThis.fetch = async url => {
    calls.push(url)
    if (url === '/camera-api/camera-status') return Response.json(cameraStatus())
    if (url === '/camera-api/camera-events') return Response.json({ events: [] })
    assert.equal(url, '/api/data/plants/1/detail')
    return Response.json(location('1', 3.8))
  }
  try {
    await h.state.loadCameraData(); await flush()
    assert.equal(h.state.plantReading.value.reading_id, 'current')
    assert.equal(h.state.plantLocation.value.latitude, 3.8)
    await h.state.loadCameraData(); await flush()
    assert.equal(calls.filter(url => url.includes('/detail')).length, 1)
    h.state.cameraExpanded.value = true
    const panels = h.render().filter(n => n.type?.name === 'CameraPlantConditions.vue')
    assert.equal(panels.length, 2)
    assert.ok(panels.every(n => n.props.reading.reading_id === 'current' && n.props.location.latitude === 3.8))
    h.props.devices = [device(reading('refreshed', '1', '2026-11-13T06:00:00Z'))]
    assert.equal(h.state.plantReading.value.reading_id, 'refreshed')
    panels[0].props.onRefresh(); await flush()
    assert.deepEqual(h.emissions, [['refresh-readings']])
    assert.ok(!calls.some(url => url.includes('/devices')))
  } finally { h.stop(); globalThis.fetch = original }
})

test('late plant location responses cannot cross plant changes or logout', async () => {
  const original = globalThis.fetch, pending = new Map(), h = harness()
  globalThis.fetch = url => new Promise(resolve => pending.set(url, resolve))
  try {
    h.state.camera.value = cameraStatus('1')
    h.state.camera.value = cameraStatus('2')
    pending.get('/api/data/plants/2/detail')(Response.json(location('2', 4.2))); await flush()
    pending.get('/api/data/plants/1/detail')(Response.json(location('1', 3.8))); await flush()
    assert.equal(h.state.plantLocation.value.latitude, 4.2)
    h.state.camera.value = cameraStatus('3')
    h.session(null)
    pending.get('/api/data/plants/3/detail')(Response.json(location('3', 5))); await flush()
    assert.equal(h.state.plantLocation.value, null)
    assert.equal(h.state.plantReading.value, null)
    assert.equal(h.state.linkedPlantId.value, '')
  } finally { h.stop(); globalThis.fetch = original }
})

test('unavailable plant location leaves readings intact and exposes a retry message', async () => {
  const original = globalThis.fetch, h = harness('CameraMonitoringSection', { devices: [device(reading('current'))] })
  globalThis.fetch = async () => Response.json({}, { status: 403 })
  try {
    h.state.camera.value = cameraStatus()
    await flush()
    assert.equal(h.state.plantLocation.value, null)
    assert.match(h.state.locationError.value, /Unable to load/)
    assert.equal(h.state.plantReading.value.reading_id, 'current')
  } finally { h.stop(); globalThis.fetch = original }
})
