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
let session: { user: AuthUser | null; pending: boolean; unavailable?: boolean } = { user: null, pending: true, unavailable: false }
let sessionGeneration = 0
let sessionTransition: number | null = null
let pendingSession: { generation: number; work: Promise<SessionVerification> } | null = null
const identity = (user: AuthUser | null) => user ? `${user.id}:${user.role}:${user.status}:${user.mustChangePassword}` : ''
function publishSession(user: AuthUser | null, pending = false, unavailable = false) {
  if (identity(session.user) === identity(user) && session.pending === pending && session.unavailable === unavailable) return
  session = { user, pending, unavailable }
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
  if (session.unavailable && !changingSession && path !== '/auth/me') throw new Error('Session verification is temporarily unavailable. Please retry.')
  const generation = changingSession ? ++sessionGeneration : sessionGeneration
  if (changingSession) { sessionTransition = generation; publishSession(null, true) }
  try {
    let response: Response
    try {
      response = await fetch(`/api${path}`, {
        method,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        ...(body === undefined || method === 'GET' || method === 'HEAD' ? {} : { body: JSON.stringify(body) }),
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
export type SessionVerification =
  | { status: 'authenticated'; user: AuthUser; generation: number; verification: number }
  | { status: 'unauthenticated' | 'unavailable' | 'superseded'; generation: number; verification: number }
let verificationSequence = 0
export function sessionVerificationCurrent(result: SessionVerification) {
  return result.status !== 'superseded' && result.generation === sessionGeneration &&
    result.verification === verificationSequence && sessionTransition === null
}
export async function verifySession(): Promise<SessionVerification> {
  const generation = sessionGeneration
  if (sessionTransition !== null) return { status: 'superseded', generation, verification: verificationSequence }
  if (pendingSession?.generation === generation) return pendingSession.work
  const verification = ++verificationSequence
  const current = () => generation === sessionGeneration && verification === verificationSequence && sessionTransition === null
  const work = (async (): Promise<SessionVerification> => {
    try {
      const user = (await api<{ user: AuthUser }>('/auth/me')).user
      if (!current()) return { status: 'superseded', generation, verification }
      if (!user || typeof user.id !== 'string' || !['Administrator', 'Conservation Officer', 'Botanist', 'Visitor'].includes(user.role) ||
          !['Active', 'Inactive', 'Suspended'].includes(user.status) || typeof user.mustChangePassword !== 'boolean')
        throw new Error('Invalid session response.')
      publishSession(user)
      return { status: 'authenticated', user, generation, verification }
    } catch (error) {
      if (!current()) return { status: 'superseded', generation, verification }
      // Only /me's explicit 401 establishes an invalid session. Other failures
      // retain identity for draft continuity, but pending blocks authorization.
      const anonymous = typeof error === 'object' && error !== null && 'status' in error && error.status === 401
      publishSession(anonymous ? null : session.user, !anonymous, !anonymous)
      return { status: anonymous ? 'unauthenticated' : 'unavailable', generation, verification }
    } finally { if (pendingSession?.generation === generation) pendingSession = null }
  })()
  pendingSession = { generation, work }
  return work
}
// Compatibility for identity-only consumers. Navigation must use verifySession.
export async function currentUser(): Promise<AuthUser | null> {
  const result = await verifySession()
  return result.status === 'authenticated' ? result.user : null
}
export async function logout() {
  await api('/auth/logout', 'POST', {})
}
