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
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
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
  if (!response.ok) throw new Error(result.error || 'Request failed.')
  return result
}
export async function currentUser(): Promise<AuthUser | null> {
  try {
    return (await api<{ user: AuthUser }>('/auth/me')).user
  } catch {
    return null
  }
}
export async function logout() {
  await api('/auth/logout', 'POST', {})
}
