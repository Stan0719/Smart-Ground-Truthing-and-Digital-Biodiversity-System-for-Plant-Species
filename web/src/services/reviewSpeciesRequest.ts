// Explicit backend linkage only. Never infer a request from names or prototype stores.
export type SpeciesRequestDecision = 'Approved' | 'Rejected' | 'Correction Required'
export const speciesRequestReviewUrl = (id: string) =>
  `/api/species-requests/${encodeURIComponent(id)}/review`
export const speciesRequestCanDecide = (request: LinkedSpeciesRequest | null) =>
  Boolean(request?.id && request.state === 'pending')

export type SpeciesRequestState =
  'pending' | 'approved' | 'rejected' | 'correction' | 'unavailable' | 'error' | 'unknown'
export interface LinkedSpeciesRequest {
  reviewedBy?: string
  reviewedAt?: string
  historicalState?: string
  historicalPhotosUnavailable?: boolean
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
  reviewCycle: number | null
  contentRevision: number | null
  contentUpdatedAt: string
  updated: boolean
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
  historicalReview = false,
): LinkedSpeciesRequest | null {
  const reference = observation.species_request_id
  const embedded = observation.species_request
  if (
    (reference === undefined || reference === null || reference === '') &&
    (embedded === undefined || embedded === null)
  )
    return null
  let data = object(embedded)
  const historical = object(data?.historical_review)
  const historicalState = historicalReview && data?.request_status === 'Approved' ? text(historical?.state) || 'unavailable' : ''
  if (historicalState) {
    const fields = object(historical?.fields) || {}
    data = { ...data, ...fields, proposed_scientific_name: fields.scientific_name ?? '',
      suggested_common_name: fields.common_name ?? '', genus_name: fields.genus_name ?? '',
      family_name: fields.family_name ?? '', conservation_status: fields.conservation_status ?? '',
      description: fields.description ?? '', habitat: fields.habitat ?? '', assets: historical?.assets || [] }
  }
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
  const revision = data?.content_revision
  const contentRevision = typeof revision === 'number' && Number.isSafeInteger(revision) && revision > 0 ? revision : null
  return {
    reviewedBy: text(historical?.reviewed_by) || text(data?.reviewed_by),
    reviewedAt: text(historical?.reviewed_at) || text(data?.reviewed_at),
    historicalState,
    historicalPhotosUnavailable: historicalState === 'unavailable' || historical?.photos_unavailable === true,
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
    reviewCycle: typeof data?.review_cycle === 'number' && Number.isSafeInteger(data.review_cycle) && data.review_cycle > 0 ? data.review_cycle : null,
    contentRevision: contentRevision,
    contentUpdatedAt: text(data?.content_updated_at),
    updated: states[normalized] === 'pending' && contentRevision !== null && contentRevision > 1,
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
