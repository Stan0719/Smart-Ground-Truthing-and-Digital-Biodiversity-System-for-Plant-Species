export const PROTOTYPE_USERS_KEY = 'niahPrototypeUsers'
export const PENDING_PASSWORD_CHANGE_KEY = 'niahPrototypePendingPasswordChange'

export type PrototypeRole = 'Conservation Officer' | 'Botanist'

export interface PrototypeUser {
  id: string
  name: string
  email: string
  role: PrototypeRole
  status: 'Active'
  lastLogin: 'Never'
  initials: string
  password: string
  mustChangePassword: boolean
}

const normaliseEmail = (email: string) => email.trim().toLowerCase()

export function getPrototypeUsers(): PrototypeUser[] {
  try {
    const stored = JSON.parse(localStorage.getItem(PROTOTYPE_USERS_KEY) ?? '[]')
    return Array.isArray(stored) ? stored : []
  } catch {
    return []
  }
}

function savePrototypeUsers(users: PrototypeUser[]) {
  // PROTOTYPE ONLY: replace localStorage/plain password with backend authentication and password hashing.
  localStorage.setItem(PROTOTYPE_USERS_KEY, JSON.stringify(users))
}

export function generateTemporaryPassword(): string {
  const uppercase = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lowercase = 'abcdefghijkmnopqrstuvwxyz'
  const numbers = '23456789'
  const pick = (characters: string) => characters[Math.floor(Math.random() * characters.length)]
  const characters = [pick(uppercase), pick(lowercase), '@', pick(numbers)]

  while (characters.length < 10) characters.push(pick(uppercase + lowercase + numbers))
  return characters.sort(() => Math.random() - 0.5).join('')
}

export function findPrototypeUserByEmail(email: string): PrototypeUser | undefined {
  const target = normaliseEmail(email)
  return getPrototypeUsers().find((user) => normaliseEmail(user.email) === target)
}

export function createPrototypeUser(input: {
  name: string
  email: string
  role: PrototypeRole
  existingIds: string[]
}): PrototypeUser {
  const allIds = [...input.existingIds, ...getPrototypeUsers().map((user) => user.id)]
  const highestId = allIds.reduce((highest, id) => {
    const match = /^USR(\d+)$/.exec(id)
    return match ? Math.max(highest, Number(match[1])) : highest
  }, 0)
  const words = input.name.trim().split(/\s+/)
  const initials = words.slice(0, 2).map((word) => word[0]?.toUpperCase()).join('')
  const user: PrototypeUser = {
    id: `USR${String(highestId + 1).padStart(3, '0')}`,
    name: input.name.trim(),
    email: normaliseEmail(input.email),
    role: input.role,
    status: 'Active',
    lastLogin: 'Never',
    initials,
    password: generateTemporaryPassword(),
    mustChangePassword: true,
  }

  savePrototypeUsers([...getPrototypeUsers(), user])
  return user
}

export function authenticatePrototypeUser(email: string, password: string): PrototypeUser | null {
  const user = findPrototypeUserByEmail(email)
  return user?.status === 'Active' && user.password === password ? user : null
}

export function updatePrototypePassword(email: string, password: string): boolean {
  const users = getPrototypeUsers()
  const index = users.findIndex((user) => normaliseEmail(user.email) === normaliseEmail(email))
  const user = users[index]
  if (!user) return false
  users[index] = { ...user, password, mustChangePassword: false }
  savePrototypeUsers(users)
  return true
}
