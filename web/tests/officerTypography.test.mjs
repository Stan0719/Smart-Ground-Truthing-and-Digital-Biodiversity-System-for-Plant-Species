import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import postcss from 'postcss'
import selectorParser from 'postcss-selector-parser'
import { parse, compileStyle } from '@vue/compiler-sfc'

const read = path => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')
const css = read('styles/officer-typography.css')
const sheet = postcss.parse(css)
const rules = []; sheet.walkRules(rule => rules.push(rule))
const declarations = rule => Object.fromEntries(rule.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]))
const find = (selector, property) => rules.find(rule => rule.selector.includes(selector) && declarations(rule)[property] !== undefined)
const root = declarations(rules[0])

// Compare CSS specificity, including :is/:not/:where, against compiled Vue rules.
const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
function specificity(selector) {
  const sum = (a, b) => a.map((v, index) => v + b[index])
  function score(node) {
    if (node.type === 'id') return [1, 0, 0]
    if (['class', 'attribute'].includes(node.type)) return [0, 1, 0]
    if (node.type === 'tag') return [0, 0, 1]
    if (node.type === 'pseudo') {
      if (node.value === ':where') return [0, 0, 0]
      if ([':is', ':not', ':has'].includes(node.value)) return node.nodes.map(score).sort(compare).at(-1) || [0, 0, 0]
      return node.value.startsWith('::') ? [0, 0, 1] : [0, 1, 0]
    }
    return (node.nodes || []).reduce((total, child) => sum(total, score(child)), [0, 0, 0])
  }
  return selectorParser().astSync(selector).nodes.map(score).sort(compare).at(-1)
}

test('Officer typography is imported only by its layout and every selector requires an explicit Officer boundary', () => {
  assert.match(read('layouts/ConservationOfficerLayout.vue'), /<style src="..\/styles\/officer-typography.css"><\/style>/)
  assert.doesNotMatch(read('main.ts'), /officer-typography/)
  for (const rule of rules) {
    const selectors = selectorParser().astSync(rule.selector).nodes
    for (const selector of selectors) {
      assert.equal(selector.nodes[0].value, ':is')
      assert.deepEqual(selector.nodes[0].nodes.map(branch => branch.nodes.filter(node => node.type === 'class').map(node => node.value)), [Array(3).fill('officer-layout'), Array(3).fill('officer-type-layer')])
    }
  }
  assert.doesNotMatch(rules.map(rule => rule.selector).join('\n'), /:root|\.admin-shell|\.staff-page|\.staff-dialog-mask/)
  sheet.walkDecls(decl => assert.ok(!decl.important))
  // Semantic palettes, borders, icons, animations and focus styles stay owned by existing styles.
  sheet.walkDecls(decl => {
    assert.ok(!/^(?:background|border|outline|animation|transform)/.test(decl.prop), decl.prop)
    if (decl.prop === 'color') assert.equal(decl.value, 'var(--officer-muted)')
  })
})

test('the navigation/router audit covers all nine Officer pages and the teleported drawer opts into only this scope', () => {
  const router = read('router/index.ts'), layout = read('layouts/ConservationOfficerLayout.vue')
  for (const name of ['dashboard', 'profile', 'species', 'observations', 'reviews', 'map', 'iot', 'alerts', 'reports']) assert.ok(router.includes(`name: 'conservation-${name}'`), name)
  for (const name of ['dashboard', 'species', 'observations', 'reviews', 'map', 'iot', 'alerts', 'reports']) assert.ok(layout.includes(`name: 'conservation-${name}'`))
  assert.match(read('components/conservation/PlantSimilarityDrawer.vue'), /<Teleport to="body">\s*<div class="similarity-drawer-layer officer-type-layer">/)
  assert.match(read('components/conservation/AppModal.vue'), /class="modal-card"/)
  assert.doesNotMatch(read('components/conservation/AppModal.vue'), /<Teleport/)
})

test('a rem-based hierarchy gives equivalent Officer page, table, summary, form and modal text consistent sizes', () => {
  assert.equal(root['--officer-title'], '1.75rem')
  assert.equal(root['--officer-section'], '1.25rem')
  assert.equal(root['--officer-card'], '1rem')
  assert.equal(root['--officer-text'], '.875rem')
  assert.equal(root['--officer-label'], '.8125rem')
  assert.equal(root['--officer-small'], '.75rem')
  assert.equal(root['--officer-number'], '1.875rem')
  assert.equal(root['--officer-modal'], '1.5rem')
  for (const [selector, token] of [['table th', 'small'], ['table td', 'text'], ['.summary-card p', 'text'], ['.summary-card strong', 'number'], ['.field > span', 'label'], ['.modal-header h2', 'modal'], ['.page-heading h1', 'title'], ['.grid-heading h3', 'card'], ['.detail-list dd', 'text']]) assert.equal(declarations(find(selector, 'font-size'))['font-size'], `var(--officer-${token})`, selector)
  assert.equal(compileStyle({ source: css, id: 'officer-typography' }).errors.length, 0)
})

test('shared type rules beat the actual small Vue-scoped overrides without editing their functionality', () => {
  for (const [path, original, shared] of [
    ['views/conservation/ObservationsView.vue', '.observations-table th', 'table th'],
    ['views/conservation/ReviewSubmissionsView.vue', '.reviews-table td', 'table td'],
    ['views/conservation/PlantSpeciesView.vue', '.form-grid > .form-field > label', '.form-field > label'],
    ['views/conservation/ConservationProfileView.vue', '.settings-field > span', '.settings-field > span'],
    ['views/conservation/ConservationDashboardView.vue', '.quick-grid strong', '.quick-grid strong'],
    ['views/conservation/ReportsView.vue', '.persistence-note', '.persistence-note'],
    ['views/conservation/BiodiversityMapView.vue', '.coordinate-note', '.coordinate-note'],
    ['components/conservation/SpeciesPhotoManager.vue', '.photo-header h2', '.photo-header h2'],
  ]) {
    const { descriptor } = parse(read(path))
    const compiled = compileStyle({ source: descriptor.styles[0].content, id: 'data-v-type-audit', scoped: true })
    const local = []; postcss.parse(compiled.code).walkRules(rule => { if (rule.selector.includes(original.split(' > ')[0]) && rule.nodes.some(node => node.prop === 'font-size')) local.push(rule) })
    assert.ok(local.length, path)
    const sharedRule = find(shared, 'font-size')
    assert.ok(sharedRule, shared)
    // Specific rules may be grouped: ensure the shared rule outranks the whole original selector.
    const originalSpecificity = specificity(original + '[data-v-type-audit]')
    assert.ok(compare(specificity(sharedRule.selector), originalSpecificity) > 0, path)
  }
})

test('tables retain scrolling, middle alignment, adjacent copy icons and nonwrapping badges/actions', () => {
  const cells = declarations(find('table td', 'vertical-align'))
  assert.equal(cells['vertical-align'], 'middle')
  assert.equal(cells['font-size'], 'var(--officer-text)')
  const badges = declarations(find('table :is(.badge', 'white-space'))
  assert.equal(badges['white-space'], 'nowrap')
  const actions = declarations(find('table .action-group', 'flex-wrap'))
  assert.equal(actions['flex-wrap'], 'nowrap'); assert.equal(actions['align-items'], 'center')
  const scroll = declarations(find('.table-scroll', 'overflow-x'))
  assert.equal(scroll['overflow-x'], 'auto'); assert.equal(scroll['max-width'], '100%')
  assert.equal(declarations(find('.identifier-line', 'gap')).gap, '7px')
  for (const path of ['ObservationsView', 'ReviewSubmissionsView']) {
    const page = read(`views/conservation/${path}.vue`)
    assert.match(page, /@click="copyIdentifier\(/)
    assert.match(page, /navigator.clipboard.writeText\(value\)/)
    assert.match(page, /\.identifier-copy[^}]*width: 44px/)
    assert.match(page, /background: #245443; color: #fff/)
  }
  assert.equal(declarations(find('.observations-table', 'min-width'))['min-width'], '90rem')
})

test('controls can grow with text zoom, keep touch targets and preserve wrapping form/table layouts', () => {
  const controls = declarations(rules.find(rule => rule.selector.includes('select)') && declarations(rule)['min-height'] === '2.75rem'))
  assert.equal(controls.height, 'auto')
  const labels = declarations(find('.control-bar > .field', 'grid-template-rows'))
  assert.equal(labels['grid-template-rows'], '1fr auto')
  assert.equal(labels['min-width'], 'min(100%, 12rem)')
  const mapSummary = declarations(find('.map-summary', 'flex-wrap'))
  assert.equal(mapSummary['flex-wrap'], 'wrap')
  assert.equal(mapSummary['max-width'], 'calc(100% - 28px)')
  assert.ok(rules.some(rule => rule.parent.params === '(max-width: 767px)' && declarations(rule)['min-height'] === '2.75rem'))
  assert.match(read('styles/officer-header.css'), /@container officer-topbar \(max-width: 60rem\)/)
  const species = read('views/conservation/PlantSpeciesView.vue')
  assert.match(species, /validation-highlight/); assert.match(species, /prefers-reduced-motion/)
  assert.match(species, /SpeciesPhotoManager/)
  assert.match(read('styles/conservation.css'), /\.form-grid\s*\{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/)
  const mobileFormRules = []
  postcss.parse(read('styles/conservation.css')).walkRules(rule => {
    if (rule.selector.includes('.form-grid') && rule.parent.params === '(max-width: 620px)') mobileFormRules.push(rule)
  })
  assert.ok(mobileFormRules.some(rule => declarations(rule)['grid-template-columns'] === '1fr'))
  sheet.walkDecls(decl => { if (decl.prop === 'height') assert.equal(decl.value, 'auto') })
})

test('English, Malay and Chinese labels remain localized and supporting charts and photo controls share the scale', () => {
  for (const language of ['en', 'ms', 'zh-CN']) {
    const locale = JSON.parse(read(`locales/${language}.json`))
    assert.ok(locale.dashboardNav && locale.conservationPages.species && locale.conservationPages.reviews)
  }
  for (const selector of ['.card-caption', '.file-errors', '.chart-empty', '.notification-copy time', '.leaflet-tooltip', '.library-photo']) assert.ok(find(selector, 'font-size'), selector)
  assert.match(read('components/conservation/ReportChart.vue'), /font: \{ size: 12 \}/)
  assert.match(read('components/CameraMonitoringSection.vue'), /font: \{ size: 12 \}/)
})

test('supporting-label contrast meets normal-text contrast on Officer light surfaces without recoloring status cards', () => {
  const luminance = hex => {
    const rgb = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722
  }
  for (const background of ['#ffffff', '#f3f6f2', '#fbfdfb', '#f5faf6']) assert.ok((luminance(background) + .05) / (luminance(root['--officer-muted']) + .05) >= 4.5)
  const muted = rules.filter(rule => declarations(rule).color)
  assert.ok(muted.every(rule => !rule.selector.includes('.review-summary-title') && !rule.selector.includes('.badge') && !rule.selector.includes('.preview-overlay')))
})
