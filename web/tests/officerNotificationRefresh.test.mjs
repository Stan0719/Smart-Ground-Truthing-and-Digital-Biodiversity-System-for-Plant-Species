import test from 'node:test'
import assert from 'node:assert/strict'
import { createOfficerNotificationRefresh, OFFICER_NOTIFICATION_REFRESH_MS } from '../src/services/officerNotificationRefresh.ts'
import { createOfficerInbox } from '../src/services/officerNotifications.ts'

const flush = () => new Promise(resolve => setImmediate(resolve))
const officer = { id: 'one', role: 'Conservation Officer', status: 'Active', mustChangePassword: false }
const notification = number => ({ id: `00000000-0000-0000-0000-${String(number).padStart(12,'0')}`, event_type: 'registration_submitted', created_at: '2026-11-15T00:00:00Z', read_at: null, resource: { kind: 'observation', id: String(number) } })
function page(items, unread = items.length, cursor = null) {
  return Response.json({ notifications: items, unread_count: unread, page: { has_more: Boolean(cursor), next_cursor: cursor }, read_through: 'verified-boundary' })
}
function browser() {
  let now = 0, sequence = 0
  const timers = new Map(), listeners = new Map()
  const events = scope => ({
    addEventListener(name, listener) {
      const key = scope + ':' + name
      if (!listeners.has(key)) listeners.set(key,new Set())
      listeners.get(key).add(listener)
    },
    removeEventListener(name, listener) { listeners.get(scope + ':' + name)?.delete(listener) },
  })
  const document = { visibilityState: 'visible', ...events('document') }
  const window = {
    ...events('window'), navigator: { onLine: true },
    setTimeout(callback, delay) { const id = ++sequence; timers.set(id,{ callback, at: now + delay }); return id },
    clearTimeout(id) { timers.delete(id) },
  }
  async function advance(milliseconds) {
    const target = now + milliseconds
    for (let iterations = 0; iterations < 100; iterations++) {
      const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a,b) => a[1].at - b[1].at)[0]
      if (!next) { now = target; await flush(); return }
      now = next[1].at; timers.delete(next[0]); next[1].callback(); await flush()
    }
    throw Error('Unexpected timer loop')
  }
  return { document, window, timers, now: () => now, advance,
    emit(scope,name) { for (const listener of listeners.get(scope + ':' + name) || []) listener() },
    listenerCount() { return [...listeners.values()].reduce((sum,set) => sum + set.size,0) },
  }
}
function setup(transport) {
  const environment = browser()
  const calls = []
  const inbox = createOfficerInbox({ transport: async (url, options) => { calls.push({url,options}); return transport(url,options) }, navigate: async () => true })
  inbox.setSession(officer,false)
  const loop = createOfficerNotificationRefresh({ ...environment, refresh: () => inbox.refresh(), ready: () => inbox.state.ready })
  return { ...environment, inbox, loop, calls, stop() { loop.stop(); inbox.dispose() } }
}

test('initial and 15-second refresh update authoritative badge and list without UI interaction or duplicate timers',async()=>{
  let items = [notification(1)], unread = 7
  const h = setup(() => page(items,unread))
  try {
    h.loop.start(); h.loop.start(); await flush()
    assert.equal(h.calls.length,1); assert.equal(h.inbox.state.unread,7)
    assert.equal(h.timers.size,1); assert.equal(h.listenerCount(),4)
    items = [notification(2),notification(1),notification(1)]; unread = 9
    await h.advance(OFFICER_NOTIFICATION_REFRESH_MS)
    assert.equal(h.inbox.state.unread,9)
    assert.deepEqual(h.inbox.state.items.map(item => item.id),[notification(2).id,notification(1).id])
    assert.equal(h.calls.length,2); assert.equal(h.inbox.state.loading,false)
    await h.advance(OFFICER_NOTIFICATION_REFRESH_MS)
    assert.equal(h.inbox.state.unread,9,'fetches never increment the count locally')
  } finally { h.stop() }
})

test('hidden/offline tabs pause and visibility, focus and reconnect resume with event throttling',async()=>{
  const h = setup(() => page([notification(1)]))
  try {
    h.loop.start(); await flush()
    h.document.visibilityState = 'hidden'; h.emit('document','visibilitychange')
    await h.advance(60_000); assert.equal(h.calls.length,1); assert.equal(h.timers.size,0)
    h.document.visibilityState = 'visible'; h.emit('document','visibilitychange'); h.emit('window','focus'); await flush()
    assert.equal(h.calls.length,2)
    h.emit('window','focus'); await h.advance(999); assert.equal(h.calls.length,2)
    await h.advance(1); assert.equal(h.calls.length,3)
    h.window.navigator.onLine = false; h.emit('window','offline'); await h.advance(60_000)
    assert.equal(h.calls.length,3)
    h.window.navigator.onLine = true; h.emit('window','online'); await flush(); assert.equal(h.calls.length,4)
  } finally { h.stop() }
  assert.equal(h.timers.size,0); assert.equal(h.listenerCount(),0)
})

test('slow refresh requests are deduplicated and temporary failures preserve the last confirmed state',async()=>{
  let release, mode = 'ok'
  const h = setup(() => mode === 'slow' ? new Promise(resolve => { release = resolve }) : mode === 'offline' ? Promise.reject(Error('offline')) : page([notification(1)],5))
  try {
    h.loop.start(); await flush(); mode = 'slow'
    await h.advance(15_000)
    const pending = h.inbox.refresh(); assert.equal(h.inbox.refresh(),pending)
    await h.inbox.load(); await h.inbox.refreshCount()
    h.emit('window','focus'); await h.advance(60_000); assert.equal(h.calls.length,2)
    release(page([notification(2),notification(1)],6)); await pending; await flush()
    assert.equal(h.inbox.state.unread,6)
    mode = 'offline'; await h.advance(15_000)
    assert.equal(h.inbox.state.unread,6); assert.equal(h.inbox.state.items.length,2); assert.equal(h.inbox.state.error,'loadFailed')
    mode = 'ok'; await h.advance(15_000)
    assert.equal(h.inbox.state.unread,5); assert.equal(h.inbox.state.error,'')
  } finally { h.stop() }
})

test('loaded older pages are revalidated under a fresh cursor with no duplicate or skipped continuation',async()=>{
  let refreshed = false
  const h = setup(url => {
    if (!refreshed) return url.includes('cursor=') ? page([notification(1)],2) : page([notification(2)],2,'old-cursor')
    return url.includes('cursor=') ? page([notification(2),notification(1)],3,'new-tail') : page([notification(3),notification(2)],3,'fresh-cursor')
  })
  try {
    await h.inbox.load(); await h.inbox.load(true); refreshed = true
    await h.inbox.refresh()
    assert.deepEqual(h.inbox.state.items.map(item => item.id),[notification(3).id,notification(2).id,notification(1).id])
    assert.ok(h.calls.at(-1).url.includes('cursor=fresh-cursor'))
    assert.equal(h.inbox.state.cursor,'new-tail'); assert.equal(h.inbox.state.unread,3)
  } finally { h.stop() }
})

test('session changes discard late responses and stop clears timers and listeners',async()=>{
  let release
  const h = setup(() => new Promise(resolve => { release = resolve }))
  h.loop.start(); h.loop.stop(); h.inbox.setSession({...officer,id:'two'},false); h.loop.start()
  assert.equal(h.inbox.state.items.length,0); assert.equal(h.inbox.state.unread,null)
  release(page([notification(1)],99)); await flush(); await h.advance(0)
  assert.equal(h.inbox.state.unread,null)
  release(page([notification(2)],1)); await flush()
  assert.equal(h.inbox.state.unread,1); assert.equal(h.inbox.state.items[0].id,notification(2).id)
  h.inbox.setSession(null,false); h.loop.stop()
  await h.advance(60_000); assert.equal(h.inbox.state.unread,null); assert.equal(h.timers.size,0); assert.equal(h.listenerCount(),0)
  h.stop()
})
