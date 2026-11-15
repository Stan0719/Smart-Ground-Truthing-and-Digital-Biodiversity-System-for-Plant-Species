import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { baseParse } from '@vue/compiler-dom'
import postcss from 'postcss'

const read = path => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')
const css = read('styles/officer-data-tables.css'), sheet = postcss.parse(css)
const rules = []; sheet.walkRules(rule => rules.push(rule))
const values = rule => Object.fromEntries(rule.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]))
const find = (selector, prop) => rules.find(rule => rule.selector.endsWith(selector) && values(rule)[prop] !== undefined)
const elements = (root, tag) => {
  const all = []
  const walk = node => { if (node.type === 1 && (!tag || node.tag === tag)) all.push(node); (node.children || []).forEach(walk) }
  walk(root); return all
}
const attr = (node, name) => node.props.find(prop => prop.type === 6 && prop.name === name)?.value?.content
const binding = (node, name) => node.props.find(prop => prop.type === 7 && prop.arg?.content === name)?.exp?.content
const text = node => node.children.map(child => child.type === 2 ? child.content : child.type === 5 ? child.content.content : '').join('').trim()
const expected = {
  IoTMonitoringView: [
    ['iot-device-table', ['Sensor ID', 'Device Name', 'Device Type', 'Serial Number', 'Related Plant', 'Location Description', 'Status', 'Installed At', 'Latest Reading', 'Actions']],
    ['iot-reading-table', ['Reading ID', 'Sensor ID', 'Plant ID', 'Temperature', 'Humidity', 'Soil Raw (ADC)', 'Soil Condition', 'Rain Raw (ADC)', 'Surface Condition', 'Motion', 'GPS', 'Recorded At', 'Actions']],
    ['iot-history-table', ['Reading ID', 'Recorded Time', 'Related Plant', 'Temperature', 'Humidity', 'Soil Raw (ADC)', 'Soil Condition', 'Rain Raw (ADC)', 'Surface Condition', 'Motion', 'GPS']],
  ],
  ThreatAlertsView: [
    ['camera-event-table', ['Event ID', 'Event Type', 'Plant ID', 'Camera ID', 'Detection Confidence', 'Status', 'Detected At', 'Recording', 'Actions']],
    ['threat-alert-table', ['Alert ID', 'Alert Type', 'Plant ID', 'Species', 'Reading Reference', 'Device', 'Detection Confidence', 'Severity', 'Status', 'Detected At', 'Actions']],
  ],
  ReportsView: [['report-summary-table', ['scientificName', 'commonName', 'approvedPlants']]],
}

for (const [page, definitions] of Object.entries(expected)) test(`${page}: every existing table opts in with unchanged headers/order and matching columns/body cells`, () => {
  const { descriptor } = parse(read(`views/conservation/${page}.vue`))
  const ast = baseParse(descriptor.template.content)
  const tables = elements(ast, 'table')
  assert.equal(tables.length, definitions.length)
  assert.ok(descriptor.styles.some(style => style.src === '../../styles/officer-data-tables.css'))
  for (const [index, [variant, headers]] of definitions.entries()) {
    const table = tables[index]
    assert.equal(attr(table, 'class'), `officer-data-table ${variant}`)
    const actualHeaders = elements(table, 'th')
    assert.deepEqual(actualHeaders.map(node => text(node).replace(/^(?:ct|rt)\('([^']+)'\)$/, '$1')), headers)
    assert.ok(actualHeaders.every(node => attr(node, 'scope') === 'col'))
    assert.equal(elements(table, 'col').length, headers.length)
    const row = elements(table, 'tr').find(node => node.props.some(prop => prop.type === 7 && prop.name === 'for'))
    assert.ok(row)
    assert.equal(elements(row, 'td').length, headers.length)
    assert.ok(binding(row, 'key'), 'original stable row key remains')
    const scroll = elements(ast, 'div').find(node => attr(node, 'class')?.includes('officer-table-scroll') && elements(node, 'table').includes(table))
    assert.ok(scroll)
    assert.equal(attr(scroll, 'role'), 'region'); assert.equal(attr(scroll, 'tabindex'), '0')
    assert.ok(binding(scroll, 'aria-label'))
    assert.ok(find(` .${variant}`, 'min-width'))
  }
  const script = compileScript(descriptor, { id: page })
  assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename: `${page}.vue`, id: page, compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
})

test('six opt-in tables use the established green/white header, continuous spacing and readable centered text', () => {
  const header = values(find(' .officer-data-table th', 'background'))
  assert.equal(header.background, '#245443'); assert.equal(header.color, '#fff')
  assert.equal(header['font-size'], 'var(--officer-small, .75rem)')
  assert.equal(header['font-weight'], '700'); assert.equal(header['text-transform'], 'uppercase')
  const cells = values(find(' .officer-data-table :is(th, td)', 'padding'))
  assert.equal(cells.padding, '12px 14px'); assert.equal(cells['vertical-align'], 'middle'); assert.equal(cells['line-height'], '1.5')
  const table = values(find(' .officer-data-table', 'border-collapse'))
  assert.equal(table['border-collapse'], 'separate'); assert.equal(table['border-spacing'], '0')
  const body = values(find(' .officer-data-table td', 'font-size'))
  assert.equal(body['font-size'], 'var(--officer-text, .875rem)')
  assert.equal(body['overflow-wrap'], 'normal'); assert.equal(body['word-break'], 'normal')
  assert.doesNotMatch(css, /word-break: break-all|text-overflow: ellipsis|overflow: hidden/)
})

test('intrinsic widths preserve full identifiers/timestamps, natural descriptions, single-line actions and scroll containment', () => {
  const scroll = values(find(' .officer-table-scroll', 'overflow-x'))
  assert.equal(scroll['max-width'], '100%'); assert.equal(scroll['min-width'], '0'); assert.equal(scroll['overflow-x'], 'auto')
  assert.ok(find(' .officer-data-table .column-id', 'width'))
  assert.ok(find(' .officer-data-table .column-description', 'width'))
  assert.notEqual(values(find(' .officer-data-table .column-id', 'width')).width, values(find(' .officer-data-table .column-plant', 'width')).width)
  assert.equal(values(find(' .officer-data-table .column-actions', 'width')).width, '1%')
  const actions = values(find(' .officer-data-table .action-group', 'display'))
  assert.equal(actions.display, 'flex'); assert.equal(actions['align-items'], 'center'); assert.equal(actions['flex-wrap'], 'nowrap'); assert.equal(actions.gap, '7px')
  assert.equal(values(find(' .officer-data-table :is(.badge, .action-button)', 'white-space'))['white-space'], 'nowrap')
  assert.ok(rules.some(rule => rule.selector.includes('.iot-device-table td:nth-child(1)') && values(rule)['white-space'] === 'nowrap'))
  assert.ok(find(' .officer-table-scroll:focus-visible', 'outline'))
  assert.equal(values(find(' .report-summary-table', 'min-width'))['min-width'], '48rem')
})

test('header styling is isolated from cards/charts/other roles and leaves status/severity palettes unchanged', () => {
  for (const rule of rules) {
    assert.ok(rule.selector.startsWith('.officer-layout'), rule.selector)
    assert.ok(rule.selector.includes('.officer-table-scroll'), rule.selector)
    assert.ok(rule.selector.includes('.officer-data-table') || /-(?:device|reading|history|event|alert|summary)-table/.test(rule.selector) || rule.selector.includes('officer-table-scroll'), rule.selector)
    const properties = values(rule)
    if (properties.background || properties.color) assert.ok(rule.selector.endsWith(' .officer-data-table th'))
    assert.ok(!properties['font-family'])
  }
  const alerts = read('views/conservation/ThreatAlertsView.vue')
  assert.match(alerts, /class="badge unavailable"/)
  assert.match(alerts, /:class="alert.status\?\.toLowerCase\(\)"/)
  assert.match(alerts, /@click="openAlert\(alert\)"/)
  const iot = read('views/conservation/IoTMonitoringView.vue')
  assert.match(iot, /motion_detected \? 'high' : 'approved'/)
  assert.match(iot, /valueOrDash\(item.reading.temperature_c, ' °C'\)/)
  const reports = read('views/conservation/ReportsView.vue')
  assert.match(reports, /@click="exportPdf"/); assert.match(reports, /@click="exportCsv"/)
  for (const page of ['ObservationsView', 'ReviewSubmissionsView', 'PlantSpeciesView', 'BiodiversityMapView']) assert.ok(!read(`views/conservation/${page}.vue`).includes('officer-data-tables.css'))
})
