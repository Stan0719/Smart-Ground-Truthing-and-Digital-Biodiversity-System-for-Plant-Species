import { formatPlantId, parsePlantId } from '../utils/plantId.ts'

export interface SpeciesContract {
  id: string
  scientificName: string
  commonName: string
  genus: string
  family: string
  conservationStatus: string
  description: string
  habitat: string
}

export interface ApprovedObservationContent {
  heightCm: number | null
  healthStatus: string
  lifeStage: string
  morphology: string
  notes: string
  latitude: number | null
  longitude: number | null
  accuracyM: number | null
  taxonomy: Record<string, string>
}

export interface PlantContract {
  id: string
  displayId: string
  speciesId: string
  status: string
  registeredSubject: string
  registeredAt: string
  latitude: number | null
  longitude: number | null
  accuracyM: number | null
  observedAt: string
  latestApproved: ApprovedObservationContent | null
}

export interface EnrichedPlant extends PlantContract {
  species: SpeciesContract | null
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
const text = (value: unknown) =>
  typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
    ? String(value)
    : ''
const number = (value: unknown, min = -Infinity, max = Infinity) => {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null
}

export const mapSpeciesContract = (value: unknown): SpeciesContract | null => {
  const item = record(value)
  if (!item) return null
  const id = text(item.species_id).trim()
  if (!id) return null
  return {
    id,
    scientificName: text(item.scientific_name),
    commonName: text(item.common_name),
    genus: text(item.genus_name),
    family: text(item.family_name),
    conservationStatus: text(item.conservation_status),
    description: text(item.description),
    habitat: text(item.habitat),
  }
}

const mapApprovedContent = (value: unknown): ApprovedObservationContent | null => {
  const item = record(value)
  if (!item) return null
  const taxonomyRecord = record(item.taxonomy)
  return {
    heightCm: number(item.heightCm, 0),
    healthStatus: text(item.healthStatus),
    lifeStage: text(item.lifeStage),
    morphology: text(item.morphology),
    notes: text(item.notes),
    latitude: number(item.latitude, -90, 90),
    longitude: number(item.longitude, -180, 180),
    accuracyM: number(item.accuracy_m, 0),
    taxonomy: taxonomyRecord
      ? Object.fromEntries(
          Object.entries(taxonomyRecord).flatMap(([key, entry]) => {
            const value = text(entry)
            return value ? [[key, value]] : []
          }),
        )
      : {},
  }
}

export const mapPlantContract = (value: unknown): PlantContract | null => {
  const item = record(value)
  if (!item) return null
  const id = text(item.plant_id).trim()
  const speciesId = text(item.species_id).trim()
  if (!id || !speciesId) return null
  return {
    id,
    displayId: formatPlantId(id) || id,
    speciesId,
    status: text(item.rbac_status),
    registeredSubject: text(item.registered_subject),
    registeredAt: text(item.registered_at),
    latitude: number(item.latitude, -90, 90),
    longitude: number(item.longitude, -180, 180),
    accuracyM: number(item.accuracy_m, 0),
    observedAt: text(item.observed_at),
    latestApproved: item.latest_approved == null ? null : mapApprovedContent(item.latest_approved),
  }
}

export const enrichPlant = (
  plant: PlantContract,
  speciesById: ReadonlyMap<string, SpeciesContract>,
): EnrichedPlant => ({ ...plant, species: speciesById.get(plant.speciesId) || null })

export const hasValidCoordinates = (plant: PlantContract) =>
  plant.latitude !== null && plant.longitude !== null

export const matchesPlantQuery = (plant: EnrichedPlant, query: string) => {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  return `${plant.id} ${plant.displayId} ${plant.speciesId} ${plant.species?.scientificName || ''} ${plant.species?.commonName || ''} ${plant.status}`
    .toLowerCase()
    .includes(normalized)
}

export const rawPlantIdFromRoute = (value: unknown) => {
  if (typeof value !== 'string') return ''
  const raw = value.trim()
  if (/^[1-9][0-9]{0,9}$/.test(raw) && Number(raw) <= 2147483647) return raw
  const legacy = parsePlantId(raw)
  return legacy === null ? '' : String(legacy)
}

export class PlantApiError extends Error {
  readonly status: number
  readonly kind: 'network' | 'invalid' | 'http'

  constructor(message: string, status = 0, kind: 'network' | 'invalid' | 'http' = 'http') {
    super(message)
    this.status = status
    this.kind = kind
  }
}

export async function requestPlantApi(url: string): Promise<Record<string, unknown>> {
  let response: Response
  try {
    response = await fetch(url, {
      credentials: 'same-origin',
      signal: AbortSignal.timeout(15000),
    })
  } catch {
    throw new PlantApiError('The plant service could not be reached. Please try again.', 0, 'network')
  }
  let result: Record<string, unknown> | null
  try {
    result = record(await response.json())
  } catch {
    throw new PlantApiError('The plant service returned an invalid response.', response.status, 'invalid')
  }
  if (!response.ok) {
    const backendMessage = [result?.message, result?.error].find(
      (value): value is string => typeof value === 'string' && Boolean(value.trim()),
    )
    const fallback = response.status === 401
      ? 'Your session has expired. Please sign in again.'
      : response.status === 403
        ? 'You do not have permission to view this plant data.'
        : response.status === 404
          ? 'The plant record is unavailable.'
          : `Plant request failed (${response.status}).`
    throw new PlantApiError(backendMessage || fallback, response.status)
  }
  if (!result) throw new PlantApiError('The plant service returned an invalid response.', response.status, 'invalid')
  return result
}
