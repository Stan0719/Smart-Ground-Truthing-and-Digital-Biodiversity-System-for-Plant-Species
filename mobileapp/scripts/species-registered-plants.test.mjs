import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const orderingSource = read('../utils/speciesPlantOrdering.js')
  .replace(/^import .*;\r?\n/gm, '')
  .replace(/export /g, '')
const context = vm.createContext({
  submissionStatus: (status) => {
    const value = String(status || '').toLowerCase()
    return value === 'approved' ? 'approved' : value === 'rejected' ? 'rejected' :
      ['pending', 'pending review'].includes(value) ? 'pending' : value
  },
})
vm.runInContext(orderingSource, context)

test('Registered Plants are sorted by approval status and newest date, preserving all records', () => {
  context.records = [
    { plantId: 'r-old', status: 'Rejected', created_at: '2026-11-15T10:00:00Z' },
    { plantId: 'p-old', status: 'Pending Review', created_at: '2026-11-15T10:00:00Z' },
    { plantId: 'a-old', status: 'Approved', created_at: '2026-11-15T10:00:00Z' },
    { plantId: 'a-new', status: 'approved', created_at: '2026-11-16T10:00:00Z' },
    { plantId: 'p-correction', status: 'Correction Required' },
    { plantId: 'r-new', status: 'Rejected', created_at: '2026-11-16T10:00:00Z' },
  ]
  const ids = vm.runInContext('orderSpeciesPlantRecords(records).map((record) => record.plantId)', context)
  assert.deepEqual(Array.from(ids), ['a-new', 'a-old', 'p-old', 'p-correction', 'r-new', 'r-old'])
})

test('Registered Plants ordering preserves stable input order when dates are unavailable', () => {
  context.records = [
    { plantId: '22', currentStatus: 'Pending Review' },
    { plantId: '21', currentStatus: 'Pending Review' },
    { plantId: '20', currentStatus: 'Pending Review' },
  ]
  const ids = vm.runInContext('orderSpeciesPlantRecords(records).map((record) => record.plantId)', context)
  assert.deepEqual(Array.from(ids), ['22', '21', '20'])
})

test('Species Details sorts only authorized results and exposes every record in a three-card nested viewport', () => {
  const source = read('../screens/SpeciesDetail.js')
  assert.match(source, /isPlantVisibleInRoleCatalog\(record, user\?\.role, user\?\.id\)[\s\S]*?\|\| isOwnedRejectedPlant\(record, user\?\.id\)/)
  assert.match(source, /orderSpeciesPlantRecords\(speciesPlants\)/)
  assert.match(source, /orderedSpeciesPlants\.length <= 3/)
  assert.match(source, /<DiscoverableScrollView nested hintKey="speciesDetail\.scrollToSeeMorePlants"[\s\S]*?nestedScrollEnabled[\s\S]*?directionalLockEnabled/)
  assert.match(source, /\{orderedSpeciesPlants\.map\(\(plant\) =>/)
  assert.doesNotMatch(source, /speciesPlants\s*\.slice\(0,\s*3\)/)
  assert.match(source, /navigation=\{navigation\}[\s\S]*?speciesDetailCard/)

  for (const language of ['en', 'ms', 'zh']) {
    const catalog = JSON.parse(read(`../translations/${language}.json`))
    assert.ok(catalog.speciesDetail.scrollToSeeMorePlants, language)
  }
})
