import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import postcss from 'postcss'
import ts from 'typescript'
import * as vue from 'vue'
import { monitoringLabels } from '../src/utils/officerMonitoringDisplay.ts'
import { formatObservationId } from '../src/utils/observationId.ts'
import { formatSpeciesRequestId } from '../src/utils/speciesRequestId.ts'
import { createOfficerInbox } from '../src/services/officerNotifications.ts'

const read = path => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')
const sheet = postcss.parse(read('styles/officer-header.css'))
const rules = []; sheet.walkRules(rule => rules.push(rule))
const decl = rule => Object.fromEntries(rule.nodes.filter(node => node.type === 'decl').map(node => [node.prop, node.value]))
const ruleFor = (selector, prop, condition = null) => rules.find(rule => rule.selector.endsWith(selector) && decl(rule)[prop] !== undefined && (condition ? rule.parent.params === condition : rule.parent.type === 'root'))
const transpile = code => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const nodes = root => {
  const all = []
  const walk = node => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (!node || typeof node !== 'object') return
    all.push(node)
    if (Array.isArray(node.children)) walk(node.children)
    else if (node.children?.default && node.type?.name !== 'RouterView') walk(node.children.default())
  }
  walk(root); return all
}

function harness(component, language = 'en', width = 1440) {
  const path = component === 'layout' ? 'layouts/ConservationOfficerLayout.vue' : 'components/ConservationTopbarActions.vue'
  const { descriptor } = parse(read(path))
  const script = compileScript(descriptor, { id: 'officer-header' })
  const template = compileTemplate({ source: descriptor.template.content, filename: path, id: 'officer-header', compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  const messages = JSON.parse(read(`locales/${language}.json`))
  const lookup = key => key.split('.').reduce((value, segment) => value?.[segment], messages)
  const t = key => lookup(key) ?? key
  const route = vue.reactive({ name: 'conservation-reviews', meta: {}, query: {} })
  const profile = vue.reactive({ fullName: 'Verified Officer With A Long Authenticated Name' })
  const currentWidth = vue.ref(width), destinations = [], cleanup = []
  const scope = vue.effectScope()
  const router = { currentRoute: vue.ref(route), push: async destination => { destinations.push(destination); Object.assign(route, destination) }, replace: async destination => { destinations.push(destination) } }
  const viewport = { width: 1440 }, listeners = new Map(), observers = []
  const observerClass = kind => class {
    constructor(callback) { this.callback=callback;this.kind=kind;this.disconnected=false;observers.push(this) }
    observe() { this.disconnected=false }
    disconnect() { this.disconnected=true }
  }
  const exports = {}
  const context = {
    exports, console, ResizeObserver: observerClass('resize'), MutationObserver: observerClass('mutation'),
    document: { documentElement: { get clientWidth(){return viewport.width} }, visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
    window: { addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name)=>listeners.delete(name), matchMedia: () => ({ matches: currentWidth.value <= 920 }), scrollTo() {} },
    fetch: () => { throw Error('Header layout checks must not send API requests') },
    require(name) {
      if (name === 'vue') return { ...vue, onMounted() {}, withDirectives: node => node, onBeforeUnmount: fn => cleanup.push(fn), resolveComponent: name => ({ name }) }
      if (name === 'vue-router') return { useRouter: () => router, useRoute: () => route }
      if (name === 'vue-i18n') return { useI18n: () => ({ t, te: key => typeof lookup(key) === 'string', locale: vue.ref(language) }) }
      if (name.endsWith('/auth')) return { logout: () => { throw Error('No sign-out during read-only tests') }, sessionSnapshot: () => ({ user: { id: 'verified-officer', role: 'Conservation Officer', status: 'Active', mustChangePassword: false }, pending: false }), subscribeSession: () => () => {} }
      if (name.endsWith('officerMonitoringDisplay')) return { monitoringLabels }
      if (name.endsWith('observationId')) return { formatObservationId }
      if (name.endsWith('speciesRequestId')) return { formatSpeciesRequestId }
      if (name.endsWith('officerNotifications')) return { createOfficerInbox }
      if (name.endsWith('conservationProfile')) return { conservationProfile: profile }
      if (name.endsWith('useAuthenticatedPageTranslation')) return { useAuthenticatedPageTranslation() {} }
      if (name.endsWith('.vue')) return { name: name.split('/').at(-1).replace('.vue', '') }
      throw Error(`Unexpected import ${name}`)
    },
  }
  vm.runInNewContext(`(function () { ${transpile(script.content)} })()`, context)
  const state = scope.run(() => exports.default.setup({}, { expose() {} }))
  vm.runInNewContext(`(function () { ${transpile(template.code)} })()`, context)
  return { state, route, profile, viewport, listeners, observers, width: currentWidth, destinations, t, render: () => exports.render({}, [], {}, vue.proxyRefs(state), {}, {}), stop: () => { cleanup.forEach(fn => fn()); scope.stop() } }
}

test('the shared header has a single identity/actions group across every real Officer route and locale', () => {
  const router = read('router/index.ts')
  for (const language of ['en', 'ms', 'zh-CN']) {
    const h = harness('layout', language)
    try {
      for (const page of ['dashboard', 'species', 'observations', 'reviews', 'map', 'iot', 'alerts', 'reports', 'profile']) {
        const name = `conservation-${page}`
        assert.ok(router.includes(`name: '${name}'`))
        h.route.name = name
        h.route.meta = page === 'profile' ? { titleKey: 'nav.profileSettings', title: 'Profile Settings' } : {}
        const tree = nodes(h.render())
        const header = tree.find(node => node.type === 'header' && node.props?.class === 'topbar')
        const content = nodes(header)
        assert.equal(content.filter(node => node.props?.class === 'officer-header-content').length, 1)
        assert.equal(content.filter(node => node.type === 'h1').length, 1)
        assert.equal(content.find(node => node.type === 'h1').children, h.state.title.value)
        assert.ok(h.state.title.value && !h.state.title.value.startsWith('dashboardNav.'))
        assert.equal(content.filter(node => node.props?.class === 'menu-button').length, 1)
        assert.equal(content.filter(node => node.type?.name === 'ConservationTopbarActions').length, 1)
        assert.equal(content.find(node => node.type === 'p').children, h.t('dashboardNav.conservation'))
      }
    } finally { h.stop() }
  }
})

test('sidebar toggle and close preserve their existing desktop collapse/mobile drawer behavior', () => {
  const h = harness('layout')
  try {
    for (const width of [1440, 1024, 768, 480, 375]) {
      h.width.value = width; h.state.sidebarOpen.value = false; h.state.collapsed.value = false
      const toggle = nodes(h.render()).find(node => node.props?.class === 'menu-button')
      assert.equal(toggle.props['aria-label'], h.t('dashboardNav.toggleNavigation'))
      toggle.props.onClick()
      assert.equal(h.state.sidebarOpen.value, width <= 920)
      assert.equal(h.state.collapsed.value, width > 920)
      h.state.closeControl()
      assert.equal(h.state.sidebarOpen.value, false)
    }
    assert.equal(h.destinations.length, 0)
  } finally { h.stop() }
})

test('the compact account trigger keeps its full accessible identity and profile actions without hiding language or notifications', async () => {
  for (const language of ['en', 'ms', 'zh-CN']) {
    const h = harness('actions', language, 375)
    try {
      let tree = nodes(h.render())
      const profile = tree.find(node => node.props?.class === 'profile-button')
      assert.ok(profile.props['aria-label'].includes(h.profile.fullName))
      assert.ok(profile.props['aria-label'].includes(h.t('dashboardNav.conservationOfficer')))
      assert.equal(profile.props.title, profile.props['aria-label'])
      assert.equal(profile.props['aria-expanded'], false)
      assert.ok(tree.some(node => node.type?.name === 'LanguageSwitcher'))
      assert.ok(tree.some(node => node.props?.class === 'notification-button' && node.props['aria-controls'] === 'conservation-notifications'))
      profile.props.onClick()
      tree = nodes(h.render())
      const menu = tree.find(node => node.props?.class === 'profile-menu')
      const identity = nodes(menu).find(node => node.props?.class === 'profile-menu-identity')
      assert.equal(nodes(identity).find(node => node.type === 'strong').children, h.profile.fullName)
      assert.equal(nodes(identity).find(node => node.type === 'small').children, h.t('dashboardNav.conservationOfficer'))
      assert.equal(nodes(menu).filter(node => node.props?.role === 'menuitem').length, 2)
      const settings = nodes(menu).find(node => node.props?.role === 'menuitem')
      await settings.props.onClick()
      assert.equal(h.destinations[0].name, 'conservation-profile')
      assert.equal(h.state.profileOpen.value, false)
    } finally { h.stop() }
  }
})

test('wide headers use one grid row; narrower available width gives the title a complete second row', () => {
  const desktop = decl(ruleFor('.officer-header-content', 'grid-template-areas'))
  assert.equal(desktop.display, 'grid')
  assert.equal(desktop['grid-template-areas'], '"toggle identity actions"')
  assert.equal(desktop['grid-template-columns'], '2.75rem minmax(0, 1fr) auto')
  const narrow = decl(ruleFor('.officer-header-content', 'grid-template-areas', 'officer-topbar (max-width: 60rem)'))
  assert.equal(narrow['grid-template-areas'], '"toggle actions" "identity identity"')
  assert.equal(narrow['grid-template-columns'], '2.75rem minmax(0, 1fr)')
  assert.equal(decl(ruleFor('.topbar', 'container-type'))['container-type'], 'inline-size')
  assert.equal(decl(ruleFor('.topbar', 'container-name'))['container-name'], 'officer-topbar')
  // Policy check against existing sidebar/padding values; this is not browser geometry verification.
  const shared = read('styles/conservation.css')
  assert.match(shared, /min-width: 226px/)
  assert.match(shared, /padding: 0 3.5%/)
  for (const width of [1440, 1024, 768, 480, 375]) for (const zoom of [1, 1.25, 1.5]) {
    const cssViewport = width / zoom
    const available = (cssViewport - (cssViewport > 920 ? 226 : 0)) * .93
    assert.equal(available > 60 * 16 ? 1 : 2, width === 1440 && zoom === 1 ? 1 : 2, `${width}px at ${zoom * 100}%`)
  }
  assert.ok(rules.some(rule => rule.parent.parent?.params === 'not (container-type: inline-size)' && rule.parent.params === '(max-width: 1200px)'))
})

test('header controls retain touch targets, menus stay bounded and titles/names wrap without clipping', () => {
  const title = decl(ruleFor('.officer-header-content .page-heading h1', 'white-space'))
  assert.equal(title['white-space'], 'normal'); assert.equal(title['word-break'], 'normal')
  assert.equal(decl(ruleFor('.officer-header-content > .page-heading', 'min-width'))['min-width'], '0')
  assert.equal(decl(ruleFor('.officer-header-content :is(.notification-button, .profile-button)', 'min-height'))['min-height'], '2.75rem')
  assert.equal(decl(ruleFor('.officer-header-content > .menu-button', 'min-height'))['min-height'], '2.75rem')
  assert.equal(decl(ruleFor('.officer-header-content .dashboard-language .language-trigger', 'min-height'))['min-height'], '2.75rem')
  assert.equal(decl(ruleFor('.officer-header-content :is(.notification-menu, .profile-menu)', 'max-width'))['max-width'], 'calc(100vw - 2rem)')
  assert.equal(decl(ruleFor('.officer-header-content .dashboard-language .language-menu', 'position')).position, 'absolute')
  assert.ok(rules.some(rule => rule.selector.endsWith('.officer-header-content :is(.profile-copy, .chevron)') && decl(rule).display === 'none'))
  assert.ok(!rules.some(rule => /(?:menu-button|notification-button|profile-button|dashboard-language)\)$/.test(rule.selector) && decl(rule).display === 'none'))
  assert.ok(!rules.some(rule => ['hidden', 'clip'].includes(decl(rule).overflow)))
})

test('new header styles stay scoped to Officer header elements and remove the obsolete flex-wrap workaround', () => {
  for (const rule of rules) {
    assert.ok(rule.selector.startsWith('.officer-layout.officer-layout '), rule.selector)
    assert.ok(rule.selector.includes('.officer-header-content') || rule.selector.endsWith(' .topbar'), rule.selector)
  }
  assert.match(read('layouts/ConservationOfficerLayout.vue'), /<style src="..\/styles\/officer-header.css"><\/style>/)
  assert.doesNotMatch(read('styles/officer-typography.css'), /\.topbar \{ flex-wrap: wrap/)
  assert.doesNotMatch(read('main.ts'), /officer-header/)
})

test('phone and zoomed header policy keeps four touch targets with a visible language code', () => {
  const compact = decl(ruleFor('.officer-header-content .dashboard-language .language-trigger', 'min-width', 'officer-topbar (max-width: 20rem)'))
  assert.equal(compact['min-width'], '2.75rem')
  assert.equal(compact['padding-inline'], '.375rem')
  for (const width of [480, 375]) for (const zoom of [1.25, 1.5]) {
    const available = width / zoom * .93
    // Four 44px minimum targets plus the grid gap and two action gaps at 16px root size.
    assert.ok(4 * 44 + 12 + 2 * 6 <= available)
  }
  const small = rules.filter(rule => rule.parent.params === 'officer-topbar (max-width: 20rem)')
  assert.ok(small.some(rule => rule.selector.includes('.language-trigger svg') && decl(rule).display === 'none'))
  assert.ok(!small.some(rule => rule.selector.includes('.language-short') && decl(rule).display === 'none'))
})

test('Officer language menu anchors to its trigger while other menu alignment remains unchanged',()=>{
 assert.equal(decl(ruleFor('.dashboard-language .language-switcher','position')).position,'relative')
 const menu=decl(ruleFor('.dashboard-language .language-menu','position'))
 assert.equal(menu.top,'calc(100% + 6px)');assert.equal(menu.left,'50%');assert.equal(menu.right,'auto')
 assert.equal(menu.transform,'translateX(calc(-50% + var(--officer-language-shift, 0px)))')
 assert.equal(menu['max-width'],'calc(100vw - 16px)')
 const other=decl(ruleFor(':is(.notification-menu, .profile-menu)','right'))
 assert.equal(other.right,'0');assert.equal(other.top,'calc(100% + .5rem)');assert.equal(other.transform,undefined)
 assert.match(read('components/LanguageSwitcher.vue'),/\.language-switcher \{ position: relative;/)
 assert.match(read('components/ConservationTopbarActions.vue'),/v-language-anchor class="dashboard-language"/)
})
test('language anchoring centers normally, clamps only at viewport edges, adapts to zoom and cleans up',()=>{
 const h=harness('actions')
 try{
  let triggerLeft=200,triggerWidth=90,menuWidth=176,present=true,shift=null
  const menu={getBoundingClientRect:()=>({width:menuWidth}),style:{setProperty:(key,value)=>{assert.equal(key,'--officer-language-shift');shift=parseFloat(value)}}}
  const trigger={getBoundingClientRect:()=>({left:triggerLeft,width:triggerWidth})}
  const root={querySelector:selector=>selector==='.language-trigger'?trigger:present?menu:null}
  const directive=h.state.vLanguageAnchor
  directive.mounted(root)
  assert.equal(shift,0)
  for(const width of [1440,1280,1024,768,480,375])for(const zoom of [1,1.25,1.5])for(const labelWidth of [44,78,140])for(const expanded of [false,true]){
   h.viewport.width=width/zoom;triggerWidth=labelWidth
   triggerLeft=Math.max(8,(h.viewport.width-(expanded&&width>920?258:0))*.5-70)
   h.listeners.get('resize')()
   const centered=triggerLeft+triggerWidth/2-menuWidth/2,left=centered+shift
   assert.ok(left>=8-1e-8&&left+menuWidth<=h.viewport.width-8+1e-8)
   if(centered>=8&&centered+menuWidth<=h.viewport.width-8)assert.equal(shift,0)
  }
  h.viewport.width=375;triggerWidth=44
  for(const left of [0,330]){triggerLeft=left;h.listeners.get('scroll')();const actual=triggerLeft+triggerWidth/2-menuWidth/2+shift;assert.ok(actual>=8&&actual+menuWidth<=367)}
  present=false;h.observers.find(o=>o.kind==='mutation').callback()
  present=true;menuWidth=200;triggerLeft=200;h.observers.find(o=>o.kind==='mutation').callback()
  const expectedLeft=triggerLeft+triggerWidth/2-menuWidth/2+shift;assert.ok(expectedLeft>=8&&expectedLeft+menuWidth<=367)
  directive.unmounted(root);assert.equal(h.listeners.size,0);assert.ok(h.observers.every(o=>o.disconnected))
 }finally{h.stop()}
})
