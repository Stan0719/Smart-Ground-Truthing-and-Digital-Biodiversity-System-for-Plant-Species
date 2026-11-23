import { conservationBadgeStyle, conservationBadgePalette } from '../src/utils/conservationBadge.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as vue from 'vue'

const source = readFileSync(new URL('../src/views/PlantsView.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const script = compileScript(descriptor, { id: 'catalogue' })
const template = compileTemplate({ source: descriptor.template.content, filename: 'PlantsView.vue', id: 'catalogue', compilerOptions: { bindingMetadata: script.bindings } })
const js = value => ts.transpileModule(value, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const fixture = (slug, family, name = slug) => ({ slug, family, name, scientificName: `Scientific ${slug}`, genus: 'Genus', description: 'Forest', category: 'Uncategorized', images: [] })
function harness() {
  const scope = vue.effectScope(), exports = {}, loaded = vue.reactive([]), route = vue.reactive({ query: {} })
  const loggedIn = vue.ref(false), role = vue.ref(null)
  const context = { exports, require(name) {
    if (name.endsWith('/conservationBadge')) return { conservationBadgeStyle }
    if (name === 'vue') return { ...vue, onMounted() {}, onBeforeUnmount() {}, resolveComponent: x => x, withDirectives: x => x }
    if (name.endsWith('.vue')) return {}
    if (name === 'vue-router') return { useRoute: () => route }
    if (name === 'vue-i18n') return { useI18n: () => ({ t: x => x, te: () => false }) }
    if (name.includes('usePrototypeSession')) return { usePrototypeSession: () => ({ isLoggedIn: loggedIn, userRole: role }) }
    if (name.endsWith('/plants')) return { plants: loaded }
    if (name.includes('useCatalogueRefresh')) return { useCatalogueRefresh: load => ({ refresh: () => load(() => true), reset: () => load(() => true) }) }
    if (name.endsWith('/knowledge')) return { refreshKnowledge: async () => {}, knowledgeError: vue.ref(''), catalogueLimited: vue.ref(false) }
    throw Error(name)
  } }
  vm.runInNewContext(`(function(){${js(script.content)}})()`, context)
  const state = scope.run(() => exports.default.setup({}, { expose() {} }))
  vm.runInNewContext(`(function(){${js(template.code)}})()`, context)
  return { state, route, loaded, loggedIn, role, stop: () => scope.stop(), render: () => exports.render({}, [], {}, vue.proxyRefs(state), {}, {}) }
}
const flat = value => {
  const out = []
  const visit = x => { if (Array.isArray(x)) return x.forEach(visit); if (!x || typeof x !== 'object') return; out.push(x); if (Array.isArray(x.children)) visit(x.children) }
  visit(value); return out
}

test('families derive from refreshed authorized data, normalize, deduplicate, sort and ignore missing values', async () => {
  const h = harness()
  try {
    h.loaded.push(fixture('z', '  Zeta   family '), fixture('a', 'Alpha'), fixture('d', 'alpha'), fixture('e', ''), fixture('n', null), fixture('u'), fixture('w', '   '))
    await h.state.loadSpecies()
    assert.equal(JSON.stringify(h.state.families.value), JSON.stringify([['alpha', 'Alpha'], ['zeta family', 'Zeta family']]))
    h.state.activeFamily.value = 'zeta family'
    assert.deepEqual(Array.from(h.state.filteredSpecies.value, x => x.slug), ['z'])
    h.loaded.splice(0, h.loaded.length, fixture('new', 'Novelaceae'))
    await h.state.loadSpecies(); await vue.nextTick()
    assert.equal(h.state.activeFamily.value, '')
    assert.equal(h.state.families.value[0][1], 'Novelaceae')
    h.state.species.value = [fixture('missing')]; await vue.nextTick()
    assert.equal(h.state.families.value.length, 0)
  } finally { h.stop() }
})

test('searchable family dropdown filters dynamic options and keyboard-selects without changing taxonomy labels', async () => {
  const h = harness()
  try {
    const names = ['Araceae', 'Asparagaceae', 'Myrtaceae', 'Plantaginaceae', 'Family', 'mii family correct Edit /Edit']
    h.state.species.value = names.map((name, index) => fixture(String(index), name))
    assert.equal(h.state.familyOptions.value.length, names.length + 1)
    assert.equal(h.state.selectedFamilyLabel.value, 'species.allFamilies')

    h.state.familySearchQuery.value = 'plant'
    await vue.nextTick()
    assert.deepEqual(Array.from(h.state.matchingFamilyOptions.value, option => option.label), ['Plantaginaceae'])
    h.state.familySearchQuery.value = 'no match'
    await vue.nextTick()
    assert.equal(h.state.matchingFamilyOptions.value.length, 0)

    h.state.familySearchQuery.value = ''
    h.state.familyDropdownOpen.value = true
    const lastOption = h.state.familyOptions.value.at(-1)
    h.state.handleFamilySearchKeydown({ key: 'End', preventDefault() {} })
    assert.equal(h.state.activeFamilyOption.value, names.length)
    h.state.handleFamilySearchKeydown({ key: 'Enter', preventDefault() {} })
    await vue.nextTick()
    assert.equal(h.state.activeFamily.value, lastOption.key)
    assert.equal(h.state.selectedFamilyLabel.value, lastOption.label)
    assert.deepEqual(Array.from(h.state.filteredSpecies.value, item => item.family), [lastOption.label])
    assert.ok(h.state.familyOptions.value.some(option => option.label === 'mii family correct Edit /Edit'))

    h.state.familyDropdownOpen.value = true
    h.state.handleFamilySearchKeydown({ key: 'Escape', preventDefault() {} })
    assert.equal(h.state.familyDropdownOpen.value, false)
  } finally { h.stop() }
})

test('family dropdown and reset labels exist in English, Malay, and Simplified Chinese', () => {
  const expected = {
    en: { allFamilies: 'All Families', filterByFamily: 'Filter by Family', searchFamilies: 'Search families', noFamiliesFound: 'No families found', currentFilter: 'Current filter: {family}', reset: 'Reset' },
    ms: { allFamilies: 'Semua Famili', filterByFamily: 'Tapis Mengikut Famili', searchFamilies: 'Cari famili', noFamiliesFound: 'Tiada famili ditemui', currentFilter: 'Penapis semasa: {family}', reset: 'Tetapkan Semula' },
    'zh-CN': { allFamilies: '所有科', filterByFamily: '按植物科筛选', searchFamilies: '搜索植物科', noFamiliesFound: '未找到植物科', currentFilter: '当前筛选：{family}', reset: '重置' },
  }
  for (const [locale, labels] of Object.entries(expected)) {
    const messages = JSON.parse(readFileSync(new URL(`../src/locales/${locale}.json`, import.meta.url), 'utf8'))
    for (const [key, value] of Object.entries(labels)) assert.equal(messages.species[key], value)
    assert.equal(messages.species.moreFilters, undefined)
    assert.equal(messages.species.showLess, undefined)
  }
})

test('family combines with search and each sort; All and Clear reset selection; route search remains reactive', async () => {
  const h = harness()
  try {
    h.state.species.value = [fixture('b', '  Alpha ', 'Beta'), fixture('a', 'ALPHA', 'Alpha'), fixture('c', 'Other', 'Gamma')]
    h.state.activeFamily.value = 'alpha'
    for (const [sort, expected] of [['default', ['b','a']], ['name-asc', ['a','b']], ['name-desc', ['b','a']], ['scientific-asc', ['a','b']]]) {
      h.state.sortOption.value = sort
      assert.deepEqual(Array.from(h.state.filteredSpecies.value, x => x.slug), expected)
    }
    h.route.query.search = 'BETA'; await vue.nextTick()
    assert.deepEqual(Array.from(h.state.filteredSpecies.value, x => x.slug), ['b'])
    h.state.sortOption.value = 'name-desc'
    h.state.clearFilters()
    assert.equal(h.state.searchQuery.value, ''); assert.equal(h.state.activeFamily.value, '')
    assert.equal(h.state.sortOption.value, 'name-desc')
    assert.equal(h.state.filteredSpecies.value.length, 3)
    h.state.searchQuery.value = 'Uncategorized'; assert.equal(h.state.filteredSpecies.value.length, 0)
    for (const query of ['Scientific', 'Genus', 'Forest', 'alpha']) { h.state.searchQuery.value = query; assert.ok(h.state.filteredSpecies.value.length) }
  } finally { h.stop() }
})

test('render exposes the searchable family combobox, reset, current selection, and existing card actions', () => {
  const h = harness()
  try {
    h.state.isLoading.value = false
    h.state.species.value = [{ ...fixture('long', 'VeryLongFamily'.repeat(8), 'LongCommonName'.repeat(8)), conservationStatus: 'Vulnerable' }]
    let nodes = flat(h.render())
    assert.ok(nodes.some(x => x.props?.class === 'family-select-trigger' && x.props['aria-haspopup'] === 'listbox'))
    assert.ok(nodes.some(x => x.props?.class === 'filter-reset-button'))
    assert.ok(nodes.some(x => x.props?.class === 'current-family-filter'))
    assert.ok(!nodes.some(x => /family-filter-toggle|family-filters/.test(x.props?.class || '')))
    assert.equal(nodes.filter(x => x.props?.to?.startsWith('/species/')).length, 2)
    assert.ok(nodes.some(x => x.props?.class === 'plant-image-placeholder'))
    assert.ok(!nodes.some(x => /category-badge|status-badge/.test(x.props?.class || '')))
    h.loggedIn.value = true; h.role.value = 'conservation-officer'
    nodes = flat(h.render()); assert.ok(nodes.some(x => x.props?.class === 'status-badge'))
    h.state.species.value[0].conservationStatus = ''; assert.ok(!flat(h.render()).some(x => x.props?.class === 'status-badge'))
  } finally { h.stop() }
})

test('layout declares 4/3/2 columns, wrapping long text and original mobile actions', () => {
  const css = descriptor.styles[0].content
  assert.match(css, /\.plant-grid\s*\{[^}]*repeat\(4, minmax\(0, 1fr\)\)/)
  assert.match(css, /@media \(max-width: 1199px\)[\s\S]*?repeat\(3, minmax\(0, 1fr\)\)/)
  assert.match(css, /@media \(max-width: 950px\)[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/)
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*?\.card-actions\s*\{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/)
  assert.match(css, /\.plant-card-content\s*\{[^}]*overflow-wrap: anywhere/)
  assert.match(css, /\.family-dropdown-panel\s*\{[^}]*position: absolute;[^}]*z-index: 10/)
  assert.match(css, /\.family-option\s*\{[^}]*overflow-wrap: anywhere/)
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*?\.family-controls\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) auto auto/)
  assert.doesNotMatch(source, /familyFiltersExpanded|visibleFamilies|species\.moreFilters|species\.showLess/)
  assert.match(css, /\.card-badges\s*\{[^}]*justify-content: flex-end/)
  assert.doesNotMatch(source, /activeCategory|category-badge|item\.category|const categories/)
})

 test('species cards use the shared conservation palette and preserve visitor visibility', () => {
  const h = harness()
  try {
    h.state.isLoading.value = false
    for (const role of ['conservation-officer', 'admin']) {
      for (const status of [...Object.keys(conservationBadgePalette), 'Unknown', null]) {
        h.state.species.value = [{ ...fixture('test', 'Family'), conservationStatus: status }]
        h.loggedIn.value = true; h.role.value = role
        const badge = flat(h.render()).find(n => n.props?.class === 'status-badge')
        if (status) { assert.deepEqual(badge.props.style, conservationBadgeStyle(status)); assert.equal(badge.children, status) }
        else assert.equal(badge, undefined)
        h.loggedIn.value = false; h.role.value = null
        assert.ok(!flat(h.render()).some(n => n.props?.class === 'status-badge'))
      }
    }
  } finally { h.stop() }
})

 test('species previews omit descriptions but retain both actions and searchable descriptions', () => {
  const h = harness()
  try {
    h.state.isLoading.value = false
    h.state.species.value = [{ ...fixture('preview', 'Family'), description: 'Unique description retained in data' }]
    const nodes = flat(h.render())
    assert.ok(!nodes.some(n => n.props?.class === 'plant-description' || n.children === 'Unique description retained in data'))
    const actions = nodes.find(n => n.props?.class === 'card-actions')
    assert.deepEqual(flat(actions).filter(n => n.props?.to).map(n => n.props.to), ['/species/preview', '/species/preview/plants'])
    h.state.searchQuery.value = 'Unique description'
    assert.equal(h.state.filteredSpecies.value.length, 1)
  } finally { h.stop() }
})

test('card actions use equal flexible columns, bottom alignment and contained wrapping labels', () => {
  const css = descriptor.styles[0].content
  assert.match(css, /\.plant-card-content\s*\{[^}]*display: flex;[^}]*flex-direction: column;[^}]*flex: 1/)
  assert.match(css, /\.card-actions\s*\{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[^}]*margin-top: auto/)
  assert.match(css, /\.card-action-link\s*\{[^}]*box-sizing: border-box;[^}]*width: 100%;[^}]*white-space: normal;[^}]*overflow-wrap: anywhere;[^}]*min-width: 0;[^}]*min-height: 44px/)
  assert.doesNotMatch(css, /\.plant-description/)
})

test('Explore Species keeps its grid mounted beside a recoverable refresh error', async () => {
  const h = harness()
  try {
    h.loaded.push(fixture('a', 'Family A'))
    await h.state.loadSpecies(); await vue.nextTick()
    h.state.activeFamily.value = 'family a'
    h.state.loadError.value = 'Temporary fixture failure'
    const tree = flat(h.render())
    assert.ok(tree.some(node => node.props?.class === 'plant-grid'))
    assert.ok(tree.some(node => node.props?.role === 'alert'))
    assert.equal(h.state.activeFamily.value, 'family a')
  } finally { h.stop() }
})
