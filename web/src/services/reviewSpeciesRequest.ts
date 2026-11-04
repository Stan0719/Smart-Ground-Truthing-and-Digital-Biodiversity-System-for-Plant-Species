// Explicit backend linkage only. Never infer a request from names or prototype stores.
export type SpeciesRequestDecision = 'Approved' | 'Rejected' | 'Correction Required'
export const speciesRequestReviewUrl = (id: string) =>
  `/api/species-requests/${encodeURIComponent(id)}/review`
export const speciesRequestCanDecide = (request: LinkedSpeciesRequest | null) =>
  Boolean(request?.id && request.state === 'pending')

export type SpeciesRequestState =
  'pending' | 'approved' | 'rejected' | 'correction' | 'unavailable' | 'error' | 'unknown'
export interface LinkedSpeciesRequest {
  id: string
  status: string
  state: SpeciesRequestState
  scientificName: string
  commonName: string
  genus: string
  family: string
  conservationStatus: string
  description: string
  habitat: string
  requestedBy: string
  submittedAt: string
  reviewComment: string
  approvedSpeciesId: string
  assets: { id: string; contentType: string }[]
}
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
const text = (value: unknown) =>
  typeof value === 'string'
    ? value.trim()
    : typeof value === 'number' && Number.isSafeInteger(value)
      ? String(value)
      : ''

export function mapLinkedSpeciesRequest(
  observation: Record<string, unknown>,
): LinkedSpeciesRequest | null {
  const reference = observation.species_request_id
  const embedded = observation.species_request
  if (
    (reference === undefined || reference === null || reference === '') &&
    (embedded === undefined || embedded === null)
  )
    return null
  const data = object(embedded)
  const referenceId = text(reference)
  const embeddedId = text(data?.request_id)
  const status = text(data?.request_status)
  const normalized = status.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
  const states: Record<string, SpeciesRequestState> = {
    pending: 'pending',
    'pending review': 'pending',
    approved: 'approved',
    rejected: 'rejected',
    'correction required': 'correction',
  }
  const invalid =
    (!referenceId && !embeddedId) ||
    Boolean(data && !embeddedId) ||
    Boolean(referenceId && embeddedId && referenceId !== embeddedId) ||
    Boolean(embedded !== undefined && embedded !== null && !data)
  return {
    id: referenceId || embeddedId,
    status,
    state: invalid ? 'error' : !data ? 'unavailable' : states[normalized] || 'unknown',
    scientificName: text(data?.proposed_scientific_name),
    commonName: text(data?.suggested_common_name),
    genus: text(data?.genus_name),
    family: text(data?.family_name),
    conservationStatus: text(data?.conservation_status),
    description: text(data?.description),
    habitat: text(data?.habitat),
    requestedBy: text(data?.requested_by),
    submittedAt: text(data?.submitted_at),
    reviewComment: text(data?.review_comment),
    approvedSpeciesId: text(data?.approved_species_id),
    assets: Array.isArray(data?.assets)
      ? data.assets.flatMap((value) => {
          const asset = object(value)
          return asset && text(asset.id) && text(asset.content_type)
            ? [{ id: text(asset.id), contentType: text(asset.content_type) }]
            : []
        })
      : [],
  }
}

export function hasResolvedSpecies(
  request: LinkedSpeciesRequest | null,
  speciesId: string,
  scientificName: string,
): boolean {
  if (!request) return true
  return (
    request.state === 'approved' &&
    /^[1-9]\d*$/.test(request.approvedSpeciesId) &&
    request.approvedSpeciesId === speciesId &&
    Boolean(scientificName.trim())
  )
}
