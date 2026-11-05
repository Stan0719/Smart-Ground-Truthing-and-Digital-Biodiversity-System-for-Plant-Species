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
export class ReviewApiError extends Error {
  readonly status: number
  constructor(message: string, status = 0) { super(message); this.status = status }
}
export type ReviewRequest = (url: string, body?: { decision: ReviewDecision; comment: string; revision?: number }) => Promise<Record<string, unknown>>
export function createReviewRequest(message: (key: string, params?: Record<string, string | number>) => string, transport: typeof fetch): ReviewRequest {
  return async (url, body) => {
    let response: Response
    try { response = await transport(url, { method: body ? 'POST' : 'GET', credentials: 'same-origin', ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) }) }
    catch { throw new ReviewApiError(message('feedback.network')) }
    let result: Record<string, unknown> | null
    try { const value: unknown = await response.json(); result = value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null }
    catch { throw new ReviewApiError(message('feedback.invalidResponse'), response.status) }
    if (!response.ok) {
      const detail = [result?.message, result?.error].find((v): v is string => typeof v === 'string' && Boolean(v.trim()))
      throw new ReviewApiError(detail || message(response.status === 401 ? 'feedback.session' : response.status === 403 ? 'feedback.forbidden' : 'feedback.requestFailed', { status: response.status }), response.status)
    }
    if (!result) throw new ReviewApiError(message('feedback.invalidResponse'), response.status)
    return result
  }
}
// Shared transaction/readback outcome handling. Callers own presentation and invalidate stale selections.
export async function performObservationReview<T>(options: {
  id: string; revision: number; decision: ReviewDecision; comment: string; request: ReviewRequest;
  read: (id: string) => Promise<T>; current: () => boolean; invalidResponse: string;
}) {
  let committed = false
  try {
    const result = await options.request('/api/observations/' + encodeURIComponent(options.id) + '/review', { decision: options.decision, comment: options.comment, revision: options.revision })
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
