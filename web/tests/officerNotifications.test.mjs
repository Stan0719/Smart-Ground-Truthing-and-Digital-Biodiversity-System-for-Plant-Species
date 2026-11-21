import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { monitoringLabels } from '../src/utils/officerMonitoringDisplay.ts'
import { formatObservationId } from '../src/utils/observationId.ts'
import { formatSpeciesRequestId } from '../src/utils/speciesRequestId.ts'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createOfficerNotificationRefresh } from '../src/services/officerNotificationRefresh.ts'
import { createOfficerInbox } from '../src/services/officerNotifications.ts'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
const officer = { id: 'one', role: 'Conservation Officer', status: 'Active', mustChangePassword: false }
const notice = (n = 1, changes = {}) => ({ id: `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`, event_type: 'registration_submitted', created_at: '2026-11-01T12:00:00Z', read_at: null, resource: { kind: 'observation', id: String(n) }, ...changes })
const page = (items = [], more = false, cursor = null) => Response.json({ notifications: items, unread_count: items.filter(n => !n.read_at).length, page: { has_more: more, next_cursor: cursor }, read_through: 'signed-boundary' })
function setup(handler, navigate = async () => true) {
  const calls = [], destinations = []
  const client = createOfficerInbox({ transport: async (url, options) => { calls.push({ url, options }); return handler(url, options) }, navigate: async route => { destinations.push(route); return navigate(route) } })
  client.setSession(officer, false)
  return { client, calls, destinations }
}
test('real inbox handles loading, sixth-and-later records, continuation, count and persistent acknowledgements', async () => {
  let release, saved = false
  const h = setup(async (url, options) => {
    if (url.includes('unread-count')) return Response.json({ unread_count: saved ? 0 : 7 })
    if (options.method === 'POST') { saved = true; return url.endsWith('read-all') ? Response.json({ updated: 6 }) : Response.json({ notification: { id: notice().id, read_at: '2026-11-02T00:00:00Z' } }) }
    if (url.startsWith('/api/observations')) return Response.json({ observation: { id: '1', revision: 4, origin_type: 'initial_registration' } })
    if (url.includes('cursor=')) return page([notice(7)])
    if (!release && !saved) return new Promise(resolve => { release = () => resolve(page(Array.from({ length: 6 }, (_, i) => notice(i + 1)), true, 'older')) })
    return page(Array.from({ length: 7 }, (_, i) => notice(i + 1, { read_at: saved ? '2026-11-02T00:00:00Z' : null })))
  })
  const loading = h.client.load(); assert.equal(h.client.state.loading, true); release(); await loading
  assert.equal(h.client.state.items.length, 6); await h.client.load(true); assert.equal(h.client.state.items.length, 7)
  assert.equal(await h.client.open(h.client.state.items[0]), true)
  assert.equal(h.destinations[0].name, 'conservation-reviews'); assert.equal(h.destinations[0].query.review, '1')
  assert.ok(h.client.state.items[0].read_at); await h.client.refreshCount()
  // Restore a positive count to exercise mark-all with the issued boundary.
  h.client.state.unread = 6; await h.client.markAll()
  assert.equal(JSON.parse(h.calls.find(c => c.url.endsWith('read-all')).options.body).read_through, 'signed-boundary')
  assert.equal(h.client.state.unread, 0); h.client.dispose()
})
test('errors are not empty success; append retry preserves records and expired cursor recovers', async () => {
  let status = 200
  const h = setup(async _url => status !== 200 ? Response.json({}, { status }) : page([notice()], true, 'next'))
  await h.client.load(); status = 503; await h.client.load(true)
  assert.equal(h.client.state.items.length, 1); assert.equal(h.client.state.unread, 1); assert.equal(h.client.state.error, 'loadFailed')
  status = 400; await h.client.load(true); assert.equal(h.client.state.cursor, null)
  status = 200; await h.client.load(); assert.equal(h.client.state.error, '')
  status = 403; await h.client.refreshCount(); assert.equal(h.client.state.ready, false); assert.equal(h.client.state.items.length, 0)
  h.client.dispose()
})
test('logout/account change reject late success AND late unauthorized responses', async () => {
  for (const response of [page([notice()]), Response.json({}, { status: 401 })]) {
    let release
    const h = setup(async () => new Promise(resolve => { release = resolve }))
    const pending = h.client.load(); h.client.setSession({ ...officer, id: 'two' }, false)
    release(response); await pending
    assert.equal(h.client.state.items.length, 0); assert.equal(h.client.state.ready, true)
    h.client.setSession(null, false); await h.client.load(); assert.equal(h.calls.length, 1); h.client.dispose()
  }
})
test('fresh origin controls navigation; failed access or navigation never marks read', async () => {
  for (const origin of ['initial_registration', 'subsequent_observation', 'unknown']) {
    const h = setup(async (url, options) => options.method === 'POST' ? Response.json({ notification: { id: notice().id, read_at: '2026-11-02T00:00:00Z' } }) : url.includes('unread-count') ? Response.json({ unread_count: 0 }) : Response.json({ observation: { id: '1', revision: 2, origin_type: origin, status: 'Approved' } }))
    assert.equal(await h.client.open(notice()), true)
    assert.equal(h.destinations[0].name, origin === 'subsequent_observation' ? 'conservation-observations' : 'conservation-reviews')
    if (origin === 'subsequent_observation') assert.equal(h.destinations[0].query.observation, '1')
    h.client.dispose()
  }
  for (const mode of ['missing', 'navigation']) {
    const h = setup(async () => mode === 'missing' ? Response.json({}, { status: 404 }) : Response.json({ observation: { id: '1', revision: 2, origin_type: 'initial_registration' } }), async () => false)
    assert.equal(await h.client.open(notice()), false); assert.ok(!h.calls.some(c => c.options.method === 'POST')); h.client.dispose()
  }
})
test('no unauthorized polling, malformed data is rejected, and uncertain read-all requires refresh', async () => {
  const h = setup(async (url, options) => options.method === 'POST' ? Promise.reject(Error('uncertain')) : page([notice()]))
  h.client.setSession({ ...officer, role: 'Administrator' }, false); await h.client.load(); assert.equal(h.calls.length, 0)
  h.client.setSession(officer, false); await h.client.load(); await h.client.markAll()
  assert.equal(h.client.state.boundary, null); assert.equal(h.client.state.error, 'readFailed'); h.client.dispose()
  const bad = setup(async () => page([notice(1, { resource: { kind: 'observation', id: 'OBS004' } })]))
  await bad.client.load(); assert.equal(bad.client.state.error, 'loadFailed'); bad.client.dispose()
})
test('Officer component preserves dimensions and renders real-state controls with complete EN/MS/ZH labels', () => {
  const content = readFileSync(new URL('../src/components/ConservationTopbarActions.vue', import.meta.url), 'utf8')
  const { descriptor } = parse(content), script = compileScript(descriptor, { id: 'officer-bell' })
  const template = compileTemplate({ source: descriptor.template.content, filename: 'ConservationTopbarActions.vue', id: 'officer-bell', compilerOptions: { bindingMetadata: script.bindings } })
  assert.equal(template.errors.length, 0)
  assert.doesNotMatch(content, /data\/conservationNotifications|slice\(0, 5\)|OBS004|CAM-NOTICE/)
  assert.match(content, /notificationState\.hasMore/); assert.match(content, /nt\('loading'\)/)
  assert.match(content, /event\.key === 'Escape'/); assert.match(content, /notificationButton\.value\?\.focus\(\)/)
  assert.match(content, /width: min\(360px, calc\(100vw - 24px\)\)/); assert.match(content, /max-height: 350px/)
  for (const lang of ['en', 'ms', 'zh-CN']) {
    const labels = JSON.parse(readFileSync(new URL(`../src/locales/${lang}.json`, import.meta.url), 'utf8')).dashboardNotifications.officerLive
    for (const key of ['registrationTitle', 'fieldTitle', 'speciesFirst', 'loading', 'loadFailed', 'sessionUnavailable', 'more', 'unread']) assert.ok(labels[key])
  }
})

 test('count and list failures recover independently without stale responses overwriting newer state', async () => {
  let listStatus=503, countStatus=503
  const h=setup(async url=>url.includes('unread-count') ? Response.json({unread_count:4},{status:countStatus}) : listStatus===200?page([notice()]):Response.json({}, {status:listStatus}))
  await h.client.load(); countStatus=200; await h.client.refreshCount()
  assert.equal(h.client.state.unread,4); assert.equal(h.client.state.listError,'loadFailed'); assert.equal(h.client.state.error,'loadFailed')
  listStatus=200; await h.client.load(); assert.equal(h.client.state.error,'')
  countStatus=503; await h.client.refreshCount(); assert.equal(h.client.state.unread,1)
  countStatus=200; await h.client.refreshCount(); assert.equal(h.client.state.error,''); assert.equal(h.client.state.unread,4)
  h.client.dispose()
  const pending=[];const race=setup(()=>new Promise(resolve=>pending.push(resolve)))
  const first=race.client.refreshCount(), second=race.client.refreshCount()
  pending[1](Response.json({unread_count:9}));await second
  pending[0](Response.json({}, {status:503}));await first
  assert.equal(race.client.state.unread,9);assert.equal(race.client.state.error,'');race.client.dispose()
 })

test('correction notifications preserve full-ID registration navigation and acknowledge only after navigation',async()=>{
 const id='4451e4cb-0000-4000-8000-123456789012'
 const item=notice(1,{event_type:'observation_resubmitted',resource:{kind:'observation',id}})
 const h=setup(async(url,options)=>url.includes('unread-count')?Response.json({unread_count:0}):options.method==='POST'?Response.json({notification:{id:item.id,read_at:'2026-11-02T00:00:00Z'}}):url.startsWith('/api/observations/')?Response.json({observation:{id,revision:2,origin_type:'initial_registration'}}):page([item]))
 await h.client.load();assert.equal(h.client.state.items[0].event_type,'observation_resubmitted');assert.ok(!h.calls.some(c=>c.options.method==='POST'))
 assert.equal(await h.client.open(item),true);assert.equal(h.destinations[0].query.review,id)
 assert.equal(h.calls.filter(c=>c.options.method==='POST').length,1);h.client.dispose()
 for(const lang of ['en','ms','zh-CN']){const labels=JSON.parse(readFileSync(new URL(`../src/locales/${lang}.json`,import.meta.url),'utf8')).dashboardNotifications.officerLive;assert.ok(labels.correctionTitle);assert.ok(labels.correctionMessage)}
})

test('standalone species notices validate resource identity and navigate before one acknowledgement',async()=>{
 const item=notice(1,{event_type:'species_request_submitted',resource:{kind:'species_request',id:'2147483647'}})
 const h=setup(async(url,options)=>url.includes('unread-count')?Response.json({unread_count:0}):options.method==='POST'?Response.json({notification:{id:item.id,read_at:'2026-11-02T00:00:00Z'}}):url.startsWith('/api/species-requests/')?Response.json({species_request:{request_id:2147483647,request_status:'Pending Review'}}):page([item]))
 await h.client.load();assert.equal(h.client.state.items.length,1);assert.ok(!h.calls.some(c=>c.options.method==='POST'))
 assert.equal(await h.client.open(h.client.state.items[0]),true);assert.deepEqual(h.destinations[0],{name:'conservation-reviews',query:{speciesRequest:'2147483647'}});assert.equal(h.calls.filter(c=>c.options.method==='POST').length,1);h.client.dispose()
 for(const resource of [{kind:'observation',id:'1'},{kind:'species_request',id:'2147483648'}]){const bad=setup(async()=>page([{...item,resource}]));await bad.client.load();assert.equal(bad.client.state.error,'loadFailed');bad.client.dispose()}
 for(const lang of ['en','ms','zh-CN']){const labels=JSON.parse(readFileSync(new URL(`../src/locales/${lang}.json`,import.meta.url),'utf8')).dashboardNotifications.officerLive;assert.ok(labels.speciesTitle);assert.ok(labels.speciesMessage)}
})

function deferredResponse() {
 let resolve
 const promise=new Promise(done=>{resolve=done})
 return {promise,resolve}
}
for(const status of [401,403]) {
 test(`superseded count ${status} cannot invalidate a newer successful count`,async()=>{
  const older=deferredResponse(),newer=deferredResponse();let requests=0
  const h=setup(()=>++requests===1?older.promise:newer.promise)
  const first=h.client.refreshCount(),second=h.client.refreshCount()
  newer.resolve(Response.json({unread_count:9}));await second
  older.resolve(Response.json({}, {status}));await first
  assert.equal(h.client.state.ready,true);assert.equal(h.client.state.unread,9);assert.equal(h.client.state.error,'');h.client.dispose()
 })
 test(`current count ${status} immediately invalidates its session`,async()=>{
  const response=deferredResponse();const h=setup(()=>response.promise)
  h.client.state.unread=9;const pending=h.client.refreshCount()
  response.resolve(Response.json({}, {status}));await pending
  assert.equal(h.client.state.ready,false);assert.equal(h.client.state.unread,null);assert.equal(h.client.state.error,'sessionUnavailable');h.client.dispose()
 })
 test(`old count ${status} cannot invalidate a newer list or acknowledgement operation`,async()=>{
  for(const operation of ['list','open','markAll']){
   const old=deferredResponse();let countCalls=0
   const h=setup(async(url,options)=>{
    if(url.includes('unread-count'))return ++countCalls===1?old.promise:Response.json({unread_count:9})
    if(options.method==='POST')return url.endsWith('read-all')?Response.json({updated:1}):Response.json({notification:{id:notice().id,read_at:'2026-11-02T00:00:00Z'}})
    if(url.startsWith('/api/observations/'))return Response.json({observation:{id:'1',revision:1,origin_type:'initial_registration'}})
    return page([notice()])
   })
   const pending=h.client.refreshCount()
   if(operation==='list')await h.client.load()
   else if(operation==='open')await h.client.open(notice())
   else{h.client.state.unread=1;h.client.state.boundary='signed-boundary';await h.client.markAll()}
   old.resolve(Response.json({}, {status}));await pending
   assert.equal(h.client.state.ready,true,operation);assert.notEqual(h.client.state.error,'sessionUnavailable',operation)
   if(operation==='list')assert.equal(h.client.state.unread,1)
   h.client.dispose()
  }
 })
 test(`current list ${status} immediately invalidates the inbox`,async()=>{
  const response=deferredResponse(),h=setup(()=>response.promise),pending=h.client.load()
  response.resolve(Response.json({}, {status}));await pending
  assert.equal(h.client.state.ready,false);assert.equal(h.client.state.unread,null);assert.equal(h.client.state.error,'sessionUnavailable');h.client.dispose()
 })
 test(`old list ${status} cannot invalidate a refreshed verified session or its newer list`,async()=>{
  const older=deferredResponse(),newer=deferredResponse();let requests=0
  const h=setup(()=>++requests===1?older.promise:newer.promise)
  const first=h.client.load();await h.client.load();assert.equal(requests,1,'concurrent list guard remains intact')
  h.client.setSession(officer,true);h.client.setSession(officer,false)
  const second=h.client.load();newer.resolve(page([notice(2)]));await second
  older.resolve(Response.json({}, {status}));await first
  assert.equal(h.client.state.ready,true);assert.equal(h.client.state.items[0].id,notice(2).id);assert.equal(h.client.state.unread,1);assert.equal(h.client.state.error,'');h.client.dispose()
 })
 test(`late read and read-all ${status} responses cannot invalidate another account or a logged-out session`,async()=>{
  for(const operation of ['open','markAll'])for(const logout of [false,true]){
   const acknowledgement=deferredResponse(),started=deferredResponse()
   const h=setup(async(url,options)=>{
    if(options.method==='POST'){started.resolve();return acknowledgement.promise}
    if(url.startsWith('/api/observations/'))return Response.json({observation:{id:'1',revision:1,origin_type:'initial_registration'}})
    if(url.includes('unread-count'))return Response.json({unread_count:9})
    return page([notice(2)])
   })
   h.client.state.unread=1;h.client.state.boundary='signed-boundary'
   const pending=operation==='open'?h.client.open(notice()):h.client.markAll();await started.promise
   h.client.setSession(logout?null:{...officer,id:'another-officer'},false)
   if(!logout)await h.client.refreshCount()
   acknowledgement.resolve(Response.json({}, {status}));await pending
   assert.equal(h.client.state.ready,!logout);assert.equal(h.client.state.unread,logout?null:9);assert.equal(h.client.state.error,'');h.client.dispose()
  }
 })
 test(`current read and read-all ${status} responses still invalidate the inbox`,async()=>{
  for(const operation of ['open','markAll']){
   const h=setup(async(url,options)=>options.method==='POST'?Response.json({}, {status}):Response.json({observation:{id:'1',revision:1,origin_type:'initial_registration'}}))
   h.client.state.unread=1;h.client.state.boundary='signed-boundary'
   if(operation==='open')await h.client.open(notice());else await h.client.markAll()
   assert.equal(h.client.state.ready,false);assert.equal(h.client.state.error,'sessionUnavailable');h.client.dispose()
  }
 })
 test(`in-flight list/count ${status} responses respect both account switch and logout`,async()=>{
  for(const operation of ['load','refreshCount'])for(const logout of [false,true]){
   const response=deferredResponse();let old=true
   const h=setup(()=>old?response.promise:Response.json({unread_count:9}))
   const pending=h.client[operation]();h.client.setSession(logout?null:{...officer,id:'different'},false);old=false
   if(!logout)await h.client.refreshCount()
   response.resolve(Response.json({}, {status}));await pending
   assert.equal(h.client.state.ready,!logout);assert.equal(h.client.state.unread,logout?null:9);assert.equal(h.client.state.error,'');h.client.dispose()
  }
 })
}

test('superseded unauthorized count is ignored entirely while a newer operation is still pending',async()=>{
 for(const status of [401,403])for(const operation of ['open','markAll']){
  const older=deferredResponse(),newer=deferredResponse();let counts=0
  const h=setup(async(url)=>url.includes('unread-count')?++counts===1?older.promise:Response.json({unread_count:9}):newer.promise)
  h.client.state.unread=9;h.client.state.boundary='signed-boundary'
  const count=h.client.refreshCount(),action=operation==='open'?h.client.open(notice()):h.client.markAll()
  older.resolve(Response.json({}, {status}));await count
  assert.equal(h.client.state.ready,true);assert.equal(h.client.state.unread,9);assert.equal(h.client.state.error,'')
  // The newer request is still authoritative: its authorization failure is not hidden.
  newer.resolve(Response.json({}, {status}));await action
  assert.equal(h.client.state.ready,false);assert.equal(h.client.state.error,'sessionUnavailable');h.client.dispose()
 }
})

test('field-observation messages describe the specific record in all supported languages',()=>{
 const expected={en:'A field observation was submitted. Open the specific observation to inspect its current status.',ms:'Pemerhatian lapangan telah dihantar. Buka pemerhatian tersebut untuk memeriksa status semasanya.','zh-CN':'\u6536\u5230\u4e00\u9879\u91ce\u5916\u89c2\u5bdf\u3002\u6253\u5f00\u8be5\u89c2\u5bdf\u8bb0\u5f55\u4ee5\u67e5\u770b\u5f53\u524d\u72b6\u6001\u3002'}
 for(const [lang,message] of Object.entries(expected)){
  const labels=JSON.parse(readFileSync(new URL(`../src/locales/${lang}.json`,import.meta.url),'utf8')).dashboardNotifications.officerLive
  assert.equal(labels.fieldMessage,message)
 }
})

function dropdownHarness(lang='en', transport=null, browser=null) {
 const source=readFileSync(new URL('../src/components/ConservationTopbarActions.vue',import.meta.url),'utf8')
 const {descriptor}=parse(source),script=compileScript(descriptor,{id:'compact-notification'})
 const template=compileTemplate({source:descriptor.template.content,filename:'ConservationTopbarActions.vue',id:'compact-notification',compilerOptions:{bindingMetadata:script.bindings}})
 assert.deepEqual(template.errors,[])
 const scope=vue.effectScope(),cleanup=[],mounted=[],exports={},calls=[]
 const labels=JSON.parse(readFileSync(new URL(`../src/locales/${lang}.json`,import.meta.url),'utf8'))
 const context={exports,Intl,AbortSignal,document:browser?.document || {removeEventListener(){}},window:browser?.window,fetch:async(url,options)=>{calls.push({url,options});if(transport)return transport(url,options);if(url.includes('unread-count'))return Response.json({unread_count:0});if(options.method==='POST')return Response.json({notification:{id:notice().id,read_at:'2026-11-02T00:00:00Z'}});const id=decodeURIComponent(url.split('/').pop());return Response.json({observation:{id,revision:1,origin_type:'subsequent_observation'}})},
 require(name){
  if(name==='vue')return {...vue,onMounted(fn){mounted.push(fn)},withDirectives:node=>node,onBeforeUnmount(fn){cleanup.push(fn)},resolveComponent:name=>name}
  if(name==='vue-i18n')return {useI18n:()=>({locale:vue.ref(lang),t:key=>key.split('.').reduce((o,k)=>o?.[k],labels)||key})}
  if(name==='vue-router'){const currentRoute=vue.ref({name:'conservation-dashboard',query:{}});return {useRouter:()=>({currentRoute,push:async target=>{currentRoute.value=target}})}}
  if(name.endsWith('/auth'))return {sessionSnapshot:()=>({user:officer,pending:false}),subscribeSession:()=>()=>{},logout:async()=>{}}
  if(name.endsWith('/officerNotificationRefresh'))return {createOfficerNotificationRefresh: options=>createOfficerNotificationRefresh({...options,...(browser?.now?{now:browser.now}:{})})}
  if(name.endsWith('/officerNotifications'))return {createOfficerInbox}
  if(name.endsWith('/conservationProfile'))return {conservationProfile:{}}
  if(name.endsWith('/officerMonitoringDisplay'))return {monitoringLabels}
  if(name.endsWith('/observationId'))return {formatObservationId}
  if(name.endsWith('/speciesRequestId'))return {formatSpeciesRequestId}
  if(name.endsWith('.vue'))return {name}
  throw Error(name)
 }}
 const transpile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 vm.runInNewContext(`(function(){${transpile(script.content)}})()`,context)
 const state=scope.run(()=>exports.default.setup({}, {expose(){}}))
 vm.runInNewContext(`(function(){${transpile(template.code)}})()`,context)
 state.notificationsOpen.value=true
 const render=()=>exports.render({},[],{},vue.proxyRefs(state),{},{})
 return {state,calls,render,mount(){mounted.forEach(fn=>fn())},stop(){cleanup.forEach(fn=>fn());scope.stop()}}
}
function dropdownNodes(node){
 if(Array.isArray(node))return node.flatMap(dropdownNodes)
 if(!node||typeof node!=='object')return []
 return [node,...dropdownNodes(node.children)]
}
function visibleDropdownText(node){
 if(Array.isArray(node))return node.map(visibleDropdownText).join(' ')
 if(typeof node==='string')return node
 if(!node||node.type===vue.Comment||node.props?.class==='notification-unread-label')return ''
 return visibleDropdownText(node.children)
}
test('compact dropdown renders titles, friendly references and localized timestamps without descriptions, UUIDs or footer',()=>{
 for(const lang of ['en','ms','zh-CN']){
  const h=dropdownHarness(lang)
  try{
   const raw='6aed3330-0000-4000-8000-123456789012'
   const items=[notice(1,{resource:{kind:'observation',id:raw}}),notice(2,{event_type:'field_observation_submitted',resource:{kind:'observation',id:raw},read_at:'2026-11-02T00:00:00Z'}),notice(3,{event_type:'observation_resubmitted',resource:{kind:'observation',id:'18'}}),notice(4,{event_type:'species_request_submitted',resource:{kind:'species_request',id:'73'}})]
   h.state.notificationState.items=items;h.state.notificationState.unread=3
   const tree=dropdownNodes(h.render()),text=visibleDropdownText(h.render())
   assert.ok(!text.includes(raw));assert.match(text,/OBS-6AED3330/);assert.match(text,/OBS018/);assert.match(text,/SR073/)
   assert.ok(!tree.some(n=>n.type==='footer'));assert.ok(!tree.some(n=>n.type==='small'&&n.children===raw))
   const messages=JSON.parse(readFileSync(new URL(`../src/locales/${lang}.json`,import.meta.url),'utf8'))
   assert.ok(!text.includes(messages.dashboardNotifications.officerLive.registrationMessage));assert.ok(!text.includes(messages.dashboardNotifications.officerLive.fieldMessage))
   const buttons=tree.filter(n=>n.type==='button'&&n.props?.class?.includes('notification-item'))
   assert.equal(buttons.length,4);assert.equal(tree.filter(n=>n.type==='time').length,4)
   assert.equal(tree.filter(n=>n.type==='time')[0].props.datetime,items[0].created_at)
   assert.equal(tree.filter(n=>n.type==='time')[0].children,new Intl.DateTimeFormat(lang.startsWith('en') ? 'en-GB' : lang,{day:'numeric',month:'long',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(items[0].created_at)))
   assert.equal(tree.filter(n=>n.props?.class==='notification-type review').every(n=>dropdownNodes(n).some(child=>child.type==='svg')),true)
   assert.equal(tree.filter(n=>n.props?.class==='notification-unread-label').length,3)
   assert.equal(h.state.notificationState.items[0].resource.id,raw);assert.equal(h.calls.length,0)
  }finally{h.stop()}
 }
})
test('compact identifiers extend loaded collisions and exact navigation still uses the original UUID',async()=>{
 const h=dropdownHarness()
 try{
  const ids=['6aed3330-0000-4000-8000-123456789012','6aed3330-1111-4000-8000-123456789012','6AED3330-0000-4000-8000-123456789012']
  h.state.notificationState.items=ids.map((id,n)=>notice(n+1,{event_type:'field_observation_submitted',resource:{kind:'observation',id}}))
  const references=h.state.notificationState.items.map(h.state.noticeReference)
  assert.equal(new Set(references).size,3);assert.ok(references.every(label=>label.length<30&&!ids.includes(label)))
  const button=dropdownNodes(h.render()).find(n=>n.type==='button'&&n.props?.class?.includes('notification-item'))
  await button.props.onClick();assert.ok(h.calls.some(c=>c.url==='/api/observations/'+ids[0]));assert.ok(h.calls.some(c=>c.url.endsWith('/read')))
 }finally{h.stop()}
})
test('compact presentation preserves loading, error/retry, empty and pagination controls',()=>{
 const h=dropdownHarness()
 try{
  const state=h.state.notificationState;state.loading=true;assert.ok(dropdownNodes(h.render()).some(n=>n.props?.role==='status'))
  state.loading=false;state.listError='loadFailed';assert.ok(dropdownNodes(h.render()).some(n=>n.props?.role==='alert'))
  state.listError='';assert.ok(visibleDropdownText(h.render()).includes('No notifications'))
  state.hasMore=true;assert.ok(dropdownNodes(h.render()).some(n=>n.type==='button'&&n.props?.class==='notification-item'))
 }finally{h.stop()}
})

const unreadDots=h=>dropdownNodes(h.render()).filter(n=>n.type==='i'&&n.props?.['aria-hidden']==='true')
test('persisted read_at controls the decorative red dot and non-color unread announcement',()=>{
 const h=dropdownHarness()
 try{
  h.state.notificationState.items=[notice(),notice(2,{read_at:'2026-11-02T00:00:00Z'})]
  assert.equal(unreadDots(h).length,1)
  assert.equal(dropdownNodes(h.render()).filter(n=>n.props?.class==='notification-unread-label').length,1)
  h.state.notificationState.items[0].read_at='2026-11-02T00:00:00Z';assert.equal(unreadDots(h).length,0)
  const source=readFileSync(new URL('../src/components/ConservationTopbarActions.vue',import.meta.url),'utf8')
  assert.match(source,/grid-template-columns: 31px minmax\(0, 1fr\) 8px/)
  assert.match(source,/\.notification-item > i \{\s*width: 8px;\s*height: 8px;[\s\S]*?background: #D94040/)
  assert.match(source,/font-size: 14px; font-weight: 400/);assert.match(source,/color: #204c3d; font-weight: 600/)
 }finally{h.stop()}
})
test('only confirmed acknowledgements remove dots; read items still navigate without another POST',async()=>{
 for(const success of [true,false]){
  const ack=deferredResponse();let posts=0
  const h=dropdownHarness('en',async(url,options)=>{
   if(url.includes('unread-count'))return Response.json({unread_count:success?0:1})
   if(options.method==='POST'){posts++;return ack.promise}
   return Response.json({observation:{id:'1',revision:1,origin_type:'subsequent_observation'}})
  })
  try{
   h.state.notificationState.items=[notice()]
   const pending=h.state.openNotification(h.state.notificationState.items[0]);await new Promise(resolve=>setImmediate(resolve))
   assert.equal(posts,1);assert.equal(unreadDots(h).length,1)
   ack.resolve(success?Response.json({notification:{id:notice().id,read_at:'2026-11-02T00:00:00Z'}}):Response.json({}, {status:503}));await pending
   h.state.notificationsOpen.value=true;assert.equal(unreadDots(h).length,success?0:1)
   if(success){await h.state.openNotification(h.state.notificationState.items[0]);assert.equal(posts,1);assert.equal(h.calls.filter(c=>c.url==='/api/observations/1').length,2)}
   else assert.equal(h.state.notificationState.items[0].read_at,null)
  }finally{h.stop()}
 }
})
test('mark-all refetches persisted states and preserves unread deliveries beyond its signed boundary across reopen and refresh',async()=>{
 let saved=false
 const h=dropdownHarness('en',async(url,options)=>{
  if(options.method==='POST'){assert.equal(url,'/api/data/staff-notifications/read-all');assert.deepEqual(JSON.parse(options.body),{read_through:'signed-boundary'});saved=true;return Response.json({updated:1})}
  if(url.includes('unread-count'))return Response.json({unread_count:1})
  return page(saved?[notice(1,{read_at:'2026-11-02T00:00:00Z'}),notice(2)]:[notice()])
 })
 try{
  await h.state.inbox.load();assert.equal(unreadDots(h).length,1)
  await h.state.inbox.markAll();assert.equal(unreadDots(h).length,1);assert.ok(h.state.notificationState.items[0].read_at);assert.equal(h.state.notificationState.items[1].read_at,null)
  h.state.notificationsOpen.value=false;h.state.toggleNotifications();await new Promise(resolve=>setImmediate(resolve));assert.equal(unreadDots(h).length,1)
  h.state.inbox.setSession(officer,true);h.state.inbox.setSession(officer,false);await h.state.inbox.load();assert.equal(unreadDots(h).length,1)
  assert.equal(h.calls.filter(c=>c.options.method==='POST').length,1)
 }finally{h.stop()}
})

test('record-change notifications accept both target types and open the exact completed or pending proposal before read acknowledgement', async()=>{
  for(const status of ['Pending Review','Approved','Rejected','Cancelled']) {
    const id='12345678-1234-1234-1234-123456789abc';
    const item=notice(1,{event_type:'record_change_submitted',change_target_type:'plant',resource:{kind:'record_change',id}});
    const h=setup(async(url,options)=>url.startsWith('/api/data/record-changes/')?Response.json({change:{id,status}}):options.method==='POST'?Response.json({notification:{id:item.id,read_at:'2026-11-02T00:00:00Z'}}):page([item]));
    await h.client.load();assert.equal(h.client.state.items[0].change_target_type,'plant');
    assert.equal(await h.client.open(h.client.state.items[0]),true);
    assert.deepEqual(h.destinations[0],{name:'conservation-reviews',query:{change:id}});
    assert.ok(h.client.state.items[0].read_at);
  }
});

test('mounted Officer header updates badge and open/closed dropdown automatically and preserves scrolled content',async()=>{
  const flush=()=>new Promise(resolve=>setImmediate(resolve))
  let now=0, sequence=0, items=[notice(1)], unread=2
  const timers=new Map(),listeners=new Map()
  const events=scope=>({addEventListener(name,listener){listeners.set(scope+name,listener)},removeEventListener(name){listeners.delete(scope+name)}})
  const browser={now:()=>now,document:{visibilityState:'visible',...events('document')},window:{navigator:{onLine:true},...events('window'),setTimeout(callback,delay){const id=++sequence;timers.set(id,{callback,at:now+delay});return id},clearTimeout(id){timers.delete(id)}}}
  const h=dropdownHarness('en',()=>Response.json({notifications:items,unread_count:unread,page:{has_more:false,next_cursor:null},read_through:'boundary'}),browser)
  async function interval(){const [id,timer]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];timers.delete(id);now=timer.at;timer.callback();await flush()}
  try {
    h.state.notificationsOpen.value=false;h.mount();await flush()
    assert.equal(h.state.notificationState.unread,2)
    items=[notice(2),notice(1)];unread=3;await interval()
    assert.equal(h.state.notificationsOpen.value,false);assert.equal(h.state.notificationState.unread,3)
    assert.equal(dropdownNodes(h.render()).find(n=>n.props?.class==='notification-count').children,'3')
    h.state.notificationsOpen.value=true
    let anchorTop=90
    const anchor={dataset:{notificationId:notice(1).id},getBoundingClientRect:()=>({top:anchorTop,bottom:anchorTop+40})}
    h.state.notificationList.value={isConnected:true,scrollTop:40,getBoundingClientRect:()=>({top:80}),querySelectorAll:()=>[anchor]}
    items=[notice(3),notice(2),notice(1)];unread=4
    await interval()
    assert.equal(h.state.notificationsOpen.value,true);assert.equal(h.state.notificationState.unread,4)
    assert.equal(h.state.notificationList.value.scrollTop,40)
    assert.equal(dropdownNodes(h.render()).filter(n=>n.props?.class?.includes?.('notification-item')&&n.props?.['data-notification-id']).length,3)
    assert.equal(h.calls.length,3,'one refresh per interval, independent of dropdown visibility')
  } finally {h.stop()}
  assert.equal(timers.size,0);assert.equal(listeners.size,0)
})


const editNotice = (revision=1,type='observation_edit_submitted') => notice(91,{event_type:type,resource:{kind:'observation_edit',id:'12345678-1234-4234-8234-123456789abc',revision}})
test('Observation edit notices validate exact identity/revision and open authoritative proposal detail only',async()=>{
 for(const type of ['observation_edit_submitted','observation_edit_resubmitted']){
  const n=editNotice(2,type)
  const h=setup(async(url)=>{if(url.includes('/observations/obs-target'))return Response.json({observation:{id:'obs-target',owner_subject:'staff:bot',origin_type:'subsequent_observation'}});if(url.includes('/observation-edits/'))return Response.json({edit:{id:n.resource.id,revision:3,status:'Pending Review',observation_id:'obs-target',owner_subject:'staff:bot'}});if(url.endsWith('/read'))return Response.json({notification:{id:n.id,read_at:'2026-11-18T00:00:00Z'}});if(url.includes('unread-count'))return Response.json({unread_count:0});return page([n])})
  await h.client.load();assert.equal(h.client.state.items[0].resource.revision,2)
  assert.equal(await h.client.open(h.client.state.items[0]),true);assert.deepEqual(h.destinations[0],{name:'conservation-observations',query:{observationEdit:n.resource.id}})
  assert.ok(h.calls.some(c=>c.url==='/api/data/observation-edits/'+n.resource.id&&c.options.method==='GET'));assert.ok(!h.calls.some(c=>c.url.endsWith('/review')));assert.ok(h.client.state.items[0].read_at);h.client.dispose()
 }
})
test('Observation edit notices reject malformed identities, missing revisions and future revision claims',async()=>{
 for(const resource of [{kind:'observation_edit',id:'wrong',revision:1},{kind:'record_change',id:editNotice().resource.id,revision:1},{kind:'observation_edit',id:editNotice().resource.id},{kind:'observation_edit',id:editNotice().resource.id,revision:0}]){
  const h=setup(async()=>page([notice(91,{event_type:'observation_edit_submitted',resource})]));await h.client.load();assert.equal(h.client.state.items.length,0);assert.equal(h.client.state.error,'loadFailed');h.client.dispose()
 }
 const h=setup(async()=>Response.json({edit:{id:editNotice().resource.id,revision:1,status:'Pending Review'}}));assert.equal(await h.client.open(editNotice(2)),false);assert.equal(h.destinations.length,0);assert.ok(!h.calls.some(c=>c.options.method==='POST'));h.client.dispose()
})
test('completed Observation edit notices stay navigable without restoring decisions; unavailable detail never acknowledges',async()=>{
 for(const status of ['Approved','Rejected','Cancelled','Correction Required']){
  const n=editNotice(),h=setup(async(url)=>url.includes('/observations/obs-target')?Response.json({observation:{id:'obs-target',owner_subject:'staff:bot',origin_type:'subsequent_observation'}}):url.includes('/observation-edits/')?Response.json({edit:{id:n.resource.id,revision:1,status,observation_id:'obs-target',owner_subject:'staff:bot'}}):url.includes('unread-count')?Response.json({unread_count:0}):Response.json({notification:{id:n.id,read_at:'2026-11-18T00:00:00Z'}}))
  assert.equal(await h.client.open(n),true);assert.equal(h.destinations[0].query.observationEdit,n.resource.id);assert.ok(h.calls.every(c=>c.options.method==='GET'||c.url.endsWith('/read')));h.client.dispose()
 }
 const h=setup(async()=>Response.json({},{status:404}));assert.equal(await h.client.open(editNotice()),false);assert.equal(h.client.state.error,'openFailed');assert.equal(h.destinations.length,0);h.client.dispose()
})
test('late Observation edit detail after account change cannot navigate or acknowledge',async()=>{
 let release;const h=setup(()=>new Promise(resolve=>release=resolve));const pending=h.client.open(editNotice());h.client.setSession({...officer,id:'another'},false);release(Response.json({edit:{id:editNotice().resource.id,revision:1,status:'Pending Review'}}));assert.equal(await pending,false);assert.equal(h.destinations.length,0);assert.ok(!h.calls.some(c=>c.options.method==='POST'));h.client.dispose()
})
test('Observation edit bell titles are localized in EN, Malay and Chinese',()=>{
 for(const language of ['en','ms','zh-CN']){const labels=JSON.parse(readFileSync(new URL('../src/locales/'+language+'.json',import.meta.url),'utf8')).observationEditNotices;assert.deepEqual(Object.keys(labels).sort(),['resubmitted','submitted']);assert.ok(labels.submitted);assert.ok(labels.resubmitted);assert.notEqual(labels.submitted,labels.resubmitted)}
 const source=readFileSync(new URL('../src/components/ConservationTopbarActions.vue',import.meta.url),'utf8');assert.match(source,/observationEditNotices.submitted/);assert.match(source,/observationEditNotices.resubmitted/)
})


test('Withdrawn Species notification navigates to authoritative read-only details',async()=>{
 const item=notice(1,{event_type:'species_request_submitted',resource:{kind:'species_request',id:'73'}})
 const h=setup(async(url,options)=>options.method==='POST'?Response.json({notification:{id:item.id,read_at:'2026-11-02T00:00:00Z'}}):url.startsWith('/api/species-requests/')?Response.json({species_request:{request_id:73,request_status:'Withdrawn'}}):page([item]))
 try{await h.client.load();assert.equal(await h.client.open(h.client.state.items[0]),true);assert.equal(h.destinations[0].query.speciesRequest,'73');assert.ok(h.calls.filter(c=>c.options.method==='POST').every(c=>!c.url.endsWith('/review')))}finally{h.client.dispose()}
})


test('initial and unclassified Observation edit notices preserve authorized compatibility details',async()=>{
 for(const origin of ['initial_registration','unknown']){
  const n=editNotice(),h=setup(async url=>url.includes('/observation-edits/')?Response.json({edit:{id:n.resource.id,revision:1,status:'Pending Review',observation_id:'obs-target',owner_subject:'staff:bot'}}):url.includes('/observations/obs-target')?Response.json({observation:{id:'obs-target',owner_subject:'staff:bot',origin_type:origin}}):url.includes('unread-count')?Response.json({unread_count:0}):Response.json({notification:{id:n.id,read_at:'2026-11-18T00:00:00Z'}}));
  assert.equal(await h.client.open(n),true);assert.equal(h.destinations[0].name,'conservation-reviews');assert.equal(h.destinations[0].query.observationEdit,n.resource.id);assert.ok(!h.calls.some(c=>c.url.endsWith('/review')));h.client.dispose()
 }
})


test('canonical Threat notices validate all metrics, open the exact alert then acknowledge without reviewing it', async () => {
 const metrics={Sensor:['temperature','humidity','soilMoisture','movement','rainfall','sound'],Camera:['human_detected','animal_detected','suspicious_movement','possible_plant_contact']}
 for(const [source,keys] of Object.entries(metrics))for(const metric of keys){
  const item=notice(98,{event_type:'threat_alert_created',resource:{kind:'threat_alert',id:'older-alert'},threat_context:{source,metric,value:0,device_id:'sensor',reading_id:source==='Sensor'?'reading':null,camera_id:source==='Camera'?'camera':null}})
  const h=setup(async(url,options)=>{
   if(url==='/api/data/alerts/older-alert')return Response.json({alert:{id:'older-alert',metric,value:0,status:'Resolved'}})
   if(options.method==='POST')return Response.json({notification:{id:item.id,read_at:'2026-11-02T00:00:00Z'}})
   if(url.endsWith('unread-count'))return Response.json({unread_count:0})
   return page([item])
  })
  await h.client.load();assert.equal(h.client.state.items.length,1);assert.equal(h.client.state.items[0].threat_context.value,0)
  assert.equal(await h.client.open(h.client.state.items[0]),true)
  assert.deepEqual(h.destinations,[{name:'conservation-alerts',query:{alert:'older-alert'}}])
  assert.equal(h.calls.filter(c=>c.options.method==='POST').length,1)
  assert.ok(h.calls.find(c=>c.options.method==='POST').url.endsWith('/read'));h.client.dispose()
 }
})
test('Threat notices reject forged source/metric context; unavailable exact alerts never acknowledge',async()=>{
 const base=notice(99,{event_type:'threat_alert_created',resource:{kind:'threat_alert',id:'older-alert'},threat_context:{source:'Sensor',metric:'movement',value:1,device_id:'sensor',reading_id:'reading',camera_id:null}})
 for(const change of [{source:'Transient'},{source:'Camera'},{value:null},{device_id:''}]){
  const h=setup(async()=>page([{...base,threat_context:{...base.threat_context,...change}}]));await h.client.load();assert.equal(h.client.state.error,'loadFailed');assert.equal(h.client.state.items.length,0);h.client.dispose()
 }
 for(const status of [403,404,503]){
  const h=setup(async(url)=>url.includes('/alerts/')?Response.json({}, {status}):page([base]));await h.client.load();assert.equal(await h.client.open(h.client.state.items[0]),false);assert.equal(h.calls.filter(c=>c.options.method==='POST').length,0);h.client.dispose()
 }
})
test('Sensor and Camera bell titles, metric context and icons render in EN/MS/ZH',()=>{
 for(const locale of ['en','ms','zh-CN']){
  const labels=JSON.parse(readFileSync(new URL(`../src/locales/${locale}.json`,import.meta.url),'utf8')).threatAlertNotices
  const h=dropdownHarness(locale)
  try{
   h.state.notificationState.items=['Sensor','Camera'].map((source,i)=>notice(i+1,{event_type:'threat_alert_created',resource:{kind:'threat_alert',id:'alert-'+i},threat_context:{source,metric:source==='Sensor'?'temperature':'human_detected',value:source==='Sensor'?40:1,device_id:'device',reading_id:null,camera_id:null}}))
   const rendered=visibleDropdownText(h.render());assert.ok(rendered.includes(labels.sensor));assert.ok(rendered.includes(labels.camera));assert.ok(rendered.includes(labels.metrics.temperature));assert.ok(rendered.includes(labels.metrics.human_detected));assert.ok(!rendered.includes('threatAlertNotices.'))
  }finally{h.stop()}
 }
})
