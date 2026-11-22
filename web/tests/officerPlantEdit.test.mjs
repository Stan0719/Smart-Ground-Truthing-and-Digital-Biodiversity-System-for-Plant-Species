import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { parse,compileScript,compileTemplate } from '@vue/compiler-sfc'
const source=readFileSync(new URL('../src/components/conservation/OfficerPlantEdit.vue',import.meta.url),'utf8')
const {descriptor}=parse(source),script=compileScript(descriptor,{id:'officer-edit'})
const template=compileTemplate({source:descriptor.template.content,filename:'OfficerPlantEdit.vue',id:'officer-edit',compilerOptions:{bindingMetadata:script.bindings}})
const transpile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const flush=async()=>{for(let i=0;i<5;i++){await vue.nextTick();await new Promise(setImmediate)}}
function harness(){
 let mode='ok',current='Original',actor
 const calls=[],events=[],cleanup=[],exports={},scope=vue.effectScope(),props=vue.reactive({plantId:'1'})
 const context={exports,AbortSignal,AbortController,fetch:async(url,options)=>{
  calls.push({url,options});
  if(options.method==='PATCH'){
   if(mode==='network')throw Error('offline');
   if(mode==='conflict')return Response.json({code:'PLANT_EDIT_CONFLICT'},{status:409});
   current=JSON.parse(options.body).scientific_name;return Response.json({saved:true});
  }
  return Response.json(url.endsWith('/edits')?{edits:[]}:{plant:{id:'1',scientific_name:current},revision:'a'.repeat(64)});
 },require(name){
  if(name==='vue')return {...vue,onBeforeUnmount(fn){cleanup.push(fn)},resolveComponent:n=>n}
  if(name==='vue-i18n')return {useI18n:()=>({t:k=>k})}
  if(name.endsWith('.vue'))return {}
  if(name.endsWith('/auth'))return {sessionSnapshot:()=>({user:{id:'officer',role:'Conservation Officer',status:'Active',mustChangePassword:false},pending:false}),subscribeSession:fn=>{actor=fn;return()=>{}}}
  throw Error(name)
 }}
 vm.runInNewContext(transpile(script.content),context)
 const state=scope.run(()=>exports.default.setup(props,{emit:(...args)=>events.push(args),expose(){}}))
 vm.runInNewContext('(function(){'+transpile(template.code)+'})()',context)
 return {state,calls,events,mode:v=>mode=v,session:()=>actor(null,false),render:()=>exports.render({},[],props,vue.proxyRefs(state),{},{}),stop(){cleanup.forEach(fn=>fn());scope.stop()}}
}
test('Officer edit validates fields, confirms saves, and keeps conflict/uncertain drafts until readback inspection',async()=>{
 for(const failure of ['network','conflict']){
  const h=harness();try{
   await flush();assert.equal(h.state.blocked.value,false);assert.equal(template.errors.length,0);assert.doesNotThrow(()=>h.render())
   h.state.name.value='';await h.state.save();assert.ok(h.state.validation.value);assert.equal(h.calls.filter(c=>c.options.method==='PATCH').length,0)
   h.state.name.value='Corrected';h.state.reason.value='Fix typo';h.mode(failure);await h.state.save();assert.equal(h.state.blocked.value,true)
   assert.ok(!h.events.some(e=>e[0]==='saved'));await h.state.save();assert.equal(h.calls.filter(c=>c.options.method==='PATCH').length,1)
   h.mode('ok');await h.state.load(true);assert.equal(h.state.name.value,'Corrected');assert.equal(h.state.reason.value,'Fix typo')
   await h.state.save();assert.equal(h.calls.filter(c=>c.options.method==='PATCH').length,1)
   h.state.checked.value=true;await h.state.save();assert.equal(h.state.saved.value,true);assert.ok(h.events.some(e=>e[0]==='saved'))
   await h.state.save();assert.equal(h.calls.filter(c=>c.options.method==='PATCH').length,2)
  }finally{h.stop()}
 }
})
test('Officer edit closes and blocks saves after session loss; all locales explain readonly fields',async()=>{
 const h=harness();try{await flush();h.session();await h.state.save();assert.ok(h.events.some(e=>e[0]==='close'));assert.equal(h.calls.filter(c=>c.options.method==='PATCH').length,0)}finally{h.stop()}
 for(const locale of ['en','ms','zh-CN']){const values=JSON.parse(readFileSync(new URL(`../src/locales/${locale}.json`,import.meta.url),'utf8')).officerPlantEdit;assert.ok(values.restriction&&values.uncertain&&values.history)}
 assert.doesNotMatch(source,/DELETE|record-changes|method:\s*'POST'/)
})
