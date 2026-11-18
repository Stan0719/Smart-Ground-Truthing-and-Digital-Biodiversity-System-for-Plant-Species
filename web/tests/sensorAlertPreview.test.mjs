import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSensorPreview, previewOnlySource, PREVIEW_BANNER } from './sensorAlertPreview.mjs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const page = readFileSync(new URL('../src/views/conservation/ThreatAlertsView.vue', import.meta.url), 'utf8')

test('preview transforms only an in-memory copy of the real modal and disables mutation controls', () => {
  const preview = previewOnlySource(page)
  assert.ok(preview.includes(PREVIEW_BANNER))
  assert.ok(!page.includes(PREVIEW_BANNER))
  assert.match(preview, /const submitResponse = async \(\) => \{\s+return \/\/ Offline preview/)
  assert.doesNotMatch(preview, /@click="submitResponse"/)
  assert.match(preview, /class="sensor-preview-readings-scroll" tabindex="0" role="region"/)
  assert.ok([...preview.matchAll(/:disabled="([^"]*)"/g)].every(m => m[1] === 'true'))
  assert.match(preview, /onMounted\(async \(\) => \{ await loadAlerts\(\); if \(alerts.value\[0\]\) openAlert/)
  const { descriptor } = parse(preview), script = compileScript(descriptor, { id: 'offline-sensor' })
  const template = compileTemplate({ source: descriptor.template.content, filename: 'OfflineSensor.vue', id: 'offline-sensor', compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  assert.throws(() => previewOnlySource('<template>unexpected</template>'), /contract changed/)
})

test('offline artifact has no external scripts, network capability or production preview dependency', async () => {
  const html = await buildSensorPreview()
  assert.ok(html.includes(PREVIEW_BANNER))
  assert.match(html, /connect-src 'none'/)
  assert.match(html, /form-action 'none'/)
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=|<video/)
  assert.ok(html.includes('fixture-temperature-alert'))
  assert.ok(html.includes('Offline preview: transport disabled'))
  assert.ok(html.includes('Trigger'))
  assert.ok(html.includes('Context'))
  assert.ok(html.includes('Threshold unavailable'))
  assert.doesNotMatch(page, /sensorAlertFixture|sensorAlertPreview|fixture-temperature-alert/)
})
