import { onBeforeUnmount, onMounted, ref } from 'vue'

const desktopSidebarOpen = ref(true)
const mobileQuery = '(max-width: 920px)'

export const useAdminSidebar = () => {
  const initialMobile =
    typeof window === 'undefined' ? true : window.matchMedia(mobileQuery).matches
  const isMobile = ref(initialMobile)
  const sidebarOpen = ref(initialMobile ? false : desktopSidebarOpen.value)
  let mediaQuery: MediaQueryList | undefined

  const syncViewport = (matches: boolean) => {
    isMobile.value = matches
    sidebarOpen.value = matches ? false : desktopSidebarOpen.value
  }

  const openSidebar = () => {
    sidebarOpen.value = true
    if (!isMobile.value) desktopSidebarOpen.value = true
  }

  const closeSidebar = () => {
    sidebarOpen.value = false
    if (!isMobile.value) desktopSidebarOpen.value = false
  }

  const handleNavigation = () => {
    if (isMobile.value) closeSidebar()
  }

  const handleViewportChange = (event: MediaQueryListEvent) => syncViewport(event.matches)

  onMounted(() => {
    mediaQuery = window.matchMedia(mobileQuery)
    syncViewport(mediaQuery.matches)
    mediaQuery.addEventListener('change', handleViewportChange)
  })

  onBeforeUnmount(() => mediaQuery?.removeEventListener('change', handleViewportChange))

  return { sidebarOpen, isMobile, openSidebar, closeSidebar, handleNavigation }
}
