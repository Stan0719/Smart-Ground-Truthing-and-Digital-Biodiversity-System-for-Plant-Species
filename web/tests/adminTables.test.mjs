import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import postcss from 'postcss'

const read = file => readFileSync(new URL('../src/' + file, import.meta.url), 'utf8')
const css = read('styles/admin-tables.css')
const id = '680be14a-f114-45e8-9d70-0ad66e8459fc'
function identifier(value, writeText) {
  const { descriptor } = parse(read('components/AdminTableIdentifier.vue'))
  const compiled = compileScript(descriptor, { id: 'admin-id' })
  const scope = vue.effectScope(), exports = {}, props = vue.reactive({ value })
  vm.runInNewContext(ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, navigator: { clipboard: { writeText } }, require(name) {
      if (name === 'vue') return { ...vue, onBeforeUnmount() {} }
      if (name.endsWith('.vue')) return {}
      throw Error(name)
    },
  })
  return { props, state: scope.run(() => exports.default.setup(props, { expose() {} })), stop: () => scope.stop() }
}

test('UUID presentation preserves human-readable codes, full originals and staff prefixes', () => {
  for (const [value, expected] of [[id, '680be14a…'], ['staff:' + id, 'staff:680be14a…'], ['PL001', 'PL001'], ['S001', 'S001'], ['A001', 'A001'], [42, '42'], [null, '—']]) {
    const h = identifier(value, async () => {})
    try { assert.equal(h.state.label.value, expected); assert.equal(h.state.raw.value, value == null ? '—' : String(value)) } finally { h.stop() }
  }
})

test('copy waits for success, writes complete IDs, guards duplicates and retains failure feedback', async () => {
  let finish
  const copied = [], h = identifier('staff:' + id, value => { copied.push(value); return new Promise(resolve => { finish = resolve }) })
  try {
    const pending = h.state.copy()
    assert.equal(h.state.feedback.value, null)
    await h.state.copy()
    assert.deepEqual(copied, ['staff:' + id])
    finish(); await pending
    assert.equal(h.state.feedback.value.message, 'Full identifier copied.')
    assert.equal(h.state.feedback.value.variant, 'success')
  } finally { h.stop() }
  const failed = identifier(id, async () => { throw Error('Denied') })
  try { await failed.state.copy(); assert.equal(failed.state.feedback.value.variant, 'error') } finally { failed.stop() }
})

test('identity changes invalidate late clipboard feedback and meaningful codes do not get copy actions', async () => {
  let finish
  const h = identifier(id, () => new Promise(resolve => { finish = resolve }))
  try {
    const pending = h.state.copy()
    h.props.value = 'PL001'; await vue.nextTick()
    finish(); await pending
    assert.equal(h.state.feedback.value, null)
    assert.equal(h.state.abbreviated.value, false)
  } finally { h.stop() }
})

test('only the eight active Administrator tables opt into shared styling and all templates compile', () => {
  const files = ['views/AdminDashboardView.vue', 'views/AdminModuleView.vue', 'views/AdminOperationsView.vue']
  const counts = [2, 5, 1]
  for (const [index, file] of files.entries()) {
    const source = read(file), { descriptor } = parse(source)
    assert.equal((descriptor.template.content.match(/class="admin-data-table /g) || []).length, counts[index], file)
    const script = compileScript(descriptor, { id: 'table-test' })
    assert.equal(compileTemplate({ source: descriptor.template.content, filename: file, id: 'table-test', compilerOptions: { bindingMetadata: script.bindings } }).errors.length, 0)
  }
  assert.doesNotMatch(read('views/AdminUserManagementView.vue'), /admin-data-table|AdminTableIdentifier/)
  assert.match(read('views/AdminModuleView.vue'), /class="admin-data-table admin-permission-table platform-permission-table"/)
  for (const file of ['views/AdminProfileView.vue', 'components/AccountProfile.vue']) assert.doesNotMatch(read(file), /admin-data-table/)
  const sheet = postcss.parse(css)
  sheet.walkRules(rule => assert.ok(rule.selector.startsWith('.admin-shell.admin-shell.admin-shell '), rule.selector))
  assert.match(read('components/AdminPageShell.vue'), /import '..\/styles\/admin-tables.css'/)
})

test('table styles match Account Directory colors, typography, padding, action sizes and contained scrolling', () => {
  assert.match(css, /background: #245443; color: #fff/)
  assert.match(css, /padding: 12px 14px/)
  assert.match(css, /font-size: \.875rem/)
  assert.match(css, /font-size: \.75rem; font-weight: 700/)
  assert.match(css, /height: 32px; min-height: 32px; padding: 2px 11px/)
  assert.match(css, /@media \(max-width: 767px\)[\s\S]*height: 44px; min-height: 44px/)
  assert.match(css, /max-width: 100%; overflow-x: auto/)
  assert.doesNotMatch(css, /\.badge\s*\{[^}]*\b(?:background|color):/)
  assert.match(css, /admin-table-id-copy[^}]*width: 44px; height: 44px/)
  assert.match(css, /admin-table-id-copy:focus-visible/)
  assert.doesNotMatch(css, /admin-table-id-copy:hover/)
})

test('existing row actions, mappings and separate IoT/Sensor routes remain wired', () => {
  const modules = read('views/AdminModuleView.vue'), operations = read('views/AdminOperationsView.vue')
  assert.match(modules, /@click="openSensorDetails\(s\)"/)
  assert.match(modules, /\{\{ formattedTimestamp\(alert.created_at\) \}\}/)
  assert.match(operations, /@click="open\('edit', d\)"/)
  assert.match(operations, /@click="open\('threshold', d\)"/)
  assert.match(operations, /<td>\{\{ date\(d.last_seen\) \}\}<\/td>/)
  assert.match(operations, /v-for="d in filteredDevices" :key="d.id"/)
  assert.match(read('router/index.ts'), /path: '\/admin\/iot'/)
  assert.match(read('router/index.ts'), /path: '\/admin\/sensors'/)
})
