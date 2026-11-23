import type { AuthUser } from './auth'
import { hasResolvedSpecies, type LinkedSpeciesRequest } from './reviewSpeciesRequest.ts'

export type ReviewDecision = 'Approved' | 'Rejected' | 'Correction Required' | 'Flagged'
export const reviewTransitions: Partial<Record<string, ReviewDecision[]>> = {
  'Pending Review': ['Approved', 'Rejected', 'Correction Required', 'Flagged'],
  Flagged: ['Approved', 'Rejected', 'Correction Required'],
}
export const reviewCommentValid = (decision: ReviewDecision, comment: string) => decision === 'Approved' || Boolean(comment.trim())
export const positiveRevision = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
export function reviewEligible(user: AuthUser | null, pending: boolean, row: { revision: unknown; owner: string; status: string; speciesId: string; scientificName: string; speciesRequest: LinkedSpeciesRequest | null }) {
  return !pending && user?.role === 'Conservation Officer' && user.status === 'Active' && user.mustChangePassword === false &&
    row.owner !== 'staff:' + user.id && positiveRevision(row.revision) && Boolean(reviewTransitions[row.status]?.length) &&
    hasResolvedSpecies(row.speciesRequest, row.speciesId, row.scientificName)
}
// Compare review-relevant response data, not display history or timestamp formatting.
export function observationReviewSnapshot(observation: Record<string, unknown>) {
  const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  const id = (value: unknown) => value == null ? '' : String(value)
  const status = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ') : ''
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : object(value)
    ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value
  const serialize = (value: unknown) => JSON.stringify(canonical(value))
  const assets = (value: unknown) => Array.isArray(value) ? value.map(item => {
    const asset = object(item)
    return [id(asset?.id), id(asset?.content_type)]
  }).sort((a, b) => a.join('\0').localeCompare(b.join('\0'))) : []
  const request = object(observation.species_request)
  const species = serialize({ reference: id(observation.species_request_id ?? request?.request_id), request: request ? {
    id: id(request.request_id), status: status(request.request_status),
    revision: request.content_revision ?? null, cycle: request.review_cycle ?? null,
    approved: id(request.approved_species_id), proposed: id(request.proposed_species_id),
    owner: request.requested_by ?? null,
    fields: Object.fromEntries(['proposed_scientific_name', 'suggested_common_name', 'genus_name', 'family_name', 'conservation_status', 'description', 'habitat'].map(key => [key, request[key] ?? null])),
    assets: assets(request.assets),
  } : null })
  return { species, observation: serialize({
    id: id(observation.id), revision: observation.revision, status: status(observation.status),
    owner: observation.owner_subject ?? null, origin: observation.origin_type ?? null,
    plant: id(observation.plant_id), species: id(observation.species_id),
    scientificName: observation.scientific_name ?? null, plantName: observation.plant_scientific_name ?? null,
    content: observation.content ?? null, assets: assets(observation.assets), request: species,
  }) }
}
export class ReviewApiError extends Error {
  readonly status: number
  readonly code?: string
  readonly failureKind?: 'timeout' | 'cancelled' | 'network' | 'body_read' | 'invalid_response'
  constructor(message: string, status = 0, code?: string, failureKind?: ReviewApiError['failureKind']) {
    super(message)
    this.status = status
    this.code = code
    this.failureKind = failureKind
  }
}
export type ReviewQueueSource = 'observations' | 'changes' | 'species'
export async function readReviewQueueSource<T>(source: ReviewQueueSource, read: () => Promise<T>): Promise<T> {
  try { return await read() }
  catch (failure) {
    throw Object.assign(failure instanceof Error ? failure : Error('Review queue verification failed.'), { queueSource: source })
  }
}
export function reviewQueueFailureDiagnostic(failure: unknown) {
  const error = failure as { queueSource?: unknown; status?: unknown; code?: unknown } | null
  const source = error?.queueSource === 'observations' || error?.queueSource === 'changes' || error?.queueSource === 'species' ? error.queueSource : 'unknown'
  const status = typeof error?.status === 'number' && Number.isInteger(error.status) && error.status >= 100 && error.status <= 599 ? error.status : null
  // Fixed categories only: never log the server body, request URL/query,
  // submission identifiers, review comments, session credentials or evidence.
  const category = failure instanceof ReviewApiError && failure.failureKind ? failure.failureKind
    : error?.code === 'REVIEW_TRANSPORT_ERROR' && status === null ? 'transport'
    : error?.code === 'REVIEW_INVALID_RESPONSE' ? 'invalid_response' : status ? 'http' : 'verification'
  return { source, status, category }
}
export interface ReviewRequestOptions { signal?: AbortSignal; retry?: boolean }
export type ReviewRequest = (url: string, body?: { decision: ReviewDecision; comment: string; revision?: number; expected_revision?: number; expected_review_cycle?: number; source_languages?: { comment: string } }, options?: ReviewRequestOptions) => Promise<Record<string, unknown>>
function transportFailureKind(cause: unknown, signal: AbortSignal): 'timeout' | 'cancelled' | 'network' {
  const name = (signal.aborted ? signal.reason : cause) as { name?: unknown } | null
  return name?.name === 'TimeoutError' ? 'timeout' : name?.name === 'AbortError' ? 'cancelled' : 'network'
}
export function createReviewRequest(message: (key: string, params?: Record<string, string | number>) => string, transport: typeof fetch): ReviewRequest {
  const once: ReviewRequest = async (url, body, options) => {
    const timeout = AbortSignal.timeout(15000)
    const signal = options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout
    let response: Response
    try { signal.throwIfAborted(); response = await transport(url, { method: body ? 'POST' : 'GET', credentials: 'same-origin', ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}), signal }); signal.throwIfAborted() }
    catch (cause) { throw new ReviewApiError(message('feedback.network'), 0, 'REVIEW_TRANSPORT_ERROR', transportFailureKind(cause, signal)) }
    let result: Record<string, unknown> | null
    try { const value: unknown = await response.json(); signal.throwIfAborted(); result = value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null }
    catch (cause) {
      const name = (cause as { name?: unknown } | null)?.name
      if (signal.aborted || name === 'TimeoutError' || name === 'AbortError' || name === 'TypeError') {
        const kind = transportFailureKind(cause, signal)
        throw new ReviewApiError(message('feedback.network'), response.status, 'REVIEW_TRANSPORT_ERROR', kind === 'network' ? 'body_read' : kind)
      }
      throw new ReviewApiError(message('feedback.invalidResponse'), response.status, 'REVIEW_INVALID_RESPONSE', 'invalid_response')
    }
    if (!response.ok) {
      throw new ReviewApiError(message(response.status === 401 ? 'feedback.session' : response.status === 403 ? 'feedback.forbidden' : 'feedback.requestFailed', { status: response.status }), response.status, typeof result?.code === 'string' ? result.code : undefined)
    }
    if (!result) throw new ReviewApiError(message('feedback.invalidResponse'), response.status, 'REVIEW_INVALID_RESPONSE')
    return result
  }
  return async (url, body, options) => {
    // Only explicitly opted-in queue GETs retry; mutations and detail reads do not.
    for (let attempt = 0; ; attempt++) {
      try { return await once(url, body, options) }
      catch (error) {
        const temporary = error instanceof ReviewApiError &&
          ([502, 503, 504].includes(error.status) ||
            ((error.status === 0 || (error.status >= 200 && error.status < 300)) && ['timeout', 'network', 'body_read'].includes(error.failureKind || '')))
        if (body || !options?.retry || attempt >= 1 || !temporary || options.signal?.aborted) throw error
        await new Promise<void>((resolve, reject) => {
          const signal = options.signal
          const cancelled = () => {
            clearTimeout(timer); signal?.removeEventListener('abort', cancelled)
            reject(new ReviewApiError(message('feedback.network'), 0, 'REVIEW_TRANSPORT_ERROR', 'cancelled'))
          }
          const timer = setTimeout(() => { signal?.removeEventListener('abort', cancelled); resolve() }, 250)
          signal?.addEventListener('abort', cancelled, { once: true })
          if (signal?.aborted) cancelled()
        })
      }
    }
  }
}
// Shared transaction/readback outcome handling. Callers own presentation and invalidate stale selections.
export async function performObservationReview<T>(options: {
  id: string; revision: number; decision: ReviewDecision; comment: string; sourceLocale?: string; request: ReviewRequest;
  read: (id: string) => Promise<T>; current: () => boolean; invalidResponse: string;
}) {
  let committed = false
  try {
    const result = await options.request('/api/observations/' + encodeURIComponent(options.id) + '/review', { decision: options.decision, comment: options.comment, revision: options.revision,
      ...(options.sourceLocale ? { source_languages: { comment: options.sourceLocale } } : {}) })
    if (result.reviewed !== true) throw new ReviewApiError(options.invalidResponse)
    committed = true
    if (!options.current()) return null
    const observation = await options.read(options.id)
    return options.current() ? { kind: 'saved' as const, observation, needsReload: false, committed } : null
  } catch (error) {
    if (!options.current()) return null
    if (error instanceof ReviewApiError && error.status === 409) {
      try { const observation = await options.read(options.id); return options.current() ? { kind: 'conflict' as const, observation, needsReload: false, committed, error } : null }
      catch { return options.current() ? { kind: 'conflict' as const, needsReload: true, committed, error } : null }
    }
    return { kind: 'error' as const, needsReload: committed || !(error instanceof ReviewApiError) || ![400, 401, 403].includes(error.status), committed, error }
  }
}
