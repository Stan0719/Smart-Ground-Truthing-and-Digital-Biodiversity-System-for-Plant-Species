import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { parse, compileScript, compileTemplate, compileStyle } from '@vue/compiler-sfc'
import { loadObservationVersionHistory } from '../src/services/observationVersionHistory.ts'
import { reviewDateTime } from '../src/utils/officerMonitoringDisplay.ts'
const row = (extra = {}) => ({ id: 'history-1', record_type: 'plant', plant_id: 24, change_id: null, version_number: 1, status: 'Superseded', created_at: '2026-11-16T00:00:00Z', snapshot: { observation_id: 'obs-1', content: { notes: 'Original notes' }, photo_ids: ['original-photo'] }, ...extra })
const payload = versions => ({ history_available: true, versions })
test('authenticated supported history reads only genuine matching initial snapshots with distinct identities', async () => {
 const calls = []
 const result = await loadObservationVersionHistory('obs-1','24','initial_registration',async (url,options) => { calls.push({url,options}); return Response.json(payload([row(), row({id:'edit',change_id:'proposal'}), row({id:'capture',snapshot:{observation_id:'obs-1',review_provenance:{}}}),row({id:'foreign',plant_id:25})])) })
 assert.equal(result.versions.length,1); assert.equal(result.versions[0].key,'record-version:history-1'); assert.equal(result.versions[0].observationId,'obs-1'); assert.equal(result.versions[0].reviewable,false)
 assert.equal(result.versions[0].content.notes,'Original notes'); assert.deepEqual(result.versions[0].photos,['/api/data/assets/original-photo'])
 assert.equal(calls[0].url,'/api/data/observations/obs-1/registration-history');assert.equal(calls[0].options.credentials,'same-origin');assert.equal(calls[0].options.method,undefined)
})
test('subsequent and unknown origins never call an unsupported version API',async()=>{
 for(const origin of ['subsequent_observation','unknown']) assert.deepEqual(await loadObservationVersionHistory('obs-1','24',origin,()=>{throw Error('Unsupported call')}),{available:false,versions:[]})
})
test('missing content and photos are never replaced with current data; invalid and duplicate identities fail closed',async()=>{
 const read=versions=>async()=>Response.json(payload(versions))
 const result=await loadObservationVersionHistory('obs-1','24','initial_registration',read([row({snapshot:{observation_id:'obs-1'}})]))
 assert.equal(result.versions[0].content,null);assert.deepEqual(result.versions[0].photos,[])
 await assert.rejects(loadObservationVersionHistory('obs-1','24','initial_registration',read([row(),row()])))
 await assert.rejects(loadObservationVersionHistory('obs-1','24','initial_registration',read([row({version_number:0})])))
 assert.equal((await loadObservationVersionHistory('obs-1','24','initial_registration',async()=>Response.json({history_available:false,versions:[]}))).available,false)
})
const filename=new URL('../src/components/conservation/ObservationVersionHistory.vue',import.meta.url)
const {descriptor}=parse(readFileSync(filename,'utf8'))
const script=compileScript(descriptor,{id:'history-test'}), template=compileTemplate({source:descriptor.template.content,filename:filename.pathname,id:'history-test',compilerOptions:{bindingMetadata:script.bindings}})
const transpile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const flush=async()=>{for(let i=0;i<5;i++){await vue.nextTick();await new Promise(setImmediate)}}
const dictionaries = Object.fromEntries(['en','ms','zh-CN'].map(lang=>[lang,JSON.parse(readFileSync(new URL('../src/locales/'+lang+'.json',import.meta.url),'utf8'))]))
function harness(read, language='en'){
 const props=vue.reactive({observationId:'obs-1',plantId:'24',origin:'initial_registration',enabled:true,context:'route-a'}),events=[],cleanup=[],scope=vue.effectScope(),exports={}
 const context={exports,console,JSON,require(name){if(name==='vue')return {...vue,onBeforeUnmount:fn=>cleanup.push(fn)};if(name==='vue-i18n')return {useI18n:()=>({t:(key,params={})=>Object.entries(params).reduce((value,[name,text])=>String(value).replaceAll('{'+name+'}',text),key.split('.').reduce((value,part)=>value?.[part],dictionaries[language])??key)})};if(name.endsWith('observationVersionHistory'))return {loadObservationVersionHistory:read};if(name.endsWith('officerMonitoringDisplay'))return {reviewDateTime};if(name.endsWith('.vue'))return {name};throw Error(name)}}
 vm.runInNewContext('(function(){'+transpile(script.content)+'})()',context)
 const state=scope.run(()=>exports.default.setup(props,{emit:(...args)=>events.push(args),expose(){}}))
 vm.runInNewContext('(function(){'+transpile(template.code)+'})()',context)
 return {state,props,events,render:()=>exports.render({},[],props,vue.proxyRefs(state),{},{}),stop(){cleanup.forEach(fn=>fn());scope.stop()}}
}
function nodes(node){if(Array.isArray(node))return node.flatMap(nodes);if(!node||typeof node!=='object')return [];return [node,...nodes(node.children),...(node.children?.default ? nodes(node.children.default()) : [])]}
test('real historical rows are grey, View Details selects immutable content and emits a read-only selection',async()=>{
 const result=await loadObservationVersionHistory('obs-1','24','initial_registration',async()=>Response.json(payload([row()])))
 const h=harness(async()=>result)
 try{await flush();let tree=nodes(h.render());assert.ok(tree.some(n=>n.type==='tr'&&n.props?.class==='superseded'));tree.find(n=>n.type==='button'&&n.props.class==='secondary-button').props.onClick();assert.equal(h.state.selected.value.id,'history-1');assert.equal(h.events.at(-1)[1],true);tree=nodes(h.render());assert.equal(tree.filter(n=>n.type==='button').length,4);const image=tree.find(n=>n.type==='img');image.props.onError();assert.equal(nodes(h.render()).some(n=>n.type==='img'),false);h.props.context='route-b';await flush();assert.equal(h.state.selected.value,null);assert.equal(h.events.at(-1)[1],false)}finally{h.stop()}
 assert.equal(compileStyle({source:descriptor.styles[0].content,filename:filename.pathname,id:'history-test'}).errors.length,0)
})
test('late history cannot restore private rows after session, route changes or unmount',async()=>{
 let release;const h=harness(()=>new Promise(resolve=>release=resolve))
 h.props.enabled=false;await flush();release({available:true,versions:[row()]});await flush();assert.equal(h.state.versions.value.length,0);assert.equal(h.state.selected.value,null);h.stop()
})
test('parent handlers block historical decisions while current Pending flow remains present',()=>{
 const source=readFileSync(new URL('../src/views/conservation/ReviewSubmissionsView.vue',import.meta.url),'utf8')
 assert.match(source,/!historicalSelectionActive.value && canReviewPlant.value/)
 assert.match(source,/if \(historicalSelectionActive.value \|\|/)
 assert.match(source,/v-if="!historicalSelectionActive"/)
 assert.match(source,/performObservationReview\(\{ id, revision/)
 assert.doesNotMatch(descriptor.scriptSetup.content,/POST|performObservationReview|revision/)
})


test('route changes and disposal invalidate pending history reads', async () => {
 for (const action of ['route','dispose']) {
  const pending=[];const h=harness(()=>new Promise(resolve=>pending.push(resolve)))
  if(action==='route'){h.props.context='new-route';await flush()}else h.stop()
  pending[0]({available:true,versions:[row()]});await flush()
  assert.equal(h.state.versions.value.length,0)
  if(action==='route')h.stop()
 }
})
test('history translations have matching keys and preserve all existing categories',()=>{
 const dictionaries=['en','ms','zh-CN'].map(language=>JSON.parse(readFileSync(new URL('../src/locales/'+language+'.json',import.meta.url),'utf8')))
 const flatten=(value,prefix='')=>Object.entries(value).flatMap(([key,item])=>typeof item==='object'?flatten(item,prefix+key+'.'):[prefix+key]).sort()
 for(const dictionary of dictionaries){assert.deepEqual(flatten(dictionary.observationVersions),flatten(dictionaries[0].observationVersions));assert.ok(dictionary.observationVersions.statuses.Superseded);assert.ok(dictionary.observationEdits.title)}
})


test('UIUX-002 genuine stored ordinals retain gaps, missing ordinals stay neutral and other Observations are excluded',async()=>{
 const result=await loadObservationVersionHistory('obs-1','24','initial_registration',async()=>Response.json(payload([
  row({version_number:7}),row({id:'history-2',version_number:12,status:'Correction Required',snapshot:{observation_id:'obs-1',content:{heightCm:30},photo_ids:[]}}),
  row({id:'neutral',version_number:null}),row({id:'foreign-observation',snapshot:{observation_id:'other',content:{heightCm:999}}})])))
 assert.deepEqual(result.versions.map(v=>v.ordinal),[7,12,null])
 for(const language of ['en','ms','zh-CN']){
  const h=harness(async()=>result,language)
  try{await flush();const rows=nodes(h.render()).filter(n=>n.type==='tr'&&nodes(n).some(child=>child.type==='td'))
   assert.equal(rows.length,3);assert.equal(h.state.title.value,dictionaries[language].observationVersions.registrationTitle)
   assert.equal(h.state.versionLabel(result.versions[0]),dictionaries[language].observationVersions.version.replace('{number}','7'))
   assert.equal(h.state.versionLabel(result.versions[2]),dictionaries[language].observationVersions.snapshot)
   assert.ok(!nodes(rows).some(n=>typeof n.children==='string'&&n.children.includes('history-1')))
   const buttons=nodes(h.render()).filter(n=>n.type==='button'&&n.props.class==='secondary-button');buttons[1].props.onClick()
   assert.equal(h.state.selected.value.id,'history-2');assert.equal(h.state.selected.value.content.heightCm,30);assert.equal(h.state.selected.value.observationId,'obs-1')
   assert.equal(h.events.at(-1)[1],true);assert.ok(nodes(h.render()).some(n=>n.type==='details'&&n.props.class==='history-technical'))
   assert.ok(!nodes(h.render()).some(n=>n.type==='button'&&['Approve','Reject'].includes(n.children)))
  }finally{h.stop()}
 }
})

test('UIUX-002 failed and missing history stay honest; retry is read-only and preserves context protection',async()=>{
 let calls=0
 const h=harness(async()=>{calls++;if(calls===1)throw Error('Unavailable');return {available:true,versions:[]}})
 try{await flush();assert.equal(h.state.failed.value,true);const retry=nodes(h.render()).find(n=>n.type==='button'&&n.props.class==='secondary-button');await retry.props.onClick();assert.equal(calls,2);assert.equal(h.state.available.value,true);assert.equal(h.state.selected.value,null);assert.ok(nodes(h.render()).some(n=>n.children===dictionaries.en.observationVersions.noSnapshots))}finally{h.stop()}
 const css=descriptor.styles[0].content
 assert.match(css,/table-layout: fixed/);assert.match(css,/max-width: 100%/);assert.match(css,/focus-visible/);assert.match(css,/@media \(max-width: 480px\)/)
})

test('registration history distinguishes the original submission from corrected resubmissions in all locales',async()=>{
 const result=await loadObservationVersionHistory('obs-1','24','initial_registration',async()=>Response.json(payload([
  row({id:'corrected-v2',version_number:2,status:'Correction Required'}),
  row({id:'original-v1',version_number:1,status:'Superseded'}),
 ])))
 for(const language of ['en','ms','zh-CN']) {
  const h=harness(async()=>result,language)
  try{await flush();const labels=nodes(h.render()).filter(n=>n.props?.class==='submission-cycle-label').map(n=>n.children)
   assert.deepEqual(labels,[dictionaries[language].observationVersions.correctedResubmission,dictionaries[language].observationVersions.originalSubmission])
  }finally{h.stop()}
 }
})

test('compact registration history hides explanatory paragraphs and provides localized accessible help',async()=>{
 for(const language of ['en','ms','zh-CN']) {
  const h=harness(async()=>({available:true,versions:[]}),language)
  try{await flush();let tree=nodes(h.render());const button=tree.find(n=>n.props?.class==='history-help-button')
   assert.equal(button.props['aria-expanded'],false);button.props.onFocus();assert.equal(h.state.helpOpen.value,true)
   assert.ok(nodes(h.render()).some(n=>n.props?.role==='tooltip'&&n.children===dictionaries[language].observationVersions.historyHelp))
   button.props.onBlur();assert.equal(h.state.helpOpen.value,false);button.props.onClick();assert.equal(h.state.helpOpen.value,true)
  }finally{h.stop()}
 }
 assert.doesNotMatch(descriptor.template.content,/label\('(?:registrationIntro|limited|statusMeaning)'\)/)
 assert.match(descriptor.template.content,/@keydown.esc.stop/)
 assert.match(descriptor.styles[0].content,/overflow-y: auto/)
})

test('only exact stored identity suppresses duplicate details; matching content never does',async()=>{
 const result=await loadObservationVersionHistory('obs-1','24','initial_registration',async()=>Response.json(payload([row(),row({id:'different',version_number:2})])))
 const h=harness(async()=>result)
 try{await flush();assert.equal(h.state.historyOpen.value,false)
  h.props.displayedSnapshotId='history-1';await flush()
  h.state.select(result.versions[0]);assert.equal(h.state.selected.value,null)
  assert.ok(nodes(h.render()).some(n=>n.props?.class==='currently-viewing'))
  h.state.select(result.versions[1]);assert.equal(h.state.selected.value.id,'different')
  assert.equal(h.state.selected.value.content.notes,'Original notes')
  assert.ok(nodes(h.render()).some(n=>n.type==='table'))
  h.state.select(null);assert.ok(nodes(h.render()).some(n=>n.type==='table'))
 }finally{h.stop()}
})

test('historical details use a teleported accessible dialog, preserve sidebar rows and close without clearing history',async()=>{
 const result=await loadObservationVersionHistory('obs-1','24','initial_registration',async()=>Response.json(payload([row({snapshot:{observation_id:'obs-1',plant_id:24,scientific_name:'Saved plant',species_scientific_name:'Saved species',qr_token:'must-not-display',content:{heightCm:12,latitude:1.5,notes:'Saved notes'},photo_ids:['original-photo']}})])))
 assert.equal(result.versions[0].plantSpecies.scientific_name,'Saved plant')
 assert.ok(!Object.hasOwn(result.versions[0].plantSpecies,'qr_token'))
 for(const language of ['en','ms','zh-CN']) {
  const h=harness(async()=>result,language)
  try {await flush();h.state.select(result.versions[0]);await flush()
   let tree=nodes(h.render());const dialog=tree.find(n=>n.type?.name?.endsWith('AppModal.vue'))
   assert.ok(dialog);assert.ok(dialog.props.accessible === '' || dialog.props.accessible === true);assert.ok(dialog.props.wide === '' || dialog.props.wide === true)
   assert.equal(dialog.props.title,dictionaries[language].observationVersions.snapshotVersion.replace('{number}','1'))
   assert.ok(tree.some(n=>n.type==='table'));assert.ok(tree.some(n=>n.type==='dd'&&n.children==='Saved plant'))
   assert.ok(tree.some(n=>n.type==='img'&&n.props.src==='/api/data/assets/original-photo'))
   assert.ok(!tree.some(n=>n.type==='button'&&/Approve|Reject|Correction|Flag/.test(String(n.children))))
   dialog.props.onClose();await flush();assert.equal(h.state.selected.value,null);assert.equal(h.state.versions.value.length,1);assert.equal(h.events.at(-1)[1],false)
   h.state.select({...result.versions[0],ordinal:null});assert.equal(h.state.snapshotTitle.value,dictionaries[language].observationVersions.snapshot)
  }finally{h.stop()}
 }
 const parent=readFileSync(new URL('../src/views/conservation/ReviewSubmissionsView.vue',import.meta.url),'utf8')
 assert.match(parent,/:suspended="historicalSelectionActive"/)
 const modal=readFileSync(new URL('../src/components/conservation/AppModal.vue',import.meta.url),'utf8')
 assert.match(modal,/v-show="!suspended"/);assert.match(modal,/:inert="suspended/)
 assert.match(descriptor.template.content,/<Teleport to="body">/)
 assert.match(descriptor.styles[0].content,/width: min\(960px/)
 assert.match(descriptor.styles[0].content,/position: sticky/)
})

test('closing snapshot restores the existing parent scroll node and exact View Details focus',async()=>{
 const result=await loadObservationVersionHistory('obs-1','24','initial_registration',async()=>Response.json(payload([row()])))
 const h=harness(async()=>result)
 try{await flush();let focused=false
  const target={isConnected:true,focus(options){focused=options.preventScroll}}
  h.state.historyButtons.set('history-1',target)
  h.state.select(result.versions[0]);await flush()
  h.state.select(null);await flush();assert.equal(focused,true)
 }finally{h.stop()}
 assert.match(descriptor.scriptSetup.content,/position.node.scrollTop = position.top/)
 assert.match(descriptor.scriptSetup.content,/position.node.scrollLeft = position.left/)
})

test('snapshot reference styling preserves all saved content and opens only historical photos in the shared lightbox',async()=>{
 const result=await loadObservationVersionHistory('obs-1','24','initial_registration',async()=>Response.json(payload([row()])))
 const h=harness(async()=>result);let opened,closed=0
 try{await flush();h.state.select(result.versions[0]);h.state.preview.value={open(...args){opened=args},close(){closed++}}
  const tree=nodes(h.render()),button=tree.find(n=>n.props?.class==='snapshot-photo-button'),trigger={name:'historical-thumbnail'}
  assert.ok(button);button.props.onClick({currentTarget:trigger})
  assert.equal(opened[0][0].url,'/api/data/assets/original-photo');assert.equal(opened[1],0);assert.equal(opened[3],trigger)
  assert.equal(h.state.selected.value.content.notes,'Original notes')
  h.state.select(null);assert.equal(closed,1)
  assert.match(descriptor.styles[0].content,/snapshot-columns \{ display: grid/)
  assert.match(descriptor.styles[0].content,/@media \(max-width: 760px\)/)
  assert.match(descriptor.template.content,/<PlantPhotoLightbox ref="preview" root-scroll-lock/)
 }finally{h.stop()}
})

test('verified approved source labels the exact corrected version without hiding its distinct submitted fields',async()=>{
 const result=await loadObservationVersionHistory('obs-1','24','initial_registration',async()=>Response.json(payload([row(),row({id:'source-v2',version_number:2,status:'Approved',snapshot:{observation_id:'obs-1',content:{notes:'Submitted correction'},photo_ids:['saved-v2']}})])))
 for(const language of ['en','ms','zh-CN']) {
  const h=harness(async()=>result,language)
  try{h.props.approvedSourceSnapshotId='source-v2';h.props.displayedSnapshotId='capture-id';await flush()
   const tree=nodes(h.render()),labels=tree.filter(n=>n.props?.class==='approved-source-label');assert.equal(labels.length,1)
   assert.equal(labels[0].children,dictionaries[language].observationVersions.approvedSource)
   const buttons=tree.filter(n=>n.type==='button'&&n.props?.class==='secondary-button')
   assert.equal(buttons[0].children,dictionaries[language].observationVersions.viewDetails)
   assert.equal(buttons[1].children,dictionaries[language].observationVersions.viewSubmission)
   buttons[1].props.onClick();assert.equal(h.state.selected.value.id,'source-v2');assert.equal(h.state.selected.value.content.notes,'Submitted correction')
   assert.equal(h.state.selected.value.ordinal,2);assert.deepEqual(Array.from(h.state.selected.value.photos),['/api/data/assets/saved-v2'])
   h.props.context='new-session';h.props.approvedSourceSnapshotId='';await flush();assert.equal(h.state.selected.value,null)
   assert.equal(nodes(h.render()).filter(n=>n.props?.class==='approved-source-label').length,0)
  }finally{h.stop()}
 }
})
