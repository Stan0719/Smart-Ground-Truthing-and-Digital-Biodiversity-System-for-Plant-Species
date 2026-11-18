import assert from 'node:assert/strict'
import test from 'node:test'
import { createThreatAlertRefresh, THREAT_ALERT_REFRESH_MS } from '../src/services/threatAlertRefresh.ts'
import { OFFICER_NOTIFICATION_REFRESH_MS } from '../src/services/officerNotificationRefresh.ts'
const flush = () => new Promise(setImmediate)
function browser() {
  const listeners = new Map(), timers = new Map(); let sequence = 0
  const events = { addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key) }
  return { listeners, timers, window: { ...events, navigator: { onLine: true }, setTimeout: (fn, delay) => { timers.set(++sequence, { fn, delay }); return sequence }, clearTimeout: id => timers.delete(id) }, document: { ...events, visibilityState: 'visible' }, tick() { const [id, entry] = timers.entries().next().value; timers.delete(id); entry.fn() } }
}
test('30-second foreground alert polling is independent of the unchanged 15-second bell cadence', async () => {
  assert.equal(THREAT_ALERT_REFRESH_MS, 30000); assert.equal(OFFICER_NOTIFICATION_REFRESH_MS, 15000)
  const b = browser(); let count = 0
  const loop = createThreatAlertRefresh({ ...b, ready: () => true, refresh: async () => { count++ } })
  loop.start(); await flush(); assert.equal(count, 1)
  assert.equal([...b.timers.values()][0].delay, 30000)
  b.tick(); await flush(); assert.equal(count, 2)
  b.document.visibilityState = 'hidden'; b.listeners.get('visibilitychange')(); assert.equal(b.timers.size, 0)
  b.document.visibilityState = 'visible'; b.listeners.get('visibilitychange')(); await flush(); assert.equal(count, 3)
  b.window.navigator.onLine = false; b.listeners.get('offline')(); assert.equal(b.timers.size, 0)
  b.window.navigator.onLine = true; b.listeners.get('online')(); await flush(); assert.equal(count, 4)
  loop.stop(); assert.equal(b.timers.size, 0); assert.equal(b.listeners.size, 0)
})
test('overlapping focus events coalesce; a busy review defers a tick without stopping future polling', async () => {
  const b = browser(); let calls = 0, release, ready = true
  const loop = createThreatAlertRefresh({ ...b, ready: () => ready, refresh: async () => { calls++; await new Promise(resolve => { release = resolve }) } })
  loop.start(); b.listeners.get('focus')(); b.listeners.get('visibilitychange')(); assert.equal(calls, 1)
  release(); await flush(); ready = false; b.tick(); await flush(); assert.equal(calls, 1); assert.equal(b.timers.size, 1)
  b.listeners.get('focus')(); await flush(); assert.equal(calls, 1); assert.equal(b.timers.size, 1)
  ready = true; b.tick(); assert.equal(calls, 2)
  loop.stop(); release(); await flush(); assert.equal(b.timers.size, 0)
})
