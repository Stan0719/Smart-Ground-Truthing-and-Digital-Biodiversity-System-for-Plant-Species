import { reactive } from 'vue'
import { detailPhotoUrl } from './plantGallery.ts'
export interface HistoryPhoto { id: string; url: string }
export interface HistoryContent {
  heightCm: number | null; healthStatus: string | null; lifeStage: string | null; morphology: string | null; notes: string | null
  latitude: number | null; longitude: number | null; accuracy_m: number | null; altitude_m: number | null; zone: string | null
}
export interface HistoryObservation {
  id: string; plant_id: string; origin: 'initial_registration' | 'subsequent_observation' | 'unknown'
  date: string; status: string; recorded_by: string | null; content: HistoryContent; assets: HistoryPhoto[]
  review: { decision: string; comment: string; created_at: string } | null
}
const object = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
const validId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v)
const statuses = ['Draft', 'Pending Review', 'Approved', 'Rejected', 'Correction Required', 'Flagged']
const validDate = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v))
function invalid(): never { throw Error('Observation history returned invalid data. Reload history.') }
function mapObservation(value: unknown, plantId: string): HistoryObservation {
  const o = object(value), c = object(o?.content)
  if (!o || !c || !validId(o.id) || o.plant_id !== plantId || !validDate(o.date) || !statuses.includes(String(o.status)) ||
    !['initial_registration', 'subsequent_observation', 'unknown'].includes(String(o.origin)) ||
    (o.recorded_by !== null && typeof o.recorded_by !== 'string') || !Array.isArray(o.assets)) return invalid()
  for (const key of ['heightCm', 'latitude', 'longitude', 'accuracy_m', 'altitude_m']) {
    if (c[key] !== null && (typeof c[key] !== 'number' || !Number.isFinite(c[key]))) return invalid()
  }
  for (const key of ['healthStatus', 'lifeStage', 'morphology', 'notes', 'zone']) if (c[key] !== null && typeof c[key] !== 'string') return invalid()
  if ((c.latitude === null) !== (c.longitude === null) || (typeof c.latitude === 'number' && Math.abs(c.latitude) > 90) ||
    (typeof c.longitude === 'number' && Math.abs(c.longitude) > 180) || (typeof c.accuracy_m === 'number' && c.accuracy_m < 0)) return invalid()
  const review = o.review === null ? null : object(o.review)
  if (o.review !== null && (!review || !statuses.includes(String(review.decision)) || typeof review.comment !== 'string' || !validDate(review.created_at))) return invalid()
  const seen = new Set<string>()
  const assets = o.assets.map(value => {
    const a = object(value)
    if (!a || !validId(a.id) || seen.has(a.id) || !['image/jpeg', 'image/png'].includes(String(a.content_type))) return invalid()
    seen.add(a.id); return { id: a.id, url: detailPhotoUrl(plantId, a.id) }
  })
  return { id: o.id, plant_id: plantId, origin: o.origin as HistoryObservation['origin'], date: o.date, status: String(o.status),
    recorded_by: o.recorded_by as string | null, content: c as unknown as HistoryContent, assets,
    review: review as HistoryObservation['review'] }
}
export function createPlantHistory({ transport = fetch }: { transport?: typeof fetch } = {}) {
  const state = reactive({ plantId: '', epoch: 0, observations: [] as HistoryObservation[], loading: false, error: '', hasMore: false, complete: false })
  let generation = 0, cursor: string | null = null, controller: AbortController | null = null
  const seen = new Set<string>()
  function reset() {
    generation++; state.epoch++; controller?.abort(); controller = null; cursor = null; seen.clear()
    state.plantId = ''; state.observations = []; state.loading = false; state.error = ''; state.hasMore = false; state.complete = false
  }
  async function load(plantId: string, append = false) {
    if (append && (state.loading || !state.hasMore || state.plantId !== plantId)) return
    if (!append) { reset(); state.plantId = plantId }
    const token = generation, after = append ? cursor : null, abort = new AbortController()
    controller = abort; state.loading = true; state.error = ''
    const current = () => generation === token && !abort.signal.aborted
    try {
      if (!/^[1-9][0-9]{0,9}$/.test(plantId) || Number(plantId) > 2147483647) return invalid()
      const query = new URLSearchParams({ limit: '20' }); if (after) query.set('cursor', after)
      const response = await transport(`/api/data/plants/${plantId}/detail/history?${query}`, {
        credentials: 'same-origin', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
      })
      if (!current()) return
      if (!response.ok) throw Error(`Observation history could not be loaded (HTTP ${response.status}).`)
      const result = object(await response.json()), page = object(result?.page)
      if (!current()) return
      if (!result || result.plant_id !== plantId || !Array.isArray(result.observations) || result.observations.length > 20 || !page || page.limit !== 20 ||
        typeof page.has_more !== 'boolean' || (page.has_more ? typeof page.next_cursor !== 'string' || !/^[A-Za-z0-9_-]{1,2000}$/.test(page.next_cursor) : page.next_cursor !== null)) return invalid()
      const next = page.next_cursor as string | null
      if (next && (seen.has(next) || next === after)) return invalid()
      const rows = result.observations.map(o => mapObservation(o, plantId))
      const merged = new Map((append ? state.observations : []).map(o => [o.id, o]))
      for (const row of rows) {
        if (merged.has(row.id)) return invalid()
        merged.set(row.id, row)
      }
      state.observations = [...merged.values()]; cursor = next; if (next) seen.add(next)
      state.hasMore = page.has_more; state.complete = !page.has_more
    } catch (error) {
      if (!current()) return
      state.observations = []; state.hasMore = false; state.complete = false; cursor = null; seen.clear()
      state.error = error instanceof Error && /^Observation history/.test(error.message) ? error.message : 'Observation history could not be loaded. Please retry.'
    } finally { if (current()) { state.loading = false; controller = null } }
  }
  return { state, reset, load }
}
