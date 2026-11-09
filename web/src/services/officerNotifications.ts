import { reactive } from 'vue'
import type { AuthUser } from './auth'

export interface OfficerNotice {
  id: string
  event_type: 'registration_submitted' | 'field_observation_submitted' | 'observation_resubmitted' | 'species_request_submitted'
  created_at: string
  read_at: string | null
  species_review_required: boolean
  resource: { kind: 'observation' | 'species_request'; id: string }
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
  function reset() {
    generation++; listRequest++; countRequest++
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
  }
  function parseNotice(value: unknown): OfficerNotice {
    const row = object(value), resource = object(row?.resource)
    if (!row || typeof row.id !== 'string' || !uuid.test(row.id) || !validDate(row.created_at) ||
      (row.read_at !== null && !validDate(row.read_at)) ||
      !['registration_submitted', 'field_observation_submitted', 'observation_resubmitted', 'species_request_submitted'].includes(String(row.event_type)) ||
      !resource || typeof resource.id !== 'string' ||
      (row.event_type === 'species_request_submitted' ? resource.kind !== 'species_request' || !/^[1-9][0-9]{0,9}$/.test(resource.id) || BigInt(resource.id)>2147483647n : resource.kind !== 'observation' || !observationId.test(resource.id)) ||
      (row.species_review_required !== null && row.species_review_required !== undefined && typeof row.species_review_required !== 'boolean')) throw Error('invalidResponse')
    return { id: row.id, event_type: row.event_type as OfficerNotice['event_type'], created_at: row.created_at,
      read_at: row.read_at as string | null, species_review_required: row.species_review_required === true, resource: { kind: resource.kind as OfficerNotice['resource']['kind'], id: resource.id } }
  }
  async function load(append = false) {
    if (!state.ready || disposed || state.loading || state.busy || (append && !state.hasMore)) return
    const token = generation, requestId = ++listRequest, countId = ++countRequest, cursor = append ? state.cursor : null
    const previousOperationError = state.operationError
    state.loading = true; state.listError = ''
    try {
      const result = await request('/api/data/staff-notifications?limit=20' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''))
      if (!current(token) || requestId !== listRequest) return
      const page = object(result.page)
      if (!Array.isArray(result.notifications) || !count(result.unread_count) || !page || typeof page.has_more !== 'boolean' ||
        (page.has_more ? typeof page.next_cursor !== 'string' || !page.next_cursor || page.next_cursor === cursor : page.next_cursor !== null) ||
        typeof result.read_through !== 'string' || !result.read_through) throw Error('invalidResponse')
      const items = result.notifications.map(parseNotice)
      if (state.operationError === previousOperationError) state.operationError = ''
      state.items = [...new Map([...(append ? state.items : []), ...items].map(item => [item.id, item])).values()]
      if (countId === countRequest) { state.unread = result.unread_count; state.countError = '' }
      state.hasMore = page.has_more; state.cursor = page.next_cursor as string | null; state.boundary = result.read_through
    } catch (error) { if (!(error instanceof StaleResponseError) && current(token) && requestId === listRequest) {
      state.listError = 'loadFailed'; if (countId === countRequest) state.unread = null
      if (error instanceof InboxError && error.status === 400) { state.cursor = null; state.hasMore = false; state.boundary = null }
    } }
    finally { if (current(token) && requestId === listRequest) state.loading = false }
  }
  async function refreshCount() {
    if (!state.ready || disposed || state.loading || state.busy) return
    const token = generation, requestId = ++countRequest
    try {
      const result = await request('/api/data/staff-notifications/unread-count')
      if (!current(token) || requestId !== countRequest) return
      if (!count(result.unread_count)) throw Error('invalidResponse')
      state.unread = result.unread_count; state.countError = ''
    } catch (error) { if (!(error instanceof StaleResponseError) && current(token) && requestId === countRequest) { state.unread = null; state.countError = 'loadFailed' } }
  }
  async function open(item: OfficerNotice) {
    if (!state.ready || disposed || state.busy) return false
    const token = generation; state.busy = true; state.operationError = ''
    try {
      const speciesRequest = item.resource.kind === 'species_request'
      const result = await request((speciesRequest ? '/api/species-requests/' : '/api/observations/') + encodeURIComponent(item.resource.id))
      if (!current(token)) return false
      const row = object(speciesRequest ? result.species_request : result.observation)
      if (speciesRequest ? !row || String(row.request_id) !== item.resource.id || !['Pending Review','Approved','Rejected','Correction Required'].includes(String(row.request_status)) : !row || row.id !== item.resource.id || !Number.isSafeInteger(row.revision) || Number(row.revision) < 1 ||
        !['initial_registration', 'subsequent_observation', 'unknown'].includes(String(row.origin_type))) throw Error('invalidResponse')
      const destination: Destination = speciesRequest ? { name: 'conservation-reviews', query: { speciesRequest: item.resource.id } } : row!.origin_type === 'subsequent_observation' ? { name: 'conservation-observations', query: { observation: item.resource.id } } :
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
  return { state, setSession, load, refreshCount, open, markAll, dispose }
}
