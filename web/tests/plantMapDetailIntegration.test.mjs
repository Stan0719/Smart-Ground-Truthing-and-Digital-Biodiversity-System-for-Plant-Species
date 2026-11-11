import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  enrichPlant,
  hasValidCoordinates,
  mapPlantContract,
  mapSpeciesContract,
  matchesPlantQuery,
  rawPlantIdFromRoute,
  requestPlantApi,
} from '../src/services/plantIntegration.ts'

const plantFixture = (overrides = {}) => ({
  plant_id: 12,
  species_id: 4,
  rbac_status: 'Pending Review',
  registered_subject: 'staff:real-subject',
  registered_at: '2026-10-01T09:00:00Z',
  latitude: 0,
  longitude: 0,
  accuracy_m: 0,
  observed_at: '2026-10-31T08:00:00Z',
  latest_approved: {
    heightCm: 42,
    healthStatus: 'Healthy',
    lifeStage: 'Mature',
    morphology: 'Current approved morphology',
    notes: 'Current approved notes',
    latitude: 0,
    longitude: 0,
    accuracy_m: 0,
    taxonomy: { genus: 'Shorea' },
  },
  ...overrides,
})
const speciesFixture = (overrides = {}) => ({
  species_id: '4',
  scientific_name: 'Shorea currentis',
  common_name: 'Current meranti',
  genus_name: 'Shorea',
  family_name: 'Dipterocarpaceae',
  conservation_status: 'Vulnerable',
  description: 'Backend species description',
  habitat: 'Backend habitat',
  ...overrides,
})

test('map contract uses raw IDs, rbac_status, real GPS and species enrichment', () => {
  const plant = mapPlantContract(plantFixture())
  const species = mapSpeciesContract(speciesFixture())
  assert.ok(plant && species)
  const enriched = enrichPlant(plant, new Map([[species.id, species]]))
  assert.equal(enriched.id, '12')
  assert.equal(enriched.displayId, 'PL012')
  assert.equal(enriched.status, 'Pending Review')
  assert.equal(enriched.latitude, 0)
  assert.equal(enriched.longitude, 0)
  assert.equal(enriched.accuracyM, 0)
  assert.equal(hasValidCoordinates(enriched), true)
  assert.equal(enriched.species.scientificName, 'Shorea currentis')
  assert.equal(enriched.species.commonName, 'Current meranti')
  assert.equal(enriched.species.conservationStatus, 'Vulnerable')
  assert.equal(enriched.species.genus, 'Shorea')
  assert.equal(enriched.species.family, 'Dipterocarpaceae')
})

test('invalid GPS is retained as an unmapped record and never becomes a marker coordinate', () => {
  for (const coordinates of [
    { latitude: 91, longitude: 10 },
    { latitude: 10, longitude: -181 },
    { latitude: 'invalid', longitude: 10 },
    { latitude: null, longitude: null },
  ]) {
    const plant = mapPlantContract(plantFixture(coordinates))
    assert.ok(plant)
    assert.equal(hasValidCoordinates(plant), false)
  }
})

test('missing species metadata stays null and current-field search remains useful', () => {
  const plant = mapPlantContract(plantFixture())
  assert.ok(plant)
  const enriched = enrichPlant(plant, new Map())
  assert.equal(enriched.species, null)
  assert.equal(matchesPlantQuery(enriched, '12'), true)
  assert.equal(matchesPlantQuery(enriched, 'PL012'), true)
  assert.equal(matchesPlantQuery(enriched, '4'), true)
  assert.equal(matchesPlantQuery(enriched, 'pending review'), true)
  assert.equal(matchesPlantQuery(enriched, 'invented species'), false)
  const withSpecies = enrichPlant(plant, new Map([['4', mapSpeciesContract(speciesFixture())]]))
  assert.equal(matchesPlantQuery(withSpecies, 'shorea currentis'), true)
  assert.equal(matchesPlantQuery(withSpecies, 'current meranti'), true)
})

test('raw plant route IDs are authoritative while visual PL links remain backward compatible', () => {
  assert.equal(rawPlantIdFromRoute('12'), '12')
  assert.equal(rawPlantIdFromRoute('PL012'), '12')
  assert.equal(rawPlantIdFromRoute('0'), '')
  assert.equal(rawPlantIdFromRoute('PLnot-a-number'), '')
  const mapSource = readFileSync(new URL('../src/views/conservation/BiodiversityMapView.vue', import.meta.url), 'utf8')
  assert.match(mapSource, /query\.plant/)
  assert.match(mapSource, /item\.id === routePlantId\.value/)
  assert.match(mapSource, /`\/plant\/\$\{encodeURIComponent\(plant\.id\)\}`/)
  assert.doesNotMatch(mapSource, /current_status|location_recorded_at|scientific_name\?:/)
})

test('plant detail maps current contract, registration, latest approved content and zero GPS', () => {
  const plant = mapPlantContract(plantFixture())
  assert.ok(plant)
  assert.equal(plant.status, 'Pending Review')
  assert.equal(plant.registeredSubject, 'staff:real-subject')
  assert.equal(plant.registeredAt, '2026-10-01T09:00:00Z')
  assert.equal(plant.observedAt, '2026-10-31T08:00:00Z')
  assert.equal(plant.latestApproved.heightCm, 42)
  assert.equal(plant.latestApproved.healthStatus, 'Healthy')
  assert.equal(plant.latestApproved.lifeStage, 'Mature')
  assert.equal(plant.latestApproved.morphology, 'Current approved morphology')
  assert.equal(plant.latestApproved.notes, 'Current approved notes')
  assert.equal(plant.latestApproved.latitude, 0)
  assert.equal(plant.latestApproved.longitude, 0)
  assert.equal(plant.latestApproved.accuracyM, 0)
  assert.deepEqual({ ...plant.latestApproved.taxonomy }, { genus: 'Shorea' })
})

test('plant detail enriches real species fields, connects gallery metadata and retains truthful history scope', () => {
  const source = readFileSync(new URL('../src/views/PlantDetailView.vue', import.meta.url), 'utf8')
  assert.match(source, /\/api\/species\/\$\{encodeURIComponent\(mapped\.speciesId\)\}/)
  assert.match(source, /<PlantPhotoGallery/)
  assert.match(source, /gallery\.load\(plant\.value\.id/)
  assert.doesNotMatch(source, /does not include observation asset IDs/)
  assert.match(source, /Complete observation history is not included/)
  assert.doesNotMatch(source, /registered_by|current_status|location_recorded_at|last_verified_at/)
  assert.doesNotMatch(source, /formatObservationId|OBS001/)
})

test('malformed plant and species records are rejected without inventing values', () => {
  for (const value of [null, {}, { plant_id: 1 }, { species_id: 2 }]) assert.equal(mapPlantContract(value), null)
  for (const value of [null, {}, { species_id: '' }]) assert.equal(mapSpeciesContract(value), null)
  const plant = mapPlantContract(plantFixture({ latest_approved: null, rbac_status: null }))
  assert.ok(plant)
  assert.equal(plant.latestApproved, null)
  assert.equal(plant.status, '')
})

test('API errors preserve backend messages and distinguish 404, malformed and network failures', async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => Response.json({ error: 'Plant unavailable from database.' }, { status: 404 })
    await assert.rejects(requestPlantApi('/api/plants/999'), { message: 'Plant unavailable from database.', status: 404 })
    globalThis.fetch = async () => new Response('<html>gateway</html>', { status: 502 })
    await assert.rejects(requestPlantApi('/api/plants'), { message: 'The plant service returned an invalid response.', kind: 'invalid' })
    globalThis.fetch = async () => { throw Error('offline') }
    await assert.rejects(requestPlantApi('/api/plants'), { message: 'The plant service could not be reached. Please try again.', kind: 'network' })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('map has no hardcoded plant marker fixtures', () => {
  const source = readFileSync(new URL('../src/views/conservation/BiodiversityMapView.vue', import.meta.url), 'utf8')
  assert.match(source, /requestPlantApi\('\/api\/plants'\)/)
  assert.match(source, /requestPlantApi\('\/api\/species\?scope=scientific'\)/)
  assert.doesNotMatch(source, /CAM-001|OBS001|PL001|Moon Cave|Painted Cave/)
})
