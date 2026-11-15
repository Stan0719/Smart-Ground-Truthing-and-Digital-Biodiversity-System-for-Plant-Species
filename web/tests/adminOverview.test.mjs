import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { parse, compileScript } from '@vue/compiler-sfc'
const source = readFileSync(new URL('../src/services/adminOverview.ts', import.meta.url),'utf8')
function service(responses = {}) {
  const exports = {}, paths = []
  const request = async path => { paths.push(path); const r = responses[path]; if (r instanceof Error || r === undefined) throw r || Error('Unavailable'); return r }
  vm.runInNewContext(ts.transpileModule(source,{ compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,{ exports, Intl, Date, require: () => ({api: request, plantApi: request}) })
  return { ...exports, paths }
}
const fixtures = () => ({ '/admin/users': {users:[{id:'staff:a',role:'Administrator'},{id:'visitor:a',role:'Visitor'}]}, '/devices':{devices:[{id:'d',status:'Active',last_seen:null}]}, '/alerts':{alerts:[]}, '/admin/audit':{events:[]}, '/admin/overview':{overview:{plants:3,alerts:0}}, '/admin/system':{system:{database:'postgresql'}} })
test('authoritative collections and integer totals use independent APIs without species counts', async()=>{
 const h=service(fixtures()), data=await h.loadOverview()
 assert.equal(data.totals.plants,3);assert.equal(data.totals.alerts,0);assert.equal(data.healthy,true)
 assert.equal(h.accountSummary(data.users).total,2);assert.equal(h.accountSummary(data.users).roles,2)
 assert.equal(h.paths.includes('/species'),false)
})
test('confirmed empty datasets stay zero, malformed totals and failures stay unavailable',async()=>{
 const f=fixtures();f['/admin/users']={users:[]};f['/admin/overview']={overview:{plants:0,alerts:0}}
 let h=service(f);let d=await h.loadOverview();assert.equal(h.accountSummary(d.users).total,0);assert.equal(d.totals.plants,0)
 for(const plants of [undefined,null,'3',NaN,-1,Infinity]) {f['/admin/overview']={overview:{plants,alerts:0}};d=await service(f).loadOverview();assert.equal(d.totals,null)}
 d=await service().loadOverview();assert.equal(d.users,null);assert.equal(d.devices,null);assert.equal(d.healthy,false)
})
test('partial failures never replace successful sections with sample data',async()=>{
 const f=fixtures();f['/devices']=Error('403');const d=await service(f).loadOverview()
 assert.equal(d.devices,null);assert.equal(d.totals.plants,3);assert.equal(d.users.length,2)
})
test('directory identities deduplicate and dates convert to Malaysia time with safe fallbacks',()=>{
 const h=service();assert.equal(h.accountSummary([{id:'a',role:'Visitor'},{id:'a',role:'Visitor'}]).total,1)
 assert.equal(h.overviewDate('2026-11-10T20:00:00Z'),'11 Nov 2026, 04:00')
 for(const value of [null,undefined,'','invalid'])assert.equal(h.overviewDate(value),'—')
})
test('Overview retains table styles, routes and session invalidation, without fabricated connectivity',()=>{
 const view=readFileSync(new URL('../src/views/AdminDashboardView.vue',import.meta.url),'utf8')
 assert.match(view,/admin-data-table admin-overview-table/);assert.match(view,/name: 'admin-iot'/)
 assert.match(view,/version === generation/);assert.match(view,/stopSession\?\.\(\)/);assert.match(view,/removeEventListener/)
 assert.match(view,/Connectivity unavailable/);assert.doesNotMatch(view,/speciesCount|A001|S001|92\.6%|2 mins ago|createdBotanist/)
})

test('account directory owns archived exclusion and serves staff and Visitors',()=>{
 const operations=readFileSync(new URL('../server/operations.mjs',import.meta.url),'utf8')
 assert.match(operations,/SELECT \* FROM users WHERE id NOT IN/)
 assert.match(operations,/SELECT \* FROM visitors WHERE id NOT IN/)
 assert.match(operations,/reason='account_archived'/)
})

function viewHarness(load) {
 const {descriptor}=parse(readFileSync(new URL('../src/views/AdminDashboardView.vue',import.meta.url),'utf8'))
 const script=compileScript(descriptor,{id:'overview-test'}),exports={},hooks={},listeners={}
 let user={role:'Administrator'}, subscriber
 const helpers=service()
 vm.runInNewContext(ts.transpileModule(script.content,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{
  exports, Intl, Date, window:{addEventListener:(n,f)=>listeners[n]=f,removeEventListener:n=>delete listeners[n],scrollTo(){}},
  require(name){
   if(name==='vue')return {...vue,onMounted:f=>hooks.mount=f,onBeforeUnmount:f=>hooks.unmount=f}
   if(name==='vue-router')return {useRouter:()=>({push:async()=>{}})}
   if(name==='vue-i18n')return {useI18n:()=>({t:k=>k,te:()=>false})}
   if(name.endsWith('/adminOverview'))return {...helpers,loadOverview:load}
   if(name.endsWith('/plantId'))return {formatPlantId:id=>`PL${String(id).padStart(3,'0')}`}
   if(name.endsWith('/auth'))return {sessionSnapshot:()=>({user}),subscribeSession:f=>{subscriber=f;return()=>subscriber=null}}
   if(name.endsWith('.vue'))return {}
   throw Error(name)
  }
 })
 const state=exports.default.setup({}, {expose(){}})
 return {state,hooks,listeners,session(value,pending=false){user=value;subscriber?.(value,pending)}}
}
test('real view derives registration counts, zero-safe donut, ordered recent alerts and real last ingestion',()=>{
 const h=viewHarness(async()=>service().emptyOverview()),v=h.state
 v.overview.value={...service().emptyOverview(),devices:[{id:'a',plant_id:8,status:'Active',latest_reading:{values:{temperature:22,humidity:64,movement:0},created_at:'2026-11-10T20:00:00Z'}},{id:'b',status:'Inactive'},{id:'c',status:'Unknown'}],alerts:[{id:'old',device_id:'a',metric:'movement',status:'New',created_at:'2026-11-01T00:00:00Z'},{id:'new',device_id:'a',metric:'temperature',status:'Resolved',created_at:'2026-11-11T00:00:00Z'}]}
 assert.equal(v.active.value,1);assert.equal(v.threatAlerts.value[0].id,'new');assert.equal(v.threatAlerts.value[0].plant,8)
 assert.equal(v.threatAlerts.value[0].severity,'—');assert.equal(v.lastSync.value,'11 Nov 2026, 04:00')
 assert.match(v.donutStyle.value.background,/33\.333/)
 assert.equal(v.summaryCards.value.find(c=>c.title==='offlineSensors').value,'—')
 v.overview.value.devices=[];assert.doesNotMatch(v.donutStyle.value.background,/NaN|Infinity/)
 assert.match(v.currentDate.value,/\d{4}/);assert.match(v.greeting.value,/Good (morning|afternoon|evening)/)
})
test('focus refresh guards overlapping requests and session changes invalidate stale content',async()=>{
 let resolve,calls=0
 const h=viewHarness(()=>{calls++;return new Promise(r=>resolve=r)})
 h.hooks.mount();assert.equal(calls,1)
 await h.state.refresh();assert.equal(calls,1)
 h.session(null);assert.equal(h.state.overview.value.users,null)
 resolve({...service().emptyOverview(),users:[{id:'private',role:'Administrator'}]})
 await new Promise(r=>setImmediate(r));assert.equal(h.state.overview.value.users,null)
 h.hooks.unmount();assert.equal(h.listeners.focus,undefined)
})
