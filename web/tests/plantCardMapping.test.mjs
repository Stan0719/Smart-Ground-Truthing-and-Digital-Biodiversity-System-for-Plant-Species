import test from 'node:test'
import assert from 'node:assert/strict'
import { mapPlantCardMetadata, plantReviewStatuses } from '../src/services/plantCardMapping.ts'

const approved = { plant_id: 8, species_id: 6, rbac_status: 'Approved', observed_at: '2026-11-05T03:00:00Z', latitude: 0, longitude: -113, zone: 'Approved zone', current_registration: { state: 'available', observation_id: 'initial-8', content: { heightCm: 42, lifeStage: 'Mature', healthStatus: 'Healthy', morphology: 'Leaves' } }, latest_approved: { heightCm: 99, lifeStage: 'Mature', healthStatus: 'Healthy', morphology: 'Leaves' } }

test('cards map actual approved API fields, preserving zero and negative coordinates', () => {
  const p = mapPlantCardMetadata(approved)
  assert.equal(p.latestApproved.heightCm, 42)
  assert.equal(p.latestApproved.lifeStage, 'Mature')
  assert.equal(p.latestApproved.date, '')
  assert.equal(p.measurementSource, 'registration')
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
    const p = mapPlantCardMetadata({ ...approved, current_registration: undefined, latest_approved, registered_at: '2026-11-04', last_verified_at: 'legacy-value' })
    assert.equal(p.latestApproved.date, '')
  }
})

test('pending proposals and older edited field visits cannot replace the approved registration', () => {
  for (const status of ['Pending Review', 'Correction Required', 'Rejected', 'Cancelled']) {
    const mapped = mapPlantCardMetadata({ ...approved, latest_approved: { heightCm: 900 },
      latest_verified_observation: { id: 'old-visit', status: 'Approved', content: { heightCm: 800 } },
      proposed_snapshot: { status, content: { heightCm: 700 } }, observed_at: '2099-01-01T00:00:00Z' })
    assert.equal(mapped.latestApproved.heightCm, 42)
    assert.equal(mapped.latestApproved.date, '')
  }
  const reloaded = mapPlantCardMetadata({ ...approved, current_registration: {
    state: 'available', observation_id: 'initial-8', content: { heightCm: 50, lifeStage: 'Mature' } } })
  assert.equal(reloaded.latestApproved.heightCm, 50)
})

test('registration provenance is mandatory and pending registration never becomes approved metadata', () => {
  for (const current_registration of [undefined, { state: 'unavailable' }, { state: 'available', content: { heightCm: 42 } }]) {
    assert.ok(Number.isNaN(mapPlantCardMetadata({ ...approved, current_registration }).latestApproved.heightCm))
  }
  for (const rbac_status of ['Pending Review', 'Correction Required', 'Rejected', 'Withdrawn']) {
    const mapped = mapPlantCardMetadata({ ...approved, rbac_status })
    assert.equal(mapped.reviewStatus, rbac_status)
    assert.equal(mapped.measurementSource, 'unavailable')
    assert.ok(Number.isNaN(mapped.latestApproved.heightCm))
    assert.ok(Number.isNaN(mapped.location.latitude))
  }
})

test('current Plant name stays distinct from the Species catalogue and historical observations',()=>{
 const mapped=mapPlantCardMetadata({...approved,scientific_name:'Officer corrected name',latest_submission:{scientific_name:'Draft name'}})
 assert.equal(mapped.plantScientificName,'Officer corrected name')
 assert.equal(mapped.latestApproved.heightCm,42)
 assert.equal(mapPlantCardMetadata({...approved,scientific_name:null}).plantScientificName,'')
})
