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
    restricted: false, latitude: 4.5, longitude: 113.7, accuracyM: 6, altitudeM: 28, zone: 'Zone A',
  })
  assert.deepEqual(JSON.parse(JSON.stringify(records[3].location)), {
    restricted: false, latitude: null, longitude: null, accuracyM: null, altitudeM: null, zone: null,
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

test('plant-specific scientific name comes from the plant or its applicable observation, never the species name', () => {
  const source = readFileSync(new URL('../utils/plantApi.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/export /g, '')
  const context = vm.createContext({ mobileApiUrl: () => 'https://example.invalid', faceSession: {} })
  vm.runInContext(source, context)
  const plants = vm.runInContext(`[
    mapBackendPlant({ plant_id: 8, rbac_status: 'Approved', scientific_name: '', species_details: { scientific_name: 'Species name' }, latest_approved: { content: { scientific_name: 'Approved plant name' } } }),
    mapBackendPlant({ plant_id: 11, rbac_status: 'Pending Review', species_details: { scientific_name: 'Species name' }, latest_submission: { content: { scientific_name: 'Submitted plant name' } } }),
    mapBackendPlant({ plant_id: 12, rbac_status: 'Pending Review', species_details: { scientific_name: 'Species name' } }),
  ]`, context)
  assert.deepEqual(JSON.parse(JSON.stringify(plants.map((plant) => plant.plantScientificName))), [
    'Approved plant name', 'Submitted plant name', '',
  ])
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

test('Plant Detail preserves distinct authenticated photo URLs for a multi-photo plant record', async () => {
  const source = readFileSync(new URL('../utils/plantApi.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/export /g, '')
  const context = vm.createContext({
    mobileApiUrl: () => 'https://example.invalid',
    AbortSignal: { timeout: () => undefined },
    faceSession: { hasSession: () => true, withToken: async operation => operation('fixture-token', { id: 'owner', role: 'Botanist' }) },
    fetch: async (url) => {
      const data = url.includes('/api/plants/17')
        ? { plant: { plant_id: 17, species_id: 6, rbac_status: 'Pending Review', registered_subject: 'staff:owner' } }
        : url.includes('/api/species')
          ? { species: [{ species_id: 6, scientific_name: 'Species six' }] }
          : { assets: [
            { id: 'plant-17-photo-1', content_type: 'image/jpeg' },
            { id: 'plant-17-photo-2', content_type: 'image/jpeg' },
            { id: 'plant-17-photo-3', content_type: 'image/jpeg' },
          ] }
      return { ok: true, status: 200, text: async () => JSON.stringify(data) }
    },
  })
  vm.runInContext(source, context)
  const plant = await vm.runInContext('fetchPlantDetail("17", { accountId: "owner", scopeMine: true })', context)
  assert.deepEqual(JSON.parse(JSON.stringify(plant.photos.map((photo) => photo.uri))), [
    'https://example.invalid/api/assets/plant-17-photo-1?scope=mine',
    'https://example.invalid/api/assets/plant-17-photo-2?scope=mine',
    'https://example.invalid/api/assets/plant-17-photo-3?scope=mine',
  ])
  assert.ok(plant.photos.every((photo) => photo.headers?.Authorization === 'Bearer fixture-token'))
})

test('plant mapper keeps plant names distinct and selects approved versus submitted observation values', async () => {
  const source = readFileSync(new URL('../utils/plantApi.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/export /g, '')
  const context = vm.createContext({ mobileApiUrl: () => 'https://example.invalid', faceSession: {} })
  vm.runInContext(source, context)
  const mapped = await vm.runInContext(`mapBackendPlant({
    plant_id: 17, species_id: 6, scientific_name: 'Plant-specific scientific name',
    common_name: 'Species catalogue common name', rbac_status: 'Pending Review',
    latest_approved: { heightCm: 12, lifeStage: 'Approved stage' },
    latest_submission: { content: { heightCm: 64, lifeStage: 'Submitted stage', healthStatus: 'Healthy', morphology: 'Plant morphology' } },
    observation_status: 'Pending Review'
  })`, context)
  assert.equal(mapped.plantScientificName, 'Plant-specific scientific name')
  assert.equal(mapped.plantCommonName, null)
  assert.equal(mapped.commonName, 'Species catalogue common name')
  assert.equal(mapped.latestSubmission.heightCm, 64)
  assert.equal(mapped.latestSubmission.status, 'Pending Review')
  const values = await vm.runInContext(`({
    approved: getPlantDisplayObservation(mapBackendPlant({ plant_id: 8, rbac_status: 'Approved', latest_approved: { heightCm: 150 }, latest_submission: { content: { heightCm: 131 } }, observation_status: 'Rejected' })),
    pending: getPlantDisplayObservation(mapBackendPlant({ plant_id: 17, rbac_status: 'Pending Review', latest_approved: { heightCm: 10 }, latest_submission: { content: { heightCm: 64 } } }))
  })`, context)
  assert.equal(values.approved.heightCm, 150)
  assert.equal(values.pending.heightCm, 64)
})

test('owner pending plant cards receive only their authenticated plant-photo preview URL', async () => {
  const source = readFileSync(new URL('../utils/plantApi.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/export /g, '')
  const context = vm.createContext({
    mobileApiUrl: () => 'https://example.invalid',
    AbortSignal: { timeout: () => undefined },
    faceSession: { hasSession: () => true, withToken: async operation => operation('private-token', { id: 'owner', role: 'Botanist' }) },
    fetch: async () => ({
      ok: true, status: 200,
      text: async () => JSON.stringify({ plants: [{
        plant_id: 17, species_id: 6, scientific_name: 'Plant 17 name',
        registered_subject: 'staff:owner', rbac_status: 'Pending Review',
        plant_image_asset_id: 'plant-17-photo',
        latest_submission: { heightCm: 64, lifeStage: 'Submitted stage' },
        observation_status: 'Pending Review',
      }] }),
    }),
  })
  vm.runInContext(source, context)
  const plants = await vm.runInContext('fetchPlantRecords([], { accountId: "owner" })', context)
  assert.equal(plants[0].plantImage.uri, 'https://example.invalid/api/assets/plant-17-photo?scope=mine')
  assert.deepEqual(JSON.parse(JSON.stringify(plants[0].plantImage.headers)), { Authorization: 'Bearer private-token' })
  assert.equal(plants[0].plantScientificName, 'Plant 17 name')
  assert.equal(plants[0].plantCommonName, null)
})

test('plant IDs 11, 13 and 17 keep their own submitted data and photo asset identifiers', async () => {
  const source = readFileSync(new URL('../utils/plantApi.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/export /g, '')
  const context = vm.createContext({ mobileApiUrl: () => 'https://example.invalid', faceSession: {} })
  vm.runInContext(source, context)
  const plants = await vm.runInContext(`[
    mapBackendPlant({ plant_id: 11, species_id: 6, scientific_name: 'Plant 11', rbac_status: 'Pending Review', plant_image_asset_id: 'asset-11', latest_submission: { content: { heightCm: 12, lifeStage: 'Seedling' } }, observation_status: 'Rejected' }),
    mapBackendPlant({ plant_id: 13, species_id: 6, scientific_name: 'Plant 13', rbac_status: 'Pending Review', plant_image_asset_id: 'asset-13', latest_submission: { content: { heightCm: 10, lifeStage: 'Young' } }, observation_status: 'Pending Review' }),
    mapBackendPlant({ plant_id: 17, species_id: 6, scientific_name: 'Plant 17', rbac_status: 'Pending Review', plant_image_asset_id: 'asset-17', latest_submission: { content: { heightCm: 64, lifeStage: 'Mature' } }, observation_status: 'Pending Review' }),
  ]`, context)
  const heights = await vm.runInContext(`[
    getPlantDisplayObservation(mapBackendPlant({ plant_id: 11, rbac_status: 'Pending Review', latest_submission: { content: { heightCm: 12 } } })).heightCm,
    getPlantDisplayObservation(mapBackendPlant({ plant_id: 13, rbac_status: 'Pending Review', latest_submission: { content: { heightCm: 10 } } })).heightCm,
    getPlantDisplayObservation(mapBackendPlant({ plant_id: 17, rbac_status: 'Pending Review', latest_submission: { content: { heightCm: 64 } } })).heightCm,
  ]`, context)
  assert.deepEqual(JSON.parse(JSON.stringify(plants.map((plant, index) => [plant.plantId, plant.plantScientificName, plant.plantImageAssetId, heights[index]]))), [
    ['11', 'Plant 11', 'asset-11', 12],
    ['13', 'Plant 13', 'asset-13', 10],
    ['17', 'Plant 17', 'asset-17', 64],
  ])
  const cardSource = readFileSync(new URL('../components/PlantCard.js', import.meta.url), 'utf8')
  assert.match(cardSource, /const imageSource = plant\.plantImage \|\| null/)
  assert.doesNotMatch(cardSource, /getSpeciesImageSource/)
  assert.match(cardSource, /imageSource && !imageFailed/)
  const plantScreens = ['../screens/Plant.js', '../screens/PlantDetail.js', '../screens/Map.js']
    .map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'))
  assert.ok(plantScreens.every((screen) => !screen.includes('getSpeciesImageSource')))
  assert.match(plantScreens[0], /plant\.plantImage && sourceKey\(plant\.plantImage\)/)
  assert.match(plantScreens[1], /const plantPhotos = uniquePlantPhotos\(plant\.photos\)/)
  assert.match(plantScreens[1], /source=\{\{ uri: selectedPhoto\.uri/)
})
