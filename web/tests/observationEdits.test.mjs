import test from 'node:test'
import assert from 'node:assert/strict'
import {observationEditDestination} from '../src/services/observationEdits.ts'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import {parse,compileScript,compileTemplate} from '@vue/compiler-sfc'
import {mapObservationEdit,loadObservationEditQueue,observationEditRequest,ObservationEditError,ObservationEditQueueLimitError} from '../src/services/observationEdits.ts'
import {unifiedReviewRows} from '../src/services/recordChanges.ts'
import {assetUrlFromId} from '../src/services/assetImages.ts'
import {reviewDateTime} from '../src/utils/officerMonitoringDisplay.ts'
const original={id:'obs-1',plant_id:24,species_id:8,owner_subject:'staff:bot',status:'Approved',scientific_name:'Plant',content:{heightCm:12,notes:'Approved notes'}}
const proposal=(overrides={})=>({id:'edit-1',observation_id:'obs-1',owner_subject:'staff:bot',status:'Pending Review',revision:7,base_revision:3,created_at:'2026-11-16T00:00:00Z',base_snapshot:{content:original.content,photo_ids:['old-photo']},proposed_content:{heightCm:18,notes:'Proposed notes'},retained_photo_ids:['old-photo'],added_photo_count:1,...overrides})
const flush=async()=>{for(let i=0;i<8;i++){await vue.nextTick();await new Promise(setImmediate)}}
const messages=JSON.parse(readFileSync(new URL('../src/locales/en.json',import.meta.url),'utf8'))
const filename=new URL('../src/components/conservation/ObservationEditReview.vue',import.meta.url)
const {descriptor}=parse(readFileSync(filename,'utf8'))
const script=compileScript(descriptor,{id:'observation-edit-test'})
const template=compileTemplate({source:descriptor.template.content,filename:filename.pathname,id:'observation-edit-test',compilerOptions:{bindingMetadata:script.bindings}})
const transpile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
function harness({origin,routeName}={}){
 let row=proposal(),mode='success',release,sessionCallback
 const route=vue.reactive({name:routeName,query:{observationEdit:'edit-1'}}),calls=[],cleanup=[],updates=[],scope=vue.effectScope()
 const officer={id:'officer',role:'Conservation Officer',status:'Active',mustChangePassword:false}
 const api=async(path,body)=>{
  calls.push({path,body})
  if(body){if(mode==='post-fail')throw new ObservationEditError(500);if(mode==='success-readback-fail')mode='readback-failed';if(mode==='conflict'){row={...row,revision:8};throw new ObservationEditError(409)}row={...row,status:body.decision,reviewed_by:'staff:officer',reviewed_at:'2026-11-16T01:00:00Z'};return {reviewed:true}}
  if(path.endsWith('/edit-history'))return {events:[{id:'event',request_id:row.id,event_type:'submitted',created_at:row.created_at,actor_subject:'staff:bot'}]}
  if(path.startsWith('/observations/'))return {observation:{...original,...(origin?{origin_type:origin}:{})}}
  if(mode==='readback-failed')throw Error('Isolated readback failure');if(mode==='delay')return new Promise(resolve=>release=resolve)
  return {edit:row}
 }
 const exports={}
 const context={exports,console,Error,fetch:async()=>Response.json({names:{bot:'Botanist A',officer:'Officer B'}}),require(name){
  if(name==='vue')return {...vue,onBeforeUnmount:fn=>cleanup.push(fn),withDirectives:node=>node}
  if(name==='vue-router')return {useRoute:()=>route,useRouter:()=>({replace:async({query,name})=>{route.query=query;if(name)route.name=name}})}
  if(name==='vue-i18n')return {useI18n:()=>({t:key=>key.split('.').reduce((v,k)=>v?.[k],messages)||key})}
  if(name.endsWith('/auth'))return {sessionSnapshot:()=>({user:officer,pending:false}),subscribeSession:fn=>{sessionCallback=fn;return ()=>{sessionCallback=null}}}
  if(name.endsWith('observationEdits'))return {observationEditDestination,mapObservationEdit:value=>mapObservationEdit(value,api),observationEditRequest:api}
  if(name.endsWith('assetImages'))return {assetUrlFromId}
  if(name.endsWith('officerMonitoringDisplay'))return {reviewDateTime}
  if(name.endsWith('.vue'))return {name}
  throw Error(name)
 }}
 vm.runInNewContext('(function(){'+transpile(script.content)+'})()',context)
 const state=scope.run(()=>exports.default.setup({},{emit:(...args)=>updates.push(args),expose(){}}))
 vm.runInNewContext('(function(){'+transpile(template.code)+'})()',context)
 return {route,state,calls,updates,setMode:value=>mode=value,setRow:value=>row=value,release:()=>release({edit:row}),session:(user,pending=false)=>sessionCallback(user,pending),officer,render:()=>exports.render({},[],{},vue.proxyRefs(state),{},{}),stop(){cleanup.forEach(fn=>fn());scope.stop()}}
}
function text(node){if(Array.isArray(node))return node.map(text).join(' ');if(!node||typeof node!=='object')return String(node??'');return text(node.children?.default?node.children.default():node.children)}
test('legacy initial and subsequent proposals retain identities and exact revisions; queue is bounded and capability-aware',async()=>{
 for(const origin_type of ['initial_registration','subsequent_observation']){
 const read=async path=>path.endsWith('/capabilities')?{available:true,versioning_available:false}:path==='/observation-edits'?{edits:[proposal()]}:{observation:{...original,origin_type}}
 const [row]=await loadObservationEditQueue(read)
 assert.equal(row.revision,7);assert.equal(row.observation_edit.observation_id,'obs-1');assert.equal(row.plant_id,24)
 const rows=unifiedReviewRows([{id:'edit-1',createdAt:row.created_at,speciesRequest:null}],[row,{...row,observation_edit:undefined}]);assert.equal(new Set(rows.map(r=>r.key)).size,3)
 }
 assert.deepEqual(await loadObservationEditQueue(async()=>({available:false})),[])
 await assert.rejects(loadObservationEditQueue(async()=>({available:true,versioning_available:true})),/Unsupported/)
 await assert.rejects(loadObservationEditQueue(async path=>path.endsWith('/capabilities')?{available:true,versioning_available:false}:{edits:Array(500).fill(proposal())}),ObservationEditQueueLimitError)
 await assert.rejects(mapObservationEdit(proposal({revision:0})),/Invalid/)
})
test('HTTP review uses authenticated proxy, POST and exact proposal revision',async()=>{
 const old=globalThis.fetch;let captured
 globalThis.fetch=async(url,options)=>{captured={url,...options};return Response.json({reviewed:true})}
 try{await observationEditRequest('/observation-edits/edit-1/review',{decision:'Approved',comment:'Reviewed',revision:7});assert.equal(captured.url,'/api/data/observation-edits/edit-1/review');assert.equal(captured.credentials,'same-origin');assert.equal(captured.method,'POST');assert.equal(JSON.parse(captured.body).revision,7)}finally{globalThis.fetch=old}
})
test('detail compares baseline/proposal, uses verified names and authenticated photo references, and supports all three decisions',async()=>{
 for(const decision of ['Approved','Rejected','Correction Required']){
 const h=harness();try{await flush();assert.equal(h.state.eligible.value,true);assert.match(text(h.render()),/Approved notes/);assert.match(text(h.render()),/Proposed notes/);assert.match(text(h.render()),/Botanist A/);assert.equal(h.state.basePhotos.value[0],'/api/data/assets/old-photo');assert.ok(h.state.proposedPhotos.value.includes('/api/data/observation-edits/edit-1/photos/0'))
 h.state.comment.value='Officer reason';await h.state.decide(decision);assert.deepEqual(h.calls.filter(c=>c.body).map(c=>[c.body.decision,c.body.revision]),[[decision,7]]);assert.equal(h.state.selected.value.status,decision);assert.equal(h.state.eligible.value,false)
 }finally{h.stop()}}
})
test('409 preserves draft, refreshes exact revision, blocks until inspection and never retries',async()=>{
 const h=harness();try{await flush();h.setMode('conflict');h.state.comment.value='Keep draft';await h.state.decide('Approved');assert.equal(h.state.comment.value,'Keep draft');assert.equal(h.state.selected.value.revision,8);assert.equal(h.state.blocked.value,true);assert.equal(h.state.eligible.value,false);await h.state.decide('Approved');assert.equal(h.calls.filter(c=>c.body).length,1);h.state.blocked.value=false;h.setMode('success');await h.state.decide('Rejected');assert.equal(h.calls.filter(c=>c.body)[1].body.revision,8)}finally{h.stop()}
})
test('terminal proposals cannot be reviewed; temporary unavailability preserves drafts and logout clears private state',async()=>{
 for(const status of ['Approved','Rejected','Cancelled','Withdrawn','Superseded','Correction Required']){const h=harness();try{await flush();h.setRow(proposal({status}));await h.state.open('edit-1');assert.equal(h.state.eligible.value,false);await h.state.decide('Approved');assert.equal(h.calls.filter(c=>c.body).length,0)}finally{h.stop()}}
 const h=harness();try{await flush();h.state.comment.value='Draft';h.session(h.officer,true);assert.equal(h.state.comment.value,'Draft');assert.equal(h.state.eligible.value,false);h.session(null);assert.equal(h.state.selected.value,null);assert.equal(h.state.comment.value,'')}finally{h.stop()}
})
test('late detail cannot restore a selection after route change, logout or disposal',async()=>{
 for(const action of ['route','logout','dispose']){const h=harness();let stopped=false;try{await flush();h.setMode('delay');const loading=h.state.open('edit-1');await flush();if(action==='route')h.route.query={};if(action==='logout')h.session(null);if(action==='dispose'){h.stop();stopped=true}await flush();const before=h.updates.length;h.release();await loading;assert.equal(h.updates.length,before);if(action!=='dispose')assert.equal(h.state.selected.value,null)}finally{if(!stopped)h.stop()}}
})

test('Observation edit labels and fields have EN/MS/Chinese parity without placeholder translations',()=>{
 const labels=['en','ms','zh-CN'].map(lang=>JSON.parse(readFileSync(new URL('../src/locales/'+lang+'.json',import.meta.url),'utf8')).observationEdits)
 const paths=(value,prefix='')=>Object.entries(value).flatMap(([key,v])=>typeof v==='object'?paths(v,prefix+key+'.'):[prefix+key])
 assert.deepEqual(paths(labels[0]),paths(labels[1]));assert.deepEqual(paths(labels[0]),paths(labels[2]))
 assert.ok(!JSON.stringify(labels[2]).includes('??'))
})


test('successful POST with failed readback stays unverified, preserves draft and retries GET only',async()=>{
 const h=harness();try{
  await flush();h.state.comment.value='Keep review draft';h.setMode('success-readback-fail');await h.state.decide('Approved')
  assert.equal(h.calls.filter(c=>c.body).length,1);assert.equal(h.state.selected.value.status,'Pending Review')
  assert.equal(h.state.message.value,messages.observationEdits.savedUnverified);assert.notEqual(h.state.message.value,messages.observationEdits.saved)
  assert.equal(h.state.readbackUnverified.value,true);assert.equal(h.state.blocked.value,true);assert.equal(h.state.inspectable.value,false);assert.equal(h.state.eligible.value,false)
  assert.match(text(h.render()),/Retry Reload/);assert.equal(h.state.comment.value,'Keep review draft')
  await h.state.decide('Approved');assert.equal(h.calls.filter(c=>c.body).length,1)
  h.setMode('success');await h.state.open('edit-1',true)
  assert.equal(h.state.readbackUnverified.value,false);assert.equal(h.state.selected.value.status,'Approved');assert.equal(h.state.selected.value.revision,7);assert.equal(h.state.selected.value.reviewed_by,'staff:officer')
  assert.equal(h.state.message.value,messages.observationEdits.reloaded);assert.equal(h.calls.filter(c=>c.body).length,1);assert.equal(h.state.comment.value,'Keep review draft')
 }finally{h.stop()}
})
test('genuine POST failure remains distinct from saved-but-unverified and conflict recovery',async()=>{
 const h=harness();try{await flush();h.state.comment.value='Preserve';h.setMode('post-fail');await h.state.decide('Rejected');assert.equal(h.state.message.value,messages.observationEdits.failed);assert.equal(h.state.readbackUnverified.value,false);assert.equal(h.state.blocked.value,true);assert.equal(h.state.inspectable.value,false);assert.equal(h.state.comment.value,'Preserve');assert.equal(h.calls.filter(c=>c.body).length,1)}finally{h.stop()}
})
test('499-row queue is accepted; 500 and 501 produce a typed safety-limit failure before mapping',async()=>{
 for(const size of [499,500,501]){
 let targets=0
 const read=async path=>path.endsWith('/capabilities')?{available:true,versioning_available:false}:path==='/observation-edits'?{edits:Array.from({length:size},(_,i)=>proposal({id:'edit-'+i}))}:(targets++,{observation:original})
 if(size===499){const rows=await loadObservationEditQueue(read);assert.equal(rows.length,499);assert.equal(targets,499)}else{await assert.rejects(loadObservationEditQueue(read),ObservationEditQueueLimitError);assert.equal(targets,0)}
 }
 await assert.rejects(loadObservationEditQueue(async()=>{throw new ObservationEditError(503)}),error=>error instanceof ObservationEditError && !(error instanceof ObservationEditQueueLimitError))
})


test('cancelled Observation proposal readback gives terminal feedback and never retries a decision',async()=>{
 const h=harness();try{
 await flush();h.state.comment.value='Keep draft';h.setRow(proposal({status:'Cancelled'}));h.setMode('conflict')
 await h.state.decide('Approved');await flush()
 assert.equal(h.state.selected.value.status,'Cancelled');assert.equal(h.state.eligible.value,false)
 assert.equal(h.state.message.value,messages.observationEdits.cancelledReadOnly)
 assert.equal(h.state.comment.value,'Keep draft')
 await h.state.decide('Approved');assert.equal(h.calls.filter(c=>c.body).length,1)
 }finally{h.stop()}
})


test('Plant IDs accept canonical positive numbers and decimal strings while rejecting unsafe coercions',async()=>{
 for(const plant_id of [24,'24',1,'1',Number.MAX_SAFE_INTEGER,String(Number.MAX_SAFE_INTEGER)]){
 const mapped=await mapObservationEdit(proposal(),async()=>({observation:{...original,plant_id}}));assert.equal(mapped.plant_id,Number(plant_id));assert.equal(typeof mapped.plant_id,'number');assert.equal(mapped.revision,7)
 }
 for(const plant_id of [0,'0',-1,'-1',1.5,'1.5','1e2',' 24','24 ','',' ','01','+24','0x18',null,undefined,{},[],true,Infinity,NaN,Number.MAX_SAFE_INTEGER+1,'9007199254740992']){
 await assert.rejects(mapObservationEdit(proposal(),async()=>({observation:{...original,plant_id}})),/Invalid Observation target/)
 }
})
test('queue parsing accepts numeric-string baseline IDs without changing proposal identity or revision',async()=>{
 const rows=await loadObservationEditQueue(async path=>path.endsWith('/capabilities')?{available:true,versioning_available:false}:path==='/observation-edits'?{edits:[proposal()]}:{observation:{...original,plant_id:'24'}})
 assert.equal(rows.length,1);assert.equal(rows[0].plant_id,24);assert.equal(rows[0].id,'edit-1');assert.equal(rows[0].revision,7)
})
test('malformed retained or baseline photo evidence is rejected, never replaced by empty arrays',async()=>{
 for(const retained_photo_ids of [{},null,'[]',[{}],['']])await assert.rejects(mapObservationEdit(proposal({retained_photo_ids}),async()=>({observation:original})),error=>error.name==='ObservationEditEvidenceError')
 await assert.rejects(mapObservationEdit(proposal({base_snapshot:{content:original.content,photo_ids:{}}}),async()=>({observation:original})),error=>error.name==='ObservationEditEvidenceError')
 const row=await mapObservationEdit(proposal({retained_photo_ids:[],added_photo_count:0}),async()=>({observation:{...original,plant_id:'24'}}));assert.deepEqual(row.observation_edit.retained_photo_ids,[])
 const h=harness();try{h.setRow(proposal({retained_photo_ids:{}}));await h.state.open('edit-1');assert.equal(h.state.eligible.value,false);assert.equal(h.state.message.value,messages.unifiedObservations.invalidEvidence);await h.state.decide('Approved');assert.equal(h.calls.filter(c=>c.body).length,0)}finally{h.stop()}
})
test('HTTP evidence-integrity errors remain explicit rather than generic conflicts or empty queues',async()=>{
 const old=globalThis.fetch;globalThis.fetch=async()=>Response.json({error:'Observation edit photo evidence is invalid. Contact support for an evidence-preserving assessment.'},{status:409})
 try{await assert.rejects(observationEditRequest('/observation-edits'),error=>error.name==='ObservationEditEvidenceError')}finally{globalThis.fetch=old}
})


test('successful review followed by malformed photo evidence stays saved-but-unverified and retries GET only',async()=>{
 const h=harness();try{await flush();h.state.comment.value='Retain draft';h.setRow(proposal({retained_photo_ids:{}}));await h.state.decide('Approved')
 assert.equal(h.state.readbackUnverified.value,true);assert.equal(h.state.message.value,messages.observationEdits.savedUnverified);assert.equal(h.state.eligible.value,false);assert.equal(h.state.comment.value,'Retain draft')
 await h.state.decide('Approved');assert.equal(h.calls.filter(c=>c.body).length,1)
 h.setRow(proposal({status:'Approved'}));await h.state.open('edit-1',true);assert.equal(h.state.readbackUnverified.value,false);assert.equal(h.calls.filter(c=>c.body).length,1)
 }finally{h.stop()}
})


test('old proposal bookmarks are dispatched by authoritative origin, with no decision POST on navigation',async()=>{
 for(const [origin,routeName,destination] of [['initial_registration','conservation-observations','conservation-reviews'],['subsequent_observation','conservation-reviews','conservation-observations'],['unknown','conservation-observations','conservation-reviews']]){
  const h=harness({origin,routeName});try{await flush();assert.equal(h.route.name,destination);assert.equal(h.state.selected.value,null);assert.ok(!h.calls.some(c=>c.body));}finally{h.stop()}
 }
})
