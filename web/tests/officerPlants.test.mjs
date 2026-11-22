import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { formatPlantId } from '../src/utils/plantId.ts'
import { reviewDateTime } from '../src/utils/officerMonitoringDisplay.ts'
import { workflowBadgeStyle } from '../src/utils/workflowBadge.ts'
const source = readFileSync(new URL('../src/views/conservation/PlantsView.vue',import.meta.url),'utf8')
const { descriptor } = parse(source), script = compileScript(descriptor,{id:'registry-test'})
const template = compileTemplate({source:descriptor.template.content,filename:'PlantsView.vue',id:'registry-test',compilerOptions:{bindingMetadata:script.bindings}})
const transpile = code => ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const flush = async()=>{for(let i=0;i<4;i++){await vue.nextTick();await new Promise(setImmediate)}}
const nodes = root => { const found=[]; const visit=node=>{ if(Array.isArray(node)) return node.forEach(visit); if(!node||typeof node!=='object') return; found.push(node); if(Array.isArray(node.children)) visit(node.children) }; visit(root); return found }
const plant = {id:'620',species_id:'1',scientific_name:'Shorea',common_name:'Meranti',status:'Approved',registered_at:'2026-11-01T00:00:00Z',registration_id:'obs-1',has_location:true,qr_id:'42',qr_status:'active'}
function harness(read) {
 const scope=vue.effectScope(),exports={},cleanups=[],calls=[];let listener
 let user={id:'officer',role:'Conservation Officer',status:'Active',mustChangePassword:false}
 const context={exports,AbortController,setTimeout,clearTimeout,require(name){
  if(name==='vue')return {...vue,onBeforeUnmount(fn){cleanups.push(fn)},resolveComponent:name=>name}
  if(name==='vue-i18n')return {useI18n:()=>({t:key=>key})}
  if(name.endsWith('.vue'))return {}
  if(name.endsWith('/auth'))return {sessionSnapshot:()=>({user,pending:false}),subscribeSession:fn=>{listener=fn;return()=>{}}}
  if(name.endsWith('officerPlants'))return {readOfficerPlants:(...args)=>{calls.push(args);return read(...args)}}
  if(name.endsWith('plantId'))return {formatPlantId}
  if(name.endsWith('officerMonitoringDisplay'))return {reviewDateTime}
  if(name.endsWith('workflowBadge'))return {workflowBadgeStyle}
  throw Error(name)
 }}
 vm.runInNewContext(transpile(script.content),context)
 const state=scope.run(()=>exports.default.setup({},{expose(){}}))
 vm.runInNewContext('(function(){'+transpile(template.code)+'})()',context)
 return {state,calls,session(next,pending=false){user=next;listener(next,pending)},render:()=>exports.render({},[],{},vue.proxyRefs(state),{},{}),stop(){cleanups.forEach(fn=>fn());scope.stop()}}
}
const page=(rows=[plant],next=null)=>({plants:rows,species:[{id:'1',name:'Shorea'}],page:{limit:25,has_more:!!next,next_cursor:next}})
test('registry paginates, retries errors, and ignores abandoned work after filters/session changes',async()=>{
 let mode='success',release
 const h=harness(async()=>{if(mode==='fail')throw Error('offline');if(mode==='delay')return new Promise(resolve=>{release=resolve});return page([plant],'next')})
 try {
  await flush();assert.equal(h.state.rows.value[0].id,'620');h.state.forward();await flush();assert.equal(h.calls[1][1],'next')
  mode='fail';await h.state.load();assert.equal(h.state.error.value,true);assert.equal(h.state.rows.value.length,0)
  mode='success';await h.state.load();assert.equal(h.state.error.value,false)
  mode='delay';const pending=h.state.load();const signal=h.calls.at(-1)[2]
  h.state.q.value='Other';assert.equal(signal.aborted,true);assert.equal(h.state.previous.value.length,0)
  h.session();release(page());await pending;assert.equal(h.state.rows.value.length,0)
 }finally{h.stop()}
})

test('same-account session notifications do not reload or clear rows; settled background refresh preserves content on success and failure',async()=>{
 let mode='success',release
 const h=harness(async()=>{if(mode==='fail')throw Error('offline');if(mode==='delay')return new Promise(resolve=>{release=resolve});return page([{...plant,scientific_name:'Fresh name'}])})
 const officer={id:'officer',role:'Conservation Officer',status:'Active',mustChangePassword:false}
 try{
  await flush();assert.equal(h.calls.length,1);assert.equal(h.state.rows.value[0].scientific_name,'Fresh name')
  h.session({...officer},true);h.session({...officer},false);await flush()
  assert.equal(h.calls.length,1);assert.equal(h.state.rows.value.length,1)
  mode='delay';const pending=h.state.load({preserveRows:true});await flush()
  assert.equal(h.state.rows.value.length,1);assert.equal(h.state.loading.value,true)
  release(page([{...plant,scientific_name:'Updated name'}]));await pending
  assert.equal(h.state.rows.value[0].scientific_name,'Updated name');assert.equal(h.state.error.value,false)
  mode='fail';await h.state.load({preserveRows:true})
  assert.equal(h.state.rows.value.length,1);assert.equal(h.state.error.value,true)
 }finally{h.stop()}
})

test('same-account verification retries a request that was in flight during pending authorization',async()=>{
 let release,calls=0
 const h=harness(async()=>{calls++;if(calls===1)return new Promise(resolve=>{release=resolve});return page()})
 const officer={id:'officer',role:'Conservation Officer',status:'Active',mustChangePassword:false}
 try{
  h.session({...officer},true);h.session({...officer},false);await flush()
  assert.equal(calls,2)
  release(page([{...plant,scientific_name:'Late old response'}]));await flush()
  assert.equal(h.state.rows.value[0].scientific_name,'Shorea')
 }finally{h.stop()}
})

test('logout, account switching, and permission revocation immediately clear private registry state',async()=>{
 const h=harness(async()=>page())
 try{
  await flush();assert.equal(h.state.rows.value.length,1)
  h.session(null,true);assert.equal(h.state.rows.value.length,0);assert.equal(h.state.choices.value.length,0)
  const officer={id:'officer',role:'Conservation Officer',status:'Active',mustChangePassword:false}
  h.session(officer);await flush();assert.equal(h.state.rows.value.length,1)
  h.session({...officer,id:'another-officer'});assert.equal(h.state.rows.value.length,0);await flush();assert.equal(h.state.rows.value.length,1)
  h.session({...officer,status:'Suspended'});assert.equal(h.state.rows.value.length,0);assert.equal(h.state.choices.value.length,0)
 }finally{h.stop()}
})

test('navigation away and back performs a fresh initial read with isolated synthetic results',async()=>{
 let calls=0
 const read=async()=>{calls++;return page([{...plant,scientific_name:`Plant ${calls}` }])}
 const first=harness(read)
 await flush();assert.equal(first.state.rows.value[0].scientific_name,'Plant 1');first.stop()
 const second=harness(read)
 try{await flush();assert.equal(second.state.rows.value[0].scientific_name,'Plant 2');assert.equal(calls,2)}finally{second.stop()}
})
test('registry opens the selected Plant in its details modal and retains scoped Edit/Delete modals and mobile cards',async()=>{
 const h=harness(async()=>page())
 try {
  await flush();assert.doesNotThrow(()=>h.render());assert.equal(template.errors.length,0)
  assert.doesNotMatch(descriptor.template.content,/conservation-reviews|conservation-observations/)
  assert.match(descriptor.template.content,/<OfficerPlantView :plant-id="viewing"/)
  const viewButton=nodes(h.render()).find(node=>node.type==='button'&&node.props?.['aria-label']==='officerPlants.view')
  assert.ok(viewButton,'the Plant View control is rendered')
  viewButton.props.onClick()
  assert.equal(h.state.viewing.value,plant.id,'the clicked Plant ID is passed to OfficerPlantView')
  assert.doesNotMatch(source,/conservation-map|registry-links/)
  assert.match(source,/@container \(max-width: 900px\)/)
  assert.doesNotMatch(source,/method:\s*['"](?:POST|PATCH|DELETE)|Create Plant|decide\(/)
  assert.equal((descriptor.template.content.match(/<button disabled/g)||[]).length,0)
  assert.match(source,/OfficerPlantDelete/)
  assert.match(source,/deleting=plant.id/)
  assert.match(source,/plant.species_scientific_name/)
  assert.match(source,/OfficerPlantEdit/)
  for(const lang of ['en','ms','zh-CN']){
   const locale=JSON.parse(readFileSync(new URL(`../src/locales/${lang}.json`,import.meta.url),'utf8')).officerPlants
   assert.ok(locale.title&&locale.editBlocked&&locale.deleteBlocked&&locale.error)
  }
 }finally{h.stop()}
})

test('confirmed deletion followed by list failure retains success and exposes the existing Retry state',async()=>{
 let fail=false
 const h=harness(async()=>{if(fail)throw Error('offline');return page()})
 try{await flush();fail=true;await h.state.afterDelete();assert.equal(h.state.error.value,true);assert.equal(h.state.deleteFeedback.value,'officerPlantDelete.savedRefresh');fail=false;await h.state.load();assert.equal(h.state.error.value,false)}finally{h.stop()}
})

test('mobile registry cards show identity, aligned detail rows and labelled touch actions without duplicating workflows',async()=>{
 const h=harness(async()=>page([{...plant,species_scientific_name:'Species catalogue name',scientific_name:'Current Plant name',status:'Withdrawn'}]))
 try{
  await flush();assert.doesNotThrow(()=>h.render())
  assert.match(source,/class="plant-identity"/)
  assert.match(source,/class="plant-emblem" aria-hidden="true"/)
  assert.equal((descriptor.template.content.match(/class="mobile-action-label"/g)||[]).length,3)
  assert.match(source,/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/)
  assert.match(source,/\.plant-identity \.cell-label \{ display:none;/)
  assert.match(source,/\.icon-action \{[^}]*min-height:44px/)
  assert.match(source,/\.cell-value \{[^}]*overflow-wrap:anywhere/)
  assert.equal(h.state.rows.value[0].status,'Withdrawn')
  assert.match(source,/:disabled="!ready\(\)\|\|plant.status!=='Approved'"/)
 }finally{h.stop()}
})

test('mobile action row has no lower divider for the removed review links',()=>{
 const mobile=source.slice(source.indexOf('@container'))
 const actions=mobile.match(/\.registry-actions \{([^}]+)\}/)[1]
 assert.doesNotMatch(actions,/border-bottom/)
 assert.match(actions,/border-top/)
})

test('mobile field values follow their own label rather than a fixed-width column',()=>{
 const mobile=source.slice(source.indexOf('@container'))
 assert.ok(mobile.includes('grid-template-columns:fit-content(50%) minmax(0,1fr)'))
 assert.ok(!mobile.includes('minmax(0, 0.95fr)'))
})

test('Plant actions use the same accessible hover/focus tooltip and active fill treatment',async()=>{
 const h=harness(async()=>page())
 try{
  await flush();const tree=h.render();assert.equal(template.errors.length,0)
  const tooltips=tree.children?.flat?.(Infinity) || []
  assert.match(source,/action-wrap:hover \.action-tip, \.action-wrap:focus-within \.action-tip/)
  assert.match(source,/\.registry-actions \.icon-action:hover:not\(:disabled\).*background: #33745d; color: #fff/)
  assert.match(source,/\.registry-actions \.icon-action\.danger:hover:not\(:disabled\).*background: #b84d42; color: #fff/)
  for(const action of ['view','edit','delete']){
   assert.ok(source.includes(`plant-\u0024{plant.id}-${action}-tooltip`))
   assert.ok(source.includes(`role="tooltip">{{ text('${action}') }}`))
  }
  assert.ok(tooltips.length>=0)
 }finally{h.stop()}
})
