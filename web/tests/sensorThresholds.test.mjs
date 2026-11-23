import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { parse, compileScript, compileTemplate, compileStyle } from '@vue/compiler-sfc'
import * as thresholds from '../src/services/sensorThresholds.ts'
import { mapCanonicalDevice, loadLatestReadings } from '../src/services/iotMonitoring.ts'

test('threshold status preserves zero, legacy maxima, boundaries, missing values and disabled limits', () => {
  const { sensorLimits, thresholdState, thresholdLabel } = thresholds
  assert.deepEqual(sensorLimits(0), { max: 0 }); assert.equal(thresholdState(0, 0), 'Within range')
  assert.equal(thresholdState(1, 0), 'Above maximum'); assert.equal(thresholdState(-1, { min: 0 }), 'Below minimum')
  assert.equal(thresholdState(20, { min: 20, max: 30 }), 'Within range')
  assert.equal(thresholdState(30, { min: 20, max: 30 }), 'Within range')
  assert.equal(thresholdState(null, 30), 'Reading unavailable'); assert.equal(thresholdState(25, {}), 'Not configured')
  assert.equal(sensorLimits({ min: 40, max: 30 }), null); assert.equal(sensorLimits({ max: '30' }), null)
  assert.equal(thresholdLabel({ min: 0, max: 30 }), '≥ 0 · ≤ 30')
  assert.equal(thresholds.thresholdRangeLabel({ min: 26, max: 40 }, '°C'), '26–40 °C')
  assert.equal(thresholds.thresholdRangeLabel({ min: 0 }, '%'), '≥ 0 %')
  assert.equal(thresholds.thresholdRangeLabel(0, 'raw ADC'), '≤ 0 raw ADC')
  assert.equal(thresholds.thresholdRangeLabel(null), '')
})

test('Officer adapter retains thresholds and a latest-reading refresh obtains changed limits', async () => {
  const raw = { id: 'sensor', name: 'Sensor', device_type: 'Sensor', status: 'Active', plant_id: 1,
    latest_reading: null, thresholds: { temperature: { min: 20, max: 30 } } }
  const device = mapCanonicalDevice(raw)
  assert.deepEqual(device.thresholds, raw.thresholds)
  const original = globalThis.fetch
  try {
    globalThis.fetch = async () => Response.json({ readings: [], page: 1, limit: 1, hasMore: false, thresholds: { temperature: { min: 10, max: 40 } } })
    const [updated] = await loadLatestReadings([device], new AbortController().signal)
    assert.equal(updated.thresholds.temperature.max, 40)
    assert.equal(device.thresholds.temperature.max, 30)
  } finally { globalThis.fetch = original }
})

test('Officer threshold component renders limits, non-colour status and complete localized labels', () => {
  const filename = 'SensorThresholdStatus.vue'
  const { descriptor } = parse(readFileSync(new URL('../src/components/conservation/' + filename, import.meta.url), 'utf8'))
  const script = compileScript(descriptor, { id: 'threshold-test' })
  const template = compileTemplate({ source: descriptor.template.content, filename, id: 'threshold-test', compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, []); assert.deepEqual(compileStyle({ source: descriptor.styles[0].content, filename, id: 'threshold-test' }).errors, [])
  const context = { exports: {}, require(name) {
    if (name === 'vue') return vue
    if (name.includes('useConservationText')) return { useConservationText: () => ({ ct: value => value }) }
    if (name.includes('sensorThresholds')) return thresholds
    throw Error(name)
  } }
  const js = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(`(function(){${js(script.content)}})()`, context)
  vm.runInNewContext(`(function(){${js(template.code)}})()`, context)
  const props = vue.reactive({ value: 40, configured: { min: 20, max: 35 } })
  const state = context.exports.default.setup(props, { expose() {} })
  const render = () => {
    const nodes = []
    const walk = n => {
      if (Array.isArray(n)) return n.forEach(walk)
      if (!n || typeof n !== 'object') return
      nodes.push(n)
      if (Array.isArray(n.children)) walk(n.children)
    }
    walk(context.exports.render({}, [], props, vue.proxyRefs(state), {}, {}))
    return nodes
  }
  assert.equal(state.state.value, 'Above maximum'); assert.equal(state.breached.value, true)
  assert.ok(render().some(n => n.props?.class === 'threshold-badge' && n.children === 'Above maximum'))
  assert.ok(render().some(n => n.type === 'strong' && n.props.class.includes('breached')))
  props.value = 25; assert.equal(state.breached.value, false)
  assert.ok(!render().some(n => n.props?.class === 'threshold-badge'))
  props.value = 19; assert.equal(state.state.value, 'Below minimum')
  assert.ok(render().some(n => n.props?.class === 'threshold-badge' && n.children === 'Below minimum'))
  for (const [metric, unit, min, max] of [['temperature', '°C', 26, 40], ['humidity', '%', 40, 80], ['soilMoisture', 'raw ADC', 2300, 2700]]) {
    Object.assign(props, { metric, unit, configured: undefined, value: min })
    assert.equal(state.usingDefault.value, true)
    assert.equal(state.range.value, `${min}–${max} ${unit}`)
    assert.equal(state.breached.value, false)
    assert.ok(render().some(n => n.props?.class === 'sensor-range' && n.children === `Default range: ${min}–${max} ${unit}`))
    props.value = max; assert.equal(state.breached.value, false)
    props.value = min - 1; assert.equal(state.state.value, 'Below minimum'); assert.equal(state.breached.value, true)
    props.value = max + 1; assert.equal(state.state.value, 'Above maximum'); assert.equal(state.breached.value, true)
    props.value = null; assert.equal(state.reading.value, '—'); assert.equal(state.breached.value, false)
  }
  Object.assign(props, { metric: 'rainfall', unit: 'raw ADC', configured: undefined })
  assert.equal(state.usingDefault.value, true)
  assert.equal(state.range.value, '≥ 2200 raw ADC')
  for (const value of [2200, 3000, 4095]) {
    props.value = value
    assert.equal(state.breached.value, false, `Dry/default rain reading ${value} is neutral`)
    assert.ok(!render().some(n => n.props?.class === 'threshold-badge'))
    assert.ok(!render().some(n => n.type === 'strong' && n.props.class.includes('breached')))
  }
  for (const value of [0, 2199]) {
    props.value = value
    assert.equal(state.state.value, 'Below minimum')
    assert.equal(state.breached.value, true, `Wet rain reading ${value} is red`)
    assert.ok(render().some(n => n.props?.class === 'threshold-badge' && n.children === 'Below minimum'))
  }
  props.value = null; assert.equal(state.breached.value, false)
  Object.assign(props, { value: 4095, configured: { min: 2200, max: 3000 } })
  assert.equal(state.usingDefault.value, false)
  assert.equal(state.state.value, 'Above maximum', 'Explicit custom rain limits still apply')
  Object.assign(props, { metric: 'humidity', unit: '%', value: 0, configured: { min: 0, max: 10 } })
  assert.equal(state.reading.value, '0%'); assert.equal(state.usingDefault.value, false)
  assert.equal(state.range.value, '0–10 %'); assert.equal(state.breached.value, false)
  props.configured = null
  assert.equal(state.range.value, ''); assert.equal(state.breached.value, false)
  assert.ok(render().some(n => n.props?.['aria-label'] === 'Not configured' && n.children === '—'))
  Object.assign(props, { metric: 'movement', configured: undefined })
  assert.equal(state.usingDefault.value, false)
  for (const lang of ['en', 'ms', 'zh-CN']) {
    const labels = JSON.parse(readFileSync(new URL('../src/locales/' + lang + '.json', import.meta.url), 'utf8')).conservationText
    for (const key of ['range','defaultrange','belowminimum','abovemaximum','withinrange','notconfigured','readingunavailable','plantatdetection','capturedat'])
      assert.ok(labels[key] && !labels[key].includes('?'), lang + ':' + key)
  }
})
