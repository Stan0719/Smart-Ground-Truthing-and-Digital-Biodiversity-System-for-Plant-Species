import { sessionSnapshot, subscribeSession } from './auth.ts'

type Session = ReturnType<typeof sessionSnapshot>
export const REVIEW_QUEUE_TTL = 45_000
// One session, one complete queue, one shared request. Never persisted.
export function createReviewQueueCache(readSession: () => Session, listen: (fn: () => void) => unknown, now = Date.now) {
  const identity = () => {
    const s = readSession(), u = s.user
    return !s.pending && !s.unavailable && u?.role === 'Conservation Officer' && u.status === 'Active' && !u.mustChangePassword
      ? JSON.stringify([u.id, u.role, u.status, u.mustChangePassword, u.lastLogin]) : ''
  }
  let owner = identity(), epoch = 0, evidence = 0
  let entry: { data: unknown; at: number } | null = null
  let flight: Promise<unknown> | null = null
  function invalidate() { epoch++; evidence++; entry = null; flight = null }
  listen(() => { const next = identity(); if (!next || next !== owner) invalidate(); owner = next })
  function synchronize() { const next = identity(); if (next !== owner) { invalidate(); owner = next } return next }
  return {
    invalidate,
    // A newer authoritative detail can be merged by the active consumer without
    // cancelling shared queue work. That older list must never enter the cache.
    evict() { evidence++; entry = null },
    read<T>(): T | null {
      if (!synchronize()) return null
      if (entry && now() - entry.at < REVIEW_QUEUE_TTL) return structuredClone(entry.data) as T
      entry = null; return null
    },
    load<T>(load: (current: () => boolean) => Promise<T>): Promise<T> {
      const actor = synchronize(), token = epoch, revision = evidence
      if (!actor) return Promise.reject(Error('Unverified Officer session'))
      if (!flight) {
        const current = () => synchronize() === actor && token === epoch
        const work = Promise.resolve().then(() => load(current)).then(data => {
          if (synchronize() !== actor || token !== epoch) throw Error('Queue request superseded')
          if (revision === evidence) entry = { data: structuredClone(data), at: now() }
          return data
        }).finally(() => { if (flight === work) flight = null })
        flight = work
      }
      return flight.then(data => structuredClone(data) as T)
    },
  }
}
export const reviewQueueCache = createReviewQueueCache(sessionSnapshot, subscribeSession)
