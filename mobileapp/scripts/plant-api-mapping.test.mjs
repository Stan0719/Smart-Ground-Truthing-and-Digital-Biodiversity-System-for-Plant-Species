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

test('Registered By resolves only a verified profile match and never exposes a staff UUID', () => {
  const source = readFileSync(new URL('../utils/plantApi.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/export /g, '')
  const context = vm.createContext({ mobileApiUrl: () => 'https://example.invalid', faceSession: {} })
  vm.runInContext(source, context)
  const display = vm.runInContext(`({
    own: getPlantRegisteredByDisplayName({ registeredBy: 'staff:owner' }, { id: 'owner', name: 'Aina Botanist' }, 'Unknown Botanist'),
    other: getPlantRegisteredByDisplayName({ registeredBy: 'staff:other' }, { id: 'owner', name: 'Aina Botanist' }, 'Unknown Botanist'),
    api: getPlantRegisteredByDisplayName({ registeredBy: 'staff:other', registeredByName: 'Other Botanist' }, { id: 'owner', name: 'Aina Botanist' }, 'Unknown Botanist'),
  })`, context)
  assert.deepEqual(JSON.parse(JSON.stringify(display)), {
    own: 'Aina Botanist', other: 'Unknown Botanist', api: 'Other Botanist',
  })
})

test('plant scientific name uses its own approved/submitted name, then the linked species name when absent', () => {
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
    'Approved plant name', 'Submitted plant name', 'Species name',
  ])
})

test('wrapped approved observation content maps to Visitor card facts without using unapproved observations', () => {
  const source = readFileSync(new URL('../utils/plantApi.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/export /g, '')
  const context = vm.createContext({ mobileApiUrl: () => 'https://example.invalid', faceSession: {} })
  vm.runInContext(source, context)
  const plant = vm.runInContext(`mapBackendPlant({ plant_id: 8, species_id: 2, rbac_status: 'Approved',
    latest_approved: { content: { heightCm: 10, healthStatus: 'Healthy', lifeStage: 'Mature', morphology: 'Broad leaves' } },
    latest_submission: { content: { heightCm: 99, healthStatus: 'Poor', lifeStage: 'Seedling', morphology: 'Unreviewed' } }
  }, new Map([['2', { scientificName: 'Species eight', name: 'Common eight' }]]))`, context)
  assert.equal(plant.plantScientificName, 'Species eight')
  assert.deepEqual(JSON.parse(JSON.stringify(plant.latestApproved)), {
    heightCm: 10, healthStatus: 'Healthy', lifeStage: 'Mature', date: null, morphology: 'Broad leaves', notes: '',
  })
  assert.equal(context.getPlantDisplayObservation(plant).heightCm, 10)
})

test('public Guest and Visitor plant projections map approved summary fields consistently', () => {
  const source = readFileSync(new URL('../utils/plantApi.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/export /g, '')
  const context = vm.createContext({ mobileApiUrl: () => 'https://example.invalid', faceSession: {} })
  vm.runInContext(source, context)
  const publicResponse = {
    plant_id: '19', species_id: '7', scientific_name: 'Plant Testing Trans JA',
    common_name: 'Testingcommon', rbac_status: 'Approved', observed_at: '2026-11-09T12:46:33Z',
    plant_image_asset_id: 'approved-plant-19-photo',
    latest_approved: { heightCm: 80, lifeStage: 'Mature', healthStatus: 'Healthy', morphology: 'Very good, now grow up' },
  }
  const result = vm.runInContext(`(() => {
    const guest = mapBackendPlant(${JSON.stringify(publicResponse)});
    const visitor = mapBackendPlant(${JSON.stringify(publicResponse)});
    return [guest, visitor].map((plant) => ({
      id: plant.id, name: plant.plantScientificName, commonName: plant.commonName,
      status: plant.currentStatus, observation: getPlantDisplayObservation(plant),
      photo: plant.plantImageAssetId, zone: plant.location.zone,
      registeredBy: plant.registeredBy, hasQrToken: Object.hasOwn(plant, 'qr_token'),
    }));
  })()`, context)
  const mapped = JSON.parse(JSON.stringify(result))
  assert.deepEqual(mapped[0], mapped[1], 'Guest and Visitor use identical public plant data')
  assert.equal(mapped[0].id, '19')
  assert.equal(mapped[0].name, 'Plant Testing Trans JA')
  assert.equal(mapped[0].commonName, 'Testingcommon')
  assert.equal(mapped[0].status, 'Approved')
  assert.equal(mapped[0].observation.heightCm, 80)
  assert.equal(mapped[0].observation.lifeStage, 'Mature')
  assert.equal(mapped[0].observation.healthStatus, 'Healthy')
  assert.equal(mapped[0].observation.morphology, 'Very good, now grow up')
  assert.equal(mapped[0].photo, 'approved-plant-19-photo')
  assert.equal(mapped[0].zone, 'Not recorded')
  assert.equal(mapped[0].registeredBy, 'Not recorded')
  assert.equal(mapped[0].hasQrToken, false)
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

test('Plant Detail distinguishes an asset-listing failure from a record with no submitted photos', async () => {
  const source = readFileSync(new URL('../utils/plantApi.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/export /g, '')
  const context = vm.createContext({
    mobileApiUrl: () => 'https://example.invalid', AbortSignal: { timeout: () => undefined },
    faceSession: { hasSession: () => false },
    fetch: async (url) => ({ ok: !url.includes('/api/assets?'), status: url.includes('/api/assets?') ? 503 : 200,
      json: async () => url.includes('/api/plants/19')
        ? { plant: { plant_id: 19, species_id: 6, rbac_status: 'Pending Review', registered_subject: 'staff:owner', latest_submission: { content: { heightCm: 42, morphology: 'Submitted morphology' } } } }
        : url.includes('/api/species') ? { species: [] } : { error: 'Temporarily unavailable' },
      text: async () => JSON.stringify(url.includes('/api/plants/19')
        ? { plant: { plant_id: 19, species_id: 6, rbac_status: 'Pending Review', registered_subject: 'staff:owner', latest_submission: { content: { heightCm: 42, morphology: 'Submitted morphology' } } } }
        : url.includes('/api/species') ? { species: [] } : { error: 'Temporarily unavailable' }) }),
  })
  vm.runInContext(source, context)
  const plant = await vm.runInContext('fetchPlantDetail("19", { scopeMine: true })', context)
  assert.equal(plant.latestSubmission.heightCm, 42)
  assert.equal(plant.latestSubmission.morphology, 'Submitted morphology')
  assert.deepEqual(JSON.parse(JSON.stringify(plant.photos)), [])
  assert.equal(plant.photoLoadError, true)
})

test('Plant Detail maps the selected observation content and its own image assets', async () => {
  const source = readFileSync(new URL('../utils/plantApi.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/export /g, '')
  const context = vm.createContext({
    mobileApiUrl: () => 'https://example.invalid',
    AbortSignal: { timeout: () => undefined },
    faceSession: { hasSession: () => true, withToken: async operation => operation('fixture-token', { id: 'owner', role: 'Botanist' }) },
    fetch: async (url) => {
      const data = url.endsWith('/api/plants/1')
        ? { plant: { plant_id: 1, species_id: 2, rbac_status: 'Approved' } }
        : url.includes('/api/species')
          ? { species: [{ species_id: 2, scientific_name: 'Verified species' }] }
          : url.includes('/api/observations')
            ? { observations: [{
              id: 'observation-1', plant_id: 1, owner_subject: 'staff:owner', status: 'Approved',
              created_at: '2026-11-07T10:00:00Z', updated_at: '2026-11-08T10:00:00Z',
              content: { heightCm: 34, healthStatus: 'Healthy', lifeStage: 'Mature', morphology: 'Broad leaves', notes: 'Flowering', taxonomy: 'Species confirmed' },
              assets: [
                { id: 'observation-photo', content_type: 'image/jpeg' },
                { id: 'observation-document', content_type: 'application/pdf' },
              ],
            }, {
              id: 'observation-old', plant_id: 1, owner_subject: 'staff:owner', status: 'Approved',
              created_at: '2026-11-05T10:00:00Z', updated_at: '2026-11-06T10:00:00Z',
              content: { heightCm: 20 }, assets: [{ id: 'old-observation-photo', content_type: 'image/jpeg' }],
            }] }
            : { assets: [] }
      return { ok: true, status: 200, text: async () => JSON.stringify(data) }
    },
  })
  vm.runInContext(source, context)
  const plant = await vm.runInContext('fetchPlantDetail("1", { includeObservations: true, accountId: "owner" })', context)
  const observation = plant.observations[0]
  assert.equal(observation.observationId, 'observation-1')
  assert.equal(observation.date, '2026-11-07T10:00:00Z')
  assert.equal(observation.updatedAt, '2026-11-08T10:00:00Z')
  assert.deepEqual(JSON.parse(JSON.stringify({
    heightCm: observation.heightCm, healthStatus: observation.healthStatus, lifeStage: observation.lifeStage,
    morphology: observation.morphology, notes: observation.notes, taxonomy: observation.taxonomy,
  })), {
    heightCm: 34, healthStatus: 'Healthy', lifeStage: 'Mature', morphology: 'Broad leaves', notes: 'Flowering', taxonomy: 'Species confirmed',
  })
  assert.deepEqual(JSON.parse(JSON.stringify(observation.photos.map((photo) => ({ id: photo.id, uri: photo.uri }))),), [
    { id: 'observation-photo', uri: 'https://example.invalid/api/assets/observation-photo' },
  ])
  assert.deepEqual(JSON.parse(JSON.stringify(observation.photos[0].headers)), { Authorization: 'Bearer fixture-token' })
  assert.equal(plant.observations.find((row) => row.observationId === 'observation-old').photos.length, 0)
})

test('Plant Detail follows observation cursors so older history is not cut off at the first page', async () => {
  const source = readFileSync(new URL('../utils/plantApi.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/export /g, '')
  const requests = []
  const context = vm.createContext({
    mobileApiUrl: () => 'https://example.invalid',
    AbortSignal: { timeout: () => undefined },
    faceSession: { hasSession: () => true, withToken: async operation => operation('fixture-token', { id: 'owner', role: 'Botanist' }) },
    fetch: async (url) => {
      requests.push(url)
      const data = url.endsWith('/api/plants/2')
        ? { plant: { plant_id: 2, species_id: 2, rbac_status: 'Approved' } }
        : url.includes('/api/species')
          ? { species: [{ species_id: 2, scientific_name: 'Verified species' }] }
          : url.includes('/api/observations?limit=200&cursor=')
            ? { observations: [{ id: 'older', plant_id: 2, owner_subject: 'staff:owner', status: 'Approved', created_at: '2025-01-01', updated_at: '2025-01-01', content: { heightCm: 10 } }], page: { next_cursor: null } }
            : url.includes('/api/observations?limit=200')
              ? { observations: [{ id: 'newer', plant_id: 2, owner_subject: 'staff:owner', status: 'Pending Review', created_at: '2026-01-01', updated_at: '2026-01-01', content: { heightCm: 20 } }], page: { next_cursor: 'cursor-a' } }
              : { assets: [] }
      return { ok: true, status: 200, text: async () => JSON.stringify(data) }
    },
  })
  vm.runInContext(source, context)
  const plant = await vm.runInContext('fetchPlantDetail("2", { includeObservations: true, accountId: "owner" })', context)
  assert.deepEqual(JSON.parse(JSON.stringify(plant.observations.map((observation) => observation.observationId))), ['newer', 'older'])
  assert.ok(requests.some((url) => url.includes('cursor=cursor-a')))
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

test('owner-authorized pending plant Zone is retained independently of GPS coordinates', () => {
  const source = readFileSync(new URL('../utils/plantApi.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/export /g, '')
  const context = vm.createContext({ mobileApiUrl: () => 'https://example.invalid', faceSession: {} })
  vm.runInContext(source, context)
  const pending = vm.runInContext(`mapBackendPlant({
    plant_id: 17, species_id: 6, rbac_status: 'Pending Review', registered_subject: 'staff:owner',
    latitude: null, longitude: null, accuracy_m: null, altitude_m: null, zone: 'Zone B'
  })`, context)
  assert.equal(pending.location.zone, 'Zone B')
  assert.equal(pending.location.latitude, null)
});

test('owner-scoped Zone projection merges only the signed-in Botanist own pending plant Zone', () => {
  const source = readFileSync(new URL('../utils/plantApi.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/export /g, '')
  const context = vm.createContext({ mobileApiUrl: () => 'https://example.invalid', faceSession: {} })
  vm.runInContext(source, context)
  const result = vm.runInContext(`mergeOwnedPendingPlantZones(
    [
      { id: '17', registeredBy: 'staff:owner', currentStatus: 'Pending Review', location: { latitude: null, longitude: null, zone: null, restricted: true } },
      { id: '18', registeredBy: 'staff:other', currentStatus: 'Pending Review', location: { zone: null } },
      { id: '19', registeredBy: 'staff:owner', currentStatus: 'Approved', location: { zone: 'Approved Zone' } }
    ],
    [
      { id: '17', registeredBy: 'staff:owner', currentStatus: 'Pending Review', location: { latitude: null, longitude: null, zone: 'Zone B', restricted: false } },
      { id: '18', registeredBy: 'staff:other', currentStatus: 'Pending Review', location: { zone: 'Other Zone' } },
      { id: '19', registeredBy: 'staff:owner', currentStatus: 'Approved', location: { zone: 'Unapproved proposal' } }
    ],
    'owner'
  )`, context)
  assert.equal(result[0].location.zone, 'Zone B')
  assert.equal(result[0].location.restricted, false)
  assert.equal(result[0].location.latitude, null)
  assert.equal(result[1].location.zone, null, 'another Botanist pending Zone is never merged')
  assert.equal(result[2].location.zone, 'Approved Zone', 'approved plant location remains unchanged')
});

test('approved and owner-visible pending plant records keep their linked species scientific name separate from plant names', () => {
  const source = readFileSync(new URL('../utils/plantApi.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/export /g, '')
  const context = vm.createContext({ mobileApiUrl: () => 'https://example.invalid', faceSession: {} })
  vm.runInContext(source, context)
  const records = [
    { plant_id: 8, species_id: 6, scientific_name: 'Plant-specific name', rbac_status: 'Approved',
      species_details: { species_id: 6, scientific_name: 'Shorea macrophylla', common_name: 'Engkabang' } },
    { plant_id: 9, species_id: 7, scientific_name: 'Pending plant-specific name', rbac_status: 'Pending Review',
      species_details: { species_id: 7, scientific_name: 'Submitted proposed species', common_name: 'Pending common name' } },
  ].map((record) => vm.runInContext('mapBackendPlant(' + JSON.stringify(record) + ')', context))
  assert.equal(records[0].species.scientificName, 'Shorea macrophylla')
  assert.equal(records[0].plantScientificName, 'Plant-specific name')
  assert.equal(records[1].species.scientificName, 'Submitted proposed species')
  assert.equal(records[1].plantScientificName, 'Pending plant-specific name')
  assert.equal(records[1].species.speciesId, '7', 'the linked ID remains available for internal operations')
})

test('Visitor species results normalize numeric species IDs and retain the approved plant version during a pending edit', () => {
  const source = readFileSync(new URL('../utils/plantApi.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/export /g, '')
  const context = vm.createContext({ mobileApiUrl: () => 'https://example.invalid', faceSession: {} })
  vm.runInContext(source, context)
  const records = [
    { plant_id: 8, species_id: 6, rbac_status: 'Approved', pending_edit_status: 'Pending Review' },
    { plant_id: 11, species_id: 6, rbac_status: 'Pending Review' },
    { plant_id: 13, species_id: '6', rbac_status: 'Rejected' },
    { plant_id: 14, species_id: 7, rbac_status: 'Approved' },
    { plant_id: 8, species_id: '6', rbac_status: 'Approved', duplicate: true },
  ].map((record) => vm.runInContext('mapBackendPlant(' + JSON.stringify(record) + ')', context))
  const visible = vm.runInContext(
    'filterUniqueSpeciesPlantRecords(records, "6", "jn-species-common").filter(record => isPlantVisibleInRoleCatalog(record, "visitor"))',
    Object.assign(context, { records }),
  )
  assert.deepEqual(visible.map((plant) => plant.plantId), ['8'])
})

test('Guest and signed-in Visitor discovery use the same unauthenticated public species and plant reads', async () => {
  const source = readFileSync(new URL('../utils/plantApi.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/export /g, '')
  const calls = []
  let sessionActive = true
  const context = vm.createContext({
    mobileApiUrl: () => 'https://example.invalid',
    AbortSignal: { timeout: () => undefined },
    faceSession: { hasSession: () => sessionActive, withToken: async () => { throw Error('public catalogue must not require a session token') } },
    fetch: async (url, options) => {
      calls.push({ url, options })
      const payload = url.endsWith('/api/species')
        ? { species: [{ species_id: 6, common_name: 'Jn species common', scientific_name: 'Jn species scientific', image_asset_id: 'species-photo' }] }
        : { plants: [
          { plant_id: 8, species_id: 6, rbac_status: 'Approved', plant_image_asset_id: 'plant-8-photo' },
        ] }
      return { ok: true, status: 200, json: async () => payload }
    },
  })
  vm.runInContext(source, context)
  const visitorSpecies = await vm.runInContext('fetchSpeciesCatalog({ accountId: "visitor", publicOnly: true })', context)
  const visitorPlants = await vm.runInContext('fetchPlantRecords(visitorSpecies, { accountId: "visitor", publicOnly: true })', Object.assign(context, { visitorSpecies }))
  const visitorCalls = calls.splice(0)

  sessionActive = false
  const guestSpecies = await vm.runInContext('fetchSpeciesCatalog({ publicOnly: true })', context)
  const guestPlants = await vm.runInContext('fetchPlantRecords(guestSpecies, { publicOnly: true })', Object.assign(context, { guestSpecies }))
  const guestCalls = calls.splice(0)

  assert.deepEqual(visitorCalls.map(({ url, options }) => [url, options.credentials, options.headers.Authorization]), guestCalls.map(({ url, options }) => [url, options.credentials, options.headers.Authorization]))
  assert.deepEqual(visitorCalls.map(({ url }) => url), ['https://example.invalid/api/species', 'https://example.invalid/api/plants'])
  assert.equal(visitorSpecies[0].id, '6')
  assert.equal(visitorSpecies[0].image.headers, undefined)
  assert.equal(visitorPlants[0].plantId, '8')
  assert.equal(visitorPlants[0].plantImage.headers, undefined)
  const visible = vm.runInContext('filterPlantRecordsForRole(filterUniqueSpeciesPlantRecords(visitorPlants, 6), "Visitor", "visitor", { publicOnly: true })', Object.assign(context, { visitorPlants }))
  assert.deepEqual(Array.from(visible, (plant) => plant.plantId), ['8'])
  const guestVisible = vm.runInContext('filterUniqueSpeciesPlantRecords(guestPlants, "6").filter(record => isPlantVisibleInRoleCatalog(record, "Guest"))', Object.assign(context, { guestPlants }))
  assert.deepEqual(Array.from(guestVisible, (plant) => plant.plantId), ['8'])
})

test('public-only discovery retains Plant 8 after the final role filter despite the redacted status projection', () => {
  const source = readFileSync(new URL('../utils/plantApi.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/export /g, '')
  const context = vm.createContext({ mobileApiUrl: () => 'https://example.invalid', faceSession: {} })
  vm.runInContext(source, context)
  // The public /api/plants projection returns IDs and species IDs but omits
  // rbac_status. Plant 9 belongs to another species; Plant 8 is species 6.
  const raw = [
    { plant_id: 9, species_id: 7 },
    { plant_id: 8, species_id: 6 },
  ]
  const plants = raw.map(record => vm.runInContext(`mapBackendPlant(${JSON.stringify(record)})`, context))
  assert.deepEqual(plants.map(plant => plant.plantId), ['9', '8'])
  assert.equal(plants[1].currentStatus, 'Not recorded', 'public mapping must not invent a redacted status')
  const scoped = vm.runInContext('filterUniqueSpeciesPlantRecords(plants, "6")', Object.assign(context, { plants }))
  assert.deepEqual(scoped.map(plant => plant.plantId), ['8'])
  for (const role of ['Guest', 'Visitor']) {
    const finalRows = vm.runInContext(
      `filterPlantRecordsForRole(scoped, ${JSON.stringify(role)}, ${role === 'Visitor' ? '"visitor"' : 'null'}, { publicOnly: true })`,
      Object.assign(context, { scoped }),
    )
    assert.deepEqual(finalRows.map(plant => plant.plantId), ['8'], `${role} should retain server-authorized Plant 8`)
  }

  const pending = vm.runInContext(`mapBackendPlant(${JSON.stringify({ plant_id: 17, species_id: 6, rbac_status: 'Pending Review', registered_subject: 'staff:owner' })})`, context)
  const botanistRows = vm.runInContext(
    'filterPlantRecordsForRole([pending], "Botanist", "owner")',
    Object.assign(context, { pending }),
  )
  assert.deepEqual(Array.from(botanistRows, plant => plant.plantId), ['17'], 'Botanist owner pending-plant filtering remains intact')
  const otherBotanistRows = vm.runInContext(
    'filterPlantRecordsForRole([pending], "Botanist", "other")',
    Object.assign(context, { pending }),
  )
  assert.deepEqual(Array.from(otherBotanistRows), [])
  const screen = readFileSync(new URL('../screens/Plant.js', import.meta.url), 'utf8')
  assert.match(screen, /useSpeciesScopedState\(requestKey, "allVisible"\)/)
  assert.match(screen, /useSpeciesScopedState\(requestKey, "All"\)/)
  assert.match(screen, /const matchesStatus = !isBotanist \|\| plantStatusFilter === "allVisible"/)
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

test('plant catalog visibility includes approved records and only the signed-in Botanist own pending submission', async () => {
  const source = readFileSync(new URL('../utils/plantApi.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/export /g, '')
  const context = vm.createContext({ mobileApiUrl: () => 'https://example.invalid', faceSession: { hasSession: () => false } })
  vm.runInContext(source, context)
  const decisions = await vm.runInContext(`(() => {
    const approvedWithPendingEdit = { currentStatus: 'Approved', reviewedEditStatus: 'Pending Review', registeredBy: 'staff:other' };
    const records = [
      { currentStatus: 'Approved', registeredBy: 'staff:other' },
      { currentStatus: 'Pending Review', registeredBy: 'staff:owner' },
      { currentStatus: 'Pending Review', registeredBy: 'staff:other' },
      { currentStatus: 'Rejected', registeredBy: 'staff:owner' },
      { currentStatus: 'Correction Required', registeredBy: 'staff:owner' },
      { currentStatus: 'Not recorded', registeredBy: 'staff:owner' },
    ];
    return {
      botanist: records.map(record => isPlantVisibleInRoleCatalog(record, 'Botanist', 'owner')),
      otherBotanist: records.map(record => isPlantVisibleInRoleCatalog(record, 'Botanist', 'other')),
      visitor: records.map(record => isPlantVisibleInRoleCatalog(record, 'Visitor', 'owner')),
      pendingEditStillApproved: ['Botanist', 'Visitor'].map(role => isPlantVisibleInRoleCatalog(approvedWithPendingEdit, role, 'owner')),
    };
  })()`, context)
  assert.deepEqual(JSON.parse(JSON.stringify(decisions.botanist)), [true, true, false, false, false, false])
  assert.deepEqual(JSON.parse(JSON.stringify(decisions.otherBotanist)), [true, false, true, false, false, false])
  assert.deepEqual(JSON.parse(JSON.stringify(decisions.visitor)), [true, false, false, false, false, false])
  assert.deepEqual(JSON.parse(JSON.stringify(decisions.pendingEditStillApproved)), [true, true])

  const plantList = readFileSync(new URL('../screens/Plant.js', import.meta.url), 'utf8')
  const speciesDetail = readFileSync(new URL('../screens/SpeciesDetail.js', import.meta.url), 'utf8')
  const map = readFileSync(new URL('../screens/Map.js', import.meta.url), 'utf8')
  assert.match(plantList, /plantStatusFilter === "myPending" && isOwnedPendingPlant/)
  assert.match(plantList, /filterPlantRecordsForRole\(recordsForSpecies, role, accountId, \{ publicOnly \}\)/)
  assert.match(speciesDetail, /filter\(\(record\) => isPlantVisibleInRoleCatalog/)
  assert.match(map, /isPlantVisibleInRoleCatalog\(record, user\.role, user\.id\)/)
})
