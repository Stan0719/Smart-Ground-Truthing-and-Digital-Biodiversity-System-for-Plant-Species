import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { buildThreatReport, threatReportDocument, threatReportDate, threatBucketLabel, threatMetricLabel, triggerReading, triggerUnit } from '../src/services/threatReport.ts'
import { reportCsv } from '../src/utils/reportExport.ts'
import * as model from '../src/services/threatReport.ts'
import { allTimeScope } from '../src/services/reporting.ts'
import { monitoringLabels } from '../src/utils/officerMonitoringDisplay.ts'
import { workflowBadgeStyle } from '../src/utils/workflowBadge.ts'
const read = path => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')
const fixture = (rows = [], scope = allTimeScope) => ({ category:'threats',generatedAt:'2026-11-19T04:00:00Z',scope,basis:'threatScope',columns:['category','severity','status','devicePlant','species','createdAt'],rows,statistics:[],chart:{kind:'horizontal',labels:[],unit:'count',series:[]} })
const row = (metric='temperature', status='New', at='2026-11-04T00:00:00Z') => [metric,null,status,'PL024','Canonical species',at]
const scope = (start,end) => ({period:'custom',timezone:'Asia/Kuala_Lumpur',startDate:start,endDate:end,startInclusive:start+'T00:00:00+08:00',endExclusive:new Date(Date.parse(end+'T00:00:00+08:00')+86400000).toISOString()})
const totalBuckets = view => view.buckets.reduce((n,b)=>n+b.counts.reduce((a,c)=>a+c,0),0)
for(const metric of ['temperature','humidity','soilMoisture','movement','rainfall','sound'])test(metric+' uses the existing Sensor classification',()=>assert.equal(buildThreatReport(fixture([row(metric)])).rows[0].source,'Sensor'))
for(const metric of ['possible_plant_contact','human_detected','animal_detected','suspicious_movement'])test(metric+' uses the existing Camera classification',()=>assert.equal(buildThreatReport(fixture([row(metric)])).rows[0].source,'Camera'))
test('unknown codes retain exact text and every canonical alert counts separately',()=>{
 const v=buildThreatReport(fixture([row(),row(),row('possible_plant_contact','Resolved'),row('new_unverified_code','Reviewing')]))
 assert.deepEqual(v.sourceCounts,[2,1,1]);assert.deepEqual(v.statistics.map(s=>s.value),[4,2,1,3,1]);assert.equal(totalBuckets(v),4)
 assert.equal(threatMetricLabel('new_unverified_code',x=>x),'new_unverified_code');assert.equal(threatMetricLabel('possible_plant_contact',x=>x),'Possible Plant Contact')
 assert.ok(Object.isFrozen(v));assert.ok(Object.isFrozen(v.rows[0]));assert.throws(()=>v.rows.push(v.rows[0]))
})
for(const [source,status,count] of [['Sensor','',2],['Camera','',1],['Unknown','',1],['','Resolved',2],['Sensor','Resolved',1],['Unknown','New',0]])test(`consistent ${source}/${status} filter`,()=>{
 const v=buildThreatReport(fixture([row(),row('humidity','Resolved'),row('possible_plant_contact','Reviewing'),row('other','Resolved')]),source,status)
 assert.equal(v.rows.length,count);assert.equal(totalBuckets(v),count);assert.equal(v.sourceCounts.reduce((a,b)=>a+b,0),count);assert.equal(v.statistics[3].value+v.statistics[4].value,count)
})
test('Malaysia midnight, exclusive end and zero-alert days use authoritative boundaries',()=>{
 const r=fixture([row('movement','New','2026-11-03T16:00:00Z'),row('temperature','Resolved','2026-11-05T15:59:59Z')],scope('2026-11-04','2026-11-06'))
 const v=buildThreatReport(r);assert.equal(v.buckets.length,3);assert.deepEqual(v.buckets.map(b=>b.counts[0]),[1,1,0]);assert.equal(threatReportDate(v.buckets[0].start,'en',true),'04 Nov 2026')
 assert.throws(()=>buildThreatReport(fixture([row('movement','New','2026-11-06T16:00:00Z')],r.scope)))
 const empty=buildThreatReport(fixture([],r.scope));assert.equal(empty.buckets.length,3);assert.equal(totalBuckets(empty),0)
 assert.equal(buildThreatReport(fixture()).buckets.length,0)
})
test('weekly and monthly buckets cross year boundaries correctly and long ranges stay bounded',()=>{
 const weekly=buildThreatReport(fixture([row('temperature','New','2026-12-31T16:00:00Z')],scope('2026-12-01','2027-03-01')))
 assert.equal(weekly.interval,'week');assert.equal(totalBuckets(weekly),1)
 assert.ok(weekly.buckets.every((b,i)=>!i||b.start===weekly.buckets[i-1].end))
 const monthly=buildThreatReport(fixture([row('temperature','New','2026-12-31T16:00:00Z')],scope('2000-01-01','2099-12-31')))
 assert.equal(monthly.interval,'month');assert.ok(monthly.step>1);assert.ok(monthly.buckets.length<=124);assert.equal(totalBuckets(monthly),1)
 assert.ok(threatBucketLabel(monthly.buckets[0],'en').includes('2000'))
 const all=buildThreatReport(fixture([row('temperature','New','1900-01-01T00:00:00Z'),row('temperature','New','2026-11-01T00:00:00Z')]))
 assert.ok(all.buckets.length<=124);assert.equal(totalBuckets(all),2)
})
test('exports share filtered snapshot, retain timestamps/nulls and include interpretation notes',()=>{
 const v=buildThreatReport(fixture([row('possible_plant_contact','Reviewing'),row('temperature','Resolved')]),'Camera','Reviewing')
 for(const language of ['en','ms','zh-CN']){
  const dict=JSON.parse(read('locales/'+language+'.json')).threatReport,t=key=>dict[key]||key,doc=threatReportDocument(v,t,language)
  assert.equal(doc.rows.length,1);assert.equal(doc.rows[0].at(-1),'2026-11-04T00:00:00Z');assert.equal(doc.context[0].value,dict.Camera);assert.equal(doc.context[1].value,dict.Reviewing)
  assert.equal(doc.notes[0].value,dict.limitations);assert.equal(doc.statistics[0].value,1);assert.equal(doc.columns.length,9);assert.ok(!doc.columns.includes('Severity'))
  const csv=reportCsv(doc);assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('2026-11-04T00:00:00Z'));assert.ok(!csv.includes('temperature'))
 }
 const custom=buildThreatReport(fixture([['=CMD()',null,'New',null,'Text,"line\nnext','2026-11-04T00:00:00Z']]))
 const csv=reportCsv(threatReportDocument(custom,x=>x,'en'));assert.ok(csv.includes("'=CMD()"));assert.ok(csv.includes('Text,""line\nnext'));assert.equal(custom.rows[0].plant,null)
})
test('malformed or unverifiable statuses/timestamps fail closed',()=>{
 for(const r of [row('temperature','Approved'),row('temperature','New','not-a-date'),row('temperature','New','2026-11-04T00:00:00')])assert.throws(()=>buildThreatReport(fixture([r])))
})
const js = s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const flush=async()=>{for(let i=0;i<6;i++){await vue.nextTick();await new Promise(setImmediate)}}
function harness(responder=async()=>fixture([row(),row('possible_plant_contact','Resolved'),row('unmapped','Reviewing')]),language='en'){
 const {descriptor}=parse(read('components/conservation/ThreatIncidentReport.vue')),script=compileScript(descriptor,{id:'threat-report-test'}),template=compileTemplate({source:descriptor.template.content,filename:'ThreatIncidentReport.vue',id:'threat-report-test',compilerOptions:{bindingMetadata:script.bindings}})
 assert.deepEqual(template.errors,[])
 const dict=JSON.parse(read('locales/'+language+'.json')),locale=vue.ref(language),calls=[],exports={},scope=vue.effectScope(),props=vue.reactive({filters:{period:'all-time'}});let cleanup
 const context={exports,console,window:{innerWidth:1024,innerHeight:800},document:{activeElement:null},require(name){
  if(name==='vue')return{...vue,onBeforeUnmount:fn=>cleanup=fn,useId:()=> 'fixture-help',resolveComponent:name=>name,withDirectives:n=>n}
  if(name==='vue-i18n')return{useI18n:()=>({locale,t:key=>key.split('.').reduce((v,k)=>v?.[k],dict)||key})}
  if(name==='jspdf')return{jsPDF:class{}}
  if(name.endsWith('officerDropdown'))return{vOfficerDropdown:{}}
  if(name.includes('operationalReporting'))return{requestOperationalReport:async(...args)=>{calls.push(args);return responder(...args)}}
  if(name.endsWith('threatReport'))return model
  if(name.endsWith('officerMonitoringDisplay'))return{monitoringLabels}
  if(name.endsWith('workflowBadge'))return{workflowBadgeStyle}
  if(name.endsWith('reportExport'))return{}
  if(name.endsWith('.vue'))return{}
  throw Error(name)
 }}
 vm.runInNewContext('(function(){'+js(script.content)+'})()',context)
 const state=scope.run(()=>exports.default.setup(props,{expose(){},emit(){}}));vm.runInNewContext('(function(){'+js(template.code)+'})()',context)
 return{state,props,calls,render:()=>exports.render({},[],props,vue.proxyRefs(state),{},{}),stop(){cleanup();scope.stop()}}
}
const flat=value=>{const out=[];function visit(n){if(Array.isArray(n))return n.forEach(visit);if(!n||typeof n!=='object')return;out.push(n);if(Array.isArray(n.children))visit(n.children)}visit(value);return out}
test('local filters never fetch, period changes reset them, and detail columns omit unsupported identities',async()=>{
 const h=harness();try{await flush();assert.equal(h.calls.length,1);h.state.source.value='Camera';h.state.status.value='Resolved';await flush();assert.equal(h.calls.length,1);assert.equal(h.state.view.value.rows.length,1)
 const tree=flat(h.render());assert.equal(tree.filter(n=>n.type==='th').length,9);assert.equal(tree.filter(n=>n.props?.class==='summary-item').length,5)
 const doc=h.state.documentModel();assert.ok(doc.columns.some(c=>c.includes('current device')));assert.ok(!doc.columns.includes('Severity'));assert.ok(doc.columns.includes('Alert ID'));assert.ok(h.state.view.value.rows.every(row=>row.id===null&&row.deviceId===null))
 h.props.filters={period:'this-month'};await flush();assert.equal(h.calls.length,2);assert.equal(h.state.source.value,'');assert.equal(h.state.status.value,'');assert.deepEqual(Object.keys(h.calls[1][1]),['period'])
 }finally{h.stop()}
})
test('late old-period results cannot replace a newer request and failures do not become empty reports',async()=>{
 const pending=[];const h=harness(()=>new Promise(resolve=>pending.push(resolve)))
 try{await flush();h.props.filters={period:'last-month'};await flush();pending[1](fixture([row('movement')]));await flush();assert.equal(h.state.view.value.rows[0].metric,'movement');pending[0](fixture([row('possible_plant_contact')]));await flush();assert.equal(h.state.view.value.rows[0].metric,'movement')
 }finally{h.stop()}
 const failed=harness(async()=>{throw Error('Offline')});try{await flush();assert.equal(failed.state.view.value,null);assert.ok(failed.state.error.value)}finally{failed.stop()}
})
test('translation keys match and parent integration isolates the new report from other categories',async()=>{
 const dictionaries=['en','ms','zh-CN'].map(l=>JSON.parse(read('locales/'+l+'.json')).threatReport)
 dictionaries.forEach(d=>{assert.deepEqual(Object.keys(d),Object.keys(dictionaries[0]));assert.ok(Object.values(d).every(v=>v&&!v.includes('???')))})
 for(const lang of ['en','ms','zh-CN']){const h=harness(undefined,lang);try{await flush();assert.equal(h.state.documentModel().title,JSON.parse(read('locales/'+lang+'.json')).threatReport.title)}finally{h.stop()}}
 const parent=read('views/conservation/ReportsView.vue');assert.match(parent,/ThreatIncidentReport v-else-if="reportType === 'threats'"/);assert.match(parent,/OperationalReport v-if="reportType === 'iot-summary'" category="iot"/)
})

test('a capped response cannot be advertised as complete when its authoritative total exceeds returned rows',()=>{
 const r=fixture([row()]);r.statistics=[{key:'totalIncidents',value:500}];assert.throws(()=>buildThreatReport(r))
 assert.throws(()=>buildThreatReport(fixture([row('movement','New','2026-02-30T12:00:00Z')])))
})
test('large matching datasets remain fully represented in counts and CSV while calendar arrays stay bounded',()=>{
 const rows=Array.from({length:1200},(_,i)=>row(i%2?'temperature':'possible_plant_contact',i%3?'New':'Resolved'))
 const v=buildThreatReport(fixture(rows));assert.equal(v.rows.length,1200);assert.equal(totalBuckets(v),1200);assert.ok(v.buckets.length<=124)
 const doc=threatReportDocument(v,x=>x,'en');assert.equal(doc.rows.length,1200);assert.equal(reportCsv(doc).split('\r\n').length,1201)
})

const projected=(rows,values)=>({...fixture(rows),threatDetailsVersion:1,alertDetails:rows.map((r,i)=>({id:'authentic-alert-'+i,deviceId:'authentic-device',cameraId:r[0]==='possible_plant_contact'?'authentic-camera':null,metric:r[0],triggerValue:values[i],status:r[2],createdAt:r[5]}))})
for(const [metric,value,unit]of [['temperature',-5,'°C'],['temperature',0,'°C'],['humidity',0,'%'],['humidity',78.5,'%'],['soilMoisture',0,'raw'],['movement',0,'binary 0/1'],['movement',1,'binary 0/1'],['rainfall',234,'raw'],['sound',123.456789,'raw']])test(`${metric} ${value} keeps its stored trigger reading and supported unit`,()=>{
 const v=buildThreatReport(projected([row(metric)],[value]));assert.equal(v.rows[0].triggerValue,value);assert.equal(triggerReading(v.rows[0],x=>x==='binary'?'binary 0/1':x),`${value} ${unit}`);assert.equal(triggerUnit(metric,x=>x==='binary'?'binary 0/1':x),unit);assert.equal(totalBuckets(v),1)
})
for(const [metric,value]of [['temperature',null],['temperature','25'],['temperature',NaN],['temperature',-274],['humidity',101],['humidity',-1],['movement',2],['soilMoisture',-1],['rainfall',Infinity],['sound',{}]])test(`${metric} invalid ${String(value)} is unavailable without removing its alert`,()=>{
 const v=buildThreatReport(projected([row(metric)],[value]));assert.equal(v.rows.length,1);assert.equal(v.rows[0].triggerValue,null);assert.equal(triggerReading(v.rows[0],x=>x),'unavailableValue');assert.equal(totalBuckets(v),1)
})
test('Camera is not applicable, Unknown is unavailable, and authentic identities remain attached through filters',()=>{
 const r=projected([row('possible_plant_contact','Resolved'),row('legacy_code'),row('temperature')],[999,8,32.5]);const view=buildThreatReport(r)
 assert.equal(triggerReading(view.rows[0],x=>x),'notApplicable');assert.equal(triggerReading(view.rows[1],x=>x),'unavailableValue');assert.equal(view.rows[0].cameraId,'authentic-camera')
 const filtered=buildThreatReport(r,'Sensor','New');assert.equal(filtered.rows[0].id,'authentic-alert-2');assert.equal(filtered.rows[0].deviceId,'authentic-device');assert.equal(filtered.rows[0].triggerValue,32.5);assert.equal(filtered.statistics[0].value,1)
 const mismatch=structuredClone(r);mismatch.alertDetails[0].metric='temperature';assert.throws(()=>buildThreatReport(mismatch))
 const duplicate=structuredClone(r);duplicate.alertDetails[1].id=duplicate.alertDetails[0].id;assert.throws(()=>buildThreatReport(duplicate))
})
test('PDF includes formatted readings; CSV keeps full zero/negative numbers and explicit units',()=>{
 const view=buildThreatReport(projected([row('temperature'),row('humidity'),row('possible_plant_contact'),row('movement')],[-5.123456789,0,1,null]))
 const csv=threatReportDocument(view,x=>x,'en','csv'),pdf=threatReportDocument(view,x=>x,'en','pdf')
 assert.equal(csv.columns.length,10);assert.equal(pdf.columns.length,9);assert.equal(csv.rows[0][3],-5.123456789);assert.equal(csv.rows[0][4],'°C');assert.equal(csv.rows[1][3],0);assert.equal(csv.rows[1][4],'%')
 assert.equal(csv.rows[2][3],'notApplicable');assert.equal(pdf.rows[0][3],'-5.123456789 °C');assert.equal(pdf.rows[3][3],'unavailableValue')
 assert.ok(reportCsv(csv).includes('"-5.123456789"'));assert.ok(!reportCsv(csv).includes("'-5.123456789"));assert.equal(csv.rows[0][0],'authentic-alert-0');assert.ok(csv.rows[0][5].includes('authentic-device'));assert.ok(pdf.notes.some(n=>n.value==='triggerLimit'))
})
test('clean header preserves generated time, omits period metadata and long explanation, and includes accessible help',async()=>{
 const h=harness(async()=>projected([row()],[32.5]));try{await flush();const tree=flat(h.render());assert.ok(tree.some(n=>n.props?.class==='report-help'));assert.ok(tree.some(n=>n.props?.role==='tooltip'))
 const source=read('components/conservation/ThreatIncidentReport.vue');assert.ok(!source.includes("text('scope')"));assert.ok(!source.includes('view.scope.startDate ?'));assert.match(source,/@mouseenter="showHelp"/);assert.match(source,/@focus="showHelp"/);assert.match(source,/@click="showHelp"/);assert.match(source,/@keydown.esc="hideHelp"/)
 let shown=0,hidden=0;const box={style:{},showPopover(){shown++},hidePopover(){hidden++},getBoundingClientRect:()=>({width:300,height:70})};h.state.help.value=box
 h.state.showHelp({currentTarget:{getBoundingClientRect:()=>({left:100,bottom:60})}});assert.equal(shown,1);assert.equal(box.style.left,'100px');h.state.hideHelp();assert.equal(hidden,1)
 const doc=h.state.documentModel();assert.ok(doc.period);assert.ok(doc.timezone);assert.ok(doc.context.length===2)
 }finally{h.stop()}
})
test('exactly one full-width stacked trend is rendered and its print configuration has no source breakdown',()=>{
 const {descriptor}=parse(read('components/conservation/ThreatReportCharts.vue')),script=compileScript(descriptor,{id:'chart-test'}),template=compileTemplate({source:descriptor.template.content,filename:'ThreatReportCharts.vue',id:'chart-test',compilerOptions:{bindingMetadata:script.bindings}})
 assert.deepEqual(template.errors,[]);assert.equal((descriptor.template.content.match(/<canvas /g)||[]).length,1);assert.ok(!descriptor.template.content.includes('breakdown'));assert.ok(!script.content.includes("configuration('source')"));assert.match(descriptor.styles[0].content,/width: 100%/)
 const view=buildThreatReport(projected([row(),row('possible_plant_contact'),row('legacy')],[32,1,2]));const exports={};const context={exports,require(name){if(name==='vue')return{...vue,onBeforeUnmount(){}};if(name==='chart.js')return{Chart:class{static register(){}},registerables:[]};if(name==='vue-i18n')return{useI18n:()=>({t:x=>x,locale:vue.ref('en')})};if(name.endsWith('threatReport'))return model;if(name.endsWith('reportExport'))return{printChart:async config=>config};throw Error(name)}}
 vm.runInNewContext('(function(){'+js(script.content)+'})()',context);const effect=vue.effectScope(),state=effect.run(()=>exports.default.setup({view},{expose(){}}));const config=state.configuration();assert.equal(config.data.datasets.length,3);assert.equal(config.options.scales.x.stacked,true);assert.equal(config.data.datasets.flatMap(s=>s.data).reduce((a,b)=>a+b,0),3);effect.stop()
})
