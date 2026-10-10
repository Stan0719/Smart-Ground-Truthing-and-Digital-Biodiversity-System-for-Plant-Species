import { reactive } from 'vue'

const ADMIN_PROFILE_KEY = 'niahAdminProfile'
const USER_DIRECTORY_KEY = 'niahAdminUserDirectory'

export interface AdminProfile {
  accountId: string
  fullName: string
  email: string
  role: 'Administrator'
}

const defaultProfile: AdminProfile = {
  accountId: 'ADM-001',
  fullName: 'Admin01',
  email: 'admin01@example.com',
  role: 'Administrator',
}

const loadAdminProfile = (): AdminProfile => {
  try {
    const stored = JSON.parse(localStorage.getItem(ADMIN_PROFILE_KEY) ?? 'null')
    if (stored && typeof stored === 'object') return { ...defaultProfile, ...stored }
  } catch {
    // Use the prototype Administrator defaults when local data is unavailable.
  }
  return { ...defaultProfile }
}

export const adminProfile = reactive<AdminProfile>(loadAdminProfile())

export const saveAdminProfile = (changes: Pick<AdminProfile, 'fullName' | 'email'>) => {
  const previousName = adminProfile.fullName
  const previousEmail = adminProfile.email.toLowerCase()

  adminProfile.fullName = changes.fullName.trim()
  adminProfile.email = changes.email.trim().toLowerCase()
  localStorage.setItem(ADMIN_PROFILE_KEY, JSON.stringify(adminProfile))

  try {
    const directory = JSON.parse(localStorage.getItem(USER_DIRECTORY_KEY) ?? 'null')
    if (!Array.isArray(directory)) return

    const updatedDirectory = directory.map((user) => {
      const isCurrentAdmin =
        user?.id === adminProfile.accountId ||
        user?.email?.trim().toLowerCase() === previousEmail ||
        (user?.role === 'Administrator' && user?.name === previousName)

      return isCurrentAdmin
        ? {
            ...user,
            name: adminProfile.fullName,
            email: adminProfile.email,
            initials: adminProfile.fullName
              .split(/\s+/)
              .slice(0, 2)
              .map((word: string) => word[0]?.toUpperCase())
              .join(''),
          }
        : user
    })
    localStorage.setItem(USER_DIRECTORY_KEY, JSON.stringify(updatedDirectory))
  } catch {
    // The profile remains saved even if legacy directory data cannot be updated.
  }
}

export const isCurrentAdminAccount = (user: { id: string; name: string; email: string }) =>
  user.id === adminProfile.accountId ||
  user.email.trim().toLowerCase() === adminProfile.email.toLowerCase() ||
  user.name === adminProfile.fullName
