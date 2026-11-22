import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const view = readFileSync(new URL('../src/views/conservation/PlantsView.vue', import.meta.url), 'utf8')
const service = readFileSync(new URL('../src/services/officerPlants.ts', import.meta.url), 'utf8')

test('Officer Plants uses four localized columns, Plant and Species names, and no status, QR display or map action', () => {
  assert.match(view, /\['plantId','species','registered','actions'\]/)
  assert.match(view, /<strong>{{ formatPlantId\(plant\.id\) }}<\/strong><em class="plant-name-inline">{{ plant\.scientific_name }}<\/em>/)
  assert.match(view, /<strong class="species-name">{{ plant\.species_scientific_name }}<\/strong>/)
  assert.doesNotMatch(view, /v-model="status"|plant\.qr_id|registry-links|conservation-map/)
  assert.match(service, /row\.status !== 'Approved'/)
  for (const locale of ['en', 'ms', 'zh-CN']) {
    const translations = JSON.parse(readFileSync(new URL(`../src/locales/${locale}.json`, import.meta.url), 'utf8'))
    assert.ok(translations.officerPlants.species)
    assert.ok(translations.officerPlants.registered)
    assert.ok(translations.officerPlants.actions)
  }
  // The registry intentionally switches to cards through tablet widths too.
  assert.match(view, /@container \(max-width: 900px\)/)
})

test('mobile Plant cards stay within their viewport and align identity, details and all three actions like Species cards', () => {
  const mobile = view.slice(view.indexOf('@container (max-width: 900px)'))
  assert.match(mobile, /\.registry-panel\s*\{[^}]*width:100%;min-width:0;max-width:100%/)
  assert.match(mobile, /\.registry-table, tbody\s*\{[^}]*width:100%;min-width:0;max-width:100%/)
  assert.match(mobile, /tbody tr\s*\{[^}]*width:100%;min-width:0;max-width:100%/)
  assert.match(mobile, /\.plant-identity\s*\{[^}]*padding:0 0 14px 62px/)
  assert.match(mobile, /\.plant-identity \.plant-emblem\s*\{[^}]*position:absolute/)
  assert.match(mobile, /\.registry-actions\s*\{[^}]*grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/)
  assert.match(mobile, /\.icon-action\s*\{[^}]*min-width:0/)
})
