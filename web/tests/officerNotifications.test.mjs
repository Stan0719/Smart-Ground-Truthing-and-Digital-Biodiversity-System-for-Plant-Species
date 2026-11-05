import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createOfficerInbox } from '../src/services/officerNotifications.ts'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
const officer = { id: 'one', role: 'Conservation Officer', status: 'Active', mustChangePassword: false }
const notice = (n = 1, changes = {}) => ({ id: `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`, event_type: 'registration_submitted', created_at: '2026-11-01T12:00:00Z', read_at: null, resource: { kind: 'observation', id: String(n) }, ...changes })
const page = (items = [], more = false, cursor = null) => Response.json({ notifications: items, unread_count: items.filter(n => !n.read_at).length, page: { has_more: more, next_cursor: cursor }, read_through: 'signed-boundary' })
function setup(handler, navigate = async () => true) {
  const calls = [], destinations = []
  const client = createOfficerInbox({ transport: async (url, options) => { calls.push({ url, options }); return handler(url, options) }, navigate: async route => { destinations.push(route); return navigate(route) } })
  client.setSession(officer, false)
  return { client, calls, destinations }
}
test('real inbox handles loading, sixth-and-later records, continuation, count and persistent acknowledgements', async () => {
  let release, saved = false
  const h = setup(async (url, options) => {
    if (url.includes('unread-count')) return Response.json({ unread_count: saved ? 0 : 7 })
    if (options.method === 'POST') { saved = true; return url.endsWith('read-all') ? Response.json({ updated: 6 }) : Response.json({ notification: { id: notice().id, read_at: '2026-11-02T00:00:00Z' } }) }
    if (url.startsWith('/api/observations')) return Response.json({ observation: { id: '1', revision: 4, origin_type: 'initial_registration' } })
    if (url.includes('cursor=')) return page([notice(7)])
    if (!release && !saved) return new Promise(resolve => { release = () => resolve(page(Array.from({ length: 6 }, (_, i) => notice(i + 1)), true, 'older')) })
    return page(Array.from({ length: 7 }, (_, i) => notice(i + 1, { read_at: saved ? '2026-11-02T00:00:00Z' : null })))
  })
  const loading = h.client.load(); assert.equal(h.client.state.loading, true); release(); await loading
  assert.equal(h.client.state.items.length, 6); await h.client.load(true); assert.equal(h.client.state.items.length, 7)
  assert.equal(await h.client.open(h.client.state.items[0]), true)
  assert.equal(h.destinations[0].name, 'conservation-reviews'); assert.equal(h.destinations[0].query.review, '1')
  assert.ok(h.client.state.items[0].read_at); await h.client.refreshCount()
  // Restore a positive count to exercise mark-all with the issued boundary.
  h.client.state.unread = 6; await h.client.markAll()
  assert.equal(JSON.parse(h.calls.find(c => c.url.endsWith('read-all')).options.body).read_through, 'signed-boundary')
  assert.equal(h.client.state.unread, 0); h.client.dispose()
})
test('errors are not empty success; append retry preserves records and expired cursor recovers', async () => {
  let status = 200
  const h = setup(async url => status !== 200 ? Response.json({}, { status }) : page([notice()], true, 'next'))
  await h.client.load(); status = 503; await h.client.load(true)
  assert.equal(h.client.state.items.length, 1); assert.equal(h.client.state.unread, null); assert.equal(h.client.state.error, 'loadFailed')
  status = 400; await h.client.load(true); assert.equal(h.client.state.cursor, null)
  status = 200; await h.client.load(); assert.equal(h.client.state.error, '')
  status = 403; await h.client.refreshCount(); assert.equal(h.client.state.ready, false); assert.equal(h.client.state.items.length, 0)
  h.client.dispose()
})
test('logout/account change reject late success AND late unauthorized responses', async () => {
  for (const response of [page([notice()]), Response.json({}, { status: 401 })]) {
    let release
    const h = setup(async () => new Promise(resolve => { release = resolve }))
    const pending = h.client.load(); h.client.setSession({ ...officer, id: 'two' }, false)
    release(response); await pending
    assert.equal(h.client.state.items.length, 0); assert.equal(h.client.state.ready, true)
    h.client.setSession(null, false); await h.client.load(); assert.equal(h.calls.length, 1); h.client.dispose()
  }
})
test('fresh origin controls navigation; failed access or navigation never marks read', async () => {
  for (const origin of ['initial_registration', 'subsequent_observation', 'unknown']) {
    const h = setup(async (url, options) => options.method === 'POST' ? Response.json({ notification: { id: notice().id, read_at: '2026-11-02T00:00:00Z' } }) : url.includes('unread-count') ? Response.json({ unread_count: 0 }) : Response.json({ observation: { id: '1', revision: 2, origin_type: origin, status: 'Approved' } }))
    assert.equal(await h.client.open(notice()), true)
    assert.equal(h.destinations[0].name, origin === 'subsequent_observation' ? 'conservation-observations' : 'conservation-reviews')
    if (origin === 'subsequent_observation') assert.equal(h.destinations[0].query, undefined)
    h.client.dispose()
  }
  for (const mode of ['missing', 'navigation']) {
    const h = setup(async () => mode === 'missing' ? Response.json({}, { status: 404 }) : Response.json({ observation: { id: '1', revision: 2, origin_type: 'initial_registration' } }), async () => false)
    assert.equal(await h.client.open(notice()), false); assert.ok(!h.calls.some(c => c.options.method === 'POST')); h.client.dispose()
  }
})
test('no unauthorized polling, malformed data is rejected, and uncertain read-all requires refresh', async () => {
  const h = setup(async (url, options) => options.method === 'POST' ? Promise.reject(Error('uncertain')) : page([notice()]))
  h.client.setSession({ ...officer, role: 'Administrator' }, false); await h.client.load(); assert.equal(h.calls.length, 0)
  h.client.setSession(officer, false); await h.client.load(); await h.client.markAll()
  assert.equal(h.client.state.boundary, null); assert.equal(h.client.state.error, 'readFailed'); h.client.dispose()
  const bad = setup(async () => page([notice(1, { resource: { kind: 'observation', id: 'OBS004' } })]))
  await bad.client.load(); assert.equal(bad.client.state.error, 'loadFailed'); bad.client.dispose()
})
test('Officer component preserves dimensions and renders real-state controls with complete EN/MS/ZH labels', () => {
  const content = readFileSync(new URL('../src/components/ConservationTopbarActions.vue', import.meta.url), 'utf8')
  const { descriptor } = parse(content), script = compileScript(descriptor, { id: 'officer-bell' })
  const template = compileTemplate({ source: descriptor.template.content, filename: 'ConservationTopbarActions.vue', id: 'officer-bell', compilerOptions: { bindingMetadata: script.bindings } })
  assert.equal(template.errors.length, 0)
  assert.doesNotMatch(content, /data\/conservationNotifications|slice\(0, 5\)|OBS004|CAM-NOTICE/)
  assert.match(content, /notificationState\.hasMore/); assert.match(content, /nt\('loading'\)/)
  assert.match(content, /event\.key === 'Escape'/); assert.match(content, /notificationButton\.value\?\.focus\(\)/)
  assert.match(content, /width: min\(360px, calc\(100vw - 24px\)\)/); assert.match(content, /max-height: 350px/)
  for (const lang of ['en', 'ms', 'zh-CN']) {
    const labels = JSON.parse(readFileSync(new URL(`../src/locales/${lang}.json`, import.meta.url), 'utf8')).dashboardNotifications.officerLive
    for (const key of ['registrationTitle', 'fieldTitle', 'speciesFirst', 'loading', 'loadFailed', 'sessionUnavailable', 'more', 'unread']) assert.ok(labels[key])
  }
})
