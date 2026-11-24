import { plantThumbnailImages } from './assetImages.ts'
import { createPlantGallery } from './plantGallery.ts'
export type ProximityCategory = 'very_close' | 'close' | 'nearby' | 'additional'
export type ProximityMatchStatus = 'same_species_zone' | 'different_species' | 'different_zone' | 'provisional_species' | 'uncertain_species' | 'uncertain_zone' | 'uncertain_match'
export type ProximitySpeciesMatchStatus = 'confirmed_same' | 'confirmed_different' | 'provisional_same_name' | 'provisional_different_name' | 'unknown'
export type ProximityZoneMatchStatus = 'same' | 'different' | 'unknown'
export interface ProximityCandidate {
  plant_id: string; status: 'Approved' | 'Pending Review'; plant_name: string | null; species_name: string | null
  latitude?: number | null; longitude?: number | null
  accuracy_m: number | null; distance_m: number; category: ProximityCategory
  location_source: 'approved_observation' | 'pending_observation_unverified' | 'recorded_location_unverified'
  match_status: ProximityMatchStatus; species_match_status: ProximitySpeciesMatchStatus
  zone_match_status: ProximityZoneMatchStatus; within_grouping_radius: boolean
}
export interface ProximityResult {
  target_location?: { latitude: number; longitude: number; status: string; source: 'submission' } | null
  contract_version: 1; observation_id: string; plant_id: string; revision: number; checked_at: string
  state: 'complete' | 'incomplete' | 'unavailable' | 'not_eligible'; accuracy_m?: number | null
  config: { very_close_m: number; close_m: number; nearby_m: number; grouping_radius_m: number; radius_m: number; accuracy_warning_m: number; candidate_limit: number }
  candidates: ProximityCandidate[]; eligible_count?: number; unlocated_count?: number; total_nearby?: number
}
const object = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const count = (v: unknown): v is number => finite(v) && Number.isSafeInteger(v) && v >= 0
const validAccuracy = (v: unknown) => v === null || (finite(v) && v >= 0)
const plantId = (v: unknown): v is string => typeof v === 'string' && /^[1-9][0-9]{0,9}$/.test(v) && Number(v) <= 2147483647
function invalid(): never { throw Error('Invalid proximity response') }
export function readProximity(value: unknown, id: string, revision: number): ProximityResult {
  const r = object(value), c = object(r?.config)
  const groupingRadius = c && finite(c.grouping_radius_m) ? c.grouping_radius_m : c?.close_m
  if (!r || !c || r.contract_version !== 1 || r.observation_id !== id || r.revision !== revision || !plantId(r.plant_id) ||
      !['complete','incomplete','unavailable','not_eligible'].includes(String(r.state)) || typeof r.checked_at !== 'string' || !Number.isFinite(Date.parse(r.checked_at)) ||
      !['very_close_m','close_m','nearby_m','radius_m','accuracy_warning_m'].every(k => finite(c[k]) && (c[k] as number) > 0) ||
      !finite(groupingRadius) || groupingRadius <= 0 ||
      !((c.very_close_m as number) < (c.close_m as number) && (c.close_m as number) < (c.nearby_m as number) && (c.nearby_m as number) < (c.radius_m as number) && groupingRadius <= (c.radius_m as number) && (c.radius_m as number) <= 100) ||
      !count(c.candidate_limit) || c.candidate_limit < 1 || c.candidate_limit > 50 || !Array.isArray(r.candidates) || r.candidates.length > c.candidate_limit ||
      (r.state !== 'not_eligible' && !validAccuracy(r.accuracy_m))) invalid()
  const validPair = (lat: unknown, lng: unknown) => finite(lat) && Math.abs(lat) <= 90 && finite(lng) && Math.abs(lng) <= 180
  if (r.target_location != null) {
    const target = object(r.target_location)
    if (!target || !validPair(target.latitude, target.longitude) || target.source !== 'submission' ||
        !['Pending Review', 'Correction Required', 'Flagged'].includes(String(target.status))) invalid()
  }
  const ids = new Set<string>()
  for (const value of r.candidates) {
    const row = object(value)
    if (row && (row.latitude != null || row.longitude != null) && !validPair(row.latitude, row.longitude)) invalid()
    const matchStatus = row?.match_status === undefined ? 'uncertain_match' : row.match_status
    const speciesMatchStatus = row?.species_match_status === undefined
      ? (matchStatus === 'same_species_zone' || matchStatus === 'different_zone' || matchStatus === 'uncertain_zone' ? 'confirmed_same' : matchStatus === 'different_species' ? 'confirmed_different' : 'unknown')
      : row.species_match_status
    const zoneMatchStatus = row?.zone_match_status === undefined
      ? (matchStatus === 'same_species_zone' ? 'same' : matchStatus === 'different_zone' ? 'different' : 'unknown')
      : row.zone_match_status
    const withinGroupingRadius = row?.within_grouping_radius === undefined && finite(row?.distance_m) ? row.distance_m <= groupingRadius : row?.within_grouping_radius
    if (!row || !plantId(row.plant_id) || row.plant_id === r.plant_id || ids.has(row.plant_id) ||
        !['Approved','Pending Review'].includes(String(row.status)) || !['approved_observation','pending_observation_unverified','recorded_location_unverified'].includes(String(row.location_source)) ||
        !['same_species_zone','different_species','different_zone','provisional_species','uncertain_species','uncertain_zone','uncertain_match'].includes(String(matchStatus)) ||
        !['confirmed_same','confirmed_different','provisional_same_name','provisional_different_name','unknown'].includes(String(speciesMatchStatus)) ||
        !['same','different','unknown'].includes(String(zoneMatchStatus)) || typeof withinGroupingRadius !== 'boolean' ||
        ![row.plant_name,row.species_name].every(v => v === null || (typeof v === 'string' && v.length <= 200)) ||
        !validAccuracy(row.accuracy_m) || !finite(row.distance_m) || row.distance_m < 0 || row.distance_m > (c.radius_m as number)) invalid()
    const expected = row.distance_m <= (c.very_close_m as number) ? 'very_close' : row.distance_m <= (c.close_m as number) ? 'close' : row.distance_m <= (c.nearby_m as number) ? 'nearby' : 'additional'
    if (row.category !== expected || withinGroupingRadius !== (row.distance_m <= groupingRadius)) invalid()
    ids.add(row.plant_id)
  }
  if (['complete','incomplete'].includes(String(r.state))) {
    if (!count(r.eligible_count) || !count(r.unlocated_count) || !count(r.total_nearby) || r.total_nearby < r.candidates.length || r.unlocated_count + r.total_nearby > r.eligible_count) invalid()
    if ((r.state === 'complete') !== (r.unlocated_count === 0 && r.total_nearby === r.candidates.length)) invalid()
    for (let i = 1; i < r.candidates.length; i++) if (r.candidates[i].distance_m < r.candidates[i - 1].distance_m) invalid()
  } else if (r.candidates.length) invalid()
  return { ...r, config: { ...c, grouping_radius_m: groupingRadius }, candidates: r.candidates.map(value => {
    const row = value as Record<string, unknown>
    const matchStatus = row.match_status ?? 'uncertain_match'
    return { ...row, match_status: matchStatus,
      species_match_status: row.species_match_status ?? (matchStatus === 'same_species_zone' || matchStatus === 'different_zone' || matchStatus === 'uncertain_zone' ? 'confirmed_same' : matchStatus === 'different_species' ? 'confirmed_different' : 'unknown'),
      zone_match_status: row.zone_match_status ?? (matchStatus === 'same_species_zone' ? 'same' : matchStatus === 'different_zone' ? 'different' : 'unknown'),
      within_grouping_radius: row.within_grouping_radius ?? ((row.distance_m as number) <= groupingRadius) }
  }) } as unknown as ProximityResult
}
export async function requestPlantProximity(id: string, revision: number, signal?: AbortSignal) {
  const response = await fetch(`/api/data/observations/${encodeURIComponent(id)}/proximity?revision=${revision}`, {
    method: 'GET', credentials: 'same-origin', cache: 'no-store', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
  })
  if (!response.ok) throw Object.assign(Error('Proximity check unavailable'), { status: response.status })
  return readProximity(await response.json(), id, revision)
}

export interface PlantPreview { image: string; scientificName: string; commonName: string }
// Resolve only the existing authorized catalogue main photo. It has no whole-plant label.
export async function requestPlantPreview(id: string, signal: AbortSignal): Promise<PlantPreview> {
  if (!plantId(id)) throw Error('Invalid Plant ID')
  const response = await fetch(`/api/data/plants/${encodeURIComponent(id)}`, {
    method: 'GET', credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
  })
  if (!response.ok) throw Error('Plant preview unavailable')
  const body = object(await response.json()), row = object(body?.plant)
  if (!row || String(row.plant_id) !== id) throw Error('Invalid Plant preview')
  const name = (value: unknown) => typeof value === 'string' ? value.slice(0, 200) : ''
  let image = plantThumbnailImages(row)[0]?.path || ''
  if (row.rbac_status === 'Pending Review') {
    const gallery = createPlantGallery({ detail: true, transport: (url, options) => fetch(url, {
      ...options, signal: AbortSignal.any([signal, options?.signal as AbortSignal, AbortSignal.timeout(15000)]),
    }) })
    try {
      await gallery.load(id, true)
      if (!signal.aborted && !gallery.state.error) image = gallery.state.assets.find(asset =>
        asset.origin === 'initial_registration' && asset.status === 'Pending Review')?.url || ''
    } finally { gallery.reset() }
  }
  return { image, scientificName: name(row.scientific_name), commonName: name(row.common_name) }
}
