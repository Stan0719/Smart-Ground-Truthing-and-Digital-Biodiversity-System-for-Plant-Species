import { ref } from 'vue'

export type PrototypeSessionRole = 'admin' | 'conservation-officer' | null

const isLoggedIn = ref(false)
const userRole = ref<PrototypeSessionRole>(null)
const username = ref('')

export const usePrototypeSession = () => ({ isLoggedIn, userRole, username })
