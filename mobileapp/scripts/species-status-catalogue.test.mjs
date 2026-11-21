import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import { combineBotanistSpecies, filterAndSortSpecies } from '../utils/speciesFilters.js'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('owner request adapter uses authenticated owner rows, request IDs and protected photos', async () => {
  const source = read('../utils/plantApi.js').replace(/^import .*;\r?\n/gm, '').replace(/export /g, '')
  const calls = []
  const context = vm.createContext({
    mobileApiUrl: () => 'https://example.invalid', faceSession: {},
    testPlantApi: async (path, options) => {
      calls.push({ path, options })
      return { species_requests: [
        { request_id: 7, requested_by: 'staff:owner', request_status: 'Pending Review', proposed_species_id: 27, scientific_name: 'Pending A', common_name: 'A', family_name: 'Family A' },
        { request_id: 8, requested_by: 'staff:owner', request_status: 'Rejected', scientific_name: 'Rejected B' },
        { request_id: 9, requested_by: 'staff:other', request_status: 'Pending Review', scientific_name: 'Private C' },
        { request_id: 10, requested_by: 'staff:owner', request_status: 'Correction Required' },
      ] }
    },
  })
  vm.runInContext(source, context)
  vm.runInContext('plantApi = testPlantApi', context)
  vm.runInContext('speciesRequestPhotoSources = async (rows) => rows.map((row) => ({uri: `protected:${row.request_id}`, headers: {Authorization: "Bearer fixture"}}))', context)
  const rows = await vm.runInContext('fetchOwnedSpeciesRequests("owner")', context)
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ path: '/species-requests', options: { expectedAccountId: 'owner' } }])
  assert.deepEqual(Array.from(rows, (row) => row.requestId), ['7', '8'])
  assert.equal(rows[0].proposedSpeciesId, '27')
  assert.equal(rows[0].approvalStatus, 'Pending Review')
  assert.equal(rows[1].approvalStatus, 'Rejected')
  assert.equal(rows[0].image.headers.Authorization, 'Bearer fixture')
  assert.equal(rows[0].speciesImageVerified, true)
})

test('Botanist combines approved catalogue with private requests without duplicate Species IDs', () => {
  const approved = [{ id: '1', name: 'Approved A', scientificName: 'A', approvalStatus: 'Approved' }]
  const requests = [
    { privateRequest: true, requestId: '3', proposedSpeciesId: '2', name: 'Pending B', scientificName: 'B', approvalStatus: 'Pending Review' },
    { privateRequest: true, requestId: '4', proposedSpeciesId: '2', name: 'Older B', scientificName: 'B', approvalStatus: 'Pending Review' },
    { privateRequest: true, requestId: '5', proposedSpeciesId: null, name: 'Rejected C', scientificName: 'C', approvalStatus: 'Rejected' },
    { privateRequest: true, requestId: '6', proposedSpeciesId: '1', name: 'Already approved', approvalStatus: 'Rejected' },
    { privateRequest: false, requestId: '7', name: 'Untrusted', approvalStatus: 'Pending Review' },
  ]
  const combined = combineBotanistSpecies(approved, requests)
  assert.deepEqual(combined.map((row) => row.name), ['Approved A', 'Pending B', 'Rejected C'])
  const pending = filterAndSortSpecies(combined.filter((row) => row.approvalStatus === 'Pending Review'), { query: 'b' })
  const rejected = filterAndSortSpecies(combined.filter((row) => row.approvalStatus === 'Rejected'), { sortOption: 'name-asc' })
  const approvedOnly = filterAndSortSpecies(combined.filter((row) => row.approvalStatus === 'Approved'))
  const allSearched = filterAndSortSpecies(combined, { query: 'pending', sortOption: 'name-desc' })
  assert.equal(combined.length, 3)
  assert.deepEqual(approvedOnly.map((row) => row.id), ['1'])
  assert.deepEqual(allSearched.map((row) => row.requestId), ['3'])
  assert.deepEqual(pending.map((row) => row.requestId), ['3'])
  assert.deepEqual(rejected.map((row) => row.requestId), ['5'])
})

test('catalogue filter and protected request navigation stay Botanist-only', () => {
  const source = read('../screens/Species.js')
  assert.match(source, /includeOwnedRequests: isBotanist/)
  assert.match(source, /isBotanist && <ScrollView horizontal showsHorizontalScrollIndicator\s/)
  assert.match(source, /style=\{\[styles\.filterToggle, filtersOpen && styles\.filterToggleActive\]\}/)
  assert.match(source, /\["Rejected", t\("species\.myRejected"\)\]/)
  assert.match(source, /\(isBotanist \? filtersOpen : sortOpen\)/)
  assert.match(source, /accessibilityState=\{\{ selected \}\}/)
  assert.match(source, /style=\{\[styles\.statusFilterChip, selected && styles\.statusFilterChipSelected\]\}/)
  assert.match(source, /statusFilterChip: \{ minHeight: 40, justifyContent: "center", paddingHorizontal: 14, borderRadius: 20/)
  assert.match(source, /statusFilterChipSelected: \{ borderColor: "#2F6B4F", backgroundColor: "#D6E9D9" \}/)
  assert.match(source, /item\.privateRequest\s*\? navigation\.navigate\("BotanistSpeciesRequestDetail", \{ requestId: item\.requestId, botanist: user \}\)/)
  assert.match(source, /\(!item\.privateRequest \|\| pendingRequest\) && <TouchableOpacity/)
  assert.match(source, /speciesApprovalBadgeStyle\(item\.approvalStatus\)/)
  assert.doesNotMatch(source, /translateLabel\(item\.conservationStatus\)/)
  for (const language of ['en', 'ms', 'zh']) {
    const catalog = JSON.parse(read(`../translations/${language}.json`))
    for (const key of ['allStatuses', 'approved', 'pendingReview', 'rejected', 'myRejected', 'viewRequest', 'approvalStatusFilter']) {
      assert.ok(catalog.species[key], `${language}:${key}`)
    }
  }
})
