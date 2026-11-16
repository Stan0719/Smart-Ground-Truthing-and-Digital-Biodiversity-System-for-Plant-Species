import { reactive } from 'vue'
import type { AuthUser } from './auth'

export interface OfficerNotice {
  id: string
  event_type: 'registration_submitted' | 'field_observation_submitted' | 'observation_resubmitted' | 'species_request_submitted' | 'record_change_submitted'
  change_target_type?: 'plant' | 'species'
  created_at: string
  read_at: string | null
  species_review_required: boolean
  resource: { kind: 'observation' | 'species_request' | 'record_change'; id: string }
}
type Destination = { name: string; query?: Record<string, string> }
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const observationId = /^(?:[1-9][0-9]{0,18}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i
const object = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
const validDate = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v))
const count = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
class StaleResponseError extends Error {}
class InboxError extends Error {
  readonly status: number
  constructor(status: number) { super('requestFailed'); this.status = status }
}

export function createOfficerInbox(options: { transport: typeof fetch; navigate: (destination: Destination) => Promise<boolean> }) {
  const state = reactive({ items: [] as OfficerNotice[], unread: null as number | null, loading: false, busy: false, ready: false,
    operationError: '', listError: '', countError: '',
    get error(): string { return this.operationError || this.listError || this.countError }, hasMore: false, cursor: null as string | null, boundary: null as string | null })
  let identity = '', generation = 0, listRequest = 0, countRequest = 0, transportRequest = 0, disposed = false
  let activeRequests = 0
  let loadedPages = 0
  let backgroundRefresh: Promise<void> | null = null
  function reset() {
    generation++; listRequest++; countRequest++; loadedPages = 0
    state.items = []; state.unread = null; state.hasMore = false; state.cursor = null; state.boundary = null
    state.operationError = ''; state.listError = ''; state.countError = ''; state.loading = false; state.busy = false
  }
  function setSession(user: AuthUser | null, pending: boolean) {
    const next = `${user?.id}:${user?.role}:${user?.status}:${user?.mustChangePassword}:${pending}`
    if (identity === next) return false
    identity = next; reset()
    state.ready = !pending && user?.role === 'Conservation Officer' && user.status === 'Active' && user.mustChangePassword === false
    return true
  }
  const current = (token: number) => !disposed && state.ready && generation === token
  async function request(url: string, body?: object) {
    const token = generation, requestId = ++transportRequest
    activeRequests++
    try {
      const response = await options.transport(url, { method: body ? 'POST' : 'GET', credentials: 'same-origin', signal: AbortSignal.timeout(15000),
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
      if (response.status === 401 || response.status === 403) {
        // Invalidation is shared across list, count and acknowledgements. A newer
        // request supersedes this response even when it belongs to another operation.
        if (!current(token) || requestId !== transportRequest) throw new StaleResponseError()
        reset(); state.ready = false; state.operationError = 'sessionUnavailable'
        throw Error('sessionUnavailable')
      }
      if (!response.ok) throw new InboxError(response.status)
      const result = object(await response.json())
      if (!result) throw Error('invalidResponse')
      return result
    } finally { activeRequests-- }
  }
  function parseNotice(value: unknown): OfficerNotice {
    const row = object(value), resource = object(row?.resource)
    if (!row || typeof row.id !== 'string' || !uuid.test(row.id) || !validDate(row.created_at) ||
      (row.read_at !== null && !validDate(row.read_at)) ||
      !['registration_submitted', 'field_observation_submitted', 'observation_resubmitted', 'species_request_submitted', 'record_change_submitted'].includes(String(row.event_type)) ||
      !resource || typeof resource.id !== 'string' ||
      (row.event_type === 'record_change_submitted' ? resource.kind !== 'record_change' || !uuid.test(resource.id) : row.event_type === 'species_request_submitted' ? resource.kind !== 'species_request' || !/^[1-9][0-9]{0,9}$/.test(resource.id) || BigInt(resource.id)>2147483647n : resource.kind !== 'observation' || !observationId.test(resource.id)) ||
      (row.species_review_required !== null && row.species_review_required !== undefined && typeof row.species_review_required !== 'boolean')) throw Error('invalidResponse')
    return { id: row.id, event_type: row.event_type as OfficerNotice['event_type'], created_at: row.created_at,
      ...(row.change_target_type === 'plant' || row.change_target_type === 'species' ? { change_target_type: row.change_target_type } : {}),
      read_at: row.read_at as string | null, species_review_required: row.species_review_required === true, resource: { kind: resource.kind as OfficerNotice['resource']['kind'], id: resource.id } }
  }
  function parsePage(result: Record<string, unknown>, cursor: string | null) {
    const page = object(result.page)
    if (!Array.isArray(result.notifications) || !count(result.unread_count) || !page || typeof page.has_more !== 'boolean' ||
      (page.has_more ? typeof page.next_cursor !== 'string' || !page.next_cursor || page.next_cursor === cursor : page.next_cursor !== null) ||
      typeof result.read_through !== 'string' || !result.read_through) throw Error('invalidResponse')
    const items = result.notifications.map(parseNotice)
    return { page, items }
  }
  async function load(append = false) {
    if (!state.ready || disposed || backgroundRefresh || state.loading || state.busy || (append && !state.hasMore)) return
    const token = generation, requestId = ++listRequest, countId = ++countRequest, cursor = append ? state.cursor : null
    const previousOperationError = state.operationError
    state.loading = true; state.listError = ''
    try {
      const result = await request('/api/data/staff-notifications?limit=20' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''))
      if (!current(token) || requestId !== listRequest) return
      const { page, items } = parsePage(result, cursor)
      if (state.operationError === previousOperationError) state.operationError = ''
      state.items = [...new Map([...(append ? state.items : []), ...items].map(item => [item.id, item])).values()]
      if (countId === countRequest) { state.unread = result.unread_count as number; state.countError = '' }
      state.hasMore = page.has_more as boolean; state.cursor = page.next_cursor as string | null; state.boundary = result.read_through as string
      loadedPages = append ? loadedPages + 1 : 1
    } catch (error) { if (!(error instanceof StaleResponseError) && current(token) && requestId === listRequest) {
      state.listError = 'loadFailed'
      if (error instanceof InboxError && error.status === 400) { state.cursor = null; state.hasMore = false; state.boundary = null }
    } }
    finally { if (current(token) && requestId === listRequest) state.loading = false }
  }
  async function refreshCount() {
    if (!state.ready || disposed || backgroundRefresh || state.loading || state.busy) return
    const token = generation, requestId = ++countRequest
    try {
      const result = await request('/api/data/staff-notifications/unread-count')
      if (!current(token) || requestId !== countRequest) return
      if (!count(result.unread_count)) throw Error('invalidResponse')
      state.unread = result.unread_count as number; state.countError = ''
    } catch (error) { if (!(error instanceof StaleResponseError) && current(token) && requestId === countRequest) { state.countError = 'loadFailed' } }
  }
  function refresh(): Promise<void> {
    if (backgroundRefresh) return backgroundRefresh
    if (!state.ready || disposed || state.loading || state.busy || activeRequests > 0) return Promise.resolve()
    if (!loadedPages) return load()
    const token = generation
    const requestId = ++listRequest
    const countId = ++countRequest
    const pagesToRefresh = loadedPages
    const work = (async () => {
      let cursor: string | null = null
      const seen = new Set<string>()
      const fresh: OfficerNotice[] = []
      try {
        for (let index = 0; index < pagesToRefresh; index++) {
          const result = await request('/api/data/staff-notifications?limit=20' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''))
          if (!current(token) || requestId !== listRequest) return
          const { page, items } = parsePage(result, cursor)
          fresh.push(...items)
          const next = page.next_cursor as string | null
          if (next && seen.has(next)) throw Error('invalidResponse')
          if (next) seen.add(next)
          if (!page.has_more || index === pagesToRefresh - 1) {
            // Revalidate the loaded page depth under a fresh server cursor boundary.
            state.items = [...new Map(fresh.map(item => [item.id, item])).values()]
            state.hasMore = page.has_more as boolean
            state.cursor = next
            state.boundary = result.read_through as string
            loadedPages = index + 1
            if (countId === countRequest) { state.unread = result.unread_count as number; state.countError = '' }
            state.listError = ''
            return
          }
          cursor = next
        }
      } catch (error) {
        if (!(error instanceof StaleResponseError) && current(token) && requestId === listRequest) state.listError = 'loadFailed'
      }
    })()
    const tracked = work.finally(() => { if (backgroundRefresh === tracked) backgroundRefresh = null })
    backgroundRefresh = tracked
    return tracked
  }
  async function open(item: OfficerNotice) {
    const waitingSession = generation
    if (backgroundRefresh) await backgroundRefresh
    if (!current(waitingSession)) return false
    if (!state.ready || disposed || state.busy) return false
    const token = generation; state.busy = true; state.operationError = ''
    try {
      const change = item.resource.kind === 'record_change'
      const speciesRequest = item.resource.kind === 'species_request'
      const result = await request((change ? '/api/data/record-changes/' : speciesRequest ? '/api/species-requests/' : '/api/observations/') + encodeURIComponent(item.resource.id))
      if (!current(token)) return false
      const row = object(change ? result.change : speciesRequest ? result.species_request : result.observation)
      if (change ? !row || row.id !== item.resource.id || !['Pending Review','Approved','Rejected','Cancelled'].includes(String(row.status)) : speciesRequest ? !row || String(row.request_id) !== item.resource.id || !['Pending Review','Approved','Rejected','Correction Required'].includes(String(row.request_status)) : !row || row.id !== item.resource.id || !Number.isSafeInteger(row.revision) || Number(row.revision) < 1 ||
        !['initial_registration', 'subsequent_observation', 'unknown'].includes(String(row.origin_type))) throw Error('invalidResponse')
      const destination: Destination = change ? { name: 'conservation-reviews', query: { change: item.resource.id } } : speciesRequest ? { name: 'conservation-reviews', query: { speciesRequest: item.resource.id } } : row!.origin_type === 'subsequent_observation' ? { name: 'conservation-observations', query: { observation: item.resource.id } } :
        { name: 'conservation-reviews', query: { review: item.resource.id } }
      if (!await options.navigate(destination)) throw Error('navigationFailed')
      if (!current(token)) return false
      // Skip a redundant acknowledgement only for server-confirmed read state.
      if ((state.items.find(entry => entry.id === item.id) || item).read_at !== null) return true
      const saved = await request('/api/data/staff-notifications/' + encodeURIComponent(item.id) + '/read', {})
      if (!current(token)) return false
      const notification = object(saved.notification)
      if (notification?.id !== item.id || !validDate(notification.read_at)) throw Error('invalidResponse')
      const entry = state.items.find(entry => entry.id === item.id)
      if (entry) entry.read_at = notification.read_at
      return true
    } catch (error) { if (!(error instanceof StaleResponseError) && current(token)) state.operationError = 'openFailed'; return false }
    finally { if (current(token)) { state.busy = false; void refreshCount() } }
  }
  async function markAll() {
    const waitingSession = generation
    if (backgroundRefresh) await backgroundRefresh
    if (!current(waitingSession)) return
    if (!state.ready || disposed || state.busy || state.loading || !state.boundary || !state.unread) return
    const token = generation; state.busy = true; state.operationError = ''
    try {
      const result = await request('/api/data/staff-notifications/read-all', { read_through: state.boundary })
      if (!current(token)) return
      if (!count(result.updated)) throw Error('invalidResponse')
      state.busy = false; await load()
    } catch (error) { if (!(error instanceof StaleResponseError) && current(token)) { state.operationError = 'readFailed'; state.boundary = null } }
    finally { if (current(token)) { state.busy = false; void refreshCount() } }
  }
  function dispose() { disposed = true; reset(); state.ready = false }
  return { state, setSession, load, refresh, refreshCount, open, markAll, dispose }
}
