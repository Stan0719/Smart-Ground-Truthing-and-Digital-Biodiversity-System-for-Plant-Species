import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

test('plant adapters normalize private-schema records without inventing redacted fields', async () => {
  const source = readFileSync(new URL('../utils/plantApi.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/export /g, '')
  const requestedUrls = []
  const context = vm.createContext({
    mobileApiUrl: () => 'https://example.invalid',
    faceSession: { hasSession: () => false, withToken: async operation => operation('fixture-token', { id: 'owner' }) },
    fetch: async (url) => { requestedUrls.push(url); return ({ ok: true, json: async () => ({ plants: [
      { plant_id: 1, species_id: 2, rbac_status: 'Approved', registered_subject: 'staff:owner', observed_at: '2026-01-02', plant_image_asset_id: 'plant-photo-1', latest_approved: { heightCm: 40, healthStatus: 'Healthy' } },
      { plant_id: 3, species_id: 2, status: 'Approved' },
      { plant_id: 8, species_id: 2, rbac_status: 'Approved', latitude: 4.5, longitude: 113.7, accuracy_m: 6, altitude_m: 28, zone: 'Zone A', latest_approved: { latitude: null, longitude: null, accuracy_m: null, altitudeM: 99, zone: 'Pending zone' } },
      { plant_id: 9, species_id: 2, rbac_status: 'Approved', latitude: null, longitude: null, accuracy_m: null, altitude_m: null, zone: null, latest_approved: { latitude: 5, longitude: 114, accuracy_m: 2, altitudeM: 30, zone: 'Older location' } },
    ] }) }); },
  })
  vm.runInContext(source, context)
  const records = await vm.runInContext('fetchPlantRecords([])', context)
  await vm.runInContext('fetchPlantRecords([], { scopeMine: true })', context)
  assert.ok(requestedUrls.some((url) => url.endsWith('/api/plants?scope=mine')))
  assert.equal(records[0].currentStatus, 'Approved')
  assert.equal(records[0].registeredBy, 'staff:owner')
  assert.equal(records[0].latestApproved.heightCm, 40)
  assert.equal(records[0].latestApproved.date, '2026-01-02')
  assert.equal(records[0].plantImageAssetId, 'plant-photo-1')
  assert.equal(records[0].plantImage.uri, 'https://example.invalid/api/assets/plant-photo-1')
  const authenticatedPlantPhoto = await vm.runInContext('plantAssetSources([{id: "plant-photo-1"}], "owner")', context)
  assert.deepEqual(JSON.parse(JSON.stringify(authenticatedPlantPhoto[0])), {
    uri: 'https://example.invalid/api/assets/plant-photo-1',
    headers: { Authorization: 'Bearer fixture-token' },
  })
  assert.equal(records[1].currentStatus, 'Approved')
  assert.equal(records[1].location.latitude, null)
  assert.equal(records[1].registeredBy, 'Not recorded')
  assert.deepEqual(JSON.parse(JSON.stringify(records[2].location)), {
    latitude: 4.5, longitude: 113.7, accuracyM: 6, altitudeM: 28, zone: 'Zone A',
  })
  assert.deepEqual(JSON.parse(JSON.stringify(records[3].location)), {
    latitude: null, longitude: null, accuracyM: null, altitudeM: null, zone: null,
  })
  const species = await vm.runInContext('mapBackendSpecies({species_id: 18, common_name: "Pea family plant", scientific_name: "Example plant", family_name: "Fabaceae", category: "Trees"})', context)
  assert.equal(species.family, 'Fabaceae')
  assert.equal(species.category, undefined)
  const speciesImage = await vm.runInContext('mapBackendSpecies({species_id: 24, common_name: "Verified", scientific_name: "Verified species", image_asset_id: "asset/24"})', context)
  assert.equal(speciesImage.speciesImageVerified, true)
  assert.equal(speciesImage.image.uri, 'https://example.invalid/api/assets/asset%2F24')
  const localSpeciesName = await vm.runInContext('mapBackendSpecies({species_id: 26, common_name: "Wild Ginger", scientific_name: "Etlingera elatior"})', context)
  assert.equal(localSpeciesName.slug, 'api-species-26')
  assert.equal(localSpeciesName.name, 'Wild Ginger')
  const arbitraryImageUrl = await vm.runInContext('mapBackendSpecies({species_id: 25, image_url: "https://example.invalid/unrelated-bird.jpg"})', context)
  assert.equal(arbitraryImageUrl.speciesImageVerified, false)
  assert.equal(arbitraryImageUrl.image, undefined)
})

test('Plant Detail keeps the authenticated approved-plant photo source returned by the backend', async () => {
  const source = readFileSync(new URL('../utils/plantApi.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/export /g, '')
  const requests = []
  const context = vm.createContext({
    mobileApiUrl: () => 'https://example.invalid',
    AbortSignal: { timeout: () => undefined },
    faceSession: { hasSession: () => true, withToken: async operation => operation('fixture-token', { id: 'owner', role: 'Botanist' }) },
    fetch: async (url, init) => {
      requests.push({ url, authorization: init?.headers?.Authorization })
      const data = url.endsWith('/api/plants/1')
        ? { plant: { plant_id: 1, species_id: 2, rbac_status: 'Approved' } }
        : url.includes('/api/species')
          ? { species: [{ species_id: 2, scientific_name: 'Verified species', common_name: 'Verified plant' }] }
          : { assets: [{ id: 'approved-photo', content_type: 'image/jpeg' }] }
      return { ok: true, status: 200, text: async () => JSON.stringify(data) }
    },
  })
  vm.runInContext(source, context)
  const plant = await vm.runInContext('fetchPlantDetail("1", { accountId: "owner" })', context)
  assert.equal(plant.photos.length, 1)
  assert.equal(plant.photos[0].uri, 'https://example.invalid/api/assets/approved-photo')
  assert.deepEqual(JSON.parse(JSON.stringify(plant.photos[0].headers)), { Authorization: 'Bearer fixture-token' })
  assert.ok(requests.some(request => request.url.endsWith('/api/assets?plant_id=1') && request.authorization === 'Bearer fixture-token'))
})
