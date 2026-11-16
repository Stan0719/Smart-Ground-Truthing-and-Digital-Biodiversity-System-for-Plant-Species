import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { formatAdminLastLogin } from '../src/utils/adminLastLogin.ts'

const source = readFileSync(new URL('../src/views/AdminUserManagementView.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const compiled = compileScript(descriptor, { id: 'admin-user-refinements' })
const template = compileTemplate({ source: descriptor.template.content, filename: 'AdminUserManagementView.vue', id: 'admin-user-refinements', compilerOptions: { bindingMetadata: compiled.bindings } })
const id = '680be14a-f114-45e8-9d70-0ad66e8459fc'
const user = { id, name: 'Fixture', email: 'fixture@example.invalid', role: 'Botanist', status: 'Active', lastLogin: 'Never', initials: 'F' }
function harness(writeText, request) {
  const exports = {}, calls = [], scope = vue.effectScope()
  const context = { exports, Error, navigator: { clipboard: { writeText } }, window: { innerWidth: 390, innerHeight: 700 }, document: { activeElement: null, querySelector: () => null }, require(name) {
    if (name === 'vue') return { ...vue, onMounted() {}, resolveComponent: name => name, withDirectives: node => node }
    if (name === 'vue-i18n') return { useI18n: () => ({ t: key => key, locale: vue.ref('en') }) }
    if (name.endsWith('/auth')) return { currentUser: async () => null, api: async (...args) => { calls.push(args); return request ? await request(...args) : { users: [user] } } }
    if (name.endsWith('/adminLastLogin')) return { formatAdminLastLogin }
    if (name.endsWith('.vue')) return {}
    throw Error(name)
  } }
  vm.runInNewContext(ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context)
  const state = scope.run(() => exports.default.setup({}, { expose() {} }))
  state.users.value = [user]
  vm.runInNewContext('(function(){' + ts.transpileModule(template.code, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText + '})()', context)
  return { state, calls, environment: context, stop: () => scope.stop(), render: () => exports.render({}, [], {}, vue.proxyRefs(state), {}, {}) }
}

function nodes(value) {
  const result = []
  function visit(node) {
    if (Array.isArray(node)) { node.forEach(visit); return }
    if (!node || typeof node !== 'object') return
    result.push(node)
    if (Array.isArray(node.children)) visit(node.children)
    else if (node.children?.default) visit(node.children.default())
  }
  visit(value)
  return result
}

test('User IDs shorten only their display while search, selected accounts and edit requests retain original IDs', async () => {
  const h = harness(async () => {})
  try {
    assert.equal(h.state.shortUserId(id), '680be14a…')
    assert.equal(h.state.shortUserId('short'), 'short')
    h.state.search.value = id
    assert.equal(h.state.filteredUsers.value[0].id, id)
    for (const mode of ['view', 'edit', 'delete']) {
      h.state.openUserAction(mode, user)
      assert.equal(h.state.selectedUser.value.id, id)
    }
    h.state.openUserAction('edit', user)
    h.state.editUser.value.name = 'Changed'
    await h.state.saveEditedUser()
    assert.equal(h.calls[0][0], '/admin/users/' + id)
    assert.equal(h.calls[0][1], 'PATCH')
    assert.equal(h.state.lastLoginLabel('Never'), 'Never')
    h.state.openAddUser()
    assert.equal(h.state.addUserOpen.value, true)
  } finally { h.stop() }
})

test('copy writes the full ID, suppresses rapid clicks and reports success only after completion', async () => {
  let finish
  const writes = []
  const h = harness(value => { writes.push(value); return new Promise(resolve => { finish = resolve }) })
  try {
    const pending = h.state.copyUserId(id)
    assert.equal(h.state.feedback.value, null)
    await h.state.copyUserId(id)
    assert.deepEqual(writes, [id])
    finish()
    await pending
    assert.equal(h.state.feedback.value.variant, 'success')
    assert.equal(h.state.feedback.value.message, 'Full identifier copied.')
    assert.equal(h.state.copyPending.value, false)
  } finally { h.stop() }
})

test('clipboard failure or unavailable clipboard uses existing error feedback', async () => {
  for (const write of [undefined, async () => { throw Error('denied') }]) {
    const h = harness(write)
    try {
      await h.state.copyUserId(id)
      assert.equal(h.state.feedback.value.variant, 'error')
      assert.equal(h.state.copyPending.value, false)
    } finally { h.stop() }
  }
})

test('summary icons, compact primary action and responsive layout are local presentation changes', () => {
  assert.match(source, /\.admin-users\.admin-users\.admin-users\.admin-users \.users-panel table\s*\{ table-layout: fixed; min-width: 80rem;/)
  assert.match(source, /\.users-panel :is\(th, td\)\s*\{ padding: 12px 14px;/)
  assert.equal((descriptor.template.content.match(/class="stat-icon/g) || []).length, 4)
  assert.match(descriptor.styles[0].content, /\.stats-grid article\s*\{[^}]*align-items: center/)
  assert.match(source, /\.stat-icon\s*\{[^}]*font-size: 24px;[^}]*flex: 0 0 39px/)
  assert.match(source, /grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/)
  assert.match(source, /@media \(max-width: 1050px\)[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/)
  assert.match(source, /\.admin-users \.page-intro > \.primary-button\s*\{[^}]*min-height: 44px;[^}]*white-space: nowrap/)
  assert.match(source, /@media \(max-width: 560px\)\s*\{\s*\.admin-users \.page-intro[^}]*\}[\s\S]*width: 100%; min-width: 0/)
})

test('user names and long emails wrap within their column while the avatar cannot squeeze them', () => {
  assert.match(source, /\.admin-users\.admin-users\.admin-users\.admin-users \.users-panel \.user-cell\s*\{ min-width: 0; max-width: 100%/)
  assert.match(source, /\.user-cell > span\s*\{ flex-shrink: 0/)
  assert.match(source, /\.user-cell > div\s*\{ flex: 1; min-width: 0/)
  assert.match(source, /\.user-cell :is\(strong, small\)\s*\{[^}]*white-space: normal; overflow-wrap: anywhere/)
})

test('copy and information icons are accessible and the exact suspension explanation remains', () => {
  assert.match(source, /<code :title="user.id">\{\{ shortUserId\(user.id\) \}\}<\/code>/)
  assert.match(source, /type="button" title="Copy full User ID" aria-label="Copy full User ID"[^>]*@click="copyUserId\(user.id\)"/)
  assert.match(source, /\.user-id-copy:focus-visible/)
  assert.match(source, /<p class="suspension-info"><svg[^>]*aria-hidden="true"[^>]*>[\s\S]*?<span>Accounts inactive for 30 days are automatically suspended\. Only Administrators can reactivate them, and the last active Administrator is protected\.<\/span><\/p>/)
  assert.match(source, /\.suspension-info[^}]*gap: 8px/)
  assert.match(source, /\.suspension-info svg[^}]*width: 18px; height: 18px; flex: 0 0 18px/)
})

test('View renders the identity banner, table badge classes, four borderless fields and existing date/copy values', () => {
  const h = harness(async () => {})
  try {
    for (const role of ['Visitor', 'Botanist', 'Conservation Officer', 'Administrator']) {
      h.state.openUserAction('view', { ...user, role, status: 'Suspended' })
      const rendered = nodes(h.render())
      const banner = rendered.find(node => node.props?.class?.includes('user-view-banner'))
      const identity = nodes(banner)
      assert.ok(identity.some(node => node.children === user.name))
      assert.ok(identity.some(node => node.children === user.email))
      assert.ok(identity.some(node => node.children === user.initials))
      assert.ok(identity.some(node => node.props?.class === 'role-badge ' + role.toLowerCase().replace(' ', '-')))
      assert.ok(identity.some(node => node.props?.class === 'status-badge suspended'))
      const fields = nodes(rendered.find(node => node.props?.class === 'user-view-fields'))
      assert.deepEqual(fields.filter(node => node.type === 'dt').map(node => node.children), ['User ID', 'Role', 'Status', 'Last login'])
      assert.ok(fields.some(node => node.children === 'Never'))
      assert.ok(fields.some(node => node.type === 'code' && node.children === '680be14a…'))
      assert.ok(fields.some(node => node.props?.['aria-label'] === 'Copy full User ID'))
    }
    assert.match(source, /\.user-view-modal \.user-view-fields div\s*\{ padding: 0; border: 0;/)
  } finally { h.stop() }
})

test('View footer preserves recovery/resend conditions, Close, and Edit opening the original selected account', () => {
  const h = harness(async () => {})
  try {
    h.state.openUserAction('view', user)
    let rendered = nodes(h.render())
    assert.ok(rendered.some(node => node.type === 'button' && nodes(node).some(child => child.children?.includes?.('Request password recovery'))))
    const edit = rendered.find(node => node.type === 'button' && nodes(node).some(child => child.children?.includes?.('Edit User')))
    edit.props.onClick()
    assert.equal(h.state.actionMode.value, 'edit')
    assert.equal(h.state.selectedUser.value.id, id)
    h.state.openUserAction('view', { ...user, mustChangePassword: true })
    rendered = nodes(h.render())
    assert.ok(rendered.some(node => node.type === 'button' && node.children === 'Resend temporary password'))
    const close = rendered.find(node => node.type === 'button' && node.children === 'Close')
    close.props.onClick()
    assert.equal(h.state.actionMode.value, null)
  } finally { h.stop() }
})

test('View modal buttons have local outlined/fill and darker primary hover states with disabled and reduced-motion guards', () => {
  assert.match(source, /\.user-view-modal button:not\(\.primary-button\)\s*\{\s*border: 1px solid #245443;\s*background: #fff;\s*color: #245443;/)
  assert.match(source, /@media \(hover: hover\)[\s\S]*\.user-view-modal button:not\(\.primary-button\):not\(\.user-id-copy\):not\(:disabled\):hover\s*\{\s*background: #245443;\s*border-color: #245443;\s*color: #fff;/)
  assert.match(source, /\.user-view-modal button.primary-button:not\(:disabled\):hover\s*\{\s*background: #173f34;/)
  assert.match(source, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.user-view-modal button \{ transition: none;/)
})

test('Edit keeps original controls and selected-account badges, with contextual role guidance', () => {
  const h = harness(async () => {})
  try {
    for (const role of ['Visitor', 'Botanist', 'Conservation Officer', 'Administrator']) {
      h.state.currentAdminId.value = role === 'Administrator' ? id : 'different-admin'
      h.state.openUserAction('edit', { ...user, role })
      const rendered = nodes(h.render())
      const banner = nodes(rendered.find(node => node.props?.class?.includes('user-view-banner')))
      assert.ok(banner.some(node => node.children === user.name))
      assert.ok(banner.some(node => node.children === user.email))
      assert.ok(banner.some(node => node.props?.class === 'role-badge ' + role.toLowerCase().replace(' ', '-')))
      assert.ok(banner.some(node => node.props?.class === 'status-badge active'))
      const select = rendered.find(node => node.props?.id === 'edit-user-role')
      assert.equal(select.props.disabled, role === 'Visitor' || role === 'Administrator')
      assert.equal(h.state.editUser.value.name, user.name)
      assert.equal(h.state.editUser.value.email, user.email)
      const expected = role === 'Visitor' ? 'Visitor accounts are self-registered. Their role cannot be changed here.'
        : role === 'Administrator' ? 'Your own Administrator role cannot be changed here.'
          : 'Staff role changes require a new sign-in to take effect.'
      assert.equal(h.state.roleInfoMessage.value, expected)
      assert.ok(rendered.some(node => node.props?.popover === 'auto' && node.props?.role === 'tooltip'))
      const info = rendered.find(node => node.props?.['aria-label'] === 'Role information')
      for (const event of ['onMouseenter', 'onFocus', 'onClick', 'onBlur', 'onMouseleave']) assert.equal(typeof info.props[event], 'function')
      const cancel = rendered.find(node => node.type === 'button' && node.children === 'Cancel')
      cancel.props.onClick()
      assert.equal(h.state.actionMode.value, null)
    }
    assert.doesNotMatch(source, /Staff role changes are enforced by the server and require a new sign-in\./)
    assert.doesNotMatch(source, /Visitor accounts are self-registered\. Their role cannot be changed from User Management\./)
    assert.match(source, /v-model="editUser.role" :disabled="selectedIsVisitor \|\| selectedIsCurrentAdmin"/)
    assert.match(source, /v-model="editUser.status" required :disabled="selectedIsCurrentAdmin \|\| selectedUser.status === 'Pending Activation'"/)
    assert.match(source, /@submit.prevent="saveEditedUser"/)
  } finally { h.stop() }
})

test('Role popover uses the top layer and clamps its position to the viewport', () => {
  const h = harness(async () => {})
  let opened = 0, closed = 0
  try {
    h.state.roleInfoButton.value = { getBoundingClientRect: () => ({ left: 370, top: 670, bottom: 694 }) }
    h.state.roleInfo.value = { showPopover() { opened++ }, hidePopover() { closed++ }, getBoundingClientRect: () => ({ width: 280, height: 90 }), style: {} }
    h.state.showRoleInfo()
    assert.equal(opened, 1)
    assert.equal(h.state.roleInfo.value.style.left, '102px')
    assert.equal(h.state.roleInfo.value.style.top, '572px')
    h.state.leaveRoleInfo()
    assert.equal(closed, 1)
    h.state.hideRoleInfo()
    assert.equal(closed, 2)
  } finally { h.stop() }
})

test('Delete names follow the selected account with safe missing-name fallback and no identity changes', () => {
  const h = harness(async () => {})
  try {
    for (const name of ['Bob', 'Another account', '<script>unsafe</script>', 'Very long name '.repeat(20)]) {
      h.state.openUserAction('delete', { ...user, name })
      const rendered = nodes(h.render())
      const question = nodes(rendered.find(node => node.props?.id === 'delete-user-question'))
      assert.ok(question.some(node => node.type === 'strong' && node.children === name.trim()))
      assert.equal(h.state.selectedUser.value.id, id)
    }
    h.state.openUserAction('delete', { ...user, name: '' })
    assert.equal(h.state.deleteUserName.value, user.email)
    assert.match(source, /\.user-delete-modal \.delete-confirmation p, \.user-delete-modal \.delete-confirmation small \{ overflow-wrap: anywhere/)
    assert.match(source, /@media \(prefers-reduced-motion: reduce\) \{ \.user-delete-modal\.user-delete-shake \{ animation: none;/)
  } finally { h.stop() }
})

test('Delete backdrop ignores interior clicks, restarts its shake and leaves View/Edit dismissal intact', () => {
  const h = harness(async () => {})
  let restarts = 0, removals = 0, layouts = 0
  try {
    h.state.actionModal.value = { classList: { remove() { removals++ }, add() { restarts++ } }, get offsetWidth() { layouts++; return 460 } }
    h.state.openUserAction('delete', user)
    const backdrop = nodes(h.render()).find(node => node.props?.class === 'modal-backdrop')
    const outside = {}, inside = {}
    backdrop.props.onClick({ target: inside, currentTarget: outside })
    assert.equal(restarts, 0)
    for (let n = 0; n < 2; n++) backdrop.props.onClick({ target: outside, currentTarget: outside })
    assert.equal(h.state.actionMode.value, 'delete')
    assert.equal(restarts, 2)
    assert.equal(removals, 2)
    assert.equal(layouts, 2)
    assert.equal(h.calls.length, 0)
    for (const mode of ['view', 'edit']) {
      h.state.openUserAction(mode, user)
      h.state.handleActionBackdrop()
      assert.equal(h.state.actionMode.value, null)
    }
  } finally { h.stop() }
})

test('Delete focus starts on Cancel, wraps with Tab, ignores Escape and returns after explicit close', async () => {
  const h = harness(async () => {})
  let focused = '', prevented = 0, restored = 0
  const first = { focus() { focused = 'X' } }, last = { focus() { focused = 'Delete' } }
  try {
    h.environment.document.activeElement = { isConnected: true, focus() { restored++ } }
    h.state.actionModal.value = {
      querySelector: () => ({ focus() { focused = 'Cancel' } }),
      querySelectorAll: () => [first, {}, last],
    }
    h.state.openUserAction('delete', user)
    await vue.nextTick(); await new Promise(setImmediate); await vue.nextTick()
    assert.equal(focused, 'Cancel')
    h.environment.document.activeElement = last
    h.state.onDeleteKeydown({ key: 'Tab', preventDefault() { prevented++ } })
    assert.equal(focused, 'X')
    h.environment.document.activeElement = first
    h.state.onDeleteKeydown({ key: 'Tab', shiftKey: true, preventDefault() { prevented++ } })
    assert.equal(focused, 'Delete')
    h.state.onDeleteKeydown({ key: 'Escape', preventDefault() { prevented++ }, stopPropagation() {} })
    assert.equal(h.state.actionMode.value, 'delete')
    assert.equal(prevented, 3)
    assert.equal(h.calls.length, 0)
    const cancel = nodes(h.render()).find(node => node.props?.['data-delete-cancel'] !== undefined)
    cancel.props.onClick()
    await vue.nextTick(); await new Promise(setImmediate); await vue.nextTick()
    assert.equal(h.state.actionMode.value, null)
    assert.equal(restored, 1)
  } finally { h.stop() }
})

test('Delete retains the original archive request, success refresh, errors and X close behavior', async () => {
  const h = harness(async () => {})
  try {
    h.state.openUserAction('delete', user)
    await h.state.confirmDeleteUser()
    assert.equal(h.calls[0][0], '/admin/users/' + id)
    assert.equal(h.calls[0][1], 'DELETE')
    assert.equal(Object.keys(h.calls[0][2]).length, 0)
    assert.equal(h.calls[1][0], '/admin/users')
    assert.equal(h.state.actionMode.value, null)
    assert.equal(h.state.feedback.value.message, 'Account deleted successfully.')
  } finally { h.stop() }
  const failed = harness(async () => {}, async () => { throw Error('Account protection retained') })
  try {
    failed.state.openUserAction('delete', user)
    await failed.state.confirmDeleteUser()
    assert.equal(failed.state.actionMode.value, 'delete')
    assert.equal(failed.state.feedback.value.message, 'Account protection retained')
    nodes(failed.render()).find(node => node.props?.['aria-label'] === 'Close').props.onClick()
    assert.equal(failed.state.actionMode.value, null)
  } finally { failed.stop() }
})
