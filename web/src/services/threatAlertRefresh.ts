export const THREAT_ALERT_REFRESH_MS = 30_000
export function createThreatAlertRefresh(options: {
  refresh: () => Promise<void>; ready: () => boolean
  window: Pick<Window, 'addEventListener' | 'removeEventListener' | 'setTimeout' | 'clearTimeout' | 'navigator'>
  document: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>
}) {
  let active = false, running = false, timer: number | null = null
  let generation = 0
  const available = () => active && options.ready() && options.document.visibilityState === 'visible' && options.window.navigator.onLine !== false
  function clear() { if (timer !== null) options.window.clearTimeout(timer); timer = null }
  async function refresh() {
    if (running) return
    if (!available()) {
      // A busy review may defer a tick; it must not permanently stop polling.
      clear()
      if (active && options.document.visibilityState === 'visible' && options.window.navigator.onLine !== false)
        timer = options.window.setTimeout(() => { timer = null; void refresh() }, THREAT_ALERT_REFRESH_MS)
      return
    }
    running = true; clear()
    const requestGeneration = generation
    try { await options.refresh() }
    catch { /* The page presents refresh errors; the next foreground tick can retry. */ }
    finally {
      running = false
      if (available()) timer = options.window.setTimeout(() => { timer = null; void refresh() }, requestGeneration === generation ? THREAT_ALERT_REFRESH_MS : 0)
    }
  }
  const activity = () => { clear(); if (active) void refresh() }
  function start() {
    if (active) return
    active = true; generation++
    options.window.addEventListener('focus', activity); options.window.addEventListener('online', activity); options.window.addEventListener('offline', activity)
    options.document.addEventListener('visibilitychange', activity)
    void refresh()
  }
  function stop() {
    active = false; generation++; clear()
    options.window.removeEventListener('focus', activity); options.window.removeEventListener('online', activity); options.window.removeEventListener('offline', activity)
    options.document.removeEventListener('visibilitychange', activity)
  }
  return { start, stop, refresh }
}
