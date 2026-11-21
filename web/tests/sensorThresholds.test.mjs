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
  vm.runInNewContext(js(script.content), context)
  const props = vue.reactive({ value: 40, configured: { min: 20, max: 35 } })
  const state = context.exports.default.setup(props, { expose() {} })
  assert.equal(state.state.value, 'Above maximum'); assert.equal(state.breached.value, true)
  props.value = 25; assert.equal(state.breached.value, false)
  for (const lang of ['en', 'ms', 'zh-CN']) {
    const labels = JSON.parse(readFileSync(new URL('../src/locales/' + lang + '.json', import.meta.url), 'utf8')).conservationText
    for (const key of ['configuredlimits','belowminimum','abovemaximum','withinrange','notconfigured','readingunavailable','plantatdetection','capturedat'])
      assert.ok(labels[key] && !labels[key].includes('?'), lang + ':' + key)
  }
})
