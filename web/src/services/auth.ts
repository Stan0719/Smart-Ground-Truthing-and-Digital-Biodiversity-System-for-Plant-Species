export interface AuthUser {
  id: string
  name: string
  email: string
  role: 'Administrator' | 'Conservation Officer' | 'Botanist' | 'Visitor'
  status: 'Active' | 'Inactive' | 'Suspended'
  mustChangePassword: boolean
  lastLogin: string
  initials: string
}
// Server-backed session notifications; no role or token is accepted from storage.
type SessionListener = (user: AuthUser | null, pending: boolean) => void
const sessionListeners = new Set<SessionListener>()
let session = { user: null as AuthUser | null, pending: true }
let sessionGeneration = 0
let sessionTransition: number | null = null
let pendingSession: { generation: number; work: Promise<AuthUser | null> } | null = null
const identity = (user: AuthUser | null) => user ? `${user.id}:${user.role}:${user.status}:${user.mustChangePassword}` : ''
function publishSession(user: AuthUser | null, pending = false) {
  if (identity(session.user) === identity(user) && session.pending === pending) return
  session = { user, pending }
  for (const listener of sessionListeners) {
    try { listener(user, pending) } catch { /* A view cannot change session authority. */ }
  }
}
export const sessionSnapshot = () => session
export function subscribeSession(listener: SessionListener) {
  sessionListeners.add(listener)
  return () => { sessionListeners.delete(listener) }
}
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const changingSession = path === '/auth/logout' || path === '/auth/login'
  const generation = changingSession ? ++sessionGeneration : sessionGeneration
  if (changingSession) { sessionTransition = generation; publishSession(null, true) }
  try {
    let response: Response
    try {
      response = await fetch(`/api${path}`, {
        method,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    } catch {
      throw new Error('Unable to reach the server. Please try again.')
    }
    const result = await response.json()
    if (!response.ok) throw Object.assign(new Error(result.error || 'Request failed.'), { status: response.status })
    if (changingSession && generation !== sessionGeneration) throw new Error('The session changed during this request.')
    if (changingSession) sessionTransition = null
    if (path === '/auth/login') publishSession(result.user)
    if (path === '/auth/logout') publishSession(null)
    return result
  } finally {
    // Failed requests must allow a fresh server verification. An older request
    // must never release a newer login/logout transition or publish an identity.
    if (changingSession && sessionTransition === generation) sessionTransition = null
  }
}
export async function currentUser(): Promise<AuthUser | null> {
  if (sessionTransition !== null) return null
  const generation = sessionGeneration
  if (pendingSession?.generation === generation) return pendingSession.work
  const work = (async () => {
    try {
      const user = (await api<{ user: AuthUser }>('/auth/me')).user
      if (generation !== sessionGeneration) return null
      if (!user || typeof user.id !== 'string' || !['Administrator', 'Conservation Officer', 'Botanist', 'Visitor'].includes(user.role) ||
          !['Active', 'Inactive', 'Suspended'].includes(user.status) || typeof user.mustChangePassword !== 'boolean')
        throw new Error('Invalid session response.')
      publishSession(user)
      return user
    } catch (error) {
      if (generation === sessionGeneration) {
        const anonymous = typeof error === 'object' && error !== null && 'status' in error && error.status === 401
        publishSession(null, !anonymous)
      }
      return null
    } finally { if (pendingSession?.generation === generation) pendingSession = null }
  })()
  pendingSession = { generation, work }
  return work
}
export async function logout() {
  await api('/auth/logout', 'POST', {})
}
