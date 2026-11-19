import test from 'node:test'
import assert from 'node:assert/strict'
import {observationEditDestination} from '../src/services/observationEdits.ts'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { ObservationEditQueueLimitError, ObservationEditError, ObservationEditCapabilityError, mapObservationEdit } from '../src/services/observationEdits.ts'
import { formatPlantId } from '../src/utils/plantId.ts'
import { workflowBadgeStyle } from '../src/utils/workflowBadge.ts'
import { reviewDateTime } from '../src/utils/officerMonitoringDisplay.ts'
const filename=new URL('../src/components/conservation/ObservationEditQueue.vue',import.meta.url)
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
 let rows=initialRows,mode='',listener,release;const calls=[],routes=[],states=[],cleanups=[],scope=vue.effectScope(),exports={}
 const messages=JSON.parse(readFileSync(new URL('../src/locales/'+language+'.json',import.meta.url),'utf8'))
 const resolve=key=>key.split('.').reduce((v,k)=>v?.[k],messages)
 const context={exports,console,Error,String,AbortSignal,fetch:async()=>Response.json({names:{bot:'Botanist Aina'}}),require(name){
 if(name==='vue')return {...vue,withDirectives:node=>node,onBeforeUnmount:fn=>cleanups.push(fn)}
 if(name==='vue-router')return {useRouter:()=>({push:destination=>routes.push(destination)})}
 if(name==='vue-i18n')return {useI18n:()=>({t:(key,params={})=>Object.entries(params).reduce((value,[k,v])=>value.replaceAll('{'+k+'}',String(v)),resolve(key)||key)})}
 if(name.endsWith('/auth'))return {sessionSnapshot:()=>({user:officer,pending:false}),subscribeSession:fn=>{listener=fn;return ()=>{listener=null}}}
 if(name.endsWith('observationEdits'))return {observationEditDestination,ObservationEditQueueLimitError,ObservationEditError,ObservationEditCapabilityError,loadObservationEditQueue:async(read,current)=>{calls.push('queue');if(mode==='capability')await read('/observation-edits/capabilities');if(mode==='limit')throw new ObservationEditQueueLimitError();if(mode==='fail')throw Error('failed');if(mode==='evidence')throw Object.assign(Error('invalid evidence'),{name:'ObservationEditEvidenceError'});if(mode==='forbidden')throw new ObservationEditError(403);if(mode==='delay')return new Promise(resolve=>release=resolve);return current()?rows:[]},observationEditRequest:async()=>{if(mode==='capability')return {available:false};throw Error('No unsupported transport')}}
 if(name.endsWith('officerMonitoringDisplay'))return {reviewDateTime}
 if(name.endsWith('workflowBadge'))return {workflowBadgeStyle}
 if(name.endsWith('plantId'))return {formatPlantId}
 if(name.endsWith('.vue'))return {name}
 throw Error(name)
 }}
 vm.runInNewContext('(function(){'+transpile(script.content)+'})()',context)
 const state=scope.run(()=>exports.default.setup({},{expose(){},emit:(_event,value)=>states.push(value)}))
 vm.runInNewContext('(function(){'+transpile(template.code)+'})()',context)
 return {state,calls,routes,states,messages,setRows:value=>rows=value,setMode:value=>mode=value,release:value=>release(value),session:(user,pending=false)=>listener(user,pending),render:()=>exports.render({},[],{},vue.proxyRefs(state),{},{}),stop(){cleanups.forEach(fn=>fn());scope.stop()}}
}


test('queue controller exposes separate namespaced proposal data and exact navigation without a second table',async()=>{
 const a=await proposal('a','initial_registration'),b=await proposal('b'),h=harness([a,b,a]);try{await flush();assert.equal(h.state.rows.value.length,2);assert.equal(h.states.at(-1).rows.length,2);assert.equal(h.states.at(-1).names.bot,'Botanist Aina');h.state.view(b);assert.equal(h.routes[0].name,'conservation-observations');assert.equal(h.routes[0].query.observationEdit,'b');assert.doesNotMatch(descriptor.template.content,/<table|<section|<select/);assert.match(descriptor.template.content,/<ObservationEditReview/)}finally{h.stop()}
})
test('controller failures and 500-row guard stay visible and retry only its own source',async()=>{
 for(const mode of ['fail','limit','capability','forbidden','evidence']){const h=harness([await proposal()]);try{await flush();h.setMode(mode);await h.state.load();assert.ok(h.state.error.value);assert.equal(h.states.at(-1).rows.length,0);if(mode==='evidence')assert.equal(h.state.error.value,h.messages.unifiedObservations.invalidEvidence);if(mode==='limit')assert.equal(h.state.error.value,h.messages.observationEditQueue.limit);if(mode==='forbidden')assert.ok(h.state.error.value.includes('403'));h.setMode('');await h.state.load();assert.equal(h.states.at(-1).rows.length,1)}finally{h.stop()}}
})
test('controller invalidates stale reads on session, refresh and disposal',async()=>{
 for(const action of ['session','refresh','dispose']){const h=harness([await proposal()]);try{await flush();h.setMode('delay');const pending=h.state.load();if(action==='session')h.session(null);else if(action==='refresh'){h.setMode('');h.setRows([]);await h.state.load()}else h.stop();h.release([await proposal('stale')]);await pending;assert.equal(h.state.rows.value.length,0)}finally{if(action!=='dispose')h.stop()}}
})
test('authoritative readback during queue loading prevents stale eligibility and retains other proposals',async()=>{
 const a=await proposal('a'),b=await proposal('b'),h=harness([a,b]);try{await flush();h.setMode('delay');const pending=h.state.load();h.state.update({...a,status:'Cancelled'});h.release([a,b]);await pending;assert.equal(h.state.rows.value.length,2);assert.equal(h.state.rows.value[0].status,'Cancelled');assert.equal(h.state.loading.value,false)}finally{h.stop()}
})
