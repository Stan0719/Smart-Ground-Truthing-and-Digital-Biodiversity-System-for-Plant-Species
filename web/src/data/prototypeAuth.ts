export const PROTOTYPE_USERS_KEY = 'niahPrototypeUsers'
export const PENDING_PASSWORD_CHANGE_KEY = 'niahPrototypePendingPasswordChange'
export const VISITOR_ACCOUNTS_KEY = '@niah_biodiversity/visitor_accounts'

export type PrototypeRole = 'Conservation Officer' | 'Botanist'

export interface PrototypeUser {
  id: string
  name: string
  email: string
  role: PrototypeRole
  status: 'Active' | 'Inactive' | 'Suspended'
  lastLogin: 'Never'
  initials: string
  password: string
  mustChangePassword: boolean
}

export interface PrototypeVisitor {
  id: string
  name: string
  email: string
  role: 'Visitor'
  status: 'Active' | 'Inactive' | 'Suspended'
  lastLogin?: string
  initials?: string
  password?: string
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

export function getPrototypeVisitors(): PrototypeVisitor[] {
  try {
    const stored = JSON.parse(localStorage.getItem(VISITOR_ACCOUNTS_KEY) ?? '[]')
    return Array.isArray(stored)
      ? stored.filter((visitor): visitor is PrototypeVisitor => visitor?.role === 'Visitor')
      : []
  } catch {
    return []
  }
}

function savePrototypeVisitors(visitors: PrototypeVisitor[]) {
  localStorage.setItem(VISITOR_ACCOUNTS_KEY, JSON.stringify(visitors))
}

export function updatePrototypeVisitor(
  id: string,
  changes: Pick<PrototypeVisitor, 'name' | 'email' | 'status' | 'initials'>,
): boolean {
  const visitors = getPrototypeVisitors()
  const index = visitors.findIndex((visitor) => visitor.id === id)
  const visitor = visitors[index]
  if (!visitor) return false
  visitors[index] = { ...visitor, ...changes, email: normaliseEmail(changes.email) }
  savePrototypeVisitors(visitors)
  return true
}

export function deletePrototypeVisitor(id: string): boolean {
  const visitors = getPrototypeVisitors()
  const remainingVisitors = visitors.filter((visitor) => visitor.id !== id)
  if (remainingVisitors.length === visitors.length) return false
  savePrototypeVisitors(remainingVisitors)
  return true
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
  const initials = words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('')
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

export function updatePrototypeUser(
  id: string,
  changes: Pick<PrototypeUser, 'name' | 'email' | 'role' | 'status' | 'initials'>,
): boolean {
  const users = getPrototypeUsers()
  const index = users.findIndex((user) => user.id === id)
  const user = users[index]
  if (!user) return false
  users[index] = { ...user, ...changes, email: normaliseEmail(changes.email) }
  savePrototypeUsers(users)
  return true
}

export function deletePrototypeUser(id: string): boolean {
  const users = getPrototypeUsers()
  const remainingUsers = users.filter((user) => user.id !== id)
  if (remainingUsers.length === users.length) return false
  savePrototypeUsers(remainingUsers)
  return true
}
