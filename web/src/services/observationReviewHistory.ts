import { reactive } from 'vue'

export interface ObservationReviewEntry {
  id: string
  review_origin?: string
  species_request_id?: string | null
  observation_id: string
  decision: string
  reviewer_subject: string | null
  comment: string
  created_at: string | null
}
const decisions = ['Approved', 'Rejected', 'Correction Required', 'Flagged']
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null

export function formatReviewTimestamp(value: string | null, locale = 'en') {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})$/.test(value)) return '\u2014'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '\u2014'
  const calendar = new Date(value.slice(0, 10) + 'T00:00:00Z')
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== value.slice(0, 10)) return '\u2014'
  const language = locale.startsWith('en') ? 'en-GB' : locale === 'ms' ? 'ms-MY' : locale
  const day = new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kuching' }).format(date)
  const time = new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Kuching' }).format(date)
  return `${day}, ${time}`
}

export function createObservationReviewHistory(transport: typeof fetch = fetch) {
  const state = reactive({ observationId: '', reviews: [] as ObservationReviewEntry[], loading: false, failed: false, hasMore: false })
  let generation = 0
  let controller: AbortController | null = null
  let cursor: string | null = null
  let retryAppend = false
  const seenCursors = new Set<string>()
  function reset() {
    generation++
    controller?.abort()
    controller = null
    cursor = null
    seenCursors.clear()
    state.observationId = ''
    state.reviews = []
    state.loading = false
    state.failed = false
    state.hasMore = false
  }
  async function load(observationId: string, append = false) {
    if (append && (state.loading || !state.hasMore || state.observationId !== observationId)) return
    if (state.observationId !== observationId) reset()
    controller?.abort()
    const token = ++generation
    const abort = new AbortController()
    controller = abort
    state.observationId = observationId
    state.loading = true
    state.failed = false
    retryAppend = append
    const current = () => token === generation && !abort.signal.aborted
    try {
      const query = new URLSearchParams({ limit: '50' })
      if (append && cursor) query.set('cursor', cursor)
      const response = await transport(`/api/data/observations/${encodeURIComponent(observationId)}/reviews?${query}`, {
        credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
      })
      if (!current()) return
      if ([401, 403, 404].includes(response.status)) {
        state.reviews = []
        state.hasMore = false
        cursor = null
      }
      if (!response.ok) throw Error('Review history request failed')
      const result = object(await response.json()), page = object(result?.page)
      if (!current()) return
      if (result?.observation_id !== observationId || !Array.isArray(result.reviews) || result.reviews.length > 50 ||
          !page || page.limit !== 50 || typeof page.has_more !== 'boolean' ||
          (page.has_more ? typeof page.next_cursor !== 'string' || !/^[A-Za-z0-9_-]{1,2000}$/.test(page.next_cursor) : page.next_cursor !== null)) throw Error('Invalid history')
      const next = page.next_cursor as string | null
      if (append && next && (seenCursors.has(next) || cursor === next)) throw Error('Repeated history cursor')
      const reviews: ObservationReviewEntry[] = result.reviews.map(value => {
        const row = object(value)
        if (!row || typeof row.id !== 'string' || !row.id.trim() || row.observation_id !== observationId ||
            !decisions.includes(String(row.decision)) || typeof row.comment !== 'string' ||
            (row.reviewer_subject !== null && typeof row.reviewer_subject !== 'string') ||
            (row.created_at !== null && typeof row.created_at !== 'string')) throw Error('Invalid review')
        return row as unknown as ObservationReviewEntry
      })
      const merged = append ? [...state.reviews, ...reviews] : reviews
      if (new Set(merged.map(row => row.id)).size !== merged.length) throw Error('Duplicate review')
      state.reviews = merged
      if (!append) seenCursors.clear()
      if (next) seenCursors.add(next)
      cursor = next
      state.hasMore = page.has_more
    } catch {
      if (current()) state.failed = true
    } finally {
      if (current()) { state.loading = false; controller = null }
    }
  }
  return { state, load, reset, retry: () => load(state.observationId, retryAppend) }
}
