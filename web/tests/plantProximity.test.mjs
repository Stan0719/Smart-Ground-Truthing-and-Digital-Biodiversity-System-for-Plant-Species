import * as proximityScore from '../src/services/plantProximityScore.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { readProximity, requestPlantProximity, requestPlantPreview } from '../src/services/plantProximity.ts'
import { formatPlantId } from '../src/utils/plantId.ts'
import { workflowBadgeStyle } from '../src/utils/workflowBadge.ts'
const config={very_close_m:2,close_m:5,nearby_m:10,radius_m:30,accuracy_warning_m:10,candidate_limit:20}
const candidate=(id='2',distance=0)=>({plant_id:id,status:'Approved',plant_name:'Separate individual Plant',species_name:'Species A',accuracy_m:null,distance_m:distance,category:distance<=2?'very_close':distance<=5?'close':distance<=10?'nearby':'additional',location_source:'approved_observation'})
const result=(extra={})=>({contract_version:1,observation_id:'1',plant_id:'1000',revision:1,checked_at:'2026-11-20T00:00:00Z',state:'complete',accuracy_m:2,config,candidates:[candidate()],eligible_count:2,unlocated_count:0,total_nearby:1,...extra})
const filename=new URL('../src/components/conservation/PlantProximityPanel.vue',import.meta.url)
const {descriptor}=parse(readFileSync(filename,'utf8')),script=compileScript(descriptor,{id:'plant-proximity'})
const template=compileTemplate({source:descriptor.template.content,filename:filename.pathname,id:'plant-proximity',compilerOptions:{bindingMetadata:script.bindings}})
const compile=code=>ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const officer={id:'officer',role:'Conservation Officer',status:'Active',mustChangePassword:false}
function harness(value=result(),language='en',user=officer){
 const labels=JSON.parse(readFileSync(new URL('../src/locales/'+language+'.json',import.meta.url),'utf8'))
 const t=(key,values={})=>Object.entries(values).reduce((text,[name,value])=>text.replaceAll('{'+name+'}',String(value)),key.split('.').reduce((v,k)=>v?.[k],labels)||key)
 const props=vue.reactive({observationId:'1',revision:1,value,loading:false,failed:false,context:'OBS-00000001'}),scope=vue.effectScope(),callbacks=[],listeners=new Set(),calls=[],previewCalls=[];let session={user,pending:false}
 const exports={},context={exports,console,AbortController,AbortSignal,Intl,window:{innerWidth:360,innerHeight:640},require(name){
  if(name==='vue')return {...vue,useId:()=> 'test-score-help',onBeforeUnmount:fn=>callbacks.push(fn)}
  if(name==='vue-i18n')return {useI18n:()=>({t,locale:vue.ref(language)})}
  if(name.endsWith('/plantProximityScore'))return proximityScore
  if(name.endsWith('/auth'))return {sessionSnapshot:()=>session,subscribeSession:fn=>{listeners.add(fn);return()=>listeners.delete(fn)}}
  if(name.endsWith('/plantProximity'))return {requestPlantPreview:async(id)=>{previewCalls.push(id);return {image:'/api/data/assets/main-'+id,scientificName:'Scientific '+id,commonName:'Common '+id}}}
  if(name.endsWith('/PlantProximityImage.vue'))return {__esModule:true,default:{name:'PlantProximityImage'}}
  if(name.endsWith('/plantId'))return {formatPlantId}
  if(name.endsWith('/workflowBadge'))return {workflowBadgeStyle}
  throw Error('Unexpected import '+name)
 }}
 vm.runInNewContext(`(function(){${compile(script.content)}})()`,context);const state=scope.run(()=>exports.default.setup(props,{emit(){},expose(){}}));vm.runInNewContext(`(function(){${compile(template.code)}})()`,context)
 return {state,props,calls,previewCalls,labels,async open(){state.drawer.value={open:false,showModal(){this.open=true},close(){this.open=false}};await state.openDrawer({currentTarget:{isConnected:true,focus(){}}})},render:()=>exports.render({},[],vue.proxyRefs(props),vue.proxyRefs(state),{},{}),session(next,pending=false){session={user:next,pending};for(const fn of listeners)fn()},stop(){callbacks.forEach(fn=>fn());scope.stop()}}
}
function nodes(root){const out=[];function walk(n){if(Array.isArray(n))return n.forEach(walk);if(!n||typeof n!=='object')return;out.push(n);if(Array.isArray(n.children))walk(n.children)}walk(root);return out}
function text(root){if(root?.type===vue.Comment)return '';if(typeof root==='string')return root;if(Array.isArray(root))return root.map(text).join(' ');return root&&typeof root==='object'?text(root.children):''}
const flush=async()=>{await new Promise(resolve=>setTimeout(resolve,0));await vue.nextTick()}
test('response contract validates identity, all raw distance boundaries, completeness, accuracy and bounded unique candidates',()=>{
 for(const distance of [0,2,2.001,5,5.001,10,10.001,30])assert.equal(readProximity(result({candidates:[candidate('2',distance)]}),'1',1).candidates[0].distance_m,distance)
 for(const r of [result({revision:2}),result({plant_id:'0'}),result({candidates:[candidate('1000')]}),result({candidates:[candidate(),candidate()]}),result({candidates:[candidate('2',31)]}),result({accuracy_m:NaN}),result({candidates:[{...candidate(),category:'close'}]}),result({total_nearby:2}),result({state:'incomplete'})])assert.throws(()=>readProximity(r,'1',1))
 assert.equal(readProximity(result({state:'incomplete',unlocated_count:1,eligible_count:3}),'1',1).state,'incomplete')
 assert.equal(readProximity(result({state:'unavailable',candidates:[],reason:'invalid_coordinates'}),'1',1).state,'unavailable')
})
test('browser request is GET-only, same-origin, no-store and validates the actual response',async()=>{
 const original=globalThis.fetch,calls=[]
 try{globalThis.fetch=async(url,options)=>{calls.push({url,options});return Response.json(result())};await requestPlantProximity('1',1)
 assert.equal(calls[0].url,'/api/data/observations/1/proximity?revision=1');assert.equal(calls[0].options.method,'GET');assert.equal(calls[0].options.credentials,'same-origin');assert.equal(calls[0].options.cache,'no-store');assert.equal(calls[0].options.body,undefined)
 globalThis.fetch=async()=>Response.json({error:'Private server detail'},{status:409});await assert.rejects(requestPlantProximity('1',1),/unavailable/)
 }finally{globalThis.fetch=original}
})
test('shared drawer keeps authorized candidates, photos, names, distances and inspection links in every locale',async()=>{
 for(const language of ['en','ms','zh-CN']){
  const rows=[candidate('2',0),candidate('3',3),candidate('4',7),candidate('5',25)],h=harness(result({candidates:rows,total_nearby:4,eligible_count:4,accuracy_m:25}),language)
  try{await flush();assert.equal(nodes(h.render()).filter(n=>n.type==='li'&&n.key).length,0);await h.open();const tree=nodes(h.render()),visible=text(h.render());assert.ok(visible.includes(h.labels.plantProximity.accuracyUnknown));assert.ok(visible.includes(h.labels.plantProximity.drawerGpsWarning));assert.equal(tree.filter(n=>n.type==='li'&&n.key).length,4)
   for(const row of rows){assert.ok(visible.includes(formatPlantId(row.plant_id)));assert.ok(visible.includes(h.labels.plantProximity['short_'+row.category]));assert.ok(tree.some(n=>n.type==='a'&&n.props.href==='/plant/'+row.plant_id&&n.props.target==='_blank'&&n.props.rel==='noopener noreferrer'))}
   assert.equal(h.calls.length,0,'drawer never repeats the proximity API request');assert.doesNotMatch(visible,/100% duplicate|high probability|definitely different/i)
  }finally{h.stop()}
 }
})

test('drawer preserves empty, incomplete, loading and unavailable states without a false None result',async()=>{
 for(const state of ['complete','incomplete','unavailable','failed','loading']){
  const h=harness(result({state:state==='failed'||state==='loading'?'complete':state,candidates:[],total_nearby:0,unlocated_count:state==='incomplete'?1:0}))
  try{h.props.failed=state==='failed';h.props.loading=state==='loading';await h.open();const visible=text(h.render());assert.equal(visible.includes(h.labels.plantProximity.none.replace('{radius}','30')),state==='complete');assert.equal(visible.includes(h.labels.plantProximity.incomplete),state==='incomplete');assert.equal(visible.includes(h.labels.plantProximity.unavailable),state==='failed'||state==='unavailable');assert.equal(visible.includes(h.labels.plantProximity.loading),state==='loading')}finally{h.stop()}
 }
})

test('drawer clears on selection, revision or session boundaries and never runs proximity reads or decisions',async()=>{
 for(const user of [null,{...officer,role:'Botanist'},{...officer,status:'Inactive'},{...officer,mustChangePassword:true}]){const h=harness(result(),'en',user);try{await h.open();assert.equal(h.state.drawer.value.open,false);assert.equal(text(h.render()),'')}finally{h.stop()}}
 const h=harness();try{await h.open();assert.equal(h.state.drawer.value.open,true);h.props.revision=2;await flush();assert.equal(h.state.drawer.value.open,false);h.props.value=result({revision:2});await h.open();h.session(null);await flush();assert.equal(h.state.drawer.value.open,false);assert.equal(h.calls.length,0);assert.doesNotMatch(descriptor.scriptSetup.content,/requestPlantProximity|decide\(|Flagged|POST|notification/)}finally{h.stop()}
})

test('one shared drawer shows only the nearest five real Plants and keeps native keyboard/focus behavior',async()=>{
 for(const count of [0,1,3,5,8]){
  const rows=Array.from({length:count},(_,i)=>candidate(String(i+2),i+0.43)),h=harness(result({candidates:rows,total_nearby:count,eligible_count:count}))
  try{await h.open();const cards=nodes(h.render()).filter(n=>n.type==='li'&&n.key);assert.equal(cards.length,Math.min(5,count));assert.deepEqual(cards.map(n=>n.key),rows.slice(0,5).map(r=>r.plant_id));assert.equal(h.previewCalls.length,Math.min(5,count));const images=nodes(h.render()).filter(n=>n.type?.name==='PlantProximityImage');assert.equal(images.length,Math.min(5,count))
   let restored=false;h.state.closeDrawer();await h.state.openDrawer({currentTarget:{isConnected:true,focus(options){restored=options.preventScroll}}});assert.equal(h.previewCalls.length,Math.min(5,count));const dialog=nodes(h.render()).find(n=>n.type==='dialog');dialog.props.onCancel({preventDefault(){},stopPropagation(){}});assert.equal(h.state.drawerOpen.value,false);assert.equal(restored,true)
  }finally{h.stop()}
 }
 const css=descriptor.styles[0].content;assert.match(css,/width: min\(760px, 100vw\)/);assert.match(css,/overflow-y: auto/);assert.match(descriptor.template.content,/<Teleport to="body">/);assert.match(descriptor.scriptSetup.content,/showModal\(\)/);assert.doesNotMatch(descriptor.template.content,/plant-proximity-panel|proximity-summary-row/)
})

test('authorized catalogue preview uses only its official main photo and safely handles missing, denied or mismatched records',async()=>{
 const original=globalThis.fetch,calls=[],signal=new AbortController().signal
 try{
  for(const [row,expected] of [[{plant_id:2,rbac_status:'Approved',plant_image_asset_id:'official-main',scientific_name:'Species',common_name:'Common'},'/api/data/assets/official-main'],[{plant_id:2,rbac_status:'Approved'},''],[{plant_id:2,rbac_status:'Pending Review',plant_image_asset_id:'private-evidence'},''],[{plant_id:2,rbac_status:'Approved',plant_image_asset_id:'https://unsafe/image'},'']]){
   globalThis.fetch=async(url,options)=>{calls.push({url,options});return Response.json({plant:row})};const preview=await requestPlantPreview('2',signal);assert.equal(preview.image,expected)
  }
  assert.ok(calls.every(c=>c.url==='/api/data/plants/2'&&c.options.method==='GET'&&c.options.credentials==='same-origin'&&c.options.cache==='no-store'))
  globalThis.fetch=async()=>Response.json({plant:{plant_id:3}});await assert.rejects(requestPlantPreview('2',signal),/Invalid/)
  globalThis.fetch=async()=>Response.json({}, {status:403});await assert.rejects(requestPlantPreview('2',signal),/unavailable/)
  await assert.rejects(requestPlantPreview('../secret',signal),/Invalid/)
 }finally{globalThis.fetch=original}
})

test('thumbnail keeps one proportionate authorized image and uses the catalogue leaf placeholder on missing/failed images',()=>{
 const file=new URL('../src/components/conservation/PlantProximityImage.vue',import.meta.url),source=readFileSync(file,'utf8'),{descriptor:d}=parse(source),compiled=compileScript(d,{id:'nearby-image'}),out={}
 const context={exports:out,require(name){if(name==='vue')return vue;if(name.endsWith('/PlantPhotoLightbox.vue'))return {__esModule:true,default:{name:'PlantPhotoLightbox'}};if(name.endsWith('/assetImages'))return {webAssetUrl:value=>/^\/api\/data\/assets\/[A-Za-z0-9_-]+$/.test(value)?value:''};throw Error(name)}}
 vm.runInNewContext(compile(compiled.content),context)
 const props=vue.reactive({src:'/api/data/assets/main',alt:'Plant photo',unavailable:'Photo unavailable'}),scope=vue.effectScope(),state=scope.run(()=>out.default.setup(props,{expose(){}}))
 try{let opened=[];state.preview.value={open(...args){opened.push(args)},close(){}};const trigger={};state.openPreview({currentTarget:trigger});assert.equal(opened.length,1);assert.equal(opened[0][0][0].url,props.src);assert.equal(opened[0][3],trigger);assert.equal(state.image.value,props.src);state.imageFailed({currentTarget:{getAttribute:()=>props.src}});assert.equal(state.failed.value,props.src);state.openPreview({currentTarget:trigger});assert.equal(opened.length,1);props.src='https://unauthorized/image';assert.equal(state.image.value,'');state.openPreview({currentTarget:trigger});assert.equal(opened.length,1);assert.match(d.template.content,/<PlantPhotoLightbox ref="preview" root-scroll-lock/);assert.match(d.template.content,/aria-haspopup="dialog"/);assert.match(d.template.content,/v-if="image && failed !== image"/);assert.match(d.template.content,/record-placeholder/);assert.equal((d.template.content.match(/<img /g)||[]).length,1);assert.match(d.styles[0].content,/object-fit: contain/)}finally{scope.stop()}
})


test('drawer uses the approved shared score for cards without a nearest-summary panel and keeps uncertainty visible without changing it',async()=>{
 for(const language of ['en','ms','zh-CN'])for(const accuracy of [2,null,25]){
  const rows=[{...candidate('21',0.43),accuracy_m:accuracy},{...candidate('8',2.42),accuracy_m:2},{...candidate('31',15.29),accuracy_m:2}],h=harness(result({candidates:rows,total_nearby:3,eligible_count:3,accuracy_m:accuracy}),language)
  try{await h.open();const visible=text(h.render());assert.equal(h.state.candidateScore(0.43),96);assert.ok(!nodes(h.render()).some(n=>n.props?.class==='nearest-risk-summary'));assert.equal(h.state.candidateScore(2.42),76);assert.equal(h.state.candidateScore(15.29),15);assert.ok(visible.includes(proximityScore.formatProximityScore(96,language)));assert.ok(!nodes(h.render()).some(n=>n.props?.class==='score-help'));assert.ok(!visible.includes(h.labels.plantProximity.scoreAbout));assert.ok(!visible.includes(h.labels.plantProximity.unverifiedLocation));assert.ok(visible.includes(h.labels.plantProximity.accuracyHeading));assert.ok(visible.includes(h.labels.plantProximity.newPlantAccuracy));assert.ok(visible.includes(h.labels.plantProximity.existingPlantAccuracy));assert.equal(visible.includes(h.labels.plantProximity.drawerGpsWarning),accuracy!==2);assert.ok(visible.includes('0.43'));assert.equal(nodes(h.render()).filter(n=>n.type==='li'&&n.key).length,3)}finally{h.stop()}
 }
 const h=harness(result({state:'incomplete',unlocated_count:1,eligible_count:3,candidates:[candidate('21',0.43)]}));try{await h.open();assert.equal(h.state.candidateScore(0.43),null);assert.equal(h.state.scoreText(0.43),h.labels.plantProximity.tableIncomplete);assert.ok(!text(h.render()).includes('96%'))}finally{h.stop()}
})


test('score heading has no tooltip icon or long explanation',()=>{
 assert.doesNotMatch(descriptor.template.content,/score-help|scoreHelp|risk-explanation/)
})
