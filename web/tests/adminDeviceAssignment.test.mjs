import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import * as sensorThresholds from '../src/services/sensorThresholds.ts'
const read = p => readFileSync(new URL('../src/' + p, import.meta.url), 'utf8')
const js = s => ts.transpileModule(s, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const plain = x => JSON.parse(JSON.stringify(x))
const messages = JSON.parse(read('locales/en.json')).adminDeviceAssignment
function service(api = async () => { throw Error('Unexpected API') }) {
  const exports = {}
  vm.runInNewContext(js(read('services/deviceAssignment.ts')), { exports, Error, require: () => ({ plantApi: api }) })
  return exports
}
const admin = { id: 'admin', role: 'Administrator', status: 'Active', mustChangePassword: false }
let idSequence = 0
function harness(file, api, { picker = false, user = admin } = {}) {
  const source = read(file), { descriptor } = parse(source), script = compileScript(descriptor, { id: 'assignment-test' })
  const template = compileTemplate({ source: descriptor.template.content, filename: file, id: 'assignment-test', compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  const exports = {}, cleanup = [], mounted = [], events = new Map(), timers = new Map(), scope = vue.effectScope(), policy = service(api)
  const props = vue.reactive({ modelValue: picker ? policy.KEEP_ASSIGNMENT : '', editing: true, disabled: false, device: null })
  let listener, session = { user, pending: false }
  const emitted = []
  let timerSequence = 0
  const context = { exports, Error,
    setTimeout: (fn, delay) => { timers.set(++timerSequence, { fn, delay }); return timerSequence }, clearTimeout: key => timers.delete(key),
    document: { addEventListener: (name, fn) => events.set(name, fn), removeEventListener: name => events.delete(name) }, require(name) {
    if (name === 'vue') return { ...vue, useId: () => `assignment-${++idSequence}`, onMounted: fn => mounted.push(fn), onBeforeUnmount: fn => cleanup.push(fn), withDirectives: n => n, resolveComponent: name => ({ name }) }
    if (name === 'vue-i18n') return { useI18n: () => ({ t: key => messages[key.replace('adminDeviceAssignment.', '')] || key }) }
    if (name === 'vue-router') return { useRoute: () => ({ path: '/admin/sensors' }), useRouter: () => ({ push: async () => {} }) }
    if (name.endsWith('/officerDropdown')) return { vOfficerDropdown: {} }
    if (name.endsWith('/auth')) return { api, logout: async () => {}, sessionSnapshot: () => session, subscribeSession: fn => { listener = fn; return () => { listener = null } } }
    if (name.endsWith('plantApi')) return { plantApi: api }
    if (name.endsWith('deviceAssignment')) return policy
    if (name.endsWith('sensorThresholds')) return sensorThresholds
    if (name.endsWith('.vue')) return { name }
    throw Error(name)
  } }
  vm.runInNewContext(`(function(){${js(script.content)}})()`, context)
  const state = scope.run(() => exports.default.setup(props, { expose() {}, emit: (...values) => emitted.push(values) }))
  vm.runInNewContext(`(function(){${js(template.code)}})()`, context)
  return { state, props, emitted, policy, events, timers, mount: () => mounted.forEach(fn => fn()), render: () => exports.render({}, [], props, vue.proxyRefs(state), {}, {}),
    setSession: next => { session = next; listener?.() }, stop: () => { cleanup.forEach(fn => fn()); scope.stop() } }
}
function nodes(root) {
  const result = []
  const walk = n => { if (Array.isArray(n)) return n.forEach(walk); if (!n || typeof n !== 'object') return; result.push(n); if (Array.isArray(n.children)) walk(n.children); else if (n.children?.default) walk(n.children.default()) }
  walk(root); return result
}
const plant = (id, status = 'Approved') => ({ plant_id: id, rbac_status: status, scientific_name: `Plant ${id}` })
const device = (extra = {}) => ({ id: 'device', name: 'Camera-looking name', status: 'Inactive', thresholds: { temperature: 31 }, last_seen: null, ...extra })

test('Admin edits all metric ranges together and saves them in one request with units and optional zero limits', async () => {
  const calls = [], sensor = device({ device_type: 'Sensor', thresholds: { temperature: 31, humidity: { min: 40, max: 80 }, movement: { max: 0 } } })
  const h = harness('views/AdminOperationsView.vue', async (...args) => {
    calls.push(args)
    return args[0] === '/devices' ? { devices: [sensor] } : args[0] === '/readings' ? { readings: [] } : {}
  })
  try {
    h.state.open('threshold', sensor)
    assert.deepEqual(plain(h.state.metrics), ['temperature', 'humidity', 'soilMoisture', 'movement', 'rainfall'])
    assert.equal(h.state.measurement({ movement: 1 }), 'movement: 1')
    assert.deepEqual(plain(h.state.configuredThresholds({ sound: 50 })), [])
    assert.deepEqual(plain(h.state.configuredThresholds({
      humidity: { min: 40, max: 80 }, rainfall: { min: 2200 }, temperature: { min: 20, max: 40 }, soilMoisture: { min: 2300, max: 2700 }, movement: 0,
    })), [
      { metric: 'temperature', label: 'Temperature', range: '20–40 °C' },
      { metric: 'humidity', label: 'Humidity', range: '40–80 %' },
      { metric: 'soilMoisture', label: 'Soil moisture', range: '2300–2700 raw ADC' },
      { metric: 'rainfall', label: 'Rainfall', range: '≥ 2200 raw ADC' },
    ])
    assert.equal(h.state.measurement({ temperature: 25, sound: 50 }), 'temperature: 25 °C')
    h.state.thresholdRows.value.push({ metric: 'sound', minimum: '', maximum: '50' }); await h.state.saveDevice()
    assert.equal(calls.length, 0)
    h.state.open('threshold', sensor)
    h.state.thresholdRows.value.push({ metric: 'movement', minimum: '', maximum: '0' }); await h.state.saveDevice()
    assert.equal(calls.length, 0)
    h.state.open('threshold', sensor)
    const rows = h.state.thresholdRows.value
    assert.deepEqual(plain(rows.map(row => row.metric)), ['temperature', 'humidity', 'soilMoisture', 'rainfall'])
    assert.deepEqual(plain(rows[0]), { metric: 'temperature', minimum: '', maximum: '31' })
    assert.deepEqual(plain(rows[1]), { metric: 'humidity', minimum: '40', maximum: '80' })
    assert.deepEqual(plain(rows[2]), { metric: 'soilMoisture', minimum: '2300', maximum: '2700' })
    assert.deepEqual(plain(rows[3]), { metric: 'rainfall', minimum: '2200', maximum: '' })
    const tree = nodes(nodes(h.render()).find(n => n.type?.name?.endsWith('StaffDialog.vue')))
    assert.equal(tree.filter(n => n.type === 'fieldset').length, 4)
    assert.equal(tree.filter(n => n.type === 'input' && n.props?.type === 'number').length, 8)
    assert.equal(tree.filter(n => n.props?.role === 'switch').length, 0)
    assert.equal(tree.find(n => n.props?.['aria-label'] === 'Soil moisture minimum (raw ADC)').props.disabled, false)
    assert.ok(!tree.some(n => n.type === 'legend' && n.children === 'Movement'))
    assert.ok(!tree.some(n => n.type === 'select'))
    for (const name of ['Temperature minimum (°C)', 'Humidity maximum (%)', 'Soil moisture minimum (raw ADC)', 'Rainfall maximum (raw ADC)'])
      assert.ok(tree.some(n => n.props?.['aria-label'] === name), name)
    rows[0].minimum = '0'; rows[0].maximum = '35'
    rows[1].minimum = ''; rows[1].maximum = ''
    rows[2].minimum = '100'; rows[2].maximum = ''
    rows[3].minimum = ''; rows[3].maximum = '0'
    await h.state.saveDevice()
    assert.equal(calls.filter(call => call[1] === 'PATCH').length, 1)
    assert.deepEqual(plain(calls.find(call => call[1] === 'PATCH')[2]), { thresholds: {
      temperature: { min: 0, max: 35 }, humidity: null, soilMoisture: { min: 100 }, rainfall: { max: 0 },
    } })
    assert.equal(h.state.modal.value, null)
    h.state.open('threshold', sensor)
    assert.equal(h.state.thresholdRows.value[2].minimum, '2300', 'Opening resets drafts from the selected device')
    h.state.thresholdRows.value[0].maximum = '34'
    h.state.thresholdRows.value[3].minimum = '40'; h.state.thresholdRows.value[3].maximum = '30'
    const count = calls.length; await h.state.saveDevice()
    assert.equal(calls.length, count, 'Validate every metric before sending any changes')
    assert.equal(h.state.modal.value, 'threshold')
    assert.match(h.state.error.value, /^Rainfall:/)
    assert.equal(h.state.thresholdRows.value[0].maximum, '34')
    h.state.thresholdRows.value[3].minimum = ''; h.state.thresholdRows.value[3].maximum = 'not a number'
    await h.state.saveDevice(); assert.equal(calls.length, count)
    h.state.thresholdRows.value[3].maximum = ''
    await h.state.saveDevice()
    assert.equal(calls.filter(call => call[1] === 'PATCH').at(-1)[2].thresholds.rainfall, null, 'Clearing both fields disables alerts')
  } finally { h.stop() }
})

test('sensor cards apply individual or all defaults to drafts and save the ranges together', async () => {
  const calls = [], h = harness('views/AdminOperationsView.vue', async (...args) => {
    calls.push(args)
    return args[0] === '/devices' ? { devices: [] } : args[0] === '/readings' ? { readings: [] } : {}
  })
  try {
    h.state.open('threshold', device({ device_type: 'Sensor', thresholds: { temperature: { min: 26, max: 40 }, humidity: { max: 90 } } }))
    const tree = nodes(h.render())
    const grid = tree.find(n => n.props?.class === 'threshold-grid')
    assert.deepEqual(nodes(grid).filter(n => n.type === 'fieldset').map(n => n.props['aria-label']), ['Temperature', 'Humidity', 'Soil moisture', 'Rainfall'])
    const names = ['temperature', 'humidity', 'soil moisture', 'rainfall']
    for (const [index, name] of names.entries()) {
      const rows = h.state.thresholdRows.value
      for (const row of rows) { row.minimum = '1'; row.maximum = '99' }
      const before = plain(rows)
      const button = tree.find(n => n.props?.['aria-label'] === `Use default ${name} thresholds`)
      assert.equal(button.props.type, 'button')
      button.props.onClick()
      for (const [i, row] of rows.entries()) {
        if (i === index) {
          assert.equal(row.minimum, sensorThresholds.DEFAULT_SENSOR_THRESHOLDS[row.metric].min?.toString() ?? '')
          assert.equal(row.maximum, sensorThresholds.DEFAULT_SENSOR_THRESHOLDS[row.metric].max?.toString() ?? '')
        } else assert.deepEqual(plain(row), before[i], 'Other sensor drafts stay unchanged')
      }
      assert.equal(calls.length, 0)
    }
    h.state.thresholdRows.value[0].minimum = '10'; h.state.error.value = 'Old error'
    const allDefaults = tree.find(n => n.type === 'button' && n.props?.class === 'threshold-reset')
    assert.equal(allDefaults.props.type, 'button')
    assert.ok(nodes(allDefaults).some(n => n.type === 'span' && n.children === 'Use all defaults'))
    allDefaults.props.onClick()
    assert.deepEqual(plain(h.state.thresholdRows.value), [
      { metric: 'temperature', minimum: '26', maximum: '40' },
      { metric: 'humidity', minimum: '40', maximum: '80' },
      { metric: 'soilMoisture', minimum: '2300', maximum: '2700' },
      { metric: 'rainfall', minimum: '2200', maximum: '' },
    ])
    assert.equal(h.state.error.value, '')
    assert.equal(calls.length, 0)
    await h.state.saveDevice()
    assert.deepEqual(plain(calls.find(call => call[1] === 'PATCH')[2]), { thresholds: {
      temperature: { min: 26, max: 40 }, humidity: { min: 40, max: 80 },
      soilMoisture: { min: 2300, max: 2700 }, rainfall: { min: 2200 },
    } })
  } finally { h.stop() }
})

test('failed batch threshold saves retain all drafts and can be retried with one request', async () => {
  let rejectSave = true
  const calls = [], sensor = device({ device_type: 'Sensor' })
  const h = harness('views/AdminOperationsView.vue', async (...args) => {
    calls.push(args)
    if (args[1] === 'PATCH' && rejectSave) throw Error('Save unavailable')
    return args[0] === '/devices' ? { devices: [sensor] } : args[0] === '/readings' ? { readings: [] } : {}
  })
  try {
    h.state.open('threshold', sensor)
    h.state.thresholdRows.value[0].maximum = '35'
    h.state.thresholdRows.value[1].minimum = '25'
    const draft = plain(h.state.thresholdRows.value)
    await h.state.saveDevice()
    assert.equal(h.state.modal.value, 'threshold'); assert.equal(h.state.operationBusy.value, false)
    assert.equal(h.state.error.value, 'Save unavailable')
    assert.deepEqual(plain(h.state.thresholdRows.value), draft)
    assert.equal(calls.length, 1)
    rejectSave = false; await h.state.saveDevice()
    assert.deepEqual(plain(calls[1]), plain(calls[0]))
    assert.equal(h.state.modal.value, null)
  } finally { h.stop() }
})
const key = value => ({ key: value, preventDefault() {}, stopPropagation() {} })

test('one closed selector opens a labelled combobox with no old explanation or standalone search form', async () => {
  const h = harness('components/AdminPlantAssignment.vue', async () => ({ plants: [plant(1)] }), { picker: true })
  try {
    h.props.device = device({ plant_id: 1 }); await h.state.load()
    let tree = nodes(h.render())
    assert.equal(tree.filter(n => n.type === 'button').length, 1)
    assert.ok(!tree.some(n => n.type === 'select' || n.type === 'input'))
    assert.equal(h.state.chosenLabel.value, 'PL001'); assert.equal(h.emitted.length, 0)
    await h.state.open(); tree = nodes(h.render())
    const input = tree.find(n => n.props?.role === 'combobox'), list = tree.find(n => n.props?.role === 'listbox')
    assert.equal(input.props['aria-controls'], list.props.id)
    assert.equal(input.props['aria-label'], messages.searchPlants)
    assert.ok(!tree.some(n => n.children === messages.currentOnly || n.children === messages.find))
    assert.match(read('components/AdminPlantAssignment.vue'), /:focus-visible/)
    h.props.device = device({ plant_id: null }); assert.equal(h.state.chosenLabel.value, messages.unassigned)
    h.props.device = device(); assert.equal(h.state.chosenLabel.value, messages.unavailable)
  } finally { h.stop() }
})

test('name matching and keyboard navigation require explicit selection; Enter never picks the first result', async () => {
  const h = harness('components/AdminPlantAssignment.vue', async () => ({ plants: [plant(1), { ...plant(2), scientific_name: 'Nepenthes rafflesiana' }] }), { picker: true })
  try {
    await h.state.load(); await h.state.open()
    h.state.search.value = 'nepenthes'; await vue.nextTick()
    assert.equal(h.state.options.value.length, 1); assert.equal(h.state.options.value[0].id, '2')
    h.state.searchKey(key('Enter')); assert.equal(h.emitted.length, 0); assert.equal(h.state.isOpen.value, true)
    h.state.searchKey(key('ArrowUp')); assert.equal(h.state.activeIndex.value, h.state.choices.value.length - 1)
    const input = nodes(h.render()).find(n => n.props?.role === 'combobox')
    assert.equal(input.props['aria-activedescendant'], h.state.activeId.value)
    h.state.searchKey(key('Enter')); assert.deepEqual(h.emitted, [['update:modelValue', '2']])
    h.props.modelValue = '2'; assert.equal(h.state.chosenLabel.value, 'PL002'); assert.equal(h.state.isOpen.value, false)
  } finally { h.stop() }
})

test('Escape, outside pointer and focus departure close safely, restore focus appropriately and clean listeners', async () => {
  const h = harness('components/AdminPlantAssignment.vue', async () => ({ plants: [plant(1)] }), { picker: true })
  let focusedSearch = 0, focusedTrigger = 0, stopped = 0
  const inside = {}, outside = {}
  h.state.root.value = { contains: value => value === inside, querySelector: () => null }
  h.state.searchInput.value = { focus: () => focusedSearch++ }; h.state.trigger.value = { focus: () => focusedTrigger++ }
  try {
    h.mount(); await new Promise(setImmediate); await h.state.open()
    assert.equal(focusedSearch, 1)
    h.state.searchKey({ ...key('Escape'), stopPropagation: () => stopped++ })
    assert.equal(stopped, 1); assert.equal(focusedTrigger, 1); assert.equal(h.state.isOpen.value, false)
    await h.state.triggerKey(key('ArrowDown')); assert.equal(h.state.activeIndex.value, 0)
    h.events.get('pointerdown')({ target: inside }); assert.equal(h.state.isOpen.value, true)
    h.events.get('pointerdown')({ target: outside }); assert.equal(h.state.isOpen.value, false); assert.equal(focusedTrigger, 1)
    await h.state.open(); h.state.focusOut({ relatedTarget: outside }); assert.equal(h.state.isOpen.value, false)
    assert.equal(h.emitted.length, 0, 'Closing leaves KEEP_ASSIGNMENT intact')
  } finally { h.stop(); assert.equal(h.events.size, 0); assert.equal(h.timers.size, 0) }
})

test('exact-ID search is debounced inside the dropdown and cancelled on close', async () => {
  const calls = [], h = harness('components/AdminPlantAssignment.vue', async path => {
    calls.push(path); return path === '/plants' ? { plants: [] } : { plant: plant(900) }
  }, { picker: true })
  try {
    await h.state.load(); await h.state.open()
    h.state.search.value = 'PL90'; await vue.nextTick()
    h.state.search.value = 'PL900'; await vue.nextTick()
    assert.equal(h.timers.size, 1)
    const [id, timer] = [...h.timers][0]; assert.equal(timer.delay, 300); h.timers.delete(id); timer.fn()
    await new Promise(setImmediate)
    assert.deepEqual(calls, ['/plants', '/plants/900']); assert.equal(h.emitted.length, 0)
    h.state.search.value = 'PL901'; await vue.nextTick(); assert.equal(h.timers.size, 1)
    h.state.close(); assert.equal(h.timers.size, 0)
  } finally { h.stop() }
})

test('failed or unapproved exact-ID results cannot become options or change the chosen assignment', async () => {
  const h = harness('components/AdminPlantAssignment.vue', async path => path === '/plants' ? { plants: [plant(1), plant(900)] } : { plant: plant(900, 'Pending Review') }, { picker: true })
  try {
    h.props.device = device({ plant_id: 1 }); await h.state.load(); await h.state.open()
    h.state.search.value = 'PL900'; await vue.nextTick()
    const work = h.state.find(); assert.equal(h.state.finding.value, true); assert.equal(h.state.options.value.length, 0)
    await work; assert.equal(h.state.error.value, messages.findFailed); assert.equal(h.state.options.value.length, 0)
    h.state.choose('900'); assert.equal(h.emitted.length, 0); assert.equal(h.state.chosenLabel.value, 'PL001')
    h.state.close(); await h.state.open()
    assert.ok(!h.state.options.value.some(p => p.id === '900'), 'Reopening must not restore an unverified option')
    assert.ok(h.state.choices.value.some(p => p.value === ''))
    h.state.choose(''); assert.deepEqual(h.emitted, [['update:modelValue', '']]); h.props.modelValue = ''
    assert.equal(h.state.chosenLabel.value, messages.unassigned)
  } finally { h.stop() }
})

for (const boundary of ['query', 'close', 'logout', 'unmount']) test(`late exact-ID result is ignored after ${boundary}`, async () => {
  let release
  const h = harness('components/AdminPlantAssignment.vue', async path => path === '/plants' ? { plants: [] } : new Promise(resolve => { release = resolve }), { picker: true })
  try {
    await h.state.load(); await h.state.open(); h.state.search.value = 'PL900'; await vue.nextTick()
    const work = h.state.find()
    if (boundary === 'query') { h.state.search.value = 'Nepenthes'; await vue.nextTick() }
    if (boundary === 'close') h.state.close()
    if (boundary === 'logout') h.setSession({ user: null, pending: false })
    if (boundary === 'unmount') h.stop()
    release({ plant: plant(900) }); await work
    assert.equal(h.state.plants.value.length, 0); assert.equal(h.emitted.length, 0)
  } finally { if (boundary !== 'unmount') h.stop() }
})

test('authoritative types and null versus unavailable assignments never depend on names', () => {
  const s = service()
  assert.equal(s.deviceType(device({ device_type: 'Sensor' })), 'Sensor')
  assert.equal(s.deviceType(device({ device_type: 'Camera' })), 'Camera')
  assert.equal(s.deviceType(device()), 'Unknown')
  assert.equal(s.currentAssignment(device({ plant_id: null })).state, 'notLinked')
  for (const value of [undefined, 0, -1, 'bad', 2147483648]) assert.equal(s.currentAssignment(device({ plant_id: value })).state, 'unavailable')
  assert.equal(s.plantLabel(s.currentAssignment(device({ plant_id: 32 })).id), 'PL032')
  assert.deepEqual(plain(s.assignmentPayload(s.KEEP_ASSIGNMENT, true)), {})
  assert.deepEqual(plain(s.assignmentPayload('', true)), { plant_id: null })
  assert.deepEqual(plain(s.assignmentPayload('2', true)), { plant_id: 2 })
})

test('catalogue caps are disclosed before eligibility filtering; exact ID search reaches outside the batch', async () => {
  const calls = [], s = service(async path => {
    calls.push(path)
    return path === '/plants' ? { plants: Array.from({ length: 500 }, (_, i) => plant(i + 1, i === 0 ? 'Approved' : 'Pending Review')) } : { plant: plant(900) }
  })
  const result = await s.loadAssignmentPlants()
  assert.equal(result.capped, true); assert.equal(result.plants.length, 1)
  assert.equal((await s.findAssignmentPlant('PL900')).id, '900')
  assert.deepEqual(calls, ['/plants', '/plants/900'])
  await assert.rejects(s.findAssignmentPlant('900 OR 1=1'))
  await assert.rejects(service(async () => ({ plant: plant(2, 'Pending Review') })).findAssignmentPlant('2'))
  await assert.rejects(service(async () => ({ plant: plant(3) })).findAssignmentPlant('2'))
  await assert.rejects(service(async () => ({ plants: [{}] })).loadAssignmentPlants())
})

test('picker renders capped and loading/error states, preserves selection, and searches via GET only', async () => {
  let broken = false
  const calls = [], h = harness('components/AdminPlantAssignment.vue', async (path, method) => {
    calls.push([path, method]); if (broken) throw Error('offline')
    return path === '/plants' ? { plants: Array.from({ length: 500 }, (_, i) => plant(i + 1)) } : { plant: plant(900) }
  }, { picker: true })
  try {
    h.props.device = device({ plant_id: 1 }); await h.state.load(); await h.state.open()
    assert.equal(h.state.currentLabel.value, 'PL001')
    assert.ok(nodes(h.render()).some(n => n.children === messages.capped))
    assert.ok(h.state.choices.value.some(p => p.value === ''))
    h.state.search.value = 'PL900'; await vue.nextTick(); await h.state.find()
    assert.equal(h.emitted.length, 0, 'Lookup must never select a Plant implicitly')
    h.state.choose('900')
    assert.deepEqual(h.emitted, [['update:modelValue', '900']])
    assert.equal(h.state.isOpen.value, false)
    h.props.modelValue = '900'; broken = true; await h.state.load()
    assert.equal(h.props.modelValue, '900'); assert.equal(h.state.error.value, messages.loadFailed)
    broken = false; await h.state.load()
    assert.equal(h.state.chosenLabel.value, 'PL900'); assert.equal(h.props.modelValue, '900')
    assert.ok(!h.state.options.value.some(p => p.id === '900'), 'A retained selection label is not a new verified search result')
    assert.ok(calls.every(([, method]) => method === undefined))
  } finally { h.stop() }
})

for (const boundary of ['logout', 'pending', 'unmount']) test(`late picker results cannot cross ${boundary}`, async () => {
  let release
  const h = harness('components/AdminPlantAssignment.vue', () => new Promise(resolve => { release = resolve }), { picker: true })
  const work = h.state.load()
  if (boundary === 'logout') h.setSession({ user: null, pending: false })
  if (boundary === 'pending') h.setSession({ user: admin, pending: true })
  if (boundary === 'unmount') h.stop()
  release({ plants: [plant(1)] }); await work
  assert.equal(h.state.plants.value.length, 0)
  if (boundary !== 'unmount') h.stop()
})

test('non-Admin picker never requests or exposes eligible Plants', async () => {
  const h = harness('components/AdminPlantAssignment.vue', () => assert.fail('unauthorized lookup'), { picker: true, user: { ...admin, role: 'Conservation Officer' } })
  try { await h.state.load(); assert.equal(h.state.authorized.value, false); assert.equal(h.state.plants.value.length, 0) } finally { h.stop() }
})

test('Admin table exposes types and current links; Camera/Unknown thresholds are excluded at UI and handler level', async () => {
  const calls = [], h = harness('views/AdminOperationsView.vue', async (...args) => { calls.push(args); return {} })
  try {
    h.state.devices.value = [device({ id: 's', device_type: 'Sensor', plant_id: 1 }), device({ id: 'c', device_type: 'Camera', plant_id: null }), device({ id: 'u' })]
    const tree = nodes(h.render())
    for (const label of [messages.deviceType, messages.currentPlant, 'Sensor', 'Camera', 'Unknown', 'PL001', 'Not linked', 'Unavailable']) assert.ok(tree.some(n => n.children === label), label)
    const deviceTable = tree.find(n => n.type === 'table' && n.props?.class.includes('sensor-device-table'))
    assert.equal(deviceTable.props.role, 'table')
    const deviceRows = nodes(deviceTable).filter(n => n.type === 'tr' && nodes(n).some(child => child.props?.class === 'sensor-identity-cell'))
    assert.equal(deviceRows.length, 3)
    for (const row of deviceRows) {
      assert.equal(row.props.role, 'row')
      assert.equal(nodes(row).filter(n => n.type === 'td' && n.props?.role === 'cell').length, 7)
      for (const label of ['Status:', `${messages.currentPlant}:`, 'Last report:', 'Thresholds:'])
        assert.ok(nodes(row).some(n => n.props?.class === 'sensor-cell-label' && n.children === label), label)
    }
    assert.equal(tree.filter(n => n.type === 'button' && n.children === 'Configure threshold').length, 1)
    assert.ok(tree.some(n => n.children === messages.cameraRules))
    h.state.open('threshold', h.state.devices.value[1]); assert.equal(h.state.modal.value, null)
    h.state.modal.value = 'threshold'; h.state.selected.value = h.state.devices.value[1]; await h.state.saveDevice()
    assert.equal(calls.length, 0)
    h.state.open('threshold', h.state.devices.value[0]); assert.equal(h.state.modal.value, 'threshold')
  } finally { h.stop() }
})

test('registration/edit failures preserve drafts, status, selection and modal without retrying decisions', async () => {
  const calls = [], h = harness('views/AdminOperationsView.vue', async (...args) => { calls.push(args); throw Error('fixture rejection') })
  try {
    h.state.open('register'); h.state.form.value.name = 'Draft name'; h.state.form.value.plant = '2'; await h.state.saveDevice()
    assert.equal(h.state.modal.value, 'register'); assert.equal(h.state.form.value.name, 'Draft name'); assert.equal(h.state.form.value.plant, '2')
    assert.deepEqual(plain(calls[0]), ['/devices', 'POST', { name: 'Draft name', plant_id: 2 }])
    h.state.open('edit', device({ plant_id: 1 })); await h.state.saveDevice()
    assert.deepEqual(plain(calls[1][2]), { name: 'Camera-looking name', status: 'Inactive' })
    h.state.form.value.plant = ''; await h.state.saveDevice()
    assert.deepEqual(plain(calls[2][2]), { name: 'Camera-looking name', status: 'Inactive', plant_id: null })
    assert.equal(h.state.modal.value, 'edit'); assert.equal(h.state.operationBusy.value, false); assert.equal(calls.length, 3)
  } finally { h.stop() }
})

test('new labels have matching EN/MS/ZH coverage and the genuine picker component is mounted in both forms', () => {
  for (const lang of ['ms', 'zh-CN']) assert.deepEqual(Object.keys(JSON.parse(read(`locales/${lang}.json`)).adminDeviceAssignment).sort(), Object.keys(messages).sort())
  assert.match(read('views/AdminOperationsView.vue'), /<AdminPlantAssignment v-if="modal === 'register' \|\| modal === 'edit'"/)
  assert.match(read('components/AdminPlantAssignment.vue'), /role="alert"/)
})
