import { ref } from 'vue'
import { currentUser } from '../services/auth'

export type PrototypeSessionRole = 'admin' | 'conservation-officer' | 'botanist' | 'visitor' | null

const isLoggedIn = ref(false)
const userRole = ref<PrototypeSessionRole>(null)
const username = ref('')

export const usePrototypeSession = () => ({ isLoggedIn, userRole, username })

// Keep the existing browser-facing refs, but derive them from server authority.
export async function refreshSession() {
  const user = await currentUser()
  const eligible = user?.status === 'Active' && !user.mustChangePassword && user.role !== 'Botanist'
  isLoggedIn.value = Boolean(eligible)
  const roles = {
    Administrator: 'admin',
    'Conservation Officer': 'conservation-officer',
    Botanist: 'botanist',
    Visitor: 'visitor',
  } as const
  userRole.value = user && eligible ? roles[user.role] : null
  username.value = user && eligible ? user.name : ''
  return user
}
