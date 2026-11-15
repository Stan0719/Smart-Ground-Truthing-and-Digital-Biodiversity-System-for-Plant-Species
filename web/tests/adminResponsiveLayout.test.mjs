import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from '@vue/compiler-sfc'
import postcss from 'postcss'

const read = path => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')
const users = read('views/AdminUserManagementView.vue')
const shell = read('components/AdminPageShell.vue')

test('one colgroup aligns six content-sized columns and preserves the keyboard-accessible scroller', () => {
  const { descriptor } = parse(users)
  const group = descriptor.template.content.match(/<colgroup>([\s\S]*?)<\/colgroup>/)[1]
  assert.deepEqual([...group.matchAll(/class="([^"]+)"/g)].map(match => match[1]), [
    'users-name-column', 'users-id-column', 'users-role-column', 'users-status-column', 'users-login-column', 'users-actions-column',
  ])
  for (const [column, width] of [['id', 11], ['role', 13], ['status', 11], ['login', 13], ['actions', 15]]) {
    assert.ok(users.includes(`.users-panel .users-${column}-column { width: ${width}rem; }`))
  }
  assert.doesNotMatch(users, /width: calc\(100% \/ 6\)/)
  assert.match(users, /class="table-scroll" tabindex="0" role="region" aria-label="User accounts"/)
  assert.match(users, /\.users-panel \.table-scroll:focus-visible/)
  assert.match(read('styles/admin-typography.css'), /overflow-x: auto/)
})

test('filters use panel width for full-row search, balanced filters and deliberate stacked controls', () => {
  const sheet = postcss.parse(parse(users).descriptor.styles[0].content)
  const containers = []
  sheet.walkAtRules('container', rule => containers.push(rule.params))
  assert.deepEqual(containers, ['user-directory (max-width: 58rem)', 'user-directory (max-width: 32rem)', 'user-directory (max-width: 22rem)'])
  assert.match(users, /container: user-directory \/ inline-size/)
  assert.match(users, /minmax\(16rem, 1fr\) minmax\(10rem, 12rem\) minmax\(10rem, 12rem\) max-content/)
  assert.match(users, /\.users-panel \.filters select, \.users-panel \.clear-button \{ height: 44px; min-height: 44px/)
  assert.match(users, /\.users-panel \.search-box svg \{ flex: 0 0 17px/)
  for (const binding of ['search', 'roleFilter', 'statusFilter']) assert.ok(users.includes(`v-model="${binding}"`))
  assert.ok(users.includes('@click="clearFilters"'))
})

test('Administrator header wraps controls intentionally and prevents word fragmentation without hiding actions', () => {
  assert.match(shell, /\.admin-shell\.admin-shell\.admin-shell\.admin-shell \.heading h1 \{ word-break: normal; overflow-wrap: normal;/)
  assert.match(shell, /\.topbar \{ flex-wrap: wrap; gap: 12px;/)
  assert.match(shell, /@media \(max-width: 620px\)[\s\S]*grid-template-columns: 39px minmax\(0, 1fr\)/)
  assert.match(shell, /:deep\(\.admin-topbar-actions\) \{ grid-column: 1 \/ -1; justify-self: end;/)
  assert.match(shell, /\.heading p \{ display: block;/)
  assert.ok(shell.includes('@click="openSidebar"'))
  assert.ok(shell.includes('@click="closeSidebar"'))
  assert.ok(shell.includes('<AdminTopbarActions />'))
  const actions = read('components/AdminTopbarActions.vue')
  for (const component of ['LanguageSwitcher', 'AdminNotificationBell']) assert.ok(actions.includes('<' + component))
  assert.ok(actions.includes('@click="toggleProfile"'))
})
