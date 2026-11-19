import test from 'node:test'
import assert from 'node:assert/strict'
import {observationEditDestination} from '../src/services/observationEdits.ts'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { parse, compileScript, compileTemplate, compileStyle } from '@vue/compiler-sfc'
import { ObservationEditQueueLimitError, mapObservationEdit } from '../src/services/observationEdits.ts'
import { formatPlantId } from '../src/utils/plantId.ts'
import { reviewDateTime } from '../src/utils/officerMonitoringDisplay.ts'
const filename=new URL('../src/components/conservation/DashboardObservationEdits.vue',import.meta.url)
const {descriptor}=parse(readFileSync(filename,'utf8'))
const script=compileScript(descriptor,{id:'dashboard-edits-test'}),template=compileTemplate({source:descriptor.template.content,filename:filename.pathname,id:'dashboard-edits-test',compilerOptions:{bindingMetadata:script.bindings}})
const transpile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const flush=async()=>{for(let i=0;i<8;i++){await vue.nextTick();await new Promise(setImmediate)}}
const officer={id:'officer',role:'Conservation Officer',status:'Active',mustChangePassword:false}
async function proposal(id='edit-1',origin='subsequent_observation',overrides={}){
 const current={id:'obs-1',plant_id:24,species_id:8,owner_subject:'staff:bot',status:'Approved',origin_type:origin,content:{notes:'Approved'}}
 return mapObservationEdit({id,observation_id:'obs-1',owner_subject:'staff:bot',status:'Pending Review',revision:2,base_revision:4,created_at:'2026-11-16T00:00:00Z',base_snapshot:{content:current.content},proposed_content:{notes:'Proposed'},retained_photo_ids:[],added_photo_count:0,...overrides},async()=>({observation:current}))
}
function harness(initialRows=[],language='en'){
 let rows=initialRows,mode='',listener,release;const calls=[],routes=[],cleanups=[],scope=vue.effectScope(),exports={}
 const messages=JSON.parse(readFileSync(new URL('../src/locales/'+language+'.json',import.meta.url),'utf8'))
 const resolve=key=>key.split('.').reduce((v,k)=>v?.[k],messages)
 const context={exports,console,Error,String,AbortSignal,fetch:async()=>Response.json({names:{bot:'Botanist Aina'}}),require(name){
 if(name==='vue')return {...vue,onBeforeUnmount:fn=>cleanups.push(fn)}
 if(name==='vue-router')return {useRouter:()=>({push:destination=>routes.push(destination)})}
 if(name==='vue-i18n')return {useI18n:()=>({t:(key,params={})=>Object.entries(params).reduce((value,[k,v])=>value.replaceAll('{'+k+'}',String(v)),resolve(key)||key)})}
 if(name.endsWith('/auth'))return {sessionSnapshot:()=>({user:officer,pending:false}),subscribeSession:fn=>{listener=fn;return ()=>{listener=null}}}
 if(name.endsWith('observationEdits'))return {observationEditDestination,ObservationEditQueueLimitError,loadObservationEditQueue:async(read,current)=>{calls.push('queue');if(mode==='capability')await read('/observation-edits/capabilities');if(mode==='limit')throw new ObservationEditQueueLimitError();if(mode==='fail')throw Error('failed');if(mode==='delay')return new Promise(resolve=>release=resolve);return current()?rows:[]},observationEditRequest:async()=>{if(mode==='capability')return {available:false};throw Error('No unsupported transport')}}
 if(name.endsWith('officerMonitoringDisplay'))return {reviewDateTime}
 if(name.endsWith('plantId'))return {formatPlantId}
 if(name.endsWith('.vue'))return {name}
 throw Error(name)
 }}
 vm.runInNewContext('(function(){'+transpile(script.content)+'})()',context)
 const state=scope.run(()=>exports.default.setup({},{expose(){}}))
 vm.runInNewContext('(function(){'+transpile(template.code)+'})()',context)
 return {state,calls,routes,messages,setRows:value=>rows=value,setMode:value=>mode=value,release:value=>release(value),session:(user,pending=false)=>listener(user,pending),render:()=>exports.render({},[],{},vue.proxyRefs(state),{},{}),stop(){cleanups.forEach(fn=>fn());scope.stop()}}
}
function nodes(node){if(Array.isArray(node))return node.flatMap(nodes);if(!node||typeof node!=='object')return [];return [node,...nodes(node.children)]}
function text(node){return nodes(node).map(n=>typeof n.children==='string'?n.children:'').join(' ')}
test('Dashboard shows separate eligible proposal count and both actual origins with exact proposal navigation',async()=>{
 const a=await proposal('proposal-a','initial_registration'),b=await proposal('proposal-b','subsequent_observation')
 const h=harness([a,b])
 try{await flush();assert.equal(h.state.eligible.value.length,2);assert.equal(h.state.preview.value.length,2);assert.equal(a.observation_edit.current.status,'Approved');const tree=nodes(h.render());assert.ok(text(h.render()).includes('Initial Registration'));assert.ok(text(h.render()).includes('Subsequent Field'));assert.ok(tree.some(n=>n.type==='strong'&&n.children==='2'));assert.ok(tree.some(n=>n.props?.value==='proposal-a'));assert.ok(tree.some(n=>n.props?.value==='obs-1'));assert.ok(tree.some(n=>n.props?.value==='staff:bot'));assert.equal(h.state.people.value.get('staff:bot'),'Botanist Aina');h.state.review(h.state.rows.value[1]);assert.equal(h.routes[0].name,'conservation-observations');assert.equal(h.routes[0].query.observationEdit,'proposal-b');assert.equal(h.routes[0].query.review,undefined);h.state.review(h.state.rows.value[0]);assert.equal(h.routes[1].name,'conservation-reviews');assert.equal(h.routes[1].query.observationEdit,'proposal-a')}finally{h.stop()}
})
test('terminal, corrected, self-authored and unapproved baselines are excluded; preview limit does not truncate count',async()=>{
 const rows=await Promise.all(['Pending Review','Approved','Rejected','Cancelled','Correction Required'].map((status,i)=>proposal('status-'+i,'subsequent_observation',{status})))
 rows.push(...await Promise.all(Array.from({length:5},(_,i)=>proposal('extra-'+i))))
 rows.push({...await proposal('self'),owner_subject:'staff:officer'})
 const changed=await proposal('baseline');changed.observation_edit.current.status='Rejected';rows.push(changed)
 const h=harness(rows)
 try{await flush();assert.equal(h.state.eligible.value.length,6);assert.equal(h.state.preview.value.length,4);h.state.review(h.state.rows.value.find(r=>r.status==='Rejected'));assert.equal(h.routes.length,0)}finally{h.stop()}
})
test('Dashboard refresh retrieves newly persisted proposals and never treats the Approved canonical baseline as Pending',async()=>{
 const h=harness([])
 try{await flush();assert.equal(h.state.eligible.value.length,0);h.setRows([await proposal()]);await h.state.load();assert.equal(h.calls.length,2);assert.equal(h.state.eligible.value.length,1);assert.equal(h.state.rows.value[0].observation_edit.current.status,'Approved')}finally{h.stop()}
})
test('queue and cap failures show unavailable rather than zero and permit retry',async()=>{
 for(const mode of ['fail','limit','capability']){const h=harness([await proposal()]);try{await flush();h.setMode(mode);await h.state.load();assert.ok(h.state.error.value);assert.ok(nodes(h.render()).some(n=>n.props?.role==='alert'));assert.ok(!text(h.render()).includes(h.messages.dashboardObservationEdits.empty));assert.equal(h.state.preview.value.length,0);assert.ok(!text(h.render()).includes('Pending edit requests: 0'));if(mode==='limit')assert.equal(h.state.error.value,h.messages.dashboardObservationEdits.limit);h.setMode('');await h.state.load();assert.equal(h.state.eligible.value.length,1)}finally{h.stop()}}
})
test('late requests cannot repopulate data after session changes, newer refresh or disposal',async()=>{
 for(const action of ['session','refresh','dispose']){const h=harness([await proposal()]);try{await flush();h.setMode('delay');const pending=h.state.load();if(action==='session')h.session(null);else if(action==='refresh'){h.setMode('');h.setRows([]);await h.state.load()}else h.stop();h.release([await proposal('stale')]);await pending;assert.equal(h.state.rows.value.length,0);if(action==='session'){h.state.review(await proposal());assert.equal(h.routes.length,0)}}finally{if(action!=='dispose')h.stop()}}
})
test('all locales render valid labels; canonical Dashboard metrics and other sections stay separate',async()=>{
 for(const language of ['en','ms','zh-CN']){const h=harness([await proposal()],language);try{await flush();assert.ok(text(h.render()).includes(h.messages.dashboardObservationEdits.title));assert.ok(text(h.render()).includes(h.messages.dashboardObservationEdits.scope))}finally{h.stop()}}
 const source=readFileSync(new URL('../src/views/conservation/ConservationDashboardView.vue',import.meta.url),'utf8')
 assert.match(source,/<DashboardObservationEdits \/>/);assert.match(source,/observations.value.filter\(requiresReview\).length/);assert.match(source,/loadObservations\(\), loadPlants\(\), loadSpecies\(\), loadAlerts\(\)/)
 assert.equal(compileStyle({source:descriptor.styles[0].content,filename:filename.pathname,id:'dashboard-edits-test'}).errors.length,0)
})
