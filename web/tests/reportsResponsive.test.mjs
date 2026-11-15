import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import postcss from 'postcss'
const read = path => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')
const paths = ['views/conservation/ReportsView.vue', 'components/conservation/OperationalReport.vue', 'components/conservation/ReportChart.vue', 'components/conservation/OperationalReportChart.vue']
const files = Object.fromEntries(paths.map(path => {
  const source = read(path), { descriptor } = parse(source)
  const sheet = postcss.parse(descriptor.styles.filter(style => !style.src).map(style => style.content).join('\n'))
  const rules = []; sheet.walkRules(rule => rules.push(rule))
  return [path.split('/').at(-1), { source, descriptor, sheet, rules }]
}))
const values = rule => Object.fromEntries(rule.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]))
const find = (file, selector, prop) => files[file].rules.find(rule => rule.selector === selector && (!prop || values(rule)[prop] !== undefined))

test('all four report templates compile and parent/child containment shrinks instead of widening the Officer layout', () => {
  for (const [filename, { descriptor, sheet }] of Object.entries(files)) {
    const script = compileScript(descriptor, { id: filename })
    assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename, id: filename, compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
    sheet.walkDecls(decl => {
      assert.ok(!(decl.prop === 'overflow-x' && decl.value === 'hidden'), 'do not hide page overflow')
      assert.ok(!(decl.prop === 'width' && /\d+(?:px|vw)/.test(decl.value)), 'no fixed-width page/chart children')
    })
  }
  const panel = values(find('ReportsView.vue', '.reports-panel'))
  assert.equal(panel['grid-template-columns'], 'minmax(0, 1fr)')
  assert.equal(panel['min-width'], '0'); assert.equal(panel['max-width'], '100%'); assert.equal(panel['container-type'], 'inline-size')
  const operational = values(find('OperationalReport.vue', '.operational-report'))
  assert.equal(operational['min-width'], '0'); assert.equal(operational['max-width'], '100%'); assert.equal(operational['container-type'], 'inline-size')
})

test('timestamp shares the other card values 24px typography and localized dates can wrap without truncation', () => {
  assert.ok(!files['OperationalReport.vue'].rules.some(rule => rule.selector.endsWith('.latest-stat strong')), 'timestamp must inherit the same card value styling')
  const numeric = values(files['OperationalReport.vue'].rules.find(rule => rule.selector.endsWith('.report-stat .stat-value')))
  assert.equal(parseFloat(numeric['font-size']) * 16, 24)
  const part = values(files['OperationalReport.vue'].rules.find(rule => rule.selector.endsWith('.timestamp-part')))
  assert.equal(part['white-space'], 'normal'); assert.equal(part['max-width'], '100%'); assert.equal(part['overflow-wrap'], 'anywhere')
  assert.ok(files['OperationalReport.vue'].source.includes(':datetime="String(stat.value)"'))
})

test('all summary grids have safe fractional columns, balanced medium layouts and natural card heights', () => {
  for (const filename of ['ReportsView.vue', 'OperationalReport.vue']) {
    const { rules } = files[filename]
    assert.ok(rules.some(rule => /metric/.test(rule.selector) && values(rule)['grid-template-columns'] === 'repeat(3, minmax(0, 1fr))'))
    for (const breakpoint of ['(max-width: 800px)', '(max-width: 520px)']) assert.ok(rules.some(rule => rule.parent.name === 'container' && rule.parent.params === breakpoint && /metric/.test(rule.selector)))
    assert.ok(rules.some(rule => /metric|report-stat/.test(rule.selector) && values(rule).height === 'auto' && values(rule)['min-height'] === '0'))
  }
  const rules = files['OperationalReport.vue'].rules
  assert.ok(rules.some(rule => rule.parent.params === '(min-width: 1250px)' && rule.selector === '.observation-metrics'))
  assert.ok(rules.some(rule => rule.parent.params === '(min-width: 1700px)' && rule.selector === '.iot-metrics'))
})

test('filters use shrinkable aligned controls and custom dates/actions reflow without changing handlers', () => {
  for (const filename of ['ReportsView.vue', 'OperationalReport.vue']) {
    const { rules } = files[filename]
    assert.ok(rules.some(rule => /control-bar|report-filters/.test(rule.selector) && values(rule).display === 'grid'))
    assert.ok(rules.some(rule => rule.selector.includes('control-bar') && values(rule)['grid-template-rows'] === '1fr auto' && values(rule)['min-width'] === '0'))
    assert.ok(rules.some(rule => /select|input/.test(rule.selector) && values(rule)['min-width'] === '0' && values(rule)['max-width'] === '100%' && values(rule)['min-height'] === '2.75rem'))
    assert.ok(rules.some(rule => rule.parent.params === '(max-width: 520px)' && /control-bar|report-filters/.test(rule.selector) && values(rule)['grid-template-columns'] === 'minmax(0, 1fr)'))
  }
  assert.match(files['ReportsView.vue'].source, /'custom-period': pendingPeriod === 'custom'/)
  assert.match(files['ReportsView.vue'].source, /@submit.prevent="applyFilters"/)
  assert.match(files['OperationalReport.vue'].source, /v-model="device" @change="load"/)
  assert.match(files['OperationalReport.vue'].source, /v-model="measurement" @change="load"/)
})

test('both chart canvases stay inside their parent with content-width mobile heights and unchanged datasets', () => {
  for (const [filename, selector] of [['ReportChart.vue', '.chart-canvas'], ['OperationalReportChart.vue', '.operational-chart']]) {
    const { rules, source } = files[filename]
    const container = values(find(filename, selector))
    assert.equal(container['min-width'], '0'); assert.equal(container.width, '100%'); assert.equal(container['max-width'], '100%')
    assert.equal(values(find(filename, selector + ' canvas'))['max-width'], '100%')
    assert.ok(rules.some(rule => rule.parent.name === 'container' && rule.parent.params === '(max-width: 520px)' && values(rule).height === '260px'))
    assert.match(source, /responsive: true/); assert.match(source, /maintainAspectRatio: false/); assert.match(source, /role="img"/)
  }
  assert.match(files['OperationalReportChart.vue'].source, /reportSeries\(c.labels, series.values\)/)
  assert.match(files['ReportChart.vue'].source, /data: props.values/)
})

test('only table wrappers scroll, category minimum widths are appropriate and exports remain keyboard reachable', () => {
  const operational = values(find('OperationalReport.vue', '.operational-scroll'))
  assert.equal(operational['overflow-x'], 'auto'); assert.equal(operational['min-width'], '0'); assert.equal(operational.width, '100%')
  for (const [category, width] of [['observations', '50rem'], ['threats', '48rem'], ['iot', '44rem']]) {
    const rule = files['OperationalReport.vue'].rules.find(rule => rule.selector.includes(`.table-${category} table`))
    assert.equal(values(rule)['min-width'], width)
  }
  const species = files['ReportsView.vue'].rules.find(rule => rule.selector.endsWith('.report-summary-table'))
  assert.equal(values(species)['min-width'], '38rem')
  for (const filename of ['ReportsView.vue', 'OperationalReport.vue']) {
    const { source, rules } = files[filename]
    assert.match(source, /role="region"[^>]*tabindex="0"/)
    assert.ok(rules.some(rule => /actions/.test(rule.selector) && values(rule)['flex-wrap'] === 'wrap'))
    assert.ok(rules.some(rule => /actions > button/.test(rule.selector) && values(rule).flex === '0 0 auto' && values(rule)['white-space'] === 'nowrap'))
  }
})

test('content-width breakpoints cover sidebar changes and zoom without viewport-fixed sizing', () => {
  // A deterministic breakpoint audit, not a browser layout measurement.
  for (const width of [1440, 1280, 1024, 768, 480, 375]) for (const zoom of [1, 1.25, 1.5, 2]) for (const sidebar of [0, 260]) {
    const available = Math.max(1, width / zoom - sidebar - 48)
    let actual
    for (const rule of files['OperationalReport.vue'].rules) {
      if (!rule.selector.split(',').some(selector => ['.operational-metrics', '.iot-metrics'].includes(selector.trim()))) continue
      if (rule.parent.name === 'container') {
        const condition = /\((min|max)-width: (\d+)px\)/.exec(rule.parent.params)
        if (condition && (condition[1] === 'min' ? available < +condition[2] : available > +condition[2])) continue
      }
      if (values(rule)['grid-template-columns']) actual = values(rule)['grid-template-columns']
    }
    const expected = available <= 520 ? 'minmax(0, 1fr)' : `repeat(${available <= 800 ? 2 : available >= 1700 ? 6 : 3}, minmax(0, 1fr))`
    assert.equal(actual, expected, `width=${width}, zoom=${zoom}, sidebar=${sidebar}`)
  }
  for (const { sheet } of Object.values(files)) sheet.walkDecls(decl => assert.ok(!/100vw|calc\([^)]*260px/.test(decl.value), 'use actual content width rather than a fixed sidebar subtraction'))
})
