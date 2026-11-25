import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import postcss from 'postcss'
import selectorParser from 'postcss-selector-parser'
import { parse, compileTemplate, compileStyle } from '@vue/compiler-sfc'

const read = file => readFileSync(new URL('../src/' + file, import.meta.url), 'utf8')
const css = read('styles/officer-page-polish.css')
const sheet = postcss.parse(css), rules = []
sheet.walkRules(rule => rules.push(rule))
const values = rule => Object.fromEntries(rule.nodes.filter(n => n.type === 'decl').map(n => [n.prop, n.value]))
const find = (part, property) => rules.find(r => r.selector.includes(part) && values(r)[property] !== undefined)

test('page polish is opt-in for the nine Officer content routes, excluding Overview and other roles', () => {
  const layout = read('layouts/ConservationOfficerLayout.vue')
  const { descriptor } = parse(layout)
  const attr = descriptor.template.content.match(/:data-officer-standard="([^"]+)"/)[1]
  const routes = [...attr.matchAll(/'conservation-([^']+)'/g)].map(m => m[1])
  assert.deepEqual(routes, ['plants', 'profile', 'species', 'observations', 'reviews', 'map', 'iot', 'alerts', 'reports'])
  assert.match(attr, /includes\(String\(route.name\)\) \? '' : undefined/)
  assert.ok(descriptor.scriptSetup.content.includes("import '../styles/officer-page-polish.css'"))
  assert.doesNotMatch(read('main.ts'), /officer-page-polish/)
  assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename: 'OfficerLayout.vue', id: 'polish-layout' }).errors, [])
  for (const rule of rules) {
    for (const selector of selectorParser().astSync(rule.selector).nodes) {
      const first = selector.nodes.slice(0, 4)
      assert.deepEqual(first.map(n => n.type === 'attribute' ? n.attribute : n.value), ['officer-layout', 'officer-layout', 'officer-layout', 'data-officer-standard'])
      assert.equal(first[3].type, 'attribute')
    }
  }
  sheet.walkDecls(d => assert.equal(d.important, undefined))
  assert.doesNotMatch(css, /\.admin-|\.staff-|:root|!important|overflow-x:\s*(hidden|clip)/)
})

test('the reference scale is retained, with 18px card headings and 13px readable state text', () => {
  const shared = read('styles/officer-typography.css')
  for (const [token, value] of [['title', '1.75rem'], ['section', '1.25rem'], ['text', '.875rem'], ['number', '1.875rem']])
    assert.ok(shared.includes(`--officer-${token}: ${value}`))
  assert.equal(values(find('[data-officer-standard]', '--officer-card'))['--officer-card'], '1.125rem')
  assert.equal(values(find('.state-message', 'font-size'))['font-size'], 'var(--officer-support, .8125rem)')
  assert.equal(values(find('.settings-card h2', 'font-size'))['font-size'], 'var(--officer-card)')
  assert.doesNotMatch(css, /font-family:|font-weight:|table (?:td|th)\s*\{/)
  assert.deepEqual(compileStyle({ source: css, id: 'officer-polish' }).errors, [])
})

const luminance = hex => {
  const rgb = hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722
}
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05)

test('supporting text meets AA on the existing light surfaces without recoloring semantic errors or badges', () => {
  const root = values(rules[0])
  for (const surface of ['#ffffff', '#f3f6f2', '#f1f4f0']) {
    assert.ok(contrast(root['--officer-support-ink'], surface) >= 4.5)
    assert.ok(contrast(root['--officer-kicker-ink'], surface) >= 4.5)
  }
  const supporting = find('.dataset-note', 'color')
  for (const exclusion of ['.error', '.warning', '.error-state', '.warning-state', '[role="alert"]']) assert.ok(supporting.selector.includes(`:not(${exclusion})`))
  for (const r of rules.filter(r => values(r).color)) assert.doesNotMatch(r.selector, /\.badge|\.summary-card|\.metric/)
})

test('spacing adapts locally while maps, compact metrics and operational table structures remain intact', () => {
  assert.equal(values(rules[0])['--officer-page-gap'], '24px')
  assert.equal(values(rules[0])['--officer-panel-padding'], '24px')
  const responsive = rules.filter(r => r.parent.type === 'atrule' && values(r)['--officer-panel-padding'])
  assert.deepEqual(responsive.map(r => [r.parent.params, values(r)['--officer-panel-padding']]), [['(max-width: 899px)', '20px'], ['(max-width: 599px)', '18px']])
  assert.ok(find('.panel:not(.table-panel):not(.map-card)', 'padding'))
  assert.equal(values(find('.profile-settings', 'gap')).gap, 'var(--officer-page-gap)')
  assert.equal(values(find('.panel-header', 'flex-direction'))['flex-direction'], 'row')
  assert.equal(values(find('.table-wrapper', 'overflow-x'))['overflow-x'], 'auto')
  assert.doesNotMatch(css, /grid-template-columns:|\.reports-table|\.reviews-table|\.observations-table|\.metric-grid|\.summary-card/)
})

test('touch targets override compact table buttons at mobile widths and for coarse pointers', () => {
  const touch = find('table :is(', 'min-height')
  assert.equal(touch.parent.params, '(max-width: 767px), (pointer: coarse)')
  assert.equal(values(touch)['min-height'], '44px')
  assert.equal(values(touch)['min-width'], '44px')
  assert.equal(values(touch).height, 'auto')
  const focus = find(':focus-visible', 'outline')
  assert.equal(values(focus).outline, '3px solid #33745d')
  assert.equal(values(find('.close-button,', 'min-height'))['min-height'], '44px')
})
