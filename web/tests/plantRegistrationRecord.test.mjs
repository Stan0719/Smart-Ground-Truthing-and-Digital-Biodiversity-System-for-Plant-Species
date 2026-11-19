import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import {parse,compileScript,compileTemplate} from '@vue/compiler-sfc'
import {plantRegistrationDisplay} from '../src/services/plantRegistrationDisplay.ts'
import {workflowBadgeStyle} from '../src/utils/workflowBadge.ts'
import {formatPlantDateTime} from '../src/utils/plantDateTime.ts'
const fields={heightCm:12,healthStatus:'Healthy',lifeStage:'Young',morphology:'Registration leaves',notes:'Registration notes',latitude:0,longitude:110,accuracy_m:0,altitude_m:-2,zone:'Registration zone',taxonomy:{}}
const initial=(status='Pending Review',extra={})=>({id:'initial-a',plant_id:'1',origin:'initial_registration',date:'2026-11-03T05:31:37.284Z',status,recorded_by:'Botanist',content:{...fields},assets:[],review:null,...extra})
const subsequent=()=>initial('Approved',{id:'visit-b',origin:'subsequent_observation',content:{...fields,heightCm:99,latitude:40,longitude:-120,morphology:'Separate field visit',notes:'Field visit notes'}})
const staff=(status='Pending Review')=>({status,registered_at:'2026-11-03T05:31:37.284Z',latest_observation:subsequent(),latest_approved_observation:subsequent(),approved_location:{latitude:40,longitude:-120},current_registration:{state:'unavailable'}})
const nodes=value=>{const out=[];function walk(n){if(Array.isArray(n))return n.forEach(walk);if(!n||typeof n!=='object')return;out.push(n);if(Array.isArray(n.children))walk(n.children)}walk(value);return out}
const text=value=>nodes(value).filter(n=>n.type!==vue.Comment&&typeof n.children==='string').map(n=>n.children).join(' ')
function harness(name,props,language='en'){
 const file=new URL('../src/components/'+name+'.vue',import.meta.url),{descriptor}=parse(readFileSync(file,'utf8')),script=compileScript(descriptor,{id:'registration-test'}),template=compileTemplate({source:descriptor.template.content,filename:file.pathname,id:'registration-test',compilerOptions:{bindingMetadata:script.bindings}});assert.deepEqual(template.errors,[])
 const dictionary=JSON.parse(readFileSync(new URL('../src/locales/'+language+'.json',import.meta.url),'utf8')),t=key=>key.split('.').reduce((v,k)=>v?.[k],dictionary)||key,ct=value=>dictionary.conservationText?.[String(value).toLowerCase().replace(/[^a-z0-9]+/g,'')]||String(value)
 const exports={},scope=vue.effectScope(),reactiveProps=vue.reactive(props),events=[],context={exports,console,require(name){if(name==='vue')return {...vue,resolveComponent:name=>name};if(name==='vue-i18n')return{useI18n:()=>({t})};if(name.endsWith('useConservationText'))return{useConservationText:()=>({ct})};if(name.endsWith('plantRegistrationDisplay'))return{plantRegistrationDisplay};if(name.endsWith('workflowBadge'))return{workflowBadgeStyle};if(name.endsWith('plantDateTime'))return{formatPlantDateTime};if(name.endsWith('.vue'))return{name};throw Error(name)}}
 const js=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 vm.runInNewContext('(function(){'+js(script.content)+'})()',context);const state=scope.run(()=>exports.default.setup(reactiveProps,{expose(){},emit:(...args)=>events.push(args)}));vm.runInNewContext('(function(){'+js(template.code)+'})()',context)
 return{state,props:reactiveProps,events,render:()=>exports.render({$emit:(...args)=>events.push(args)},[],reactiveProps,vue.proxyRefs(state),{},{}),stop:()=>scope.stop(),dictionary}
}
const props=(extra={})=>({authorized:true,staff:staff(),plantId:'1',observations:[subsequent(),initial()],complete:true,hasMore:false,loading:false,error:'',...extra})

test('Pending Plant Record uses only a complete authoritative initial registration and labels submitted evidence',()=>{
 const h=harness('PlantRegistrationRecord',props());try{assert.equal(h.state.model.value.provenance,'submitted');assert.equal(h.state.model.value.content.heightCm,12);assert.equal(h.state.model.value.content.latitude,0);const value=text(h.render());assert.ok(value.includes(h.dictionary.plantRecord.pendingNotice));assert.ok(value.includes('Registration leaves'));assert.ok(!value.includes('Separate field visit'));assert.ok(value.includes('0 m'));assert.ok(value.includes('Nov 3, 2026, 13:31'));assert.equal(nodes(h.render()).filter(n=>n.props?.class==='evidence-tag'&&n.children===h.dictionary.plantRecord.submitted).length,2);assert.ok(!value.includes('Latest approved observation'));assert.ok(!value.includes('Submitted GPS Evidence'))}finally{h.stop()}
})
test('Approved registration and approved Plant edits use only the current registration projection, preserving subsequent history',()=>{
 const visits=[subsequent()],approved={...staff('Approved'),current_registration:{state:'available',observation_id:'initial-a',version_id:'approval-capture',content:{...fields,heightCm:30,latitude:1,longitude:111}}};const h=harness('PlantRegistrationRecord',props({staff:approved,observations:visits}));try{assert.equal(h.state.model.value.provenance,'approved');assert.equal(h.state.model.value.content.heightCm,30);assert.equal(h.state.model.value.content.latitude,1);h.props.staff={...approved,current_registration:{...approved.current_registration,version_id:'approved-plant-edit',content:{...fields,heightCm:45,latitude:2,longitude:112}}};assert.equal(h.state.model.value.content.heightCm,45);assert.equal(h.state.model.value.content.latitude,2);assert.equal(visits[0].content.heightCm,99);assert.equal(visits[0].content.latitude,40)}finally{h.stop()}
})
test('unavailable, partial, ambiguous and wrong-Plant provenance never falls back to latest observations or official-looking GPS',()=>{
 const cases=[props({complete:false,hasMore:true}),props({observations:[subsequent()]}),props({observations:[initial(),initial('Pending Review',{id:'another-initial'})]}),props({observations:[initial('Pending Review',{plant_id:'2'})]}),props({staff:staff('Approved')}),props({staff:{...staff('Approved'),current_registration:{state:'available',observation_id:'initial-a',content:{...fields,latitude:999}}}})]
 for(const p of cases){const h=harness('PlantRegistrationRecord',p);try{assert.equal(h.state.model.value.content,null);assert.equal(h.state.locationAvailable.value,false);assert.ok(!text(h.render()).includes('Separate field visit'));assert.ok(!text(h.render()).includes('Registration zone'))}finally{h.stop()}}
})
test('rejected, corrected, withdrawn and flagged initial evidence is submitted, never approved',()=>{
 for(const status of ['Rejected','Correction Required','Withdrawn','Flagged']){const h=harness('PlantRegistrationRecord',props({observations:[initial(status)]}));try{assert.equal(h.state.model.value.status,status);assert.equal(h.state.model.value.provenance,'submitted');assert.notEqual(h.state.notice.value,'approvedNotice')}finally{h.stop()}}
})
test('Guest and unauthorized projections cannot render private registration fields or taxonomy',()=>{
 const h=harness('PlantRegistrationRecord',props({authorized:false}));try{assert.equal(h.state.model.value.content,null);assert.equal(text(h.render()),'');assert.equal(nodes(h.render()).filter(n=>n.type==='article').length,0)}finally{h.stop()}
})
test('unsupported measurement fields are not fabricated and absent data has a meaningful empty state',()=>{
 const h=harness('PlantRegistrationRecord',props({observations:[initial('Pending Review',{content:{latitude:null,longitude:null,stemDiameter:99,leafCount:200}})]}));try{assert.equal(h.state.facts.value.length,0);assert.ok(text(h.render()).includes(h.dictionary.plantRecord.observationUnavailable));assert.ok(!text(h.render()).includes('99'));assert.ok(!text(h.render()).includes('200'))}finally{h.stop()}
})
test('history separates real subsequent visits from initial and unclassified records while retaining evidence and continuation',()=>{
 const h=harness('PlantObservationHistory',{observations:[initial(),subsequent(),initial('Rejected',{id:'legacy-c',origin:'unknown',content:{...fields,notes:'Legacy note',morphology:'Legacy morphology'}})],complete:false,hasMore:true,loading:false,error:''});try{assert.deepEqual(Array.from(h.state.visibleObservations.value,o=>o.id),['visit-b']);assert.deepEqual(Array.from(h.state.unclassified.value,o=>o.id),['legacy-c']);const value=text(h.render());assert.ok(value.includes('Separate field visit'));assert.ok(!value.includes('Registration notes'));assert.ok(value.includes(h.dictionary.plantRecord.unclassified));assert.ok(value.includes('More history pages'));assert.ok(!nodes(h.render()).some(n=>n.key==='initial-a'));nodes(h.render()).find(n=>n.type==='button'&&n.children==='Load more observations').props.onClick();assert.ok(h.events.some(e=>e[0]==='more'))}finally{h.stop()}
})
test('history empty/loading/error states distinguish availability and retain source retry',()=>{
 const h=harness('PlantObservationHistory',{observations:[initial()],complete:true,hasMore:false,loading:false,error:''});try{assert.ok(text(h.render()).includes(h.dictionary.plantRecord.historyEmpty));assert.ok(text(h.render()).includes(h.dictionary.plantRecord.historyEmptyExplanation));h.props.error='History unavailable';h.props.complete=false;assert.ok(!text(h.render()).includes(h.dictionary.plantRecord.historyEmpty));assert.ok(nodes(h.render()).some(n=>n.props?.role==='alert'));nodes(h.render()).find(n=>n.type==='button'&&n.children==='Retry').props.onClick();assert.ok(h.events.some(e=>e[0]==='retry'))}finally{h.stop()}
})
test('new lower-section wording has EN/MS/ZH parity and layouts respond without changing upper markup/CSS',()=>{
 const keys=Object.keys(JSON.parse(readFileSync(new URL('../src/locales/en.json',import.meta.url),'utf8')).plantRecord)
 for(const locale of ['en','ms','zh-CN']){const h=harness('PlantRegistrationRecord',props(),locale);try{assert.deepEqual(Object.keys(h.dictionary.plantRecord),keys);assert.ok(Object.values(h.dictionary.plantRecord).every(s=>s&&!s.includes('???')));assert.ok(text(h.render()).includes(h.dictionary.plantRecord.title))}finally{h.stop()}}
 const source=readFileSync(new URL('../src/views/PlantDetailView.vue',import.meta.url),'utf8').replaceAll('\r\n','\n'),upper=source.slice(source.indexOf('<template>'),source.indexOf('    <section v-if="canReadStaff && plant.staff" class="content-section">'));const hash=s=>createHash('sha256').update(s).digest('hex');assert.equal(hash(upper),'28025a3842b1763be57a2e183689f4ac483883550f2cf41bb7bb8021695f0ae5');assert.equal(hash(source.slice(source.indexOf('<style scoped>'))),'0a0198b14a2750dfa983450af93e201de51faa3a54ecd5891e47de1f8709cdbe')
 const css=readFileSync(new URL('../src/components/PlantRegistrationRecord.vue',import.meta.url),'utf8');assert.match(css,/@media \(max-width: 760px\)/);assert.match(css,/@media \(max-width: 380px\)/)
})

test('retained complete pending registration stays Submitted during refresh and recoverable failure',()=>{
 const h=harness('PlantRegistrationRecord',props({verifiedComplete:true}));try{
  for(const update of [{loading:true},{loading:false,error:'HTTP 503',complete:false}]){Object.assign(h.props,update);assert.equal(h.state.model.value.provenance,'submitted');assert.equal(h.state.model.value.content.heightCm,12);assert.equal(h.state.model.value.content.latitude,0);assert.equal(h.state.model.value.content.accuracy_m,0);assert.equal(h.state.model.value.content.altitude_m,-2)}
  h.props.observations=[subsequent(),initial('Pending Review',{content:{...fields,heightCm:24}})];h.props.error='';h.props.complete=true
  assert.equal(h.state.model.value.content.heightCm,24)
  h.props.observations=[initial(),initial('Pending Review',{id:'ambiguous'})];assert.equal(h.state.model.value.content,null)
  h.props.observations=[subsequent()];assert.equal(h.state.model.value.content,null)
  h.props.observations=[initial()];h.props.verifiedComplete=false;h.props.hasMore=true;assert.equal(h.state.model.value.content,null)
  h.props.verifiedComplete=true;h.props.hasMore=false;h.props.authorized=false;assert.equal(h.state.model.value.content,null)
 }finally{h.stop()}
})
test('history background feedback is compact, retained errors are truthful and Retry preserves its event',()=>{
 for(const locale of ['en','ms','zh-CN']){const h=harness('PlantObservationHistory',{observations:[initial(),subsequent()],complete:true,hasMore:false,loading:true,refreshing:true,retained:true,error:''},locale);try{
  assert.ok(text(h.render()).includes(h.dictionary.plantRecord.refreshing));assert.ok(!text(h.render()).includes('Loading observation history'))
  assert.ok(text(h.render()).includes('Separate field visit'))
  h.props.loading=false;h.props.refreshing=false;h.props.error='HTTP 503';h.props.complete=false
  assert.ok(text(h.render()).includes(h.dictionary.plantRecord.refreshFailed));assert.ok(!nodes(h.render()).some(n=>n.props?.role==='alert'))
  nodes(h.render()).find(n=>n.type==='button'&&n.props?.onClick).props.onClick();assert.ok(h.events.some(e=>e[0]==='retry'))
 }finally{h.stop()}}
})

test('redesigned Plant Record preserves status, full precision, units, Notes and taxonomy in all supported languages',()=>{
 for(const locale of ['en','ms','zh-CN']){
  const values={...fields,heightCm:100000,latitude:1.518293123456,longitude:110.330181234567,altitude_m:61.20000076293945,zone:'Zone '+ 'Long zone '.repeat(20),morphology:'Long morphology '.repeat(30),notes:'Important registration notes',taxonomy:{'Leaf detail':'Historical taxonomy value'}}
  const h=harness('PlantRegistrationRecord',props({observations:[initial('Pending Review',{content:values})]}),locale)
  try{
   const tree=nodes(h.render()),value=text(h.render())
   assert.ok(value.includes('100000 cm'));assert.ok(value.includes('1.518293123456'));assert.ok(value.includes('110.330181234567'));assert.ok(value.includes('61.20000076293945 m'));assert.ok(value.includes(values.zone));assert.ok(value.includes(values.morphology));assert.ok(value.includes(values.notes));assert.ok(value.includes('Historical taxonomy value'))
   assert.ok(tree.some(n=>n.type==='h2'&&n.children===h.dictionary.plantRecord.title))
   assert.equal(tree.filter(n=>n.type==='h3').length,2)
   assert.equal(tree.filter(n=>n.props?.class==='evidence-tag'&&n.children===h.dictionary.plantRecord.submitted).length,2)
   assert.ok(tree.filter(n=>n.type==='svg').every(n=>n.props?.['aria-hidden']==='true'||n.props?.['aria-hidden']===true))
   assert.equal(tree.filter(n=>n.type==='button'||n.type==='input'||n.type==='select').length,0)
   h.props.staff={...staff('Approved'),current_registration:{state:'available',observation_id:'initial-a',content:values}}
   assert.equal(h.state.model.value.provenance,'approved')
   assert.equal(nodes(h.render()).filter(n=>n.props?.class==='evidence-tag'&&n.children===h.dictionary.plantRecord.approved).length,2)
  }finally{h.stop()}
 }
})
test('status badge is authoritative and unsupported evidence remains honestly unavailable after redesign',()=>{
 for(const status of ['Pending Review','Approved','Correction Required','Rejected','Withdrawn','Flagged']){
  const h=harness('PlantRegistrationRecord',props({staff:staff(status),observations:[],verifiedComplete:false}))
  try{assert.equal(h.state.model.value.status,status);assert.equal(h.state.model.value.content,null);assert.ok(text(h.render()).includes(h.dictionary.plantRecord.locationUnavailable));assert.ok(text(h.render()).includes(h.dictionary.plantRecord.observationUnavailable));assert.equal(nodes(h.render()).filter(n=>n.props?.class==='evidence-tag').length,0)}finally{h.stop()}
 }
})
