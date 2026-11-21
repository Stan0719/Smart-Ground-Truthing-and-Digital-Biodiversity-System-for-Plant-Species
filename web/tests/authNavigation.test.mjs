import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

const read = path => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')
const transpile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const user = { id: 'fake-officer', role: 'Conservation Officer', status: 'Active', mustChangePassword: false }
const deferred = () => { let resolve; const promise = new Promise(yes => resolve = yes); return { resolve, promise } }
function harness(fetch, path = '/conservation/reviews') {
  const auth = { exports: {}, fetch, AbortSignal }; vm.runInNewContext(transpile(read('services/auth.ts')), auth)
  const route = vue.reactive({ path, fullPath: path }), redirects = []
  let cleanup, guard
  const router = { replace: async value => { redirects.push(value) }, afterEach() {}, beforeEach: fn => guard = fn }
  const { descriptor } = parse(read('App.vue')), script = compileScript(descriptor, { id: 'auth-navigation' })
  const scope = vue.effectScope()
  const context = { exports: {}, window: { removeEventListener() {} }, require(name) {
    if (name === 'vue') return { ...vue, resolveComponent: name => name, onMounted() {}, onUnmounted: fn => cleanup = fn }
    if (name === 'vue-router') return { useRoute: () => route, useRouter: () => router }
    if (name === 'vue-i18n') return { useI18n: () => ({ t: key => key }) }
    if (name.includes('services/auth')) return auth.exports
    if (name.includes('knowledge')) return { refreshKnowledge() {} }
    return {}
  } }
  vm.runInNewContext(transpile(script.content), context)
  const state = scope.run(() => context.exports.default.setup({}, { expose() {} }))
  const template = compileTemplate({ source: descriptor.template.content, filename: 'App.vue', id: 'auth-navigation', compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  vm.runInNewContext('(function(){'+transpile(template.code)+'})()', context)
  const routerContext = { exports: {}, require(name) {
    if (name === 'vue-router') return { createRouter: () => router, createWebHistory() {} }
    if (name.includes('services/auth')) return auth.exports
    return {}
  } }
  vm.runInNewContext(transpile(read('router/index.ts').replace('import.meta.env.BASE_URL', "'/'")), routerContext)
  return { auth: auth.exports, route, redirects, state, guard: to => guard(to), render: () => context.exports.render({}, [], {}, vue.proxyRefs(state), {}, {}), stop() { cleanup(); scope.stop() } }
}
const nodes = root => !root || typeof root !== 'object' ? [] : [root, ...(Array.isArray(root.children) ? root.children.flatMap(nodes) : [])]

for (const [path, role] of [['/conservation/reviews', 'Conservation Officer'], ['/admin', 'Administrator']]) {
  test(`${role} retains route and blocks protected UI during outage, then recovers`, async () => {
    let status = 200
    const h = harness(async () => status === 200 ? Response.json({ user: {...user,role} }) : Response.json({error:'fixture'},{status}), path)
    try {
      await h.auth.verifySession();status=503
      await h.state.checkSession()
      assert.equal(h.redirects.length,0)
      assert.equal(nodes(h.render()).find(node=>node.type==='main').props.inert,true)
      assert.ok(nodes(h.render()).some(node=>node.props?.role==='alert'))
      assert.equal(await h.guard({path,fullPath:path}),false)
      status=200;await h.state.checkSession()
      assert.equal(nodes(h.render()).find(node=>node.type==='main').props.inert,false)
      assert.equal(await h.guard({path,fullPath:path}),undefined)
      status=401;await h.state.checkSession();assert.deepEqual(h.redirects,['/'])
    } finally { h.stop() }
  })
}

test('an unknown session cannot enter a protected route during verification failure', async () => {
  const h=harness(async()=>Response.json({error:'offline'},{status:503}),'/')
  try { assert.equal(await h.guard({path:'/admin',fullPath:'/admin'}),false);assert.equal(h.auth.sessionSnapshot().user,null) } finally {h.stop()}
})

for(const transition of ['login','logout','account-switch','navigation']) {
  test(`late poll cannot redirect after ${transition}`,async()=>{
    const old=deferred()
    const h=harness(async url=>url==='/api/auth/me'?old.promise:Response.json({user:{...user,id:'new-account'}}))
    try {
      const pending=h.state.checkSession()
      if(transition==='navigation') {h.route.path='/conservation/reports';h.route.fullPath=h.route.path}
      else await h.auth.api('/auth/'+(transition==='logout'?'logout':'login'),'POST',{})
      old.resolve(Response.json({error:'old session'},{status:401}));await pending
      assert.equal(h.redirects.length,0)
      if(transition!=='navigation')assert.equal(h.auth.sessionSnapshot().user?.id??null,transition==='logout'?null:'new-account')
    }finally{h.stop()}
  })
}

test('late navigation guard cannot redirect a newer login or a newer navigation',async()=>{
  for(const login of [false,true]) {
    const old=deferred();const h=harness(async url=>url==='/api/auth/me'?old.promise:Response.json({user}))
    try {
      const pending=h.guard({path:'/admin',fullPath:'/admin'})
      if(login)await h.auth.api('/auth/login','POST',{})
      else await h.guard({path:'/',fullPath:'/'})
      old.resolve(Response.json({error:'old'},{status:401}))
      assert.equal(await pending,false)
    }finally{h.stop()}
  }
})

test('role and password-change guards remain enforced and confirmed anonymous navigation redirects home',async()=>{
  let current=user
  const h=harness(async()=>current?Response.json({user:current}):Response.json({error:'expired'},{status:401}))
  try {
    assert.equal((await h.guard({path:'/admin',fullPath:'/admin'})).name,'home')
    current={...user,mustChangePassword:true}
    assert.equal((await h.guard({path:'/conservation',fullPath:'/conservation'})).name,'change-password')
    assert.equal(await h.guard({path:'/change-password',fullPath:'/change-password',name:'change-password'}),undefined)
    current=null;assert.equal((await h.guard({path:'/conservation',fullPath:'/conservation'})).name,'home')
  }finally{h.stop()}
})


for (const failure of [403, 429, 500, 502, 503, 504, 'network', 'invalid-json', 'invalid-user']) {
  test(`dashboard check does not redirect for temporary ${failure} and Retry recovers`, async () => {
    let mode = 'healthy'
    const h = harness(async () => {
      if (mode === 'healthy') return Response.json({ user })
      if (mode === 'network') throw Error('Fixture offline')
      if (mode === 'invalid-json') return new Response('invalid json')
      if (mode === 'invalid-user') return Response.json({ user: { id: user.id } })
      return Response.json({ error: 'Fixture unavailable' }, { status: mode })
    })
    try {
      await h.auth.verifySession(); mode = failure
      await h.state.checkSession()
      assert.equal(h.redirects.length, 0)
      assert.equal(nodes(h.render()).find(node => node.type === 'main').props.inert, true)
      mode = 'healthy'; await h.state.checkSession()
      assert.equal(h.redirects.length, 0)
      assert.equal(nodes(h.render()).find(node => node.type === 'main').props.inert, false)
    } finally { h.stop() }
  })
}
