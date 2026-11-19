import { onBeforeUnmount, onMounted } from 'vue'
import { sessionSnapshot, subscribeSession, verifySession, type AuthUser } from '../services/auth'

// A response belongs to both the selected route and the verified account.
export function useCatalogueRefresh(load: (current: () => boolean, user: AuthUser | null) => Promise<void>, clear: () => void, failed: () => void) {
  let generation = 0, disposed = false
  let work: Promise<void> | null = null
  let timer: ReturnType<typeof setInterval> | undefined
  const identity = () => {
    const { user, pending } = sessionSnapshot()
    return pending ? 'pending' : user ? `${user.id}:${user.role}:${user.status}:${user.mustChangePassword}` : 'guest'
  }
  let account = identity()
  function invalidate() { generation++; work = null; clear() }
  function refresh() {
    if (disposed) return Promise.resolve()
    if (work) return work
    const token = ++generation
    const current = () => !disposed && token === generation
    const next = (async () => {
      try {
        const session = await verifySession()
        if (!current()) return
        if (session.status === 'unavailable' || session.status === 'superseded' ||
          (session.status === 'authenticated' && (session.user.status !== 'Active' || session.user.mustChangePassword))) {
          clear(); failed(); return
        }
        await load(current, session.status === 'authenticated' ? session.user : null)
      } catch { if (current()) { clear(); failed() } }
    })()
    work = next
    void next.finally(() => { if (work === next) work = null })
    return next
  }
  const unsubscribe = subscribeSession((_user, pending) => {
    const next = identity()
    if (pending || next !== account) {
      account = next; invalidate()
      if (pending) failed()
      else queueMicrotask(() => { void refresh() })
    }
  })
  const visible = () => { if (document.visibilityState === 'visible') void refresh() }
  const focus = () => { void refresh() }
  onMounted(() => {
    window.addEventListener('focus', focus)
    document.addEventListener('visibilitychange', visible)
    timer = setInterval(focus, 60000)
    void refresh()
  })
  onBeforeUnmount(() => {
    disposed = true; invalidate(); unsubscribe()
    window.removeEventListener('focus', focus)
    document.removeEventListener('visibilitychange', visible)
    if (timer) clearInterval(timer)
  })
  return { refresh, reset: () => { invalidate(); return refresh() } }
}
