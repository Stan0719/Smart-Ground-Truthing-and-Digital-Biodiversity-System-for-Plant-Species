import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import {parse,compileScript,compileTemplate} from '@vue/compiler-sfc'
import * as requests from '../src/services/reviewSpeciesRequest.ts'
import {workflowBadgeStyle} from '../src/utils/workflowBadge.ts'
import {reviewDateTime} from '../src/utils/officerMonitoringDisplay.ts'
import {observationEditDestination} from '../src/services/observationEdits.ts'
const dictionary=JSON.parse(readFileSync(new URL('../src/locales/en.json',import.meta.url),'utf8'))
const flush=async()=>{for(let i=0;i<8;i++){await vue.nextTick();await new Promise(setImmediate)}}
const nodes=root=>{const out=[];function walk(n){if(Array.isArray(n))return n.forEach(walk);if(!n||typeof n!=='object')return;out.push(n);if(Array.isArray(n.children))walk(n.children);else if(n.children?.default)walk(n.children.default())}walk(root);return out}
const transpile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
function harness(name,{rows=[],proposals=[],fail=false,props={},language='en',capped=false}={}){
 const file=new URL('../src/components/conservation/'+name+'.vue',import.meta.url),{descriptor}=parse(readFileSync(file,'utf8'));const script=compileScript(descriptor,{id:'final-workflow'}),template=compileTemplate({source:descriptor.template.content,filename:file.pathname,id:'final-workflow',compilerOptions:{bindingMetadata:script.bindings}});assert.deepEqual(template.errors,[])
 const data=JSON.parse(readFileSync(new URL('../src/locales/'+language+'.json',import.meta.url),'utf8')),calls=[],emits=[],routes=[],cleanup=[],scope=vue.effectScope(),exports={};let callback
 class QueueLimit extends Error {}
 const route=vue.reactive({query:{}})
 const officer={id:'officer',role:'Conservation Officer',status:'Active',mustChangePassword:false};const reactiveProps=vue.reactive(props)
 const context={exports,console,Error,AbortSignal,fetch:async url=>{calls.push(url);return fail?Response.json({}, {status:503}):Response.json(url.includes('submitter-names')?{names:{bot:'Botanist Aina',reviewer:'Officer Lin'}}:{species_requests:rows})},require(path){
  if(path==='vue')return {...vue,onBeforeUnmount:fn=>cleanup.push(fn),resolveComponent:name=>name}
  if(path==='vue-router')return {useRoute:()=>route,useRouter:()=>({push:async destination=>routes.push(destination)})}
  if(path==='vue-i18n')return {useI18n:()=>({t:key=>key.split('.').reduce((v,k)=>v?.[k],data)||key})}
  if(path.endsWith('/auth'))return {sessionSnapshot:()=>({user:officer,pending:false}),subscribeSession:fn=>{callback=fn;return ()=>{}}}
  if(path.endsWith('reviewSpeciesRequest'))return requests
  if(path.endsWith('workflowBadge'))return {workflowBadgeStyle}
  if(path.endsWith('officerMonitoringDisplay'))return {reviewDateTime}
  if(path.endsWith('observationEdits'))return {loadObservationEditQueue:async(_read,current)=>{calls.push('legacy-list');if(capped)throw new QueueLimit();return current()?proposals:[]},observationEditDestination,observationEditRequest:async path=>{calls.push(path);return {edit:proposals.find(p=>p.id===path.split('/').at(-1))}},mapObservationEdit:async row=>{if(!row)throw Error('Unavailable');return row},ObservationEditQueueLimitError:QueueLimit}
  if(path.endsWith('.vue'))return {name:path}
  throw Error('Unexpected import '+path)
 }}
 vm.runInNewContext('(function(){'+transpile(script.content)+'})()',context);const state=scope.run(()=>exports.default.setup(reactiveProps,{expose(){},emit:(...args)=>emits.push(args)}));vm.runInNewContext('(function(){'+transpile(template.code)+'})()',context)
 return {state,calls,emits,routes,route,props:reactiveProps,session:(user,pending)=>callback(user,pending),render:()=>exports.render({},[],reactiveProps,vue.proxyRefs(state),{},{}),stop:()=>{cleanup.forEach(fn=>fn());scope.stop()}}
}
const request=(id,overrides={})=>({request_id:id,owner_subject:'staff:bot',requested_by:'staff:bot',request_status:'Pending Review',scientific_name:'Species '+id,common_name:'Common',content_revision:1,review_cycle:1,submitted_at:'2026-11-18T00:00:00Z',...overrides})
test('standalone Species cells are display-only and retain exact detail identity without a Plant association',async()=>{
 const row=requests.mapLinkedSpeciesRequest({species_request_id:2,species_request:{...request(2),proposed_scientific_name:'Species 2'}},true)
 const h=harness('StandaloneSpeciesRows',{props:{row,submitter:'Botanist Aina',reviewer:'\u2014',authorized:true}})
 try{await flush();assert.equal(h.calls.length,0);const cells=nodes(h.render()).filter(n=>n.type==='td');assert.equal(cells.length,11);assert.equal(cells[1].children,'\u2014');assert.equal(cells[4].children,'Botanist Aina');assert.equal(cells[5].children,'\u2014');nodes(cells[10]).find(n=>n.type==='button').props.onClick();assert.ok(h.emits.some(e=>e[0]==='open'&&e[1]==='2'));h.props.authorized=false;assert.equal(nodes(h.render()).find(n=>n.type==='button').props.disabled,true)}finally{h.stop()}
})

test('all new workflow labels have EN/MS/ZH parity and no placeholder text',()=>{
 for(const lang of ['en','ms','zh-CN']){const labels=JSON.parse(readFileSync(new URL('../src/locales/'+lang+'.json',import.meta.url),'utf8')).finalOfficerWorkflow;assert.deepEqual(Object.keys(labels),Object.keys(dictionary.finalOfficerWorkflow));assert.ok(Object.values(labels).every(value=>value&&!value.includes('???')))}
})

test('legacy host has no locator, network calls or placeholder on ordinary visits; direct links retain the existing reviewer',async()=>{
 const h=harness('RegistrationObservationEdits')
 try{await flush();assert.equal(h.calls.length,0);assert.ok(!nodes(h.render()).some(n=>['details','summary','input','section','form'].includes(n.type)))
  assert.ok(!nodes(h.render()).some(n=>n.type?.name?.includes('ObservationEditReview')))
  h.route.query.observationEdit='12345678-1234-1234-1234-123456789abc';await flush()
  assert.ok(nodes(h.render()).some(n=>n.type?.name?.includes('ObservationEditReview')))
  assert.equal(h.calls.length,0)
  h.route.query={};await flush();assert.ok(!nodes(h.render()).some(n=>n.type?.name?.includes('ObservationEditReview')))
 }finally{h.stop()}
 const source=readFileSync(new URL('../src/components/conservation/RegistrationObservationEdits.vue',import.meta.url),'utf8')
 assert.doesNotMatch(source,/loadObservationEditQueue|observationEditRequest|legacyLocator|<style|<details|<input/)
})
