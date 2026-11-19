import { computed, shallowRef } from 'vue'
import { sessionSnapshot, subscribeSession, verifySession } from '../services/auth'

export type PrototypeSessionRole = 'admin' | 'conservation-officer' | 'botanist' | 'visitor' | null
const session = shallowRef(sessionSnapshot())
subscribeSession(() => { session.value = sessionSnapshot() })
const eligible = computed(() => {
  const user = session.value.user
  return user?.status === 'Active' && !user.mustChangePassword && user.role !== 'Botanist' ? user : null
})
const roles = { Administrator: 'admin', 'Conservation Officer': 'conservation-officer', Botanist: 'botanist', Visitor: 'visitor' } as const
// Identity is display-only while verification is uncertain; it grants no access.
const isLoggedIn = computed(() => Boolean(eligible.value))
const userRole = computed<PrototypeSessionRole>(() => eligible.value ? roles[eligible.value.role] : null)
const username = computed(() => eligible.value?.name || '')
const sessionPending = computed(() => session.value.pending)
const canUseProtectedSession = computed(() => Boolean(eligible.value) && !session.value.pending)
export const usePrototypeSession = () => ({ isLoggedIn, userRole, username, sessionPending, canUseProtectedSession })

export async function refreshSession() {
  const result = await verifySession()
  if (result.status === 'unavailable' || result.status === 'superseded') throw Error('Session verification is temporarily unavailable. Please retry.')
  return result.status === 'authenticated' ? result.user : null
}
