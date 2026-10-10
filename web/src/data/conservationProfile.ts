import { reactive } from 'vue'

export interface ConservationProfile {
  accountId: string
  fullName: string
  email: string
  role: 'Conservation Officer'
}

export const conservationProfile = reactive<ConservationProfile>({
  accountId: 'CO-001',
  fullName: 'Officer01',
  email: 'officer01@example.com',
  role: 'Conservation Officer',
})
