import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import {parse,compileScript,compileTemplate} from '@vue/compiler-sfc'
const source=readFileSync(new URL('../src/components/conservation/OfficerPlantDelete.vue',import.meta.url),'utf8')
const {descriptor}=parse(source),script=compileScript(descriptor,{id:'delete-plant'})
const template=compileTemplate({source:descriptor.template.content,filename:'OfficerPlantDelete.vue',id:'delete-plant',compilerOptions:{bindingMetadata:script.bindings}})
const transpile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const flush=async()=>{for(let i=0;i<5;i++){await vue.nextTick();await new Promise(setImmediate)}}
function harness(){
 let mode='ok',exists=true
 const calls=[],events=[],cleanup=[],exports={},scope=vue.effectScope(),props=vue.reactive({plantId:'1'})
 const context={exports,AbortSignal,AbortController,fetch:async(url,options)=>{
  calls.push({url,options})
  if(options.method==='DELETE'){
   if(mode==='uncertain'){exists=false;throw Error('offline')}
   if(mode==='rejected')return Response.json({code:'PLANT_DELETE_REFERENCED'},{status:409})
   exists=false;return Response.json({deleted:true})
  }
  if(!exists)return Response.json({code:'PLANT_DELETE_UNAVAILABLE'},{status:404})
  if(mode==='blocked')return Response.json({code:'PLANT_DELETE_REFERENCED'},{status:409})
  if(mode==='permission')return Response.json({},{status:403})
  return Response.json({revision:'a'.repeat(64)})
 },require(name){
  if(name==='vue')return {...vue,onBeforeUnmount(fn){cleanup.push(fn)},resolveComponent:n=>n}
  if(name==='vue-i18n')return {useI18n:()=>({t:k=>k})}
  if(name.endsWith('.vue'))return {}
  if(name.endsWith('plantId'))return {formatPlantId:id=>'PL'+id}
  throw Error(name)
 }}
 vm.runInNewContext(transpile(script.content),context)
 const state=scope.run(()=>exports.default.setup(props,{emit:(...args)=>events.push(args),expose(){}}))
 vm.runInNewContext('(function(){'+transpile(template.code)+'})()',context)
 return {state,calls,events,mode:v=>mode=v,render:()=>exports.render({},[],props,vue.proxyRefs(state),{},{}),stop(){cleanup.forEach(fn=>fn());scope.stop()}}
}
test('deletion confirms persistence once and never repeats DELETE after success',async()=>{
 const h=harness();try{await flush();assert.equal(template.errors.length,0);assert.doesNotThrow(()=>h.render());await h.state.remove();await h.state.remove()
 assert.equal(h.calls.filter(c=>c.options.method==='DELETE').length,1);assert.equal(h.state.done.value,true);assert.equal(h.events.filter(e=>e[0]==='deleted').length,1)
 }finally{h.stop()}
})
test('uncertain deletion requires read-only verification before any further attempt',async()=>{
 const h=harness();try{await flush();h.mode('uncertain');await h.state.remove();await h.state.remove()
 assert.equal(h.state.uncertain.value,true);assert.equal(h.events.length,0);assert.equal(h.calls.filter(c=>c.options.method==='DELETE').length,1)
 await h.state.check();assert.equal(h.state.done.value,true);assert.equal(h.calls.filter(c=>c.options.method==='DELETE').length,1);assert.equal(h.events.filter(e=>e[0]==='deleted').length,1)
 }finally{h.stop()}
})
test('linked evidence and permission failures block deletion with localized messages',async()=>{
 for(const mode of ['blocked','permission']){const h=harness();try{await flush();h.mode(mode);await h.state.check();await h.state.remove();assert.equal(h.calls.filter(c=>c.options.method==='DELETE').length,0);assert.match(h.state.message.value,mode==='blocked'?/referenced/:/permission/)}finally{h.stop()}}
 const h=harness();try{await flush();h.mode('rejected');await h.state.remove();assert.match(h.state.message.value,/referenced/);assert.equal(h.state.uncertain.value,false);assert.equal(h.events.length,0)}finally{h.stop()}
 for(const locale of ['en','ms','zh-CN']){const values=JSON.parse(readFileSync(new URL(`../src/locales/${locale}.json`,import.meta.url),'utf8')).officerPlantDelete;assert.ok(values.referenced&&values.uncertain&&values.savedRefresh);assert.ok(!values.title.includes('?'))}
})
