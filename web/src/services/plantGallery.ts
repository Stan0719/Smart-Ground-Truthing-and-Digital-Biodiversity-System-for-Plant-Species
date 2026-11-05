import { reactive } from 'vue'
import { assetUrlFromId } from './assetImages.ts'
export type GalleryOrigin = 'initial_registration' | 'subsequent_observation' | 'unknown'
export interface GalleryAsset {
  id: string; url: string; observationId: string | null; origin: GalleryOrigin
  date: string | null; status: string | null; revision: string | null; photoOrder: string | null
}
export interface GalleryGroup {
  key: string; observationId: string | null; origin: GalleryOrigin
  date: string | null; status: string | null; revision: string | null; assets: GalleryAsset[]
}
const object = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v)
function invalid(): never { throw new Error('The photo gallery returned invalid metadata. Reload photos.') }
function mapAsset(value: unknown, scientific: boolean): GalleryAsset {
  const a = object(value)
  if (!a || !id(a.asset_id) || !['image/jpeg', 'image/png'].includes(String(a.content_type)) ||
    !['initial_registration', 'subsequent_observation', 'unknown'].includes(String(a.effective_origin))) return invalid()
  const linked = a.linkage === 'observation' && id(a.observation_id)
  const unlinked = a.linkage === 'unlinked' && a.observation_id === null && a.effective_origin === 'unknown'
  if (!linked && !unlinked) return invalid()
  if (a.photo_order !== null && (typeof a.photo_order !== 'string' || !/^\d{1,100}$/.test(a.photo_order))) return invalid()
  if (a.observation_date !== null && (typeof a.observation_date !== 'string' || !Number.isFinite(Date.parse(a.observation_date)))) return invalid()
  if (a.observation_status !== null && !['Draft', 'Pending Review', 'Approved', 'Rejected', 'Correction Required', 'Flagged'].includes(String(a.observation_status))) return invalid()
  const revision = a.observation_revision
  if (revision !== null && !((typeof revision === 'number' && Number.isSafeInteger(revision) && revision > 0) ||
    (typeof revision === 'string' && /^[1-9][0-9]{0,18}$/.test(revision)))) return invalid()
  // Public callers must not accept unexpected private review context.
  if ((!scientific || unlinked) && [a.observation_date, a.observation_status, revision].some(v => v !== null)) return invalid()
  return { id: a.asset_id, url: assetUrlFromId(a.asset_id), observationId: linked ? a.observation_id as string : null,
    origin: a.effective_origin as GalleryOrigin, date: a.observation_date as string | null,
    status: a.observation_status as string | null, revision: revision === null ? null : String(revision), photoOrder: a.photo_order as string | null }
}
function signature(a: GalleryAsset) { return JSON.stringify([a.observationId, a.origin, a.date, a.status, a.revision]) }
export function groupGallery(assets: GalleryAsset[]): GalleryGroup[] {
  const groups = new Map<string, GalleryGroup>()
  for (const a of assets) {
    const key = a.observationId === null ? 'unlinked' : 'observation:' + a.observationId
    let group = groups.get(key)
    if (!group) { group = { key, observationId: a.observationId, origin: a.origin, date: a.date, status: a.status, revision: a.revision, assets: [] }; groups.set(key, group) }
    group.assets.push(a)
  }
  for (const group of groups.values()) group.assets.sort((a, b) => {
    if (a.photoOrder === null || b.photoOrder === null) return a.photoOrder === b.photoOrder ? 0 : a.photoOrder === null ? 1 : -1
    const x = BigInt(a.photoOrder), y = BigInt(b.photoOrder); return x < y ? -1 : x > y ? 1 : 0
  })
  const ordered = [...groups.values()]
  // Sort known dates in their existing slots; undated groups retain server order.
  const dated = ordered.filter(g => g.date !== null).sort((a, b) => Date.parse(a.date!) - Date.parse(b.date!))
  let index = 0
  return ordered.map(g => g.date === null ? g : dated[index++]!)
}
export function createPlantGallery({ transport = fetch }: { transport?: typeof fetch } = {}) {
  const state = reactive({ plantId: '', epoch: 0, assets: [] as GalleryAsset[], loading: false, error: '', hasMore: false, complete: false })
  let generation = 0, cursor: string | null = null, controller: AbortController | null = null
  const seen = new Set<string>()
  function reset() {
    generation++; state.epoch++; controller?.abort(); controller = null; cursor = null; seen.clear()
    state.plantId = ''; state.assets = []; state.loading = false; state.error = ''; state.hasMore = false; state.complete = false
  }
  async function load(plantId: string, scientific: boolean, append = false) {
    if (append && (state.loading || !state.hasMore || state.plantId !== plantId)) return
    if (!append) { reset(); state.plantId = plantId }
    if (!/^[1-9][0-9]{0,9}$/.test(plantId)) { state.error = 'Invalid plant identifier.'; return }
    const token = generation, after = append ? cursor : null
    const abort = new AbortController(); controller = abort; state.loading = true; state.error = ''
    const current = () => token === generation && !abort.signal.aborted
    try {
      const query = new URLSearchParams({ limit: '20' }); if (after) query.set('cursor', after)
      const response = await transport(`/api/data/plants/${plantId}/gallery?${query}`, {
        credentials: 'same-origin', signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
      })
      if (!current()) return
      if (!response.ok) throw new Error(response.status === 404 ? 'Photo gallery unavailable for this plant. Please retry later.' : `Photos could not be loaded (HTTP ${response.status}).`)
      const result = object(await response.json()); if (!current()) return
      const page = object(result?.page)
      if (!result || result.plant_id !== plantId || !Array.isArray(result.assets) || result.assets.length > 20 || !page || page.limit !== 20 ||
        typeof page.has_more !== 'boolean' || (page.has_more ? typeof page.next_cursor !== 'string' || !/^[A-Za-z0-9_-]{1,2000}$/.test(page.next_cursor) : page.next_cursor !== null)) return invalid()
      const next = page.next_cursor as string | null
      if (next !== null && (next === after || seen.has(next))) throw new Error('Photo pagination repeated a cursor. Reload photos.')
      const merged = new Map((append ? state.assets : []).map(a => [a.id, a]))
      const groups = new Map([...merged.values()].map(a => [a.observationId ?? 'unlinked', signature(a)]))
      for (const value of result.assets) {
        const a = mapAsset(value, scientific), previous = merged.get(a.id), key = a.observationId ?? 'unlinked'
        if ((previous && JSON.stringify(previous) !== JSON.stringify(a)) || (groups.has(key) && groups.get(key) !== signature(a)))
          throw new Error('Photo metadata changed between pages. Reload photos.')
        groups.set(key, signature(a)); merged.set(a.id, a)
      }
      state.assets = [...merged.values()]; cursor = next; if (next) seen.add(next)
      state.hasMore = page.has_more; state.complete = !page.has_more
    } catch (error) {
      if (!current()) return
      // Fail closed on metadata inconsistencies; retry starts a fresh snapshot.
      state.assets = []; state.hasMore = false; state.complete = false; cursor = null; seen.clear()
      state.error = error instanceof Error && /^(The photo gallery|Photos could|Photo gallery|Photo pagination|Photo metadata)/.test(error.message)
        ? error.message : 'Photos could not be loaded. Please retry.'
    } finally { if (token === generation) { state.loading = false; if (controller === abort) controller = null } }
  }
  return { state, load, reset }
}
