import type { DetailObservationContent } from './plantDetail'
import type { HistoryObservation } from './plantHistory'
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
function content(value: unknown): DetailObservationContent | null {
  const source = object(value)
  if (!source) return null
  const result: Record<string, unknown> = {}
  for (const key of ['heightCm','latitude','longitude','accuracy_m','altitude_m']) {
    const value = source[key] ?? null
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) return null
    result[key] = value
  }
  if ((result.latitude === null) !== (result.longitude === null) ||
      (typeof result.latitude === 'number' && Math.abs(result.latitude) > 90) ||
      (typeof result.longitude === 'number' && Math.abs(result.longitude) > 180) ||
      (typeof result.accuracy_m === 'number' && result.accuracy_m < 0)) return null
  for (const key of ['healthStatus','lifeStage','morphology','notes','zone']) {
    const value = source[key] ?? null
    if (value !== null && typeof value !== 'string') return null
    result[key] = value
  }
  const taxonomy = source.taxonomy == null ? {} : object(source.taxonomy)
  if (!taxonomy || Object.values(taxonomy).some(value => typeof value !== 'string')) return null
  result.taxonomy = taxonomy
  return result as unknown as DetailObservationContent
}
export function plantRegistrationDisplay(authorized: boolean, staff: unknown, plantId: string, observations: HistoryObservation[], historyComplete: boolean) {
  const data = authorized ? object(staff) : null
  const unavailable = { status: typeof data?.status === 'string' ? data.status : '', registeredAt: typeof data?.registered_at === 'string' && Number.isFinite(Date.parse(data.registered_at)) ? data.registered_at : '', provenance: 'unavailable' as 'unavailable' | 'approved' | 'submitted', content: null as DetailObservationContent | null }
  if (!data) return unavailable
  const registration = object(data.current_registration)
  if (data.status === 'Approved') {
    const fields = registration?.state === 'available' && typeof registration.observation_id === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(registration.observation_id) ? content(registration.content) : null
    return fields ? { ...unavailable, provenance: 'approved' as const, content: fields } : unavailable
  }
  // Complete authorized history is required to exclude ambiguous initial identities.
  // Never use latest_observation, timestamps or list position as provenance.
  if (!historyComplete) return unavailable
  const initial = observations.filter(row => row.origin === 'initial_registration' && row.plant_id === plantId)
  if (initial.length !== 1 || !['Pending Review','Correction Required','Rejected','Withdrawn','Flagged'].includes(initial[0]!.status)) return unavailable
  const fields = content(initial[0]!.content)
  return fields ? { ...unavailable, status: initial[0]!.status, provenance: 'submitted' as const, content: fields } : unavailable
}
