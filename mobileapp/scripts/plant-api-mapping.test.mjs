import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

test('plant adapters normalize private-schema records without inventing redacted fields', async () => {
  const source = readFileSync(new URL('../utils/plantApi.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/export /g, '')
  const context = vm.createContext({
    mobileApiUrl: () => 'https://example.invalid',
    faceSession: { hasSession: () => false },
    fetch: async () => ({ ok: true, json: async () => ({ plants: [
      { plant_id: 1, species_id: 2, rbac_status: 'Approved', registered_subject: 'staff:owner', observed_at: '2026-01-02', latest_approved: { heightCm: 40, healthStatus: 'Healthy' } },
      { plant_id: 3, species_id: 2, status: 'Approved' },
    ] }) }),
  })
  vm.runInContext(source, context)
  const records = await vm.runInContext('fetchPlantRecords([])', context)
  assert.equal(records[0].currentStatus, 'Approved')
  assert.equal(records[0].registeredBy, 'staff:owner')
  assert.equal(records[0].latestApproved.heightCm, 40)
  assert.equal(records[0].latestApproved.date, '2026-01-02')
  assert.equal(records[1].currentStatus, 'Approved')
  assert.equal(records[1].location.latitude, null)
  assert.equal(records[1].registeredBy, 'Not recorded')
})
