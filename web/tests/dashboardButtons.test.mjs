import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import postcss from 'postcss'
import { parse } from '@vue/compiler-sfc'

const css = readFileSync(new URL('../src/styles/dashboard-buttons.css', import.meta.url), 'utf8')
const sheet = postcss.parse(css)
const rules = []
sheet.walkRules(rule => rules.push(rule))
const values = rule => Object.fromEntries(rule.nodes.filter(n => n.type === 'decl').map(n => [n.prop, n.value]))
const find = (selector, property, value) => rules.find(r => r.selector.includes(selector) && values(r)[property] === value)

test('both sidebars retain real logout icons, translated labels and original click handlers', () => {
  for (const [file, handler] of [['layouts/ConservationOfficerLayout.vue', 'signOut'], ['components/AdminPageShell.vue', 'logout']]) {
    const { descriptor } = parse(readFileSync(new URL('../src/' + file, import.meta.url), 'utf8'))
    const button = descriptor.template.content.match(new RegExp('<button type="button" @click="' + handler + '">([\\s\\S]*?)</button>'))?.[1]
    assert.ok(button, file)
    assert.match(button, /<svg class="logout-icon"/)
    assert.match(button, /stroke="currentColor"/)
    assert.match(button, /aria-hidden="true"/)
    assert.match(button, /<span>\{\{ t\('nav.logout'\) \}\}<\/span>/)
  }
  assert.doesNotMatch(css, /sidebar-footer button::before/)
})

test('Logout is solid project red and centered, with darker red enabled hover', () => {
  const normal = find('.sidebar-footer button', 'background', '#b84d42')
  assert.equal(values(normal).color, '#fff')
  assert.equal(values(normal)['justify-content'], 'center')
  assert.ok(find('.sidebar-footer button', 'transition', 'background-color 180ms ease'))
  const hover = find('.sidebar-footer button:not(:disabled)', 'background', '#a13c37')
  assert.equal(values(hover).color, '#fff')
  assert.equal(hover.parent.params, '(hover: hover)')
  assert.equal(values(find('.logout-icon', 'width', '20px')).flex, '0 0 20px')
})

test('semantic actions are outlined at rest and filled with white text on enabled hover', () => {
  const green = find('.action-button', '--dashboard-action-fill', 'var(--dashboard-action-green)')
  const red = find('.delete-action', '--dashboard-action-fill', 'var(--dashboard-action-red)')
  for (const rule of [green, red]) {
    assert.equal(values(rule).background, '#fff')
    assert.equal(values(rule).color, 'var(--dashboard-action-fill)')
    assert.equal(values(rule).border, '1px solid var(--dashboard-action-fill)')
  }
  const hover = find('.delete-action', 'background', 'var(--dashboard-action-fill)')
  assert.match(hover.selector, /:not\(:disabled\):not\(\[aria-disabled='true'\]\):hover/)
  assert.equal(values(hover).color, '#fff')
  assert.ok(find('span, svg, i', 'color', 'inherit'))
  assert.ok(find("svg [stroke]:not([stroke='none'])", 'stroke', 'currentColor'))
})

test('disabled actions retain their outlined state; keyboard and reduced-motion rules remain', () => {
  assert.ok(find(':disabled', 'cursor', 'not-allowed'))
  assert.ok(find(':disabled', 'transition', 'none'))
  const hover = find(':is(:disabled', 'border-color', 'var(--dashboard-action-fill)')
  assert.equal(values(hover).background, '#fff')
  assert.ok(find(':focus-visible', 'outline', '3px solid var(--dashboard-button-focus)'))
  assert.ok(rules.some(r => r.parent.params === '(prefers-reduced-motion: reduce)' && values(r).transition === 'none'))
})

test('shared controls retain compact horizontal actions and bounded table scrollers', () => {
  assert.match(css, /--dashboard-button-height: 44px/)
  assert.match(css, /--dashboard-button-compact: 32px/)
  assert.ok(find('.sidebar nav a', 'min-height', 'var(--dashboard-button-height)'))
  const compact = find('.table-wrapper) table', 'min-height', 'var(--dashboard-button-compact)')
  assert.equal(values(compact).height, 'var(--dashboard-button-compact)')
  assert.equal(values(compact).padding, '2px 11px')
  assert.equal(values(compact)['align-items'], 'center')
  assert.equal(values(compact)['justify-content'], 'center')
  assert.equal(values(compact)['font-size'], undefined)
  assert.equal(values(compact)['border-radius'], undefined)
  assert.doesNotMatch(compact.selector, /sidebar|logout|modal-actions|form-actions/)
  assert.ok(!compact.selector.includes('table button'))
  const group = find('table :is(.action-group', 'flex-wrap', 'nowrap')
  assert.equal(values(group)['flex-direction'], 'row')
  assert.equal(values(group).width, 'max-content')
  assert.equal(values(group)['min-width'], 'max-content')
  assert.equal(values(group).gap, '6px')
  const button = find('table :is(button', 'white-space', 'nowrap')
  assert.equal(values(button).flex, '0 0 auto')
  assert.equal(values(button).width, 'max-content')
  assert.equal(values(button)['min-width'], 'max-content')
  assert.equal(values(button)['overflow-wrap'], 'normal')
  assert.equal(values(button)['word-break'], 'normal')
  // These constraints apply at every width, rather than only at a desktop breakpoint.
  assert.equal(group.parent.type, 'root')
  assert.equal(button.parent.type, 'root')
  assert.ok(find('> table', 'table-layout', 'auto'))
  const scroll = find('.table-scroll', 'overflow-x', 'auto')
  assert.equal(values(scroll)['min-width'], '0')
  assert.equal(values(scroll)['max-width'], '100%')
  assert.ok(find('.sidebar', 'overflow-y', 'auto'))
  for (const rule of rules) assert.match(rule.selector, /\.officer-layout|\.admin-shell|\.staff-dialog-mask|\.similarity-drawer-layer/, rule.selector)
})


test('shared sizing cannot introduce arbitrary text breaking or wrapping table action groups', () => {
  for (const rule of rules) {
    const declarations = values(rule)
    assert.notEqual(declarations['overflow-wrap'], 'anywhere', rule.selector)
    assert.notEqual(declarations['word-break'], 'break-all', rule.selector)
    if (declarations['white-space'] === 'normal') assert.match(rule.selector, /sidebar nav a/)
    if (declarations['flex-wrap'] === 'wrap') assert.doesNotMatch(rule.selector, /action-group|action-buttons|row-actions|sensor-actions/)
    if (declarations.background === 'transparent') assert.doesNotMatch(rule.selector, /sidebar-footer/)
  }
  const normal = find('.sidebar-footer button', 'background', '#b84d42')
  assert.equal(values(normal).display, 'flex')
  assert.equal(values(normal)['align-items'], 'center')
  assert.equal(values(normal)['min-height'], 'var(--dashboard-button-height)')
})

test('Observations uses one primary action and retains the nonbreaking table action contract', () => {
  const observation = readFileSync(new URL('../src/views/conservation/ObservationsView.vue', import.meta.url), 'utf8')
  const review = readFileSync(new URL('../src/views/conservation/ReviewSubmissionsView.vue', import.meta.url), 'utf8')
  assert.match(observation, /class="table-scroll observations-scroll"/)
  const group = observation.match(/<td class="actions-cell"><div class="action-group">([\s\S]*?)<\/div><\/td>/)?.[1]
  assert.ok(group)
  // Four field actions, or five registration/legacy actions; primary variants are exclusive.
  assert.equal((group.match(/class="action-button"/g) || []).length, 6)
  assert.match(group, /<button v-if="canReviewField\(item\)"/)
  assert.match(group, /<button v-else class="action-button" @click="open\(item\)"/)
  assert.match(group, /<RouterLink v-if="authorizedOfficer && item.origin !== 'subsequent_observation'/)
  assert.match(group, /@click="open\(item, true\)"/)
  assert.match(review, /class="table-scroll reviews-scroll"/)
  assert.match(review, /class="action-button" :disabled="reviewBusy" @click="open\(observation\)"/)
  assert.ok(find('table :is(button', 'min-width', 'max-content'))
})
