import * as proximityScore from '../src/services/plantProximityScore.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import * as vue from 'vue'
import ts from 'typescript'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { createPlantProximityQueue, proximityKey } from '../src/services/plantProximityQueue.ts'
import { formatPlantId } from '../src/utils/plantId.ts'
const row=(id,revision=1,stamp='gps-a')=>({id:String(id),revision,stamp})
const result=(target,extra={})=>({contract_version:1,observation_id:target.id,revision:target.revision,plant_id:'1000',checked_at:'2026-11-20T00:00:00Z',state:'complete',accuracy_m:2,config:{very_close_m:2,close_m:5,nearby_m:10,grouping_radius_m:5,radius_m:30,accuracy_warning_m:10,candidate_limit:20},candidates:[],eligible_count:0,unlocated_count:0,total_nearby:0,...extra})

const flush=async()=>{await new Promise(setImmediate);await vue.nextTick()}
test('large table is lazy and visible-row requests never exceed two concurrent checks',async()=>{
 const pending=[],rows=Array.from({length:1000},(_,i)=>row(i+1));let active=0,maximum=0,reads=0
 const q=createPlantProximityQueue((id,revision)=>{reads++;active++;maximum=Math.max(maximum,active);return new Promise(resolve=>pending.push(()=>{active--;resolve(result(row(id,revision)))}))},()=>{})
 try{q.setRows(rows);await flush();assert.equal(reads,0);for(const target of rows.slice(0,6))q.visibility(target,true);await flush();assert.equal(reads,2)
  while(pending.length){pending.shift()();await flush()}assert.equal(reads,6);assert.equal(maximum,2);assert.equal(q.entries.get('7:1').state,'idle')
 }finally{q.dispose()}
})
test('filter/revision changes abort obsolete work and late old results cannot replace the new submission',async()=>{
 const pending=[],signals=[];let reads=0
 const q=createPlantProximityQueue((id,revision,signal)=>{reads++;signals.push(signal);return new Promise(resolve=>pending.push(()=>resolve(result(row(id,revision)))))},()=>{})
 try{q.setRows([row(1),row(2)]);q.visibility(row(1),true);q.visibility(row(2),true);await flush();q.setRows([row(1,2)]);q.visibility(row(1,2),true);assert.ok(signals.every(s=>s.aborted));assert.equal(q.entries.has('2:1'),false)
  pending.shift()();pending.shift()();await flush();assert.equal(reads,3);pending.shift()();await flush();assert.equal(q.entries.get('1:2').result.revision,2);assert.equal(q.entries.has('1:1'),false)
 }finally{q.dispose()}
})
test('memory cache is keyed by ID/revision/stamp, expires after 30 seconds and clears at session boundaries',async()=>{
 let now=0,reads=0;const q=createPlantProximityQueue(async(id,revision)=>{reads++;return result(row(id,revision))},()=>{},()=>now)
 try{q.setRows([row(1)]);q.visibility(row(1),true);await flush();assert.equal(reads,1);q.setRows([]);q.setRows([row(1)]);q.visibility(row(1),true);await flush();assert.equal(reads,1)
  now=60001;q.setRows([row(1)]);await flush();assert.equal(reads,2);q.setRows([row(1,1,'gps-b')]);await flush();assert.equal(reads,3);q.clear();q.setRows([row(1,1,'gps-b')]);q.visibility(row(1),true);await flush();assert.equal(reads,4)
 }finally{q.dispose()}
})
test('failed and incomplete checks never become empty success; explicit Retry is isolated and no repeated automatic retries occur',async()=>{
 let fail=true,reads=0;const q=createPlantProximityQueue(async(id,revision)=>{reads++;if(fail)throw Error('synthetic offline');return result(row(id,revision),{state:'incomplete',unlocated_count:1,eligible_count:1})},()=>{})
 try{q.setRows([row(1)]);q.visibility(row(1),true);await flush();assert.equal(q.entries.get('1:1').state,'failed');assert.equal(q.entries.get('1:1').result,null);q.visibility(row(1),true);await flush();assert.equal(reads,1)
  fail=false;q.retry(row(1));await flush();assert.equal(reads,2);assert.equal(q.entries.get('1:1').result.state,'incomplete')
 }finally{q.dispose()}
})
test('quick viewport exit/reentry resumes cancelled work without stale publication or a stuck loading badge',async()=>{
 const pending=[];let reads=0;const q=createPlantProximityQueue((id,revision)=>{reads++;return new Promise(resolve=>pending.push(()=>resolve(result(row(id,revision)))))},()=>{})
 try{q.setRows([row(1)]);q.visibility(row(1),true);await flush();q.visibility(row(1),false);q.visibility(row(1),true);pending.shift()();await flush();assert.equal(reads,2);pending.shift()();await flush();assert.equal(q.entries.get('1:1').state,'ready')}finally{q.dispose()}
})
test('cache retains at most 100 results and rejects identity mismatches',async()=>{
 let reads=0;const q=createPlantProximityQueue(async(id,revision)=>{reads++;return result(row(id,revision))},()=>{}),rows=Array.from({length:101},(_,i)=>row(i+1))
 try{q.setRows(rows);rows.forEach(r=>q.visibility(r,true));await flush();assert.equal(reads,101);q.setRows([]);q.setRows([row(1)]);q.visibility(row(1),true);await flush();assert.equal(reads,102)}finally{q.dispose()}
 const mismatch=createPlantProximityQueue(async()=>result(row(999)),()=>{});try{mismatch.setRows([row(1)]);mismatch.visibility(row(1),true);await flush();assert.equal(mismatch.entries.get(proximityKey(row(1))).state,'failed')}finally{mismatch.dispose()}
})

const file=new URL('../src/components/conservation/PlantProximityCell.vue',import.meta.url),{descriptor}=parse(readFileSync(file,'utf8')),script=compileScript(descriptor,{id:'proximity-cell'}),template=compileTemplate({source:descriptor.template.content,filename:file.pathname,id:'proximity-cell',compilerOptions:{bindingMetadata:script.bindings}})
const js=code=>ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
function cell(entry,language='en'){
 const labels=JSON.parse(readFileSync(new URL('../src/locales/'+language+'.json',import.meta.url),'utf8')),emits=[],mount=[],cleanup=[],exports={},props=vue.reactive({entry,enabled:true}),scope=vue.effectScope();let callback,disconnected=false,observed
 const context={exports,Intl,IntersectionObserver:class{constructor(fn){callback=fn}observe(target){observed=target}disconnect(){disconnected=true}},require(name){if(name.endsWith('/plantProximityScore'))return proximityScore;if(name==='vue')return {...vue,onMounted:fn=>mount.push(fn),onBeforeUnmount:fn=>cleanup.push(fn)};if(name==='vue-i18n')return {useI18n:()=>({locale:vue.ref(language),t:key=>key.split('.').reduce((v,k)=>v?.[k],labels)||key})};if(name.endsWith('/plantId'))return {formatPlantId};throw Error(name)}}
 vm.runInNewContext(js(script.content),context);const state=scope.run(()=>exports.default.setup(props,{emit:(...args)=>emits.push(args),expose(){}}));vm.runInNewContext(`(function(){${js(template.code)}})()`,context)
 return {state,props,emits,labels,render:()=>exports.render({},[],vue.proxyRefs(props),vue.proxyRefs(state),{},{}),mount(){state.anchor.value={closest:()=>({tag:'TR'})};mount.forEach(fn=>fn());return observed},visible(value){callback([{isIntersecting:value}])},stop(){cleanup.forEach(fn=>fn());scope.stop();return disconnected}}
}
test('table badge displays the nearest risk percentage and distinguishes no score, incomplete, unavailable and not eligible in every locale',()=>{
 for(const lang of ['en','ms','zh-CN']){
   const candidate={plant_id:'21',status:'Approved',plant_name:'Plant group',species_name:'Species',accuracy_m:4,distance_m:0.43,category:'very_close',location_source:'approved_observation',match_status:'same_species_zone',within_grouping_radius:true},entry={target:row(1),state:'ready',result:result(row(1),{candidates:[candidate,{...candidate,plant_id:'35',distance_m:0.88}]})},h=cell(entry,lang)
   try{assert.equal(h.state.label.value,proximityScore.formatProximityScore(96,lang));assert.equal(h.state.score.value,96);assert.ok(String(h.render().children[0].props.class).includes('high'));assert.ok(!h.state.label.value.includes('PL021'));assert.ok(h.state.tooltip.value.includes(h.labels.plantProximity.scoreDisclaimer));assert.ok(!h.state.tooltip.value.includes(h.labels.plantProximity.scoreUncertain));h.props.entry={...entry,result:result(row(1))};assert.equal(h.state.label.value,'—');assert.ok(h.state.tooltip.value.includes(h.labels.plantProximity.noScore))

   h.props.entry={...entry,result:result(row(1),{state:'incomplete',candidates:[candidate]})};assert.equal(h.state.label.value,h.labels.plantProximity.tableIncomplete);assert.equal(h.state.score.value,null);h.props.entry={...entry,state:'failed',result:null};assert.equal(h.state.label.value,h.labels.plantProximity.tableUnavailable)
   h.props.entry={...entry,result:result(row(1),{state:'not_eligible'})};assert.equal(h.state.label.value,'—');h.props.entry={...entry,state:'loading'};assert.equal(h.state.label.value,h.labels.plantProximity.tableLoading)
  }finally{h.stop()}
 }
})
test('row IntersectionObserver drives visibility, button opens its drawer, and unmount stops observer callbacks',()=>{
 const h=cell(undefined);try{assert.equal(h.emits.length,0);assert.equal(h.mount().tag,'TR');h.visible(true);assert.deepEqual(h.emits.at(-1),['visibility',true]);const button=h.render().children[0],event={currentTarget:{}};button.props.onClick(event);assert.equal(h.emits.at(-1)[0],'open');assert.equal(h.emits.at(-1)[1],event);assert.equal(h.stop(),true);const before=h.emits.length;h.visible(true);assert.equal(h.emits.length,before)}finally{h.stop()}
})


test('unchanged 60-second polls and 10-minute verification preserve ready results while refreshing once',async()=>{
 let now=0,reads=0;const pending=[]
 const q=createPlantProximityQueue(()=>{reads++;return new Promise(resolve=>pending.push(resolve))},()=>{},()=>now)
 try{
  q.setRows([row(1)]);q.visibility(row(1),true);await flush();pending.shift()(result(row(1)));await flush()
  const first=q.entries.get('1:1').result
  for(const time of [60000,600000]){
   now=time;q.setRows([row(1)]);const entry=q.entries.get('1:1');assert.equal(entry.result,first);assert.equal(entry.state,'ready');assert.equal(entry.refreshing,true)
   await flush();const count=reads;q.setRows([row(1)]);q.visibility(row(1),true);await flush();assert.equal(reads,count)
   pending.shift()(first);await flush();assert.equal(entry.refreshing,false);assert.equal(entry.state,'ready')
  }
  assert.equal(reads,3)
 }finally{q.dispose()}
})
test('expired result updates atomically, target changes invalidate immediately and old completion cannot publish',async()=>{
 let now=0;const pending=[]
 const q=createPlantProximityQueue((id,revision,signal)=>new Promise(resolve=>pending.push({resolve,signal,id,revision})),()=>{},()=>now)
 try{
  q.setRows([row(1)]);q.visibility(row(1),true);await flush();const first=result(row(1));pending.shift().resolve(first);await flush()
  now=60000;q.setRows([row(1)]);await flush();assert.equal(q.entries.get('1:1').result,first);const changed=result(row(1),{checked_at:'2026-11-23T00:00:00Z'});pending.shift().resolve(changed);await flush();assert.equal(q.entries.get('1:1').result,changed)
  now+=60000;q.setRows([row(1)]);await flush();const obsolete=pending.shift();q.setRows([row(1,1,'new-content')]);assert.equal(q.entries.get('1:1').result,null);assert.ok(obsolete.signal.aborted)
  obsolete.resolve(first);await flush();assert.notEqual(q.entries.get('1:1').result,first)
  q.clear();pending.shift().resolve(changed);await flush();assert.equal(q.entries.size,0)
 }finally{q.dispose()}
})
test('background failure retains previous evidence, and explicit retry never flashes empty',async()=>{ let now=0,fail=false
 const q=createPlantProximityQueue(async()=>{if(fail)throw Error('offline');return result(row(1))},()=>{},()=>now)
 try{
  q.setRows([row(1)]);q.visibility(row(1),true);await flush();const previous=q.entries.get('1:1').result
  now=60000;fail=true;q.setRows([row(1)]);await flush();assert.equal(q.entries.get('1:1').state,'ready');assert.equal(q.entries.get('1:1').result,previous);assert.equal(q.entries.get('1:1').refreshError,true);fail=false;q.retry(row(1));assert.equal(q.entries.get('1:1').result,previous);assert.equal(q.entries.get('1:1').state,'ready');await flush();assert.equal(q.entries.get('1:1').state,'ready');assert.equal(q.entries.get('1:1').refreshError,false) }finally{q.dispose()}
})


test('authorization and target conflicts discard previously displayed private results',async()=>{
 for(const status of [401,403,404,409]){
  let now=0,denied=false
  const q=createPlantProximityQueue(async()=>{if(denied)throw Object.assign(Error('denied'),{status});return result(row(1))},()=>{},()=>now)
  try{q.setRows([row(1)]);q.visibility(row(1),true);await flush();assert.ok(q.entries.get('1:1').result);now=60000;denied=true;q.setRows([row(1)]);await flush();assert.equal(q.entries.get('1:1').result,null)}finally{q.dispose()}
 }
})
