import type { ProximityResult } from './plantProximity.ts'
export interface ProximityTarget { id: string; revision: number; stamp: string }
export interface ProximityEntry { target: ProximityTarget; state: 'idle' | 'loading' | 'ready' | 'failed'; result: ProximityResult | null; refreshing?: boolean; refreshError?: boolean; refreshAttemptedAt?: number }
export const proximityKey = (row: Pick<ProximityTarget, 'id' | 'revision'>) => `${row.id}:${row.revision}`
const CACHE_TTL_MS = 30000
const MIN_REFRESH_INTERVAL_MS = 60000
// Page-owned, memory-only cache. No queue authorization or review state is changed.
export function createPlantProximityQueue(read: (id: string, revision: number, signal: AbortSignal) => Promise<ProximityResult>, publish: () => void, now = Date.now) {
  const entries = new Map<string, ProximityEntry>(), visible = new Set<string>(), waiting = new Set<string>()
  const running = new Map<ProximityEntry, AbortController>()
  const cache = new Map<string, { stamp: string; at: number; result: ProximityResult }>()
  let disposed = false
  function cancel(entry: ProximityEntry) { running.get(entry)?.abort() }
  function pump() {
    if (disposed) return
    for (const key of waiting) {
      if (running.size >= 2) break
      waiting.delete(key)
      const entry = entries.get(key)
      if (!entry || !visible.has(key) || running.has(entry) || (entry.state !== 'idle' && !entry.refreshing)) continue
      const controller = new AbortController()
      running.set(entry, controller); entry.refreshing = Boolean(entry.result); entry.state = entry.result ? 'ready' : 'loading'; entry.refreshAttemptedAt = now(); publish()
      const current = () => !disposed && !controller.signal.aborted && entries.get(key) === entry
      void Promise.resolve().then(() => {
        controller.signal.throwIfAborted()
        return read(entry.target.id, entry.target.revision, controller.signal)
      }).then(result => {
        if (!current()) return
        if (result.observation_id !== entry.target.id || result.revision !== entry.target.revision) throw Error('Stale proximity response')
        entry.result = result; entry.state = 'ready'; entry.refreshing = false; entry.refreshError = false
        cache.delete(key); cache.set(key, { stamp: entry.target.stamp, at: now(), result })
        while (cache.size > 100) cache.delete(cache.keys().next().value!)
      }).catch(error => { if (current()) {
        entry.refreshing = false
        if ([401, 403, 404, 409].includes(error?.status)) {
          entry.state = 'failed'; entry.result = null; entry.refreshError = false; cache.delete(key)
        } else if (entry.result) {
          // Keep the last verified result visible after a transient revalidation failure.
          entry.state = 'ready'; entry.refreshError = true
        } else entry.state = 'failed'
      } }).finally(() => {
        running.delete(entry)
        if (entries.get(key) === entry && controller.signal.aborted && (entry.state === 'loading' || entry.refreshing)) {
          entry.state = entry.result ? 'ready' : 'idle'; entry.refreshing = false
          if (visible.has(key) && (!entry.result || now() - (entry.refreshAttemptedAt ?? 0) >= MIN_REFRESH_INTERVAL_MS)) {
            if (entry.result) entry.refreshing = true
            waiting.add(key)
          }
        }
        if (!disposed) { publish(); pump() }
      })
    }
  }
  return {
    entries,
    setRows(rows: ProximityTarget[]) {
      if (disposed) return
      const wanted = new Set(rows.map(proximityKey))
      for (const [key, entry] of entries) if (!wanted.has(key)) { cancel(entry); entries.delete(key); visible.delete(key); waiting.delete(key) }
      for (const row of rows) {
        const key = proximityKey(row), old = entries.get(key), stored = cache.get(key)
        const lastAttemptAt = old?.refreshAttemptedAt ?? stored?.at ?? 0
        const expired = Boolean(old?.result && now() - lastAttemptAt >= MIN_REFRESH_INTERVAL_MS)
        if (old && old.target.stamp === row.stamp) {
          if (expired && !running.has(old) && !old.refreshing) {
            old.refreshing = true
            if (visible.has(key)) waiting.add(key)
          }
          continue
        }
        if (old) cancel(old)
        const valid = stored && stored.stamp === row.stamp && now() - stored.at < CACHE_TTL_MS
        entries.set(key, { target: { ...row }, state: valid ? 'ready' : 'idle', result: valid ? stored.result : null, refreshAttemptedAt: valid ? stored.at : undefined })
        if (visible.has(key)) waiting.add(key)
      }
      publish(); pump()
    },
    visibility(row: Pick<ProximityTarget, 'id' | 'revision'>, shown: boolean) {
      const key = proximityKey(row), entry = entries.get(key)
      if (!entry || disposed) return
      if (shown) {
        visible.add(key)
        if (entry.state === 'idle' || entry.refreshing) waiting.add(key)
        else if (entry.result && now() - (entry.refreshAttemptedAt ?? 0) >= MIN_REFRESH_INTERVAL_MS) { entry.refreshing = true; waiting.add(key) }
        pump()
      }
      else { visible.delete(key); waiting.delete(key); cancel(entry) }
    },
    retry(row: Pick<ProximityTarget, 'id' | 'revision'>) {
      const key = proximityKey(row), old = entries.get(key)
      if (!old || disposed) return
      cancel(old); cache.delete(key)
      entries.set(key, { target: old.target, state: old.result ? 'ready' : 'idle', result: old.result, refreshing: Boolean(old.result), refreshAttemptedAt: old.refreshAttemptedAt })
      visible.add(key); waiting.add(key); publish(); pump()
    },
    clear() { for (const entry of entries.values()) cancel(entry); entries.clear(); visible.clear(); waiting.clear(); cache.clear(); publish() },
    dispose() { disposed = true; for (const entry of running.values()) entry.abort(); entries.clear(); visible.clear(); waiting.clear(); cache.clear() },
  }
}
