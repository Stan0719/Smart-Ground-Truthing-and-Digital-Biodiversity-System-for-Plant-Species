import test from 'node:test'
import assert from 'node:assert/strict'
import { mapPlantCardMetadata, plantReviewStatuses } from '../src/services/plantCardMapping.ts'

const approved = { plant_id: 8, species_id: 6, rbac_status: 'Approved', observed_at: '2026-11-05T03:00:00Z', latitude: 0, longitude: -113, zone: 'Approved zone', latest_approved: { heightCm: 42, lifeStage: 'Mature', healthStatus: 'Healthy', morphology: 'Leaves' } }

test('cards map actual approved API fields, preserving zero and negative coordinates', () => {
  const p = mapPlantCardMetadata(approved)
  assert.equal(p.latestApproved.heightCm, 42)
  assert.equal(p.latestApproved.lifeStage, 'Mature')
  assert.equal(p.latestApproved.date, approved.observed_at)
  assert.equal(p.location.zone, 'Approved zone')
  assert.equal(p.location.latitude, 0)
  assert.equal(p.location.longitude, -113)
  assert.equal(p.reviewStatus, 'Approved')
})

test('pending evidence never fills approved card fields or verification dates', () => {
  const p = mapPlantCardMetadata({ plant_id: 17, species_id: 7, rbac_status: 'Pending Review', registered_at: '2026-11-05', latitude: null, longitude: null, latest_submission: { heightCm: 80, lifeStage: 'Young', latitude: 4, longitude: 113, zone: 'Private pending zone' } })
  assert.equal(p.reviewStatus, 'Pending Review')
  assert.ok(Number.isNaN(p.latestApproved.heightCm))
  assert.equal(p.latestApproved.lifeStage, '')
  assert.equal(p.latestApproved.date, '')
  assert.equal(p.location.zone, '')
  assert.ok(Number.isNaN(p.location.latitude))
  assert.ok(Number.isNaN(p.location.longitude))
})

test('only authoritative supported plant statuses produce badges', () => {
  for (const status of plantReviewStatuses) assert.equal(mapPlantCardMetadata({ ...approved, rbac_status: status }).reviewStatus, status)
  for (const status of [undefined, 'Draft', 'Unknown']) assert.equal(mapPlantCardMetadata({ ...approved, rbac_status: status, status: 'Approved' }).reviewStatus, '')
})

test('public projections remain empty of staff metadata and do not infer status', () => {
  const p = mapPlantCardMetadata({ plant_id: 8, species_id: 6, plant_image_asset_id: 'authorized-preview' })
  assert.equal(p.reviewStatus, '')
  assert.equal(p.latestApproved.date, '')
  assert.equal(p.latestApproved.lifeStage, '')
  assert.ok(Number.isNaN(p.latestApproved.heightCm))
  assert.equal(p.location.zone, '')
})

test('missing approved content never uses submission or registration timestamps', () => {
  for (const latest_approved of [null, undefined]) {
    const p = mapPlantCardMetadata({ ...approved, latest_approved, registered_at: '2026-11-04', last_verified_at: 'legacy-value' })
    assert.equal(p.latestApproved.date, '')
  }
})
