import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import postcss from 'postcss'
import { parse, compileScript } from '@vue/compiler-sfc'
import { formatAdminLastLogin } from '../src/utils/adminLastLogin.ts'

const read = path => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')
const css = read('styles/admin-typography.css')
const sheet = postcss.parse(css)
const declarations = selector => {
  const result = {}
  sheet.walkRules(rule => {
    if (rule.selector.endsWith(selector)) rule.walkDecls(item => { result[item.prop] = item.value })
  })
  return result
}

test('Administrator scale matches Officer tokens and is isolated to the shell and its teleported dialogs', () => {
  const officer = read('styles/officer-typography.css')
  for (const [admin, reference] of [['text', 'text'], ['support', 'support'], ['small', 'small'], ['section', 'section'], ['title', 'title']]) {
    const expected = officer.match(new RegExp('--officer-' + reference + ': ([^;]+);'))[1]
    assert.match(css, new RegExp('--admin-' + admin + ': ' + expected.replaceAll('.', '\\.') + ';'))
  }
  sheet.walkRules(rule => assert.ok(rule.selector.startsWith(':is(.admin-shell.admin-shell.admin-shell, body:has(.admin-shell) .staff-dialog-mask.'), rule.selector))
  assert.match(read('components/AdminPageShell.vue'), /import '..\/styles\/admin-typography.css'/)
  for (const selector of ['table th', 'table td', 'button', ':is(label, dt)']) assert.ok(Object.keys(declarations(selector)).length)
})

test('directory title and table use Officer dark green, padding, typography and nonshrinking actions', () => {
  assert.equal(declarations('.users-panel .panel-heading').background, '#245443')
  assert.equal(declarations('.users-panel th').background, '#245443')
  assert.equal(declarations('.users-panel :is(th, td)').padding, '12px 14px')
  assert.equal(declarations('table th')['font-size'], 'var(--admin-small)')
  assert.equal(declarations('table td')['font-size'], 'var(--admin-text)')
  assert.equal(declarations('.users-panel .row-actions').gap, '7px')
  assert.equal(declarations('.users-panel .row-actions button').padding, '2px 11px')
  assert.match(css, /height: 32px; min-height: 32px/)
  assert.match(css, /@media \(max-width: 767px\)[\s\S]*height: 44px; min-height: 44px/)
  assert.equal(declarations('.users-panel td code')['overflow-wrap'], 'anywhere')
  assert.equal(declarations(':is(.table-scroll, .table-wrap)')['overflow-x'], 'auto')
})

test('directory retains all columns, bindings, actions, dates and API entry points', () => {
  const source = read('views/AdminUserManagementView.vue')
  const { descriptor } = parse(source)
  assert.doesNotThrow(() => compileScript(descriptor, { id: 'admin-users' }))
  const headings = [...descriptor.template.content.matchAll(/<th>(.*?)<\/th>/g)].map(match => match[1])
  assert.deepEqual(headings, ['User', 'User ID', 'Role', 'Status', "{{ t('adminUsers.lastLogin') }}", 'Actions'])
  for (const binding of ['search', 'roleFilter', 'statusFilter']) assert.match(source, new RegExp('v-model="' + binding + '"'))
  for (const mode of ['view', 'edit', 'delete']) assert.ok(source.includes(`@click="openUserAction('${mode}', user)"`))
  for (const endpoint of ['/admin/users', '/status', '/reset', '/resend']) assert.ok(source.includes(endpoint))
  assert.match(source, /lastLoginLabel\(user.lastLogin\)/)
  assert.match(source, /formatAdminLastLogin\(value, locale.value\)/)
  assert.match(source, /value\?\.startsWith\('Today,'\)/)
  assert.match(source, /value\?\.startsWith\('Yesterday,'\)/)
})

test('Last Login preserves Never and handles missing or invalid values', () => {
  assert.equal(formatAdminLastLogin('Never', 'en'), 'Never')
  for (const value of [null, undefined, '', '   ', 'invalid timestamp', 123]) assert.equal(formatAdminLastLogin(value, 'en'), '—')
})

test('Last Login uses day-month-year order, localized months and local timezone with rollover', () => {
  const value = '2026-11-05T20:54:35.450Z'
  for (const locale of ['en', 'ms', 'zh']) {
    const parts = new Intl.DateTimeFormat(locale === 'ms' ? 'ms-MY' : locale, {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(value))
    const fields = Object.fromEntries(parts.map(part => [part.type, part.value]))
    assert.equal(formatAdminLastLogin(value, locale), `${fields.day} ${fields.month} ${fields.year}, ${fields.hour}:${fields.minute}`)
  }
  const originalZone = process.env.TZ
  try {
    for (const zone of ['Asia/Kuching', 'UTC']) {
      process.env.TZ = zone
      const actual = formatAdminLastLogin(value, 'en-GB')
      assert.equal(actual, new Intl.DateTimeFormat('en-GB', {
        timeZone: zone, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(new Date(value)))
      assert.equal(actual, zone === 'Asia/Kuching' ? '6 Nov 2026, 04:54' : '5 Nov 2026, 20:54')
    }
  } finally {
    if (originalZone === undefined) delete process.env.TZ
    else process.env.TZ = originalZone
  }
})
