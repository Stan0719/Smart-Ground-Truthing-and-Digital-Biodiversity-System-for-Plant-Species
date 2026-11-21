import type { ProximityResult } from './plantProximity.ts'
export interface ProximityTarget { id: string; revision: number; stamp: string }
export interface ProximityEntry { target: ProximityTarget; state: 'idle' | 'loading' | 'ready' | 'failed'; result: ProximityResult | null }
export const proximityKey = (row: Pick<ProximityTarget, 'id' | 'revision'>) => `${row.id}:${row.revision}`
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
      if (!entry || !visible.has(key) || running.has(entry) || entry.state !== 'idle') continue
      const controller = new AbortController()
      running.set(entry, controller); entry.state = 'loading'; publish()
      const current = () => !disposed && !controller.signal.aborted && entries.get(key) === entry
      void Promise.resolve().then(() => {
        controller.signal.throwIfAborted()
        return read(entry.target.id, entry.target.revision, controller.signal)
      }).then(result => {
        if (!current()) return
        if (result.observation_id !== entry.target.id || result.revision !== entry.target.revision) throw Error('Stale proximity response')
        entry.result = result; entry.state = 'ready'
        cache.delete(key); cache.set(key, { stamp: entry.target.stamp, at: now(), result })
        while (cache.size > 100) cache.delete(cache.keys().next().value!)
      }).catch(() => { if (current()) entry.state = 'failed' }).finally(() => {
        running.delete(entry)
        if (entries.get(key) === entry && controller.signal.aborted && entry.state === 'loading') { entry.state = 'idle'; if (visible.has(key)) waiting.add(key) }
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
        const expired = old?.state === 'ready' && (!stored || now() - stored.at >= 30000)
        if (old && old.target.stamp === row.stamp && !expired) continue
        if (old) cancel(old)
        const valid = stored && stored.stamp === row.stamp && now() - stored.at < 30000
        entries.set(key, { target: { ...row }, state: valid ? 'ready' : 'idle', result: valid ? stored.result : null })
        if (visible.has(key)) waiting.add(key)
      }
      publish(); pump()
    },
    visibility(row: Pick<ProximityTarget, 'id' | 'revision'>, shown: boolean) {
      const key = proximityKey(row), entry = entries.get(key)
      if (!entry || disposed) return
      if (shown) { visible.add(key); if (entry.state === 'idle') waiting.add(key); pump() }
      else { visible.delete(key); waiting.delete(key); cancel(entry) }
    },
    retry(row: Pick<ProximityTarget, 'id' | 'revision'>) {
      const key = proximityKey(row), old = entries.get(key)
      if (!old || disposed) return
      cancel(old); cache.delete(key)
      entries.set(key, { target: old.target, state: 'idle', result: null })
      visible.add(key); waiting.add(key); publish(); pump()
    },
    clear() { for (const entry of entries.values()) cancel(entry); entries.clear(); visible.clear(); waiting.clear(); cache.clear(); publish() },
    dispose() { disposed = true; for (const entry of running.values()) entry.abort(); entries.clear(); visible.clear(); waiting.clear(); cache.clear() },
  }
}
