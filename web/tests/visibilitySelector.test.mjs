import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { parse, compileScript, compileTemplate, compileStyle } from '@vue/compiler-sfc'
const source = readFileSync(new URL('../src/components/conservation/VisibilitySelector.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source), script = compileScript(descriptor, { id: 'visibility-test' })
const template = compileTemplate({ source: descriptor.template.content, filename: 'VisibilitySelector.vue', id: 'visibility-test', compilerOptions: { bindingMetadata: script.bindings } })
const js = value => ts.transpileModule(value, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const nodes = root => { const out = []; function walk(n) { if (Array.isArray(n)) return n.forEach(walk); if (!n || typeof n !== 'object') return; out.push(n); if (Array.isArray(n.children)) walk(n.children) } walk(root); return out }
test('native radio cards preserve raw values, explicit empty state, selection, descriptions and disabled/error access', () => {
  const props = vue.reactive({ id: 'fixture-visibility', modelValue: '', required: true, disabled: false, invalid: false, validationField: 'visibility' })
  const exports = {}, values = [], context = { exports, require: () => vue }
  vm.runInNewContext(`(function(){${js(script.content)}})()`, context)
  const state = exports.default.setup(props, { expose() {}, emit(name, value) { assert.equal(name, 'update:modelValue'); values.push(value); props.modelValue = value } })
  vm.runInNewContext(`(function(){${js(template.code)}})()`, context)
  const render = () => nodes(exports.render({}, [], props, vue.proxyRefs(state), {}, {}))
  const inputs = () => render().filter(n => n.type === 'input')
  assert.deepEqual(inputs().map(n => n.props.value), ['public', 'internal', 'protected'])
  assert.ok(inputs().every(n => n.props.type === 'radio' && n.props.name === props.id && n.props.required && !n.props.checked))
  for (const value of ['public', 'internal', 'protected']) {
    inputs().find(n => n.props.value === value).props.onChange()
    assert.deepEqual(inputs().filter(n => n.props.checked).map(n => n.props.value), [value])
    assert.equal(render().filter(n => n.props?.class === 'visibility-check').length, 1)
  }
  assert.deepEqual(values, ['public', 'internal', 'protected'])
  props.disabled = true; props.invalid = true; props.error = 'Select a valid visibility.'
  assert.ok(inputs().every(n => n.props.disabled && n.props['aria-invalid']))
  assert.ok(inputs().every(n => n.props['aria-describedby'].includes('fixture-visibility-error')))
  assert.ok(render().some(n => n.props?.id === 'fixture-visibility-error' && n.children === props.error))
  assert.ok(render().some(n => n.type === 'legend'))
  assert.deepEqual(render().filter(n => n.props?.['data-icon']).map(n => n.props['data-icon']), ['globe', 'users', 'lock-keyhole'])
})
test('selector layout uses scoped responsive cards and a full-width horizontal create row', () => {
  const css = descriptor.styles[0].content
  assert.match(css, /visibility-selector-horizontal \{ grid-column: 1 \/ -1/)
  assert.match(css, /visibility-options \{[^}]*repeat\(3, minmax\(0, 1fr\)\)/)
  assert.match(css, /:focus-within \{ outline:/)
  assert.match(css, /@media \(max-width: 620px\)/)
  assert.deepEqual(compileStyle({ source: css, id: 'data-v-visibility-test', scoped: true }).errors, [])
})
