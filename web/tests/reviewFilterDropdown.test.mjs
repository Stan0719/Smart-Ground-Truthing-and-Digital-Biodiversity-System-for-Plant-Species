import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { parse, compileScript, compileTemplate, compileStyle } from '@vue/compiler-sfc'

const filename = new URL('../src/components/conservation/ReviewFilterDropdown.vue', import.meta.url)
const { descriptor } = parse(readFileSync(filename, 'utf8'))
const script = compileScript(descriptor, { id: 'review-filter-test' })
const template = compileTemplate({ source: descriptor.template.content, filename: filename.pathname,
  id: 'review-filter-test', compilerOptions: { bindingMetadata: script.bindings } })
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const nodes = root => {
  const result = []
  function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk)
    if (!node || typeof node !== 'object') return
    result.push(node)
    if (Array.isArray(node.children)) walk(node.children)
  }
  walk(root); return result
}
const options = [
  { value: '', label: 'All Types' }, { value: 'initial_registration', label: 'Original Registration' },
  { value: 'linked_species_request', label: 'New Species Request' },
  { value: 'approved_plant_change', label: 'Plant Edit' }, { value: 'approved_species_change', label: 'Species Edit' },
]

function harness(overrides = {}, viewport = { width: 1280, height: 800 }, rect = { left: 40, top: 100, width: 240, bottom: 144 }) {
  const props = vue.reactive({ id: 'fixture-filter', labelledBy: 'fixture-label', modelValue: '', options, ...overrides })
  const mounted = [], cleanup = [], emitted = [], listeners = new Map(), windowListeners = new Map()
  const events = map => ({
    addEventListener(type, fn) { if (!map.has(type)) map.set(type, new Set()); map.get(type).add(fn) },
    removeEventListener(type, fn) { map.get(type)?.delete(fn) },
  })
  const document = events(listeners)
  const window = { innerWidth: viewport.width, innerHeight: viewport.height, ...events(windowListeners) }
  const exports = {}, scope = vue.effectScope()
  const context = { exports, document, window, setTimeout, clearTimeout, require: () => ({ ...vue,
    onMounted: fn => mounted.push(fn), onBeforeUnmount: fn => cleanup.push(fn) }) }
  vm.runInNewContext(`(function(){${compile(script.content)}})()`, context)
  const state = scope.run(() => exports.default.setup(props, { expose() {}, emit(name, value) {
    assert.equal(name, 'update:modelValue'); emitted.push(value); props.modelValue = value
  } }))
  vm.runInNewContext(`(function(){${compile(template.code)}})()`, context)
  let focused = 0, scrolled = 0
  const trigger = { closest: () => null, getBoundingClientRect: () => rect, contains: target => target === trigger, focus: () => focused++ }
  const menu = { scrollHeight: 222, contains: target => target === menu,
    children: Array.from({ length: 100 }, () => ({ scrollIntoView() { scrolled++ } })) }
  state.trigger.value = trigger; state.menu.value = menu
  mounted.forEach(fn => fn())
  const render = () => nodes(exports.render({}, [], props, vue.proxyRefs(state), {}, {}))
  const button = () => render().find(node => node.props?.role === 'combobox')
  const key = async value => {
    const event = { key: value, preventDefault() { this.prevented = true }, stopPropagation() { this.stopped = true } }
    button().props.onKeydown(event); await vue.nextTick(); await vue.nextTick(); return event
  }
  return { props, state, emitted, render, button, key, trigger, menu,
    get focused() { return focused }, get scrolled() { return scrolled },
    dispatch(type, target) { listeners.get(type)?.forEach(fn => fn({ target })) },
    stop() { cleanup.forEach(fn => fn()); scope.stop(); assert.ok([...listeners.values(), ...windowListeners.values()].every(set => set.size === 0)) },
  }
}

test('combobox exposes its label/value, opens, selects the original value and restores trigger focus', async () => {
  const h = harness()
  try {
    assert.equal(h.button().props['aria-labelledby'], 'fixture-label fixture-filter-value')
    assert.equal(h.button().props['aria-expanded'], false)
    h.button().props.onClick(); await vue.nextTick()
    assert.equal(h.button().props['aria-expanded'], true)
    const menu = h.render().find(node => node.props?.role === 'listbox')
    assert.equal(menu.props.id, h.button().props['aria-controls'])
    const items = h.render().filter(node => node.props?.role === 'option')
    assert.equal(items.length, 5)
    assert.equal(items[0].props['aria-selected'], true)
    assert.ok(items[0].props.class.includes('is-selected'))
    items[3].props.onClick()
    assert.equal(h.props.modelValue, 'approved_plant_change')
    assert.deepEqual(h.emitted, ['approved_plant_change'])
    assert.equal(h.button().props['aria-expanded'], false)
    assert.equal(h.focused, 1)
    assert.ok(h.render().some(node => node.props?.id === 'fixture-filter-value' && node.children === 'Plant Edit'))
    h.button().props.onClick(); await vue.nextTick(); h.button().props.onClick()
    assert.equal(h.state.expanded.value, false)
  } finally { h.stop() }
})

test('arrows, Home/End, Enter/Space and typeahead work without mouse interaction', async () => {
  const h = harness()
  try {
    await h.key('ArrowDown'); await h.key('ArrowDown')
    assert.equal(h.button().props['aria-activedescendant'], 'fixture-filter-option-1')
    await h.key('Enter'); assert.equal(h.props.modelValue, 'initial_registration')
    await h.key(' '); await h.key('End'); await h.key('ArrowUp'); await h.key(' ')
    assert.equal(h.props.modelValue, 'approved_plant_change')
    await h.key('Home'); assert.equal(h.state.active.value, 0)
    await h.key('End'); await h.key('Enter'); assert.equal(h.props.modelValue, 'approved_species_change')
    await h.key('p'); await h.key('l'); await h.key('Enter')
    assert.equal(h.props.modelValue, 'approved_plant_change')
    assert.ok(h.scrolled > 0)
  } finally { h.stop() }
})

test('Escape, Tab, outside pointer and focus close safely without changing the selected filter', async () => {
  const h = harness()
  try {
    await h.key('Enter')
    const escape = await h.key('Escape')
    assert.equal(escape.prevented, true); assert.equal(h.state.expanded.value, false)
    await h.key('Enter'); const tab = await h.key('Tab')
    assert.equal(tab.prevented, undefined); assert.equal(h.state.expanded.value, false)
    await h.key('Enter'); h.dispatch('pointerdown', h.menu)
    assert.equal(h.state.expanded.value, true)
    h.dispatch('pointerdown', {}); assert.equal(h.state.expanded.value, false)
    await h.key('Enter'); h.dispatch('focusin', {}); assert.equal(h.state.expanded.value, false)
    assert.deepEqual(h.emitted, [])
  } finally { h.stop() }
})

test('dynamic options, external Clear Filters and language changes refresh the displayed value', async () => {
  const h = harness({ modelValue: '6', options: [{ value: '', label: 'All species' }, { value: '6', label: 'Species six' }] })
  try {
    assert.ok(h.render().some(node => node.children === 'Species six'))
    await h.key('Enter')
    h.props.options = [{ value: '', label: 'All species' }, { value: '6', label: 'Species six' }, { value: '8', label: 'Newly loaded species' }]
    await vue.nextTick()
    assert.equal(h.render().filter(node => node.props?.role === 'option').length, 3)
    h.props.modelValue = ''; await vue.nextTick()
    assert.equal(h.state.active.value, 0)
    for (const label of ['Semua spesies', '\u6240\u6709\u7269\u79cd']) {
      h.props.options = [{ value: '', label }, { value: '6', label: 'Species six' }]
      await vue.nextTick()
      assert.ok(h.render().some(node => node.props?.id === 'fixture-filter-value' && node.children === label))
    }
  } finally { h.stop() }
})

test('fixed overlay stays inside narrow viewports and opens upward near the viewport bottom', async () => {
  for (const width of [320, 375, 390, 768, 1280]) {
    const rect = { left: width - 200, top: 600, bottom: 644, width: 240 }
    const h = harness({}, { width, height: 680 }, rect)
    try {
      await h.key('Enter')
      const style = h.state.menuStyle.value
      assert.ok(parseFloat(style.top) < rect.top)
      assert.ok(parseFloat(style.left) >= 8)
      assert.ok(parseFloat(style.left) + parseFloat(style.width) <= width - 8)
      assert.ok(parseFloat(style.maxHeight) <= 320)
      assert.ok(h.render().some(node => node.type === vue.Teleport && node.props.to === 'body'))
    } finally { h.stop() }
  }
})

test('styles are scoped, use sage selection and scroll internally without changing native controls', () => {
  assert.deepEqual(template.errors, [])
  assert.deepEqual(compileStyle({ source: descriptor.styles[0].content, id: 'review-filter-test', scoped: true }).errors, [])
  const css = descriptor.styles[0].content
  assert.match(css, /position: fixed; z-index: 1100/)
  assert.match(css, /overflow-y: auto/)
  assert.match(css, /\.review-filter-option.is-selected \{ background: #d3e2d5/)
  assert.match(css, /:focus-visible/)
  assert.match(css, /prefers-reduced-motion/)
  assert.match(css, /\.review-filter-value \{ font: inherit; color: inherit; text-transform: none; letter-spacing: normal/)
  assert.match(css, /\.review-filter-option \+ \.review-filter-option \{ margin-top: 4px/)
  assert.match(css, /\.review-filter-option.is-selected \{[^}]*font-weight: 400/)
  assert.doesNotMatch(css, /(?:^|\n)(?:select|input|button)\s*\{/)
})


test('disabled controls and options remain unavailable and keyboard navigation skips disabled choices', async () => {
  const h = harness({ options: [
    { value: '', label: 'Choose one', disabled: true },
    { value: 'first', label: 'First enabled option' },
    { value: 'blocked', label: 'Unavailable', disabled: true },
    { value: 'last', label: 'Last enabled option' },
  ] })
  try {
    await h.key('Enter')
    assert.equal(h.state.active.value, 1)
    const disabled = h.render().find(n => n.props?.id === 'fixture-filter-option-0')
    assert.equal(disabled.props['aria-disabled'], true)
    disabled.props.onClick(); assert.equal(h.emitted.length, 0)
    await h.key('ArrowDown'); assert.equal(h.state.active.value, 3)
    await h.key('Enter'); assert.equal(h.props.modelValue, 'last')
    await h.key('Enter'); h.props.disabled = true; await vue.nextTick()
    assert.equal(h.state.expanded.value, false)
    assert.equal(h.button().props.disabled, true)
    await h.key('Enter'); assert.equal(h.state.expanded.value, false)
  } finally { h.stop() }
})
