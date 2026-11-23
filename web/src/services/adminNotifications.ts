import { reactive } from 'vue'
import type { AuthUser } from './auth'

export type AdminNotificationAction =
  | 'staff_created'
  | 'staff_deactivated'
  | 'staff_reactivated'
  | 'staff_role_changed'
  | 'staff_profile_updated'
  | 'staff_archived'
  | 'security_settings_changed'
  | 'security_event'
  | 'system_failure'

export interface AdminNotification {
  id: string
  event_type: 'account_administration' | 'security_event' | 'system_failure'
  priority: 'normal' | 'high'
  created_at: string
  read_at: string | null
  details: {
    action: AdminNotificationAction
    account_name?: string
    previous_role?: string
    role?: string
    status?: string
  }
}

const actions: AdminNotificationAction[] = [
  'staff_created', 'staff_deactivated', 'staff_reactivated', 'staff_role_changed',
  'staff_profile_updated', 'staff_archived', 'security_settings_changed', 'security_event', 'system_failure',
]
const roles = ['Administrator', 'Conservation Officer', 'Botanist', 'Visitor']
const statuses = ['Active', 'Inactive', 'Suspended', 'Pending Activation']
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const validDate = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))
const validNotification = (value: unknown): AdminNotification | null => {
  const row = object(value)
  const details = object(row?.admin_details)
  if (!row || typeof row.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(row.id) ||
      !['account_administration', 'security_event', 'system_failure'].includes(String(row.event_type)) ||
      !['normal', 'high'].includes(String(row.priority)) || !validDate(row.created_at) ||
      (row.read_at !== null && !validDate(row.read_at)) || !details ||
      !actions.includes(details.action as AdminNotificationAction)) return null
  return {
    id: row.id,
    event_type: row.event_type as AdminNotification['event_type'],
    priority: row.priority as AdminNotification['priority'],
    created_at: row.created_at,
    read_at: row.read_at as string | null,
    details: {
      action: details.action as AdminNotificationAction,
      ...(typeof details.account_name === 'string' && details.account_name.length <= 100 ? { account_name: details.account_name } : {}),
      ...(roles.includes(String(details.previous_role)) ? { previous_role: String(details.previous_role) } : {}),
      ...(roles.includes(String(details.role)) ? { role: String(details.role) } : {}),
      ...(statuses.includes(String(details.status)) ? { status: String(details.status) } : {}),
    },
  }
}

export function createAdminInbox(options: { transport: typeof fetch }) {
  const state = reactive({
    items: [] as AdminNotification[], unread: 0, ready: false, loading: false, busy: false,
    loaded: false, boundary: null as string | null, error: '',
  })
  let identity = ''
  let generation = 0
  let disposed = false
  const current = (token: number) => !disposed && generation === token && state.ready
  function setSession(user: AuthUser | null, pending: boolean) {
    const next = `${user?.id}:${user?.role}:${user?.status}:${user?.mustChangePassword}:${pending}`
    if (identity === next) return
    identity = next
    generation++
    state.items = []; state.unread = 0; state.loaded = false; state.boundary = null; state.error = ''
    state.loading = false; state.busy = false
    state.ready = !pending && user?.role === 'Administrator' && user.status === 'Active' && !user.mustChangePassword
  }
  async function request(url: string, body?: object) {
    const response = await options.transport(url, {
      method: body ? 'POST' : 'GET', credentials: 'same-origin', signal: AbortSignal.timeout(15000),
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    })
    if (!response.ok) throw Object.assign(new Error('requestFailed'), { status: response.status })
    const parsed = object(await response.json())
    if (!parsed) throw Error('invalidResponse')
    return parsed
  }
  async function load() {
    if (!state.ready || disposed || state.loading || state.busy) return
    const token = generation
    state.loading = true; state.error = ''
    try {
      const result = await request('/api/data/staff-notifications?limit=20')
      if (!current(token)) return
      if (!Array.isArray(result.notifications) || !Number.isSafeInteger(result.unread_count) ||
          Number(result.unread_count) < 0 || !object(result.page) || typeof result.read_through !== 'string') throw Error('invalidResponse')
      const items = result.notifications.map(validNotification)
      if (items.some((item) => !item)) throw Error('invalidResponse')
      state.items = items as AdminNotification[]
      state.unread = Number(result.unread_count)
      state.boundary = result.read_through
      state.loaded = true
    } catch (error) {
      if (!current(token)) return
      state.error = (error as { status?: number })?.status === 401 || (error as { status?: number })?.status === 403
        ? 'sessionUnavailable' : 'loadFailed'
      if (state.error === 'sessionUnavailable') { state.ready = false; state.items = []; state.unread = 0 }
    } finally { if (current(token)) state.loading = false }
  }
  async function refresh() { await load() }
  async function refreshCount() {
    if (!state.ready || disposed) return
    const token = generation
    try {
      const result = await request('/api/data/staff-notifications/unread-count')
      if (!current(token)) return
      if (!Number.isSafeInteger(result.unread_count) || Number(result.unread_count) < 0) throw Error('invalidResponse')
      state.unread = Number(result.unread_count)
    } catch {
      if (current(token)) state.error = 'loadFailed'
    }
  }
  async function markRead(item: AdminNotification) {
    if (!state.ready || state.busy) return false
    if (item.read_at) return true
    const token = generation
    state.busy = true; state.error = ''
    try {
      const result = await request(`/api/data/staff-notifications/${encodeURIComponent(item.id)}/read`, {})
      const saved = object(result.notification)
      if (!current(token)) return false
      if (saved?.id !== item.id || !validDate(saved.read_at)) throw Error('invalidResponse')
      const entry = state.items.find((notice) => notice.id === item.id)
      if (entry) entry.read_at = saved.read_at
      state.unread = Math.max(0, state.unread - 1)
      return true
    } catch { if (current(token)) state.error = 'readFailed'; return false }
    finally { if (current(token)) state.busy = false }
  }
  async function markAll() {
    if (!state.ready || state.busy || !state.unread || !state.boundary) return
    const token = generation
    state.busy = true; state.error = ''
    try {
      const result = await request('/api/data/staff-notifications/read-all', { read_through: state.boundary })
      if (!current(token) || !Number.isSafeInteger(result.updated)) throw Error('invalidResponse')
      await loadAfterMarkAll(token)
    } catch { if (current(token)) state.error = 'readFailed' }
    finally { if (current(token)) state.busy = false }
  }
  async function loadAfterMarkAll(token: number) {
    // Reuse the same API contract after acknowledgement while avoiding a concurrent load lock.
    const result = await request('/api/data/staff-notifications?limit=20')
    if (!current(token) || !Array.isArray(result.notifications) || !Number.isSafeInteger(result.unread_count) || typeof result.read_through !== 'string') throw Error('invalidResponse')
    const items = result.notifications.map(validNotification)
    if (items.some((item) => !item)) throw Error('invalidResponse')
    state.items = items as AdminNotification[]
    state.unread = Number(result.unread_count)
    state.boundary = result.read_through
    state.loaded = true
  }
  function dispose() { disposed = true; generation++; state.ready = false; state.items = []; state.unread = 0 }
  return { state, setSession, load, refresh, refreshCount, markRead, markAll, dispose }
}
