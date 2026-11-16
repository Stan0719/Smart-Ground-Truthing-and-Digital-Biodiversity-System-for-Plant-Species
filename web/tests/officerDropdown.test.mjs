import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'

const sourceCode = readFileSync(new URL('../src/components/conservation/officerDropdown.ts', import.meta.url), 'utf8')
const compile = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const flush = async () => { await vue.nextTick(); await vue.nextTick() }
function harness({ plainLabel = false, multiple = false } = {}) {
  let root, observer, mounted = 0, unmounted = 0, focusCount = 0, handlerCalls = 0, model = 6
  const events = [], listeners = new Map(), formListeners = new Map()
  const attributes = new Map([['style', 'color:red'], ['title', 'Existing tooltip'], ['aria-invalid', 'false'], ['data-validation-field', 'speciesId']])
  const labelSpan = { id: '', removeAttribute() { this.id = '' } }
  const host = { style: {}, remove() { this.removed = true } }
  const options = [{ value: '6', label: 'Species six', _value: 6, disabled: false, title: '' },
    { value: '8', label: 'Species eight', _value: 8, disabled: false, title: 'Full species name' },
    { value: '', label: 'Choose species', disabled: true, title: '' }]
  const label = { querySelector: () => plainLabel ? null : labelSpan, childNodes: [{ nodeType: 3, textContent: 'Existing label' }, { nodeType: 1 }] }
  const source = {
    value: '6', disabled: false, required: true, multiple, size: 0, options, style: { cssText: 'color:red' }, labels: [label],
    ownerDocument: { createElement: () => host },
    getAttribute: name => attributes.get(name) ?? null,
    setAttribute(name, value) { attributes.set(name, value) }, removeAttribute: name => attributes.delete(name),
    before(node) { this.host = node },
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name),
    form: { addEventListener: (name, fn) => formListeners.set(name, fn), removeEventListener: name => formListeners.delete(name) },
    dispatchEvent(event) {
      events.push(event.type)
      if (event.type === 'change') { model = options.find(option => option.value === source.value)?._value; handlerCalls++ }
    },
  }
  const exports = {}, context = { exports, Event, MutationObserver: class {
    constructor(callback) { this.callback = callback; observer = this }
    observe() {} disconnect() { this.disconnected = true }
  }, require(name) {
    if (name === 'vue') return { ...vue, createApp(component) {
      root = component
      return { mount() { mounted++; root.render().props.ref.value = { focus() { focusCount++ } } }, unmount() { unmounted++ } }
    } }
    if (name.endsWith('.vue')) return { default: {} }
    throw Error(name)
  } }
  vm.runInNewContext(compile(sourceCode), context)
  const directive = exports.vOfficerDropdown
  directive.mounted(source)
  return { source, options, directive, host, events, attributes, labelSpan, listeners, formListeners,
    props: () => root.render().props,
    observe: async () => { observer.callback(); await flush() },
    get model() { return model }, get handlerCalls() { return handlerCalls }, get focusCount() { return focusCount }, get mounted() { return mounted },
    stop() { directive.beforeUnmount(source); if (mounted) { assert.equal(unmounted, 1); assert.equal(observer.disconnected, true); assert.equal(listeners.size, 0); assert.equal(formListeners.size, 0) } },
  }
}

test('visual selection preserves native numeric option values and invokes existing input/change behavior once', async () => {
  const h = harness()
  try {
    assert.equal(h.props().modelValue, '6')
    assert.equal(h.props().labelledBy, h.labelSpan.id)
    assert.equal(h.props()['data-validation-field'], 'speciesId')
    assert.equal(h.props()['aria-required'], 'true')
    assert.equal(h.props().title, 'Existing tooltip')
    assert.equal(h.attributes.get('aria-hidden'), 'true')
    h.props()['onUpdate:modelValue']('8'); await flush()
    assert.equal(h.source.value, '8'); assert.equal(h.model, 8)
    assert.equal(h.handlerCalls, 1)
    assert.deepEqual(h.events, ['input', 'change'])
    assert.equal(h.props().modelValue, '8')
    h.props()['onUpdate:modelValue']('8'); assert.equal(h.handlerCalls, 1, 'reselecting the same option does not cause an extra request')
    h.props()['onUpdate:modelValue'](''); assert.equal(h.source.value, '8', 'disabled placeholders stay unavailable')
    h.source.disabled = true; h.directive.updated(h.source); await flush()
    assert.equal(h.props().disabled, true)
    h.props()['onUpdate:modelValue']('6'); assert.equal(h.source.value, '8')
  } finally { h.stop() }
})

test('external model updates, translated options and validation state refresh without dispatching change', async () => {
  const h = harness()
  try {
    h.source.value = '8'; h.directive.updated(h.source); await flush()
    assert.equal(h.props().modelValue, '8')
    h.options[1].label = 'Translated species label'
    h.options.push({ value: '12', label: 'Newly loaded species', disabled: false, title: '' })
    h.source.setAttribute('aria-invalid', 'true'); h.source.setAttribute('aria-describedby', 'existing-validation-error')
    await h.observe()
    assert.equal(h.props().options[1].label, 'Translated species label')
    assert.equal(h.props().options.length, 4)
    assert.equal(h.props()['aria-invalid'], 'true')
    assert.equal(h.props()['aria-describedby'], 'existing-validation-error')
    assert.deepEqual(h.events, [])
    h.listeners.get('focus')(); assert.equal(h.focusCount, 1, 'existing validation focus reaches the visible control')
    const labelClick = new Event('click', { cancelable: true }); h.listeners.get('click')(labelClick)
    assert.equal(labelClick.defaultPrevented, true, 'an explicit label never opens the hidden native popup')
    assert.equal(h.focusCount, 2)
    h.formListeners.get('reset')(); h.source.value = '6'; await flush()
    assert.equal(h.props().modelValue, '6')
  } finally { h.stop() }
  assert.equal(h.attributes.get('style'), 'color:red')
  assert.equal(h.attributes.has('aria-hidden'), false)
  assert.equal(h.host.removed, true)
  assert.equal(h.labelSpan.id, '')
})

test('plain labels remain unchanged and unsupported multi-selects retain native behavior', () => {
  const plain = harness({ plainLabel: true })
  try { assert.equal(plain.props().label, 'Existing label'); assert.equal(plain.props().labelledBy, undefined) } finally { plain.stop() }
  const multiple = harness({ multiple: true })
  try { assert.equal(multiple.mounted, 0); assert.equal(multiple.attributes.has('aria-hidden'), false) } finally { multiple.stop() }
})

test('every select on the routed Officer pages opts into the design without altering option content', () => {
  for (const file of ['BiodiversityMapView', 'IoTMonitoringView', 'ObservationsView', 'PlantSpeciesView', 'ReportsView', 'ThreatAlertsView']) {
    const content = readFileSync(new URL(`../src/views/conservation/${file}.vue`, import.meta.url), 'utf8')
    const selects = content.match(/<select\b[^>]*>/g) || []
    assert.ok(selects.length, file)
    assert.ok(selects.every(select => select.includes('v-officer-dropdown')), file)
  }
})
