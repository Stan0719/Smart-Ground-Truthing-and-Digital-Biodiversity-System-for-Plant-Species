import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createAdminInbox } from '../src/services/adminNotifications.ts'

const admin = { id: 'admin-1', name: 'Admin', email: 'admin@example.invalid', role: 'Administrator', status: 'Active', mustChangePassword: false, lastLogin: 'Never', initials: 'A' }
const notice = { id: '6b9ef6dd-ea20-4a68-8b7e-55e89f6fa101', event_type: 'account_administration', priority: 'normal', created_at: '2026-11-22T02:00:00.000Z', read_at: null, admin_details: { action: 'staff_created', account_name: 'New Officer', role: 'Conservation Officer' } }
const page = (notifications = [], unread_count = 0) => ({ notifications, unread_count, page: { limit: 20, has_more: false, next_cursor: null }, read_through: 'signed-boundary' })
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

test('Admin inbox loads real notices, marks individual and all notifications read', async () => {
  const calls = []
  let unread = 1
  const transport = async (url, options = {}) => {
    calls.push([url, options.method])
    if (url.endsWith('/read') && !url.endsWith('/read-all')) {
      unread = 0
      return response({ notification: { id: notice.id, read_at: '2026-11-22T02:01:00.000Z' } })
    }
    if (url.endsWith('/read-all')) return response({ updated: unread })
    return response(page(unread ? [notice] : [{ ...notice, read_at: '2026-11-22T02:01:00.000Z' }], unread))
  }
  const inbox = createAdminInbox({ transport })
  inbox.setSession(admin, false)
  await inbox.load()
  await inbox.refreshCount()
  assert.equal(inbox.state.items[0].details.account_name, 'New Officer')
  assert.equal(inbox.state.unread, 1)
  assert.equal(await inbox.markRead(inbox.state.items[0]), true)
  assert.equal(inbox.state.items[0].read_at, '2026-11-22T02:01:00.000Z')
  assert.equal(inbox.state.unread, 0)
  inbox.dispose()
  assert.deepEqual(calls.map(([url]) => url), [
    '/api/data/staff-notifications?limit=20',
    '/api/data/staff-notifications/unread-count',
    `/api/data/staff-notifications/${notice.id}/read`,
  ])
})

test('Admin inbox handles empty, invalid-session, loading failure and read-all refresh states', async () => {
  let calls = 0
  const inbox = createAdminInbox({ transport: async (url) => {
    calls++
    if (calls === 1) return response(page())
    if (calls === 2) return response({}, 503)
    if (url.endsWith('/read-all')) return response({ updated: 1 })
    return response(page([{ ...notice, read_at: '2026-11-22T02:02:00.000Z' }], 0))
  } })
  inbox.setSession(admin, false)
  await inbox.load()
  assert.equal(inbox.state.loaded, true)
  assert.deepEqual(inbox.state.items, [])
  assert.equal(inbox.state.unread, 0)
  await inbox.load()
  assert.equal(inbox.state.error, 'loadFailed')

  inbox.setSession(admin, false) // Identity unchanged: retain state and the previously issued boundary.
  inbox.state.unread = 1
  await inbox.markAll()
  assert.equal(inbox.state.unread, 0)
  assert.equal(inbox.state.error, '')
  inbox.dispose()
})

test('only an active, permanent Administrator session can load notifications', async () => {
  let calls = 0
  const inbox = createAdminInbox({ transport: async () => { calls++; return response(page()) } })
  inbox.setSession({ ...admin, role: 'Conservation Officer' }, false)
  await inbox.load()
  assert.equal(inbox.state.ready, false)
  assert.equal(calls, 0)
  inbox.setSession(admin, true)
  await inbox.load()
  assert.equal(calls, 0)
  inbox.dispose()
})

test('Admin notification action copy is available in EN, MS and ZH', () => {
  for (const locale of ['en', 'ms', 'zh-CN']) {
    const data = JSON.parse(readFileSync(new URL(`../src/locales/${locale}.json`, import.meta.url), 'utf8'))
    for (const action of ['staff_created', 'staff_deactivated', 'staff_reactivated', 'staff_role_changed', 'staff_profile_updated', 'staff_archived', 'security_settings_changed', 'security_event', 'system_failure']) {
      assert.equal(typeof data.dashboardNotifications.admin.actions[action]?.title, 'string', `${locale} ${action} title`)
      assert.equal(typeof data.dashboardNotifications.admin.actions[action]?.message, 'string', `${locale} ${action} message`)
    }
  }
})
