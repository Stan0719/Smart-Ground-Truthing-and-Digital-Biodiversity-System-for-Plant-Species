import assert from 'node:assert/strict'
import test from 'node:test'
import { mapPlantContract, hasValidCoordinates } from '../src/services/plantIntegration.ts'

const fixture = (extra = {}) => ({
  plant_id: 17, species_id: 7, rbac_status: 'Pending Review',
  latitude: null, longitude: null, accuracy_m: null, altitude_m: null, zone: null,
  observation_status: 'Pending Review',
  latest_submission: { latitude: 4, longitude: 113, accuracy_m: 8.96, altitudeM: 18.55, zone: 'zone test' },
  ...extra,
})

test('pending Plant 17-like submission preserves evidence without inventing approved GPS', () => {
  const p = mapPlantContract(fixture())
  assert.equal(hasValidCoordinates(p), false)
  assert.equal(p.accuracyM, null)
  assert.equal(p.altitudeM, null)
  assert.equal(p.zone, '')
  assert.deepEqual(p.submittedGps, { status: 'Pending Review', latitude: 4, longitude: 113, accuracyM: 8.96, altitudeM: 18.55, zone: 'zone test' })
})

test('approved and submitted GPS remain independent, including status and optional metadata', () => {
  const p = mapPlantContract(fixture({ latitude: 0, longitude: -20, accuracy_m: 0, altitude_m: -5, zone: 'Approved zone' }))
  assert.equal(hasValidCoordinates(p), true)
  assert.equal(p.latitude, 0)
  assert.equal(p.longitude, -20)
  assert.equal(p.accuracyM, 0)
  assert.equal(p.altitudeM, -5)
  assert.equal(p.zone, 'Approved zone')
  assert.equal(p.submittedGps.latitude, 4)
  assert.equal(p.submittedGps.status, 'Pending Review')
  assert.equal(mapPlantContract(fixture({ latest_submission: null })).submittedGps, null)
})

test('optional accuracy, altitude and zone never invalidate a valid submitted pair', () => {
  for (const optional of [{}, { accuracy_m: null, altitudeM: null, zone: null }, { accuracy_m: -1, altitudeM: 'bad', zone: {} }]) {
    const p = mapPlantContract(fixture({ latest_submission: { latitude: '0', longitude: '-113', ...optional } }))
    assert.equal(p.submittedGps.latitude, 0)
    assert.equal(p.submittedGps.longitude, -113)
    assert.equal(p.submittedGps.accuracyM, null)
    assert.equal(p.submittedGps.altitudeM, null)
    assert.equal(p.submittedGps.zone, '')
  }
})

test('invalid or incomplete submitted coordinates cannot appear as a valid pair', () => {
  for (const latitude of [null, undefined, '', ' ', true, [], {}, NaN, Infinity, 91, 'invalid']) {
    const p = mapPlantContract(fixture({ latest_submission: { latitude, longitude: 113 } }))
    assert.equal(p.submittedGps.latitude, null)
    assert.equal(p.submittedGps.longitude, null)
  }
  for (const longitude of [null, -181, Infinity, false]) {
    const p = mapPlantContract(fixture({ latest_submission: { latitude: 4, longitude } }))
    assert.equal(p.submittedGps.latitude, null)
    assert.equal(p.submittedGps.longitude, null)
  }
})
