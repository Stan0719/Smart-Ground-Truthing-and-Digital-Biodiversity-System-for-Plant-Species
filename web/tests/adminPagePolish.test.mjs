import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import postcss from 'postcss'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const read = path => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')
const css = read('styles/admin-page-polish.css')
const sheet = postcss.parse(css)

test('Admin polish remains isolated, including the existing teleported dialogs', () => {
  sheet.walkRules(rule => {
    assert.ok(rule.selector.startsWith('.admin-shell.admin-shell.admin-shell ') ||
      rule.selector.startsWith(':is(.admin-shell.admin-shell.admin-shell, body:has(.admin-shell) .staff-dialog-mask.'), rule.selector)
  })
  assert.match(read('components/AdminPageShell.vue'), /import '..\/styles\/admin-page-polish.css'/)
  assert.doesNotMatch(css, /!important|display:\s*none|overflow-x:\s*hidden/)
})

function luminance(hex) {
  const rgb = hex.match(/[\da-f]{2}/gi).map(part => parseInt(part, 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (values[0] + .05) / (values[1] + .05)
}

test('supporting text meets AA on Admin cream, white and unread surfaces', () => {
  for (const ink of ['#53695e', '#426b56']) {
    assert.ok(css.includes(ink))
    for (const surface of ['#ffffff', '#f4f7f3', '#edf4ef', '#f0f7f2']) {
      assert.ok(contrast(ink, surface) >= 4.5, `${ink} on ${surface}`)
    }
  }
  assert.ok(contrast('#bfd7cd', '#173f35') >= 4.5)
})

test('responsive Admin rules retain readable type, focus and contained modal scrolling', () => {
  assert.match(css, /@media \(max-width: 1279px\)/)
  assert.match(css, /@media \(max-width: 899px\)/)
  assert.match(css, /@media \(max-width: 599px\)/)
  assert.match(css, /min-height: 44px/)
  assert.match(css, /:focus-visible\s*\{\s*outline: 3px solid #245443/)
  assert.match(css, /max-height: calc\(100dvh - 32px\);\s*overflow-y: auto/)
  // Existing scale/table behavior is preserved; no compressed table type.
  assert.doesNotMatch(css, /table[^{}]*\{[^}]*font-size/)
  assert.match(read('styles/admin-typography.css'), /--admin-title: 1\.75rem/)
  assert.match(read('styles/admin-typography.css'), /font-size: 1\.875rem/)
})

test('all routed Admin page templates still compile with existing interactions', () => {
  for (const name of ['AdminDashboardView', 'AdminUserManagementView', 'AdminModuleView', 'AdminOperationsView', 'AdminProfileView']) {
    const { descriptor } = parse(read(`views/${name}.vue`))
    const script = compileScript(descriptor, { id: name })
    const result = compileTemplate({ source: descriptor.template.content, filename: name + '.vue', id: name,
      compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(result.errors, [], name)
    assert.match(descriptor.template.content, /AdminPageShell/)
  }
  for (const lang of ['en', 'ms', 'zh-CN']) {
    const locale = JSON.parse(read(`locales/${lang}.json`))
    assert.ok(locale.dashboardNav && locale.adminRoles && locale.adminModules, lang)
  }
})
