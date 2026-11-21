// Presentation only: never retries a mutation or changes review permissions.
export function officerActionError(error: unknown): string {
  const value = error as { status?: number; name?: string } | null
  if (value?.name === 'ObservationEditEvidenceError') return 'evidence'
  const status = value?.status
  if (status === 409) return 'conflict'
  if (status === 401) return 'session'
  if (status === 403) return 'permission'
  if (status === 400 || status === 422) return 'validation'
  if (status === 404) return 'unavailable'
  if (status === 429) return 'rateLimited'
  if (typeof status === 'number' && status >= 500) return 'server'
  if (!status) return 'network'
  return 'failed'
}
export function officerSaveUncertain(error: unknown): boolean {
  return ['network', 'server'].includes(officerActionError(error))
}
