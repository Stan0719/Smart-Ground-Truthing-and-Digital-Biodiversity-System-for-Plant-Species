export type ObservationOrigin = 'initial_registration' | 'subsequent_observation' | 'unknown'
export type ObservationQueue = ObservationOrigin | 'all'
export const observationOrigin = (value: unknown): ObservationOrigin =>
  value === 'initial_registration' || value === 'subsequent_observation' ? value : 'unknown'
export function observationQueueUrl(origin: ObservationQueue, status = '', cursor: string | null = null) {
  const query = new URLSearchParams({ limit: '100' })
  if (origin !== 'all') query.set('origin_type', origin)
  if (status) query.set('status', status)
  if (cursor) query.set('cursor', cursor)
  return '/api/observations?' + query.toString()
}
export function readQueuePage(value: unknown): { hasMore: boolean; cursor: string | null } | null {
  if (!value || typeof value !== 'object') return null
  const page = value as Record<string, unknown>
  if (typeof page.has_more !== 'boolean' ||
    (page.has_more ? typeof page.next_cursor !== 'string' || !page.next_cursor : page.next_cursor !== null)) return null
  return { hasMore: page.has_more, cursor: page.next_cursor as string | null }
}
