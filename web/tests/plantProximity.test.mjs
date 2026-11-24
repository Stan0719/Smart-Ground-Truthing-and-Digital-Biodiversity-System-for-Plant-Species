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
const config={very_close_m:2,close_m:5,nearby_m:10,grouping_radius_m:5,radius_m:30,accuracy_warning_m:10,candidate_limit:20}
const candidate=(id='2',distance=0,extra={})=>({plant_id:id,status:'Approved',plant_name:'Representative Plant group',species_name:'Species A',accuracy_m:2,distance_m:distance,category:distance<=2?'very_close':distance<=5?'close':distance<=10?'nearby':'additional',location_source:'approved_observation',match_status:'same_species_zone',within_grouping_radius:distance<=5,...extra})
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
  if(name.endsWith('/ReviewLocationMap.vue'))return {__esModule:true,default:{name:'ReviewLocationMap'}}
  if(name.endsWith('/PlantProximityImage.vue'))return {__esModule:true,default:{name:'PlantProximityImage'}}
  if(name.endsWith('/plantId'))return {formatPlantId}
  if(name.endsWith('/workflowBadge'))return {workflowBadgeStyle}
  throw Error('Unexpected import '+name)
 }}
 vm.runInNewContext(`(function(){${compile(script.content)}})()`,context);const state=scope.run(()=>exports.default.setup(props,{emit(){},expose(){}}));vm.runInNewContext(`(function(){${compile(template.code)}})()`,context)
 return {state,props,calls,previewCalls,labels,async open(){state.drawer.value={open:false,showModal(){this.open=true},close(){this.open=false},focus(){}};await state.openDrawer({currentTarget:{isConnected:true,focus(){}}})},render:()=>exports.render({},[],vue.proxyRefs(props),vue.proxyRefs(state),{},{}),session(next,pending=false){session={user:next,pending};for(const fn of listeners)fn()},stop(){callbacks.forEach(fn=>fn());scope.stop()}}
}
function nodes(root){const out=[];function walk(n){if(Array.isArray(n))return n.forEach(walk);if(!n||typeof n!=='object')return;out.push(n);if(Array.isArray(n.children))walk(n.children)}walk(root);return out}
function text(root){if(root?.type===vue.Comment)return '';if(typeof root==='string')return root;if(Array.isArray(root))return root.map(text).join(' ');return root&&typeof root==='object'?text(root.children):''}
const flush=async()=>{await new Promise(resolve=>setTimeout(resolve,0));await vue.nextTick()}
test('response contract validates identity, all raw distance boundaries, completeness, accuracy and bounded unique candidates',()=>{
 for(const distance of [0,2,2.001,5,5.001,10,10.001,30])assert.equal(readProximity(result({candidates:[candidate('2',distance)]}),'1',1).candidates[0].distance_m,distance)
 for(const r of [result({revision:2}),result({plant_id:'0'}),result({candidates:[candidate('1000')]}),result({candidates:[candidate(),candidate()]}),result({candidates:[candidate('2',31)]}),result({accuracy_m:NaN}),result({candidates:[{...candidate(),category:'close'}]}),result({candidates:[{...candidate(),within_grouping_radius:false}]}),result({total_nearby:2}),result({state:'incomplete'})])assert.throws(()=>readProximity(r,'1',1))
 assert.equal(readProximity(result({state:'incomplete',unlocated_count:1,eligible_count:3}),'1',1).state,'incomplete')
 assert.equal(readProximity(result({state:'unavailable',candidates:[],reason:'invalid_coordinates'}),'1',1).state,'unavailable')
 const legacy=result();delete legacy.config.grouping_radius_m;delete legacy.candidates[0].match_status;delete legacy.candidates[0].within_grouping_radius
 const legacyParsed=readProximity(legacy,'1',1);assert.equal(legacyParsed.candidates[0].match_status,'uncertain_match');assert.equal(legacyParsed.config.grouping_radius_m,5)
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
  const rows=[candidate('2',0,{accuracy_m:null}),candidate('3',3),candidate('4',7),candidate('5',25)],h=harness(result({candidates:rows,total_nearby:4,eligible_count:4,accuracy_m:25}),language)
  try{await flush();assert.equal(nodes(h.render()).filter(n=>n.type==='li'&&n.key).length,0);await h.open();const tree=nodes(h.render()),visible=text(h.render());assert.ok(visible.includes(h.labels.plantProximity.accuracyUnknown));assert.ok(visible.includes(h.labels.plantProximity.drawerGpsWarning));assert.equal(tree.filter(n=>n.type==='li'&&n.key).length,4)
   for(const row of rows){assert.ok(visible.includes(formatPlantId(row.plant_id)));assert.ok(visible.includes(h.labels.plantProximity['short_'+row.category]));assert.ok(tree.some(n=>n.type==='button'&&n.children===h.labels.plantProximity.viewOnMap))}
   assert.equal(h.calls.length,0,'drawer never repeats the proximity API request');assert.doesNotMatch(visible,/100% duplicate|high probability|definitely different/i)
  }finally{h.stop()}
 }
})

test('drawer keeps unavailable species/zone match information compact in the risk panel',async()=>{
 for(const language of ['en','ms','zh-CN']){
  const uncertainCandidate=candidate('8',0.33,{match_status:'uncertain_zone',within_grouping_radius:null}),h=harness(result({candidates:[uncertainCandidate],total_nearby:1,eligible_count:1}),language)
  try{
   await h.open();const tree=nodes(h.render()),riskPanel=tree.find(node=>node.type==='aside'&&String(node.props?.class||'').includes('candidate-risk')),match=tree.find(node=>String(node.props?.class||'').includes('candidate-match'))
   assert.ok(riskPanel);assert.ok(match);assert.ok(nodes(riskPanel).includes(match));assert.equal(h.state.candidateScore(uncertainCandidate),null)
   assert.ok(text(match).length>0)
  }finally{h.stop()}
 }
})

test('drawer labels pending-name comparisons as provisional in every locale without assigning a score',async()=>{
 for(const language of ['en','ms','zh-CN']){
  const row=candidate('23',0.33,{match_status:'provisional_species',species_match_status:'provisional_different_name',zone_match_status:'same',within_grouping_radius:true})
  const h=harness(result({candidates:[row],total_nearby:1,eligible_count:1}),language)
  try{
   await h.open();const tree=nodes(h.render()),match=tree.find(node=>String(node.props?.class||'').includes('candidate-match'))
   assert.ok(match);assert.ok(text(match).includes(h.labels.plantProximity.matchProvisionalDifferentNameSameZone))
   assert.equal(h.state.candidateScore(row),null)
   assert.ok(!text(match).includes(h.labels.plantProximity.matchDifferentSpecies))
  }finally{h.stop()}
 }
})

test('drawer preserves empty, incomplete, loading and unavailable states without a false None result',async()=>{
 for(const state of ['complete','incomplete','unavailable','failed','loading']){
  const h=harness(result({state:state==='failed'||state==='loading'?'complete':state,candidates:[],total_nearby:0,unlocated_count:state==='incomplete'?1:0}))
  try{h.props.failed=state==='failed';h.props.loading=state==='loading';if(state==='loading'||state==='failed')h.props.value=null;await h.open();const visible=text(h.render());assert.equal(visible.includes(h.labels.plantProximity.none.replace('{radius}','30')),state==='complete');assert.equal(visible.includes(h.labels.plantProximity.incomplete),state==='incomplete');assert.equal(visible.includes(h.labels.plantProximity.unavailable),state==='failed'||state==='unavailable');assert.equal(visible.includes(h.labels.plantProximity.loading),state==='loading')}finally{h.stop()}
 }
})

test('drawer clears on selection, revision or session boundaries and never runs proximity reads or decisions',async()=>{
 for(const user of [null,{...officer,role:'Botanist'},{...officer,status:'Inactive'},{...officer,mustChangePassword:true}]){const h=harness(result(),'en',user);try{await h.open();assert.equal(h.state.drawer.value.open,false);assert.equal(text(h.render()).trim(),'')}finally{h.stop()}}
 const h=harness();try{await h.open();assert.equal(h.state.drawer.value.open,true);h.props.revision=2;await flush();assert.equal(h.state.drawer.value.open,false);h.props.value=result({revision:2});await h.open();h.session(null);await flush();assert.equal(h.state.drawer.value.open,false);assert.equal(h.calls.length,0);assert.doesNotMatch(descriptor.scriptSetup.content,/requestPlantProximity|decide\(|Flagged|POST|notification/)}finally{h.stop()}
})

test('one shared drawer shows only the nearest five real Plants and keeps native keyboard/focus behavior',async()=>{
 for(const count of [0,1,3,5,8]){
  const rows=Array.from({length:count},(_,i)=>candidate(String(i+2),i+0.43)),h=harness(result({candidates:rows,total_nearby:count,eligible_count:count}))
  try{await h.open();const cards=nodes(h.render()).filter(n=>n.type==='li'&&n.key);assert.equal(cards.length,Math.min(5,count));assert.deepEqual(cards.map(n=>n.key),rows.slice(0,5).map(r=>r.plant_id));assert.equal(h.previewCalls.length,Math.min(5,count));const images=nodes(h.render()).filter(n=>n.type?.name==='PlantProximityImage');assert.equal(images.length,Math.min(5,count))
   let restored=false;h.state.closeDrawer();await h.state.openDrawer({currentTarget:{isConnected:true,focus(options){restored=options.preventScroll}}});assert.equal(h.previewCalls.length,Math.min(5,count));const dialog=nodes(h.render()).find(n=>n.type==='dialog');dialog.props.onCancel({preventDefault(){},stopPropagation(){}});assert.equal(h.state.drawerOpen.value,false);assert.equal(restored,true)
  }finally{h.stop()}
 }
 const css=descriptor.styles[0].content;assert.match(css,/width: min\(700px, 100vw\)/);assert.match(css,/overflow-y: auto/);assert.match(css,/background: #15563f/);assert.match(descriptor.template.content,/<Teleport to="body">/);assert.match(descriptor.scriptSetup.content,/showModal\(\)/);assert.doesNotMatch(descriptor.template.content,/plant-proximity-panel|proximity-summary-row/)
})

test('authorized catalogue preview uses only its official main photo and safely handles missing, denied or mismatched records',async()=>{
 const original=globalThis.fetch,calls=[],signal=new AbortController().signal
 try{
  for(const [row,expected] of [[{plant_id:2,rbac_status:'Approved',plant_image_asset_id:'official-main',scientific_name:'Species',common_name:'Common'},'/api/data/assets/official-main'],[{plant_id:2,rbac_status:'Approved'},''],[{plant_id:2,rbac_status:'Pending Review',plant_image_asset_id:'private-evidence'},''],[{plant_id:2,rbac_status:'Approved',plant_image_asset_id:'https://unsafe/image'},'']]){
   globalThis.fetch=async(url,options)=>{calls.push({url,options});return Response.json({plant:row})};const preview=await requestPlantPreview('2',signal);assert.equal(preview.image,expected)
  }
  assert.ok(calls.filter(c=>c.url==='/api/data/plants/2').every(c=>c.options.method==='GET'&&c.options.credentials==='same-origin'&&c.options.cache==='no-store'))
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
 try{let opened=[];state.preview.value={open(...args){opened.push(args)},close(){}};const trigger={};state.openPreview({currentTarget:trigger});assert.equal(opened.length,1);assert.equal(opened[0][0][0].url,props.src);assert.equal(opened[0][3],trigger);assert.equal(state.image.value,props.src);props.src='/api/data/plants/2/detail/assets/registration-photo';assert.equal(state.image.value,props.src);state.imageFailed({currentTarget:{getAttribute:()=>props.src}});assert.equal(state.failed.value,props.src);state.openPreview({currentTarget:trigger});assert.equal(opened.length,1);props.src='https://unauthorized/image';assert.equal(state.image.value,'');state.openPreview({currentTarget:trigger});assert.equal(opened.length,1);assert.match(d.template.content,/<PlantPhotoLightbox ref="preview" root-scroll-lock/);assert.match(d.template.content,/aria-haspopup="dialog"/);assert.match(d.template.content,/v-if="image && failed !== image"/);assert.match(d.template.content,/record-placeholder/);assert.equal((d.template.content.match(/<img /g)||[]).length,1);assert.match(d.styles[0].content,/object-fit: contain/)}finally{scope.stop()}
})


test('only confirmed same-Species same-zone candidates with reliable GPS receive the shared distance score',async()=>{
 for(const language of ['en','ms','zh-CN'])for(const accuracy of [2,null,25]){
  const rows=[{...candidate('21',0.43),accuracy_m:accuracy},{...candidate('8',2.42),accuracy_m:2},{...candidate('31',15.29),accuracy_m:2}],h=harness(result({candidates:rows,total_nearby:3,eligible_count:3,accuracy_m:accuracy}),language)
  try{await h.open();const visible=text(h.render());assert.equal(h.state.candidateScore(rows[0]),accuracy===2?96:null);assert.ok(!nodes(h.render()).some(n=>n.props?.class==='nearest-risk-summary'));assert.equal(h.state.candidateScore(rows[1]),accuracy===2?76:null);assert.equal(h.state.candidateScore(rows[2]),accuracy===2?15:null);assert.equal(visible.includes(proximityScore.formatProximityScore(96,language)),accuracy===2);assert.ok(!nodes(h.render()).some(n=>n.props?.class==='score-help'));assert.ok(!visible.includes(h.labels.plantProximity.scoreAbout));assert.ok(!visible.includes(h.labels.plantProximity.unverifiedLocation));assert.ok(visible.includes(h.labels.plantProximity.accuracyHeading));assert.ok(visible.includes(h.labels.plantProximity.newPlantAccuracy));assert.ok(visible.includes(h.labels.plantProximity.existingPlantAccuracy));assert.equal(visible.includes(h.labels.plantProximity.drawerGpsWarning),accuracy!==2);assert.ok(visible.includes('0.43'));assert.equal(nodes(h.render()).filter(n=>n.type==='li'&&n.key).length,3)}finally{h.stop()}
 }
 const h=harness(result({state:'incomplete',unlocated_count:1,eligible_count:3,candidates:[candidate('21',0.43)]}));try{await h.open();assert.equal(h.state.candidateScore(candidate('21',0.43)),null);assert.equal(h.state.scoreText(candidate('21',0.43)),h.labels.plantProximity.tableIncomplete);assert.ok(!text(h.render()).includes('96%'))}finally{h.stop()}
})

test('different Species and zones receive no risk score; unresolved match or accuracy stays explicitly uncertain',()=>{
 const known=result(), candidateRows=[candidate('2',1,{match_status:'different_species'}),candidate('3',1,{match_status:'different_zone'}),candidate('4',1,{match_status:'uncertain_species'}),candidate('5',1,{match_status:'uncertain_zone'}),candidate('6',1,{accuracy_m:null})]
 for(const row of candidateRows)assert.equal(proximityScore.groupRiskScore(row,known),null)
 assert.equal(proximityScore.nearestGroupCandidate(candidateRows).plant_id,'6');assert.equal(proximityScore.hasUncertainGroupCandidate(candidateRows),true)
 assert.equal(proximityScore.nearestGroupCandidate([candidate('8',1),candidate('7',8)]).plant_id,'8')
 assert.deepEqual([1,4,8,25].map(distance=>proximityScore.groupRiskScore(candidate('9',distance),known)),[90,60,32,5])
 assert.equal(proximityScore.gpsProximityScore(1,config),90)
})


test('score heading has no tooltip icon or long explanation',()=>{
 assert.doesNotMatch(descriptor.template.content,/score-help|scoreHelp|risk-explanation/)
})

test('Officer pending thumbnails use authorized initial registration evidence while catalogue thumbnails stay private',async()=>{
 const original=globalThis.fetch,signal=new AbortController().signal,calls=[]
 const asset={asset_id:'registration-photo',content_type:'image/jpeg',observation_id:'original',linkage:'observation',effective_origin:'initial_registration',observation_date:'2026-11-23T00:00:00Z',observation_status:'Pending Review',observation_revision:1,photo_order:'0'}
 try{
  for(const scenario of ['photo','empty','denied','invalid','subsequent']){
   globalThis.fetch=async(url,options)=>{
    calls.push({url,options})
    if(url==='/api/data/plants/2')return Response.json({plant:{plant_id:2,rbac_status:'Pending Review',plant_image_asset_id:'not-public'}})
    assert.equal(url,'/api/data/plants/2/detail/gallery?limit=20');assert.equal(options.credentials,'same-origin')
    if(scenario==='denied')return Response.json({}, {status:403})
    if(scenario==='invalid')return Response.json({plant_id:'3',assets:[asset],page:{limit:20,has_more:false,next_cursor:null}})
    return Response.json({plant_id:'2',assets:scenario==='empty'?[]:[{...asset,effective_origin:scenario==='subsequent'?'subsequent_observation':'initial_registration'}],page:{limit:20,has_more:false,next_cursor:null}})
   }
   const preview=await requestPlantPreview('2',signal)
   assert.equal(preview.image,scenario==='photo'?'/api/data/plants/2/detail/assets/registration-photo':'')
  }
  assert.ok(calls.some(c=>c.url.includes('/detail/gallery')))
 }finally{globalThis.fetch=original}
})


test('map contract retains exact coordinates, rejects malformed pairs and permits unavailable legacy coordinates',()=>{
 const target={latitude:0,longitude:0,status:'Pending Review',source:'submission'}
 const r=result({target_location:target,candidates:[candidate('2',0,{latitude:0,longitude:0})]})
 assert.deepEqual(readProximity(r,'1',1).target_location,target)
 for(const coords of [{latitude:NaN,longitude:0},{latitude:91,longitude:0},{latitude:0,longitude:181},{latitude:0}]){
  assert.throws(()=>readProximity({...r,target_location:{...target,...coords,longitude:coords.longitude}},'1',1))
  assert.throws(()=>readProximity({...r,candidates:[candidate('2',0,coords)]},'1',1))
 }
 assert.equal(readProximity(result(),'1',1).target_location,undefined)
})
test('map selection preserves drawer, closes on revision/session changes and never navigates',async()=>{
 const h=harness(result({target_location:{latitude:0,longitude:0,status:'Pending Review',source:'submission'}}))
 try{
  await h.open();const trigger=nodes(h.render()).find(n=>n.type==='button'&&n.children===h.labels.plantProximity.viewOnMap)
  trigger.props.onClick();assert.equal(h.state.drawerOpen.value,true);assert.equal(h.state.mapCandidate.value.plant_id,'2')
  let modal=nodes(h.render()).find(n=>n.type?.name==='ReviewLocationMap');assert.equal(modal.props.target.plantId,'1000');assert.equal(modal.props.candidate.plantId,'2')
  modal.props.onClose();assert.equal(h.state.mapCandidate.value,null);assert.equal(h.state.drawerOpen.value,true)
  trigger.props.onClick();h.props.revision=2;await flush();assert.equal(h.state.mapCandidate.value,null)
  await h.open();h.state.mapCandidate.value=candidate();h.session(null);assert.equal(h.state.mapCandidate.value,null)
 }finally{h.stop()}
})
test('review map uses native modal lifecycle, pixel-separated icons, text-safe tooltips and no catalogue loading',()=>{
 const source=readFileSync(new URL('../src/components/conservation/ReviewLocationMap.vue',import.meta.url),'utf8')
 const {descriptor:d}=parse(source);const compiled=compileScript(d,{id:'review-map'});assert.ok(compiled.content)
 assert.match(source,/showModal\(\)/);assert.match(source,/@cancel.prevent.stop/);assert.match(source,/preventScroll: true/)
 assert.match(source,/map\?\.remove\(\)/);assert.match(source,/invalidateSize/);assert.match(source,/fitBounds/)
 assert.match(source,/#E65B32/);assert.match(source,/#176BD2/);assert.match(source,/tooltip.textContent/);assert.match(source,/border: 4px solid #fff/)
 assert.doesNotMatch(source,/fetch\(|router|requestPlantApi/)
 assert.match(source,/locationUnavailable/);assert.match(source,/accuracyUnknown/);assert.match(d.template.content,/conservationText.coordinates/);assert.doesNotMatch(d.template.content,/label\('locationSource'\)|\}\} \? \{\{/)
 for(const lang of ['en','ms','zh-CN']){
  const messages=JSON.parse(readFileSync(new URL('../src/locales/'+lang+'.json',import.meta.url),'utf8')).plantProximity
  for(const key of ['viewOnMap','mapTitle','currentSubmission','nearbyPlant','mapAccuracy','locationSource','locationUnavailable','overlappingLocations'])assert.ok(messages[key])
 }
})


for (const longitude of [0, 0.000005]) test('review markers retain exact GPS positions at longitude '+longitude+', remain interactive and restore focus',async()=>{
 const source=readFileSync(new URL('../src/components/conservation/ReviewLocationMap.vue',import.meta.url),'utf8')
 const {descriptor:d}=parse(source),script=compileScript(d,{id:'map-runtime'}),out={},mounted=[],cleanup=[],positions=[],fits=[],events=[]
 const handlers={},icons=[],clicks=[];let pixelDistance=0
 const map={on(name,fn){handlers[name]=fn},latLngToLayerPoint(){return {distanceTo:()=>pixelDistance}},invalidateSize(){},fitBounds(bounds){fits.push(bounds)},setView(){},remove(){events.push('remove')}}
 const leaflet={map:()=>map,tileLayer:()=>({addTo(){}}),latLngBounds:points=>points,divIcon:options=>options,marker(point){positions.push(point);const marker={getLatLng:()=>point,setLatLng(next){point=next;events.push('move');return marker},setTooltipContent(){return marker},remove(){events.push('marker-remove')},setIcon(icon){icons.push(icon);return marker},on(name,fn){assert.equal(name,'click');clicks.push(fn);return marker},addTo(){return marker},bindTooltip(){return marker},openTooltip(){events.push('tooltip')}};return marker}}
 const element=()=>({textContent:'',className:'',children:[],style:{setProperty(k,v){this[k]=v}},classList:{add(){}},setAttribute(){},append(...items){this.children.push(...items)}})
 let frame
 const props=vue.reactive({target:{plantId:'1',status:'Pending Review',latitude:0,longitude:0,accuracy:null,source:'submission'},candidate:{plantId:'2',status:'Pending Review',latitude:0,longitude,accuracy:2,source:'pending_observation_unverified'}})
 const scope=vue.effectScope(),opener={isConnected:true,focus(options){assert.equal(options.preventScroll,true);events.push('focus')}}
 vm.runInNewContext(compile(script.content),{exports:out,document:{activeElement:opener,createElement:element,createElementNS:element},ResizeObserver:class{observe(){}disconnect(){events.push('disconnect')}},requestAnimationFrame(fn){frame=fn;return 1},cancelAnimationFrame(){},require(name){
  if(name==='leaflet')return leaflet
  if(name.endsWith('.css'))return {}
  if(name==='vue')return {...vue,onMounted:fn=>mounted.push(fn),onBeforeUnmount:fn=>cleanup.push(fn)}
  if(name==='vue-i18n')return {useI18n:()=>({t:key=>key,locale:vue.ref('en')})}
  if(name.endsWith('/plantId'))return {formatPlantId}
  throw Error(name)
 }})
 const state=scope.run(()=>out.default.setup(props,{expose(){},emit:event=>events.push(event)}))
 try{
  state.dialog.value={showModal(){events.push('showModal')},close(){events.push('close')}};state.canvas.value={}
  await mounted[0]();frame();assert.deepEqual(JSON.parse(JSON.stringify(positions)),[[0,0],[0,longitude]]);assert.equal(fits[0].length,2);assert.equal(clicks.length,2);clicks.forEach(fn=>fn());assert.equal(events.filter(e=>e==='tooltip').length,2)
  assert.equal(state.separated.value,true);
  assert.deepEqual(Array.from(state.records.value,p=>p.color),['#E65B32','#176BD2']);
  for(const [i,icon] of icons.entries()){const badge=icon.html.children.at(-1);assert.equal(badge.children[0].textContent,String(i+1));assert.equal(badge.children[1].textContent,formatPlantId(String(i+1)));assert.ok(badge.style.transform.includes(i===0?'-54px':'54px'))}
  state.canvas.value.clientWidth=200;pixelDistance=0;handlers.zoomend();assert.equal(state.separated.value,true);assert.ok(icons.at(-1).html.children.at(-1).style.transform.includes('44px'));state.canvas.value.clientWidth=800;pixelDistance=15;handlers.zoomend();assert.equal(state.separated.value,true);pixelDistance=200;handlers.zoomend();assert.equal(state.separated.value,false);assert.ok(icons.at(-1).html.children.at(-1).style.transform.includes('0px'));assert.deepEqual(JSON.parse(JSON.stringify(positions)),[[0,0],[0,longitude]]);
  assert.equal(state.accuracyLabel({accuracy:9.437513611831253}),'9.44 m');assert.equal(state.accuracyLabel({accuracy:9.26362373692627}),'9.26 m');assert.equal(state.accuracyLabel({accuracy:0}),'0.00 m');assert.equal(state.located({latitude:null,longitude:0}),false);assert.equal(state.located({latitude:91,longitude:0}),false)
  assert.equal(state.coordinateLabel(props.target),'0, 0');assert.equal(state.coordinateLabel({latitude:null,longitude:0}),'plantProximity.locationUnavailable');props.candidate={...props.candidate,longitude:0.00001};await vue.nextTick();frame();assert.ok(events.includes('move'));assert.equal(events.filter(e=>e==='showModal').length,1);assert.equal(state.accuracyLabel(props.target),'plantProximity.accuracyUnknown');state.focusMarker(1);assert.ok(events.includes('tooltip'))
  const template=compileTemplate({source:d.template.content,filename:'ReviewLocationMap.vue',id:'map-runtime',compilerOptions:{bindingMetadata:script.bindings}})
  assert.deepEqual(template.errors,[])
 }finally{cleanup.forEach(fn=>fn());scope.stop()}
 assert.ok(events.includes('showModal'));assert.ok(events.includes('remove'));assert.ok(events.includes('disconnect'));assert.ok(events.includes('focus'))
})


test('background results preserve drawer/map selection and previews, reconcile changed candidates and explain removal',async()=>{
 const first=candidate('2',0,{latitude:0,longitude:0}),h=harness(result({candidates:[first]}))
 try{
  await h.open();h.state.mapCandidate.value=first;const preview=h.state.previews.value['2'];const count=h.previewCalls.length
  const selection=h.state.mapCandidate.value;h.props.loading=true;await flush();assert.equal(h.state.mapCandidate.value,selection)
  h.props.value=result({candidates:[{...first}],checked_at:'2026-11-23T00:00:00Z'});await flush()
  assert.equal(h.state.drawerOpen.value,true);assert.equal(h.state.mapCandidate.value,selection);assert.equal(h.state.previews.value['2'],preview);assert.equal(h.previewCalls.length,count)
  assert.ok(!text(h.render()).includes(h.labels.plantProximity.loading))
  h.props.value=result({candidates:[{...first,longitude:0.00001}]});await flush();assert.equal(h.state.mapCandidate.value.longitude,0.00001);assert.equal(h.previewCalls.length,count)
  h.props.value=result({candidates:[],total_nearby:0});await flush();assert.equal(h.state.mapCandidate.value,null);assert.equal(h.state.mapRemoved.value,true);assert.equal(h.state.drawerOpen.value,true)
  assert.ok(text(h.render()).includes(h.labels.plantProximity.mapCandidateRemoved));assert.equal(h.state.previews.value['2'],undefined)
 }finally{h.stop()}
})
