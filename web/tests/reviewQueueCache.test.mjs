import test from 'node:test'
import assert from 'node:assert/strict'
import { createReviewQueueCache, REVIEW_QUEUE_TTL } from '../src/services/reviewQueueCache.ts'

const officer = id => ({ id, role: 'Conservation Officer', status: 'Active', mustChangePassword: false, lastLogin: 'session-1' })
function fixture() {
  let session = { user: officer('one'), pending: false }, listener, clock = 0
  const cache = createReviewQueueCache(() => session, fn => { listener = fn }, () => clock)
  return { cache, change(next) { session = next; listener() }, advance(ms) { clock += ms } }
}
test('one bounded memory snapshot, shared in-flight load, copies and 45-second expiry', async () => {
  const f = fixture(); let calls = 0, release
  const load = () => { calls++; return new Promise(resolve => { release = resolve }) }
  const a = f.cache.load(load), b = f.cache.load(load)
  await Promise.resolve(); assert.equal(calls, 1); assert.equal(f.cache.read(), null)
  release({ rows: ['verified'] }); const [first, second] = await Promise.all([a, b])
  first.rows.push('local draft'); assert.deepEqual(second, { rows: ['verified'] })
  assert.deepEqual(f.cache.read(), second)
  f.advance(REVIEW_QUEUE_TTL); assert.equal(f.cache.read(), null)
})
for (const boundary of ['logout', 'switch', 'role', 'status', 'password', 'temporary', 'new session', 'decision']) {
  test(`cached and in-flight private data are invalidated on ${boundary}`, async () => {
    const f = fixture(); await f.cache.load(async () => ({ rows: ['private'] }))
    let release; const old = f.cache.load(() => new Promise(resolve => { release = resolve }))
    await Promise.resolve()
    if (boundary === 'decision') f.cache.invalidate()
    else {
      const user = officer(boundary === 'switch' ? 'two' : 'one')
      if (boundary === 'role') user.role = 'Botanist'
      if (boundary === 'status') user.status = 'Inactive'
      if (boundary === 'password') user.mustChangePassword = true
      if (boundary === 'new session') user.lastLogin = 'session-2'
      f.change({ user: boundary === 'logout' ? null : user, pending: boundary === 'temporary' })
    }
    assert.equal(f.cache.read(), null)
    release({ rows: ['obsolete'] }); await assert.rejects(old, /superseded/)
    assert.equal(f.cache.read(), null)
  })
}
test('old completion cannot replace a newer post-invalidation refresh', async () => {
  const f = fixture(); let release
  const old = f.cache.load(() => new Promise(resolve => { release = resolve })); await Promise.resolve()
  f.cache.invalidate(); await f.cache.load(async () => ({ rows: ['new'] }))
  release({ rows: ['old'] }); await assert.rejects(old, /superseded/)
  assert.deepEqual(f.cache.read(), { rows: ['new'] })
})
test('failed source is never cached as an empty queue', async () => {
  const f = fixture(); await assert.rejects(f.cache.load(async () => { throw Error('unavailable') }))
  assert.equal(f.cache.read(), null)
  assert.deepEqual(await f.cache.load(async () => ({ rows: [] })), { rows: [] })
})


test('authoritative detail eviction keeps shared work alive but forbids caching its older list', async () => {
  const f = fixture(); let release
  const work = f.cache.load(() => new Promise(resolve => { release = resolve })); await Promise.resolve()
  f.cache.evict(); release({ rows: ['old list for consumer merge'] })
  assert.deepEqual(await work, { rows: ['old list for consumer merge'] }); assert.equal(f.cache.read(), null)
})

test('shared page currency survives consumer unmount but stops on logout', async () => {
  const f = fixture(); let currency
  await f.cache.load(async current => { currency = current; assert.equal(current(), true); return { rows: [] } })
  assert.equal(currency(), true)
  f.change({user:null,pending:false}); assert.equal(currency(), false)
})


test('failed shared attempt aborts unfinished siblings and cannot paginate or publish after a fresh retry', async () => {
  const f = fixture(), failure = Error('source unavailable'); let release, oldSignal, oldCurrent, continued = 0
  const first = f.cache.load(async (current, signal) => {
    oldSignal = signal; oldCurrent = current
    return Promise.all([
      (async () => { await new Promise(resolve => { release = resolve }); if (current()) continued++; return 'old' })(),
      Promise.reject(failure),
    ])
  })
  await assert.rejects(first, error => error === failure)
  assert.equal(oldSignal.aborted, true); assert.equal(oldCurrent(), false)
  let reads = 0
  const a = f.cache.load(async () => { reads++; return { rows: ['fresh'] } }), b = f.cache.load(() => { throw Error('duplicate attempt') })
  await Promise.all([a,b]); release(); await Promise.resolve(); await Promise.resolve()
  assert.equal(reads, 1); assert.equal(continued, 0); assert.deepEqual(f.cache.read(), { rows: ['fresh'] })
})

test('session invalidation aborts pending transport while detail eviction preserves it', async () => {
  const f = fixture(); let signal, release
  const work = f.cache.load((_current, value) => { signal = value; return new Promise(resolve => { release = resolve }) })
  await Promise.resolve(); f.cache.evict(); assert.equal(signal.aborted, false)
  f.change({ user: officer('one'), pending: true }); assert.equal(signal.aborted, true)
  release({ rows: ['obsolete'] }); await assert.rejects(work, /superseded/)
})
