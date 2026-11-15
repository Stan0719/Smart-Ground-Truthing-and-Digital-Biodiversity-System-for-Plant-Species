export const OFFICER_NOTIFICATION_REFRESH_MS = 15_000
const FOCUS_THROTTLE_MS = 1_000

type RefreshBrowser = Pick<Window, 'addEventListener' | 'removeEventListener' | 'setTimeout' | 'clearTimeout' | 'navigator'>
type RefreshDocument = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>

export function createOfficerNotificationRefresh(options: {
  refresh: () => Promise<void>
  ready: () => boolean
  window: RefreshBrowser
  document: RefreshDocument
  now?: () => number
}) {
  let active = false
  let running = false
  let timer: number | null = null
  let generation = 0
  let lastAttempt = -Infinity
  const now = options.now || Date.now
  const available = () => active && options.ready() && options.document.visibilityState === 'visible' && options.window.navigator.onLine !== false

  function clearTimer() {
    if (timer !== null) options.window.clearTimeout(timer)
    timer = null
  }
  function schedule(delay: number) {
    clearTimer()
    if (available()) timer = options.window.setTimeout(() => { timer = null; void refresh() }, delay)
  }
  async function refresh() {
    if (!available() || running) return
    const remaining = FOCUS_THROTTLE_MS - (now() - lastAttempt)
    if (remaining > 0) { schedule(remaining); return }
    running = true
    lastAttempt = now()
    const requestGeneration = generation
    try { await options.refresh() }
    catch { /* The inbox owns error presentation. Retry on the next foreground interval. */ }
    finally {
      running = false
      schedule(requestGeneration === generation ? OFFICER_NOTIFICATION_REFRESH_MS : 0)
    }
  }
  function activity() {
    clearTimer()
    if (available()) void refresh()
  }
  function start() {
    if (active) return
    active = true
    generation++
    lastAttempt = -Infinity
    options.document.addEventListener('visibilitychange', activity)
    options.window.addEventListener('focus', activity)
    options.window.addEventListener('online', activity)
    options.window.addEventListener('offline', activity)
    void refresh()
  }
  function stop() {
    active = false
    generation++
    clearTimer()
    options.document.removeEventListener('visibilitychange', activity)
    options.window.removeEventListener('focus', activity)
    options.window.removeEventListener('online', activity)
    options.window.removeEventListener('offline', activity)
  }
  return { start, stop }
}
