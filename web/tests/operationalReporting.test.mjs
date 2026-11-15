import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { parse, compileScript, compileTemplate, compileStyle } from '@vue/compiler-sfc'
import selectorParser from 'postcss-selector-parser'
import * as reporting from '../src/services/reporting.ts'
import { monitoringDate } from '../src/utils/officerMonitoringDisplay.ts'
import { reportSeries } from '../src/utils/reportSeries.ts'
import postcss from 'postcss'
const read = path => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')
const transpile = value => ts.transpileModule(value, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const service = { exports: {}, URLSearchParams, AbortSignal, Error, fetch: (...args) => globalThis.fetch(...args), require: () => reporting }
vm.runInNewContext(transpile(read('services/operationalReporting.ts')), service)
const api = service.exports
const fixture = category => ({
  category, generatedAt: '2026-11-05T03:44:00Z', scope: reporting.allTimeScope,
  basis: category === 'observations' ? 'observationScope' : category === 'threats' ? 'threatScope' : 'iotScope',
  columns: category === 'observations' ? ['period','totalObservations','Pending Review','Approved','Rejected','Correction Required','Flagged'] : category === 'threats' ? ['category','severity','status','devicePlant','species','createdAt'] : ['recordedAt','device','measurement','value','unit'],
  rows: category === 'observations' ? [['2026-11-01',3,1,2,0,0,0]] : category === 'threats' ? [['temperature',null,'New','PL018','Test species','2026-11-05T03:44:00Z']] : [['2026-11-05T03:44:00Z','Sensor one','temperature',0,'°C']],
  statistics: [{ key: category === 'observations' ? 'totalObservations' : category === 'threats' ? 'totalIncidents' : 'totalReadings', value: category === 'observations' ? 3 : 1 }],
  chart: { kind: category === 'observations' ? 'stacked' : category === 'threats' ? 'horizontal' : 'line', labels: [category === 'observations' ? '2026-11-01' : category === 'threats' ? 'temperature' : '2026-11-05T03:44:00Z'], unit: category === 'iot' ? '°C' : 'count', series: [{ key: category === 'iot' ? 'temperature' : 'totalIncidents', values: [category === 'observations' ? 3 : category === 'threats' ? 1 : 0] }] },
  ...(category === 'iot' ? { devices: [{id:'sensor',name:'Sensor one'},{id:'other',name:'Sensor two'}], device:'sensor', measurement:'temperature', measurements:['temperature','humidity'] } : {}),
})
const clone = value => JSON.parse(JSON.stringify(value))

test('real report adapter dispatches explicit endpoints, keeps credentials and rejects malformed/unavailable data', async () => {
  const original = globalThis.fetch
  try {
    for (const category of ['observations','threats','iot']) {
      globalThis.fetch = async (url, options) => {
        assert.ok(url.startsWith(`/api/data/reports/${category}`)); assert.equal(options.credentials,'same-origin')
        assert.ok(!options.method || options.method==='GET')
        return Response.json(fixture(category))
      }
      assert.equal((await api.requestOperationalReport(category,{period:'all-time'})).category,category)
    }
    await assert.rejects(api.requestOperationalReport('camera',{period:'all-time'}),/Unsupported/)
    for (const result of [{}, {...fixture('observations'),category:'threats'}, {...fixture('observations'),rows:[['bad']]}, {...fixture('iot'),chart:{...fixture('iot').chart,labels:['invalid date']}}, {...fixture('observations'),scope:{...reporting.allTimeScope,timezone:'UTC'}}]) {
      globalThis.fetch=async()=>Response.json(result)
      await assert.rejects(api.requestOperationalReport('observations',{period:'all-time'}),/Invalid/)
    }
    globalThis.fetch=async()=>Response.json({error:'unavailable'},{status:503})
    await assert.rejects(api.requestOperationalReport('iot',{period:'all-time'}),/503/)
  } finally { globalThis.fetch=original }
})

test('request preserves precise server date filters and selected device/measurement; CSV neutralizes formulas', async () => {
  const original=globalThis.fetch
  try {
    globalThis.fetch=async url=>{
      const parsed=new URL(url,'http://offline.test')
      assert.equal(parsed.searchParams.get('start'),'2026-11-01');assert.equal(parsed.searchParams.get('end'),'2026-11-05')
      assert.equal(parsed.searchParams.get('device'),'sensor / one');assert.equal(parsed.searchParams.get('measurement'),'humidity')
      const result=fixture('iot');result.scope={...result.scope,period:'custom',startDate:'2026-11-01',endDate:'2026-11-05'}
      return Response.json(result)
    }
    await api.requestOperationalReport('iot',{period:'custom',start:'2026-11-01',end:'2026-11-05'},'sensor / one','humidity')
  } finally {globalThis.fetch=original}
  const csv=api.operationalCsv([['=HYPERLINK("x")',' \t@SUM(1)','中文','a,b','line\nbreak',null,0]])
  assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes("'=HYPERLINK"));assert.ok(csv.includes("' \t@SUM"));assert.ok(csv.includes('中文'));assert.ok(csv.includes('"0"'))
})

function harness(category, responder = async selected => fixture(selected), language='en') {
  const filename='components/conservation/OperationalReport.vue', {descriptor}=parse(read(filename))
  const script=compileScript(descriptor,{id:'operational'})
  const template=compileTemplate({source:descriptor.template.content,filename,id:'operational',compilerOptions:{bindingMetadata:script.bindings}})
  assert.deepEqual(template.errors,[])
  const messages=JSON.parse(read(`locales/${language}.json`))
  const resolve=key=>key.split('.').reduce((value,part)=>value?.[part],messages)
  const locale=vue.ref(language),calls=[],pdfs=[],drawn=[],blobs=[],events=[]
  let cleanup, exportUtilities
  const context={exports:{},Error,Blob,console,Image:class{naturalWidth=1000;naturalHeight=400;async decode(){}},
    document:{createElement:()=>({click(){},toDataURL:()=> 'data:image/png;base64,offline',getContext:()=>({fillRect(){},drawImage(){},beginPath(){},roundRect(){},fill(){},stroke(){},strokeRect(){},fillText:value=>drawn.push(value),measureText:value=>({width:Array.from(value).length*11})})})},
    URL:{createObjectURL:blob=>{blobs.push(blob);return'blob:offline'},revokeObjectURL(){}},
    require(name){
      if(name.includes('reportExport')){if(!exportUtilities){const helper={...context,exports:{}};vm.runInNewContext(transpile(read('utils/reportExport.ts')),helper);exportUtilities=helper.exports}return exportUtilities}
      if(name==='vue')return{...vue,onBeforeUnmount:fn=>{cleanup=fn},resolveComponent:name=>name,withDirectives:node=>node}
      if(name==='vue-i18n')return{useI18n:()=>({t:key=>resolve(key)||key,te:key=>typeof resolve(key)==='string',locale})}
      if(name==='jspdf')return{jsPDF:class{constructor(){pdfs.push(this);this.pages=0}addPage(){this.pages++}addImage(){}save(name){this.name=name}}}
      if(name.includes('operationalReporting'))return{...api,requestOperationalReport:async(...args)=>{calls.push(args);return responder(...args)}}
      if(name.includes('officerMonitoringDisplay'))return{monitoringDate}
      if(name.endsWith('.vue'))return{name}
      throw Error(name)
    }}
  vm.runInNewContext(`(function(){${transpile(script.content)}})()`,context)
  const props=vue.reactive({category,filters:{period:'all-time'}}),scope=vue.effectScope()
  const state=scope.run(()=>context.exports.default.setup(props,{expose(){},emit:(...args)=>events.push(args)}))
  state.chart.value={toPrintDataUrl:async()=> 'data:image/png;base64,offline'}
  vm.runInNewContext(`(function(){${transpile(template.code)}})()`,context)
  return{state,props,calls,pdfs,drawn,blobs,events,render:()=>context.exports.render({},[],props,vue.proxyRefs(state),{},{}),stop(){cleanup();scope.stop()}}
}
const flush=async()=>{await vue.nextTick();await new Promise(resolve=>setImmediate(resolve));await vue.nextTick()}
const nodes=root=>{const found=[];const walk=node=>{if(Array.isArray(node)){node.forEach(walk);return}if(!node||typeof node!=='object')return;found.push(node);if(Array.isArray(node.children))walk(node.children);else if(node.children?.default)walk(node.children.default())};walk(root);return found}

for(const category of ['observations','threats','iot'])test(`${category}: real component renders authoritative rows/chart and exports matching CSV/PDF`,async()=>{
  const h=harness(category)
  try{
    await flush();assert.equal(h.state.report.value.category,category)
    const tree=nodes(h.render())
    assert.equal(tree.filter(n=>n.type==='th').length,fixture(category).columns.length)
    const chart=tree.find(n=>n.props?.report)
    assert.ok(chart);assert.equal(chart.props.report.chart.kind,fixture(category).chart.kind)
    await h.state.exportFile('csv');assert.equal(h.blobs.length,1)
    const csv=await h.blobs[0].text();assert.ok(csv.startsWith(h.state.exportDocument().columns.map(value=>'"'+value+'"').join(',')));assert.ok(!csv.includes(h.state.exportDocument().title));assert.equal(csv.split('\r\n').length,h.state.exportDocument().rows.length+1)
    await h.state.exportFile('pdf');assert.equal(h.pdfs.length,1);assert.ok(h.pdfs[0].name.includes(category));assert.ok(h.drawn.join(' ').includes(category==='iot'?'Sensor one':category==='observations'?'Nov 1, 2026':'Test species'))
    assert.equal(h.calls.length,1)
  }finally{h.stop()}
})

test('switching category/date and device uses selected parameters; stale completions cannot replace current report',async()=>{
  let release,first=true
  const h=harness('iot',async(category,filters,device,measurement)=>{
    if(first){first=false;return new Promise(resolve=>{release=resolve})}
    const result=fixture(category);if(category==='iot'){result.device=device;result.measurement=measurement}return result
  })
  try{
    h.props.category='threats';await flush();assert.equal(h.state.report.value.category,'threats')
    release(fixture('iot'));await flush();assert.equal(h.state.report.value.category,'threats')
    h.props.category='iot';await flush();h.state.device.value='other';h.state.measurement.value='humidity';await h.state.load()
    assert.deepEqual(Array.from(h.calls.at(-1)).slice(-2),['other','humidity'])
    h.props.filters={period:'this-month'};await flush();assert.equal(h.calls.at(-1)[1].period,'this-month');assert.equal(h.calls.at(-1)[2],'')
  }finally{h.stop()}
})

test('unavailable, loading and empty reports cannot export or fabricate totals',async()=>{
  for(const mode of ['error','empty']){
    const h=harness('iot',async()=>{if(mode==='error')throw Error('unavailable');const result=fixture('iot');result.rows=[];result.chart.labels=[];result.chart.series[0].values=[];return result})
    try{
      await h.state.exportFile('csv');await flush();await h.state.exportFile('csv');await h.state.exportFile('pdf')
      assert.equal(h.blobs.length,0);assert.equal(h.pdfs.length,0)
      if(mode==='error'){assert.equal(h.state.report.value,null);assert.ok(h.state.error.value)}
    }finally{h.stop()}
  }
})

test('IoT PDF export cancels when filters change while the print chart is rendering',async()=>{
  const h=harness('iot');let resolve
  try{
    await flush()
    h.state.chart.value={toPrintDataUrl:()=>new Promise(done=>{resolve=done})}
    const pending=h.state.exportFile('pdf');await flush();assert.equal(typeof resolve,'function')
    h.props.filters={period:'this-month'};await flush()
    resolve('data:image/png;base64,old');await pending
    assert.equal(h.pdfs.length,0);assert.equal(h.blobs.length,0)
  }finally{h.stop()}
})

test('a missing real chart blocks PDF export rather than inserting a placeholder visualization',async()=>{
  const h=harness('threats')
  try{await flush();h.state.chart.value=null;await h.state.exportFile('pdf');assert.equal(h.pdfs.length,0);assert.ok(h.state.feedback.value)}finally{h.stop()}
})

test('English, Malay and Chinese report labels, status labels and Unicode PDF/CSV export are supported',async()=>{
  const required=Object.keys(JSON.parse(read('locales/en.json')).conservationPages.reports.operational)
  for(const lang of ['en','ms','zh-CN']){
    const translations=JSON.parse(read(`locales/${lang}.json`)).conservationPages.reports.operational
    assert.deepEqual(Object.keys(translations).sort(),[...required].sort());assert.ok(Object.values(translations).every(value=>value&&!value.includes('??')))
    const h=harness('observations',undefined,lang)
    try{await flush();await h.state.exportFile('pdf');await h.state.exportFile('csv');assert.ok(h.drawn.join(' ').includes(translations.observations));assert.ok((await h.blobs[0].text()).includes(translations.totalObservations));assert.ok(!(await h.blobs[0].text()).includes(translations.observations))}finally{h.stop()}
  }
})

test('charts preserve missing points, actual x timestamps, status colors, min/max decimation and responsive accessible tables',()=>{
  const chart=read('components/conservation/OperationalReportChart.vue'),page=read('components/conservation/OperationalReport.vue')
  assert.match(chart,/reportSeries\(c.labels, series.values\)/)
  assert.match(chart,/spanGaps: false/);assert.match(chart,/indexAxis: c.kind === 'horizontal' \? 'y' : 'x'/)
  assert.match(chart,/legend: \{ display: stacked \}/);assert.match(chart,/animation: false/)
  assert.match(page,/overflow-x: auto/);assert.match(page,/scope="col"/);assert.match(page,/vertical-align: middle/);assert.match(page,/background: #245443; color: white/)
  assert.match(page,/role="region"/);assert.match(chart,/role="img"/)
})

test('time-series downsampling preserves spikes, zero, null boundaries and long interruptions without changing source rows',()=>{
  const labels=Array.from({length:5000},(_,index)=>new Date(Date.UTC(2026,10,1)+index*60000).toISOString())
  const values=labels.map(()=>10);values[123]=999;values[321]=-5;values[444]=null;values[445]=0
  const points=reportSeries(labels,values)
  assert.ok(points.length<1500);assert.ok(points.some(point=>point.y===999));assert.ok(points.some(point=>point.y===-5));assert.ok(points.some(point=>point.y===0))
  const missing=points.findIndex(point=>point.x===Date.parse(labels[444]));assert.equal(points[missing].y,null)
  assert.equal(points[missing-1].x,Date.parse(labels[443]));assert.equal(points[missing+1].x,Date.parse(labels[445]))
  assert.equal(values.length,5000);assert.equal(values[444],null)
  const interrupted=reportSeries(['2026-11-01T00:00:00Z','2026-11-01T00:01:00Z','2026-11-01T00:02:00Z','2026-11-01T04:00:00Z'],[0,1,2,3])
  assert.equal(interrupted.length,5);assert.equal(interrupted[3].y,null)
})

const renderedText = tree => nodes(tree).filter(node=>node.type!==vue.Comment).map(node => typeof node.children === 'string' ? node.children : '').join(' ')
test('localized Malaysia Time and concise generated scope agree between UI and exports',async()=>{
  for(const language of ['en','ms','zh-CN'])for(const category of ['observations','iot']){
    const h=harness(category,undefined,language)
    try{
      await flush()
      const translations=JSON.parse(read(`locales/${language}.json`)).conservationPages.reports.operational
      const ui=renderedText(h.render())
      assert.ok(ui.includes(translations.malaysiaTime));assert.ok(!ui.includes('Asia/Kuala_Lumpur'))
      assert.ok(!ui.includes(translations[category==='iot'?'iotScope':'observationScope']))
      if(category==='observations')assert.ok(ui.includes(translations.observationScopeShort))
      assert.equal(h.state.exportDocument().timezone,translations.malaysiaTime)
      assert.ok(!JSON.stringify(h.state.exportDocument()).includes(translations[category==='iot'?'iotScope':'observationScope']))
      assert.equal(h.state.report.value.scope.timezone,'Asia/Kuala_Lumpur')
    }finally{h.stop()}
  }
})

test('all six Observation cards get canonical status themes without changing dynamic counts',async()=>{
  const stats=['totalObservations','Pending Review','Approved','Rejected','Correction Required','Flagged'].map((key,index)=>({key,value:index+1}))
  const h=harness('observations',async()=>({...fixture('observations'),statistics:stats}))
  try{
    await flush()
    const cards=nodes(h.render()).filter(node=>node.type==='div'&&String(node.props?.class).includes('report-stat'))
    assert.equal(cards.length,6)
    const themes=['total','pending','approved','rejected','correction','flagged']
    cards.forEach((card,index)=>{assert.ok(card.props.class.includes('observation-'+themes[index]));assert.equal(renderedText(nodes(card).find(node=>node.type==='strong')).trim(),String(index+1))})
    for(const stat of stats)assert.equal(h.state.exportDocument().statistics.find(item=>item.label===h.state.text(stat.key)).value,stat.value)
  }finally{h.stop()}
})

test('IoT timestamp keeps date/time groups together and summary units/precision do not alter exported values',async()=>{
  const stats=[{key:'devicesWithReadings',value:2},{key:'totalReadings',value:3},{key:'latestReading',value:'2026-11-07T13:31:00Z'},{key:'minimum',value:0},{key:'average',value:22.1234567},{key:'maximum',value:25}]
  const h=harness('iot',async()=>({...fixture('iot'),statistics:stats}))
  try{
    await flush()
    const tree=nodes(h.render()),time=tree.find(node=>node.type==='time')
    assert.equal(time.props.datetime,'2026-11-07T13:31:00Z')
    const groups=nodes(time).filter(node=>node.props?.class==='timestamp-part')
    assert.equal(groups.length,2);assert.equal(groups[0].children,'Nov 7, 2026,');assert.equal(groups[1].children,'21:31')
    assert.equal(tree.filter(node=>node.props?.class==='stat-unit').length,3)
    assert.ok(tree.filter(node=>node.props?.class==='stat-unit').every(node=>node.children==='°C'))
    assert.equal(h.state.display(22.1234567),'22.1235')
    assert.ok(h.state.exportDocument().statistics.some(stat=>stat.value===22.1234567))
    assert.ok(h.state.exportDocument().statistics.some(stat=>stat.value==='2026-11-07T13:31:00Z'))
  }finally{h.stop()}
})

test('rendered nested time and 6,793 value share the summary-value class which beats the actual shared time helper rule',async()=>{
  const h=harness('iot',async()=>({...fixture('iot'),statistics:[{key:'totalReadings',value:6793},{key:'latestReading',value:'2026-11-07T13:31:00Z'}]}))
  try{
    await flush()
    const tree=nodes(h.render()),time=tree.find(node=>node.type==='time')
    const number=tree.find(node=>node.type==='strong'&&renderedText(node).includes('6,793'))
    const wrapper=tree.find(node=>node.type==='strong'&&nodes(node).includes(time))
    assert.ok(number&&time&&wrapper)
    assert.equal(number.props.class,'stat-value');assert.equal(time.props.class,'stat-value');assert.equal(wrapper.props.class,'stat-value')
    assert.equal(time.props.datetime,'2026-11-07T13:31:00Z')
    const {descriptor}=parse(read('components/conservation/OperationalReport.vue'))
    const compiled=compileStyle({source:descriptor.styles[0].content,id:'data-v-iot-cascade',scoped:true})
    assert.deepEqual(compiled.errors,[])
    const local=[],shared=[]
    postcss.parse(compiled.code).walkRules(rule=>local.push(rule))
    postcss.parse(read('styles/officer-typography.css')).walkRules(rule=>shared.push(rule))
    const unified=local.find(rule=>rule.selector.includes('.report-stat .stat-value'))
    const helper=shared.find(rule=>rule.selector.endsWith(':is(small, time)'))
    const declarations=rule=>Object.fromEntries(rule.nodes.filter(node=>node.type==='decl').map(node=>[node.prop,node.value]))
    assert.equal(declarations(helper)['font-size'],'var(--officer-small)')
    assert.equal(declarations(shared[0])['--officer-small'],'.75rem') // Before: <time> 12px, although <strong> was 24px.
    assert.deepEqual(['font-size','font-weight','line-height','color','margin'].map(key=>declarations(unified)[key]),['1.5rem','700','1.25','inherit','0'])
    const compare=(a,b)=>a[0]-b[0]||a[1]-b[1]||a[2]-b[2]
    const score=node=>{
      if(node.type==='id')return[1,0,0]
      if(['class','attribute'].includes(node.type))return[0,1,0]
      if(node.type==='tag')return[0,0,1]
      if(node.type==='pseudo'&&node.value===':is')return node.nodes.map(score).sort(compare).at(-1)
      return(node.nodes||[]).reduce((total,child)=>total.map((value,index)=>value+score(child)[index]),[0,0,0])
    }
    assert.ok(compare(score(selectorParser().astSync(unified.selector)),score(selectorParser().astSync(helper.selector)))>0)
  }finally{h.stop()}
})

test('report card palette and container breakpoints are scoped, compact and override inherited typography',()=>{
  const {descriptor}=parse(read('components/conservation/OperationalReport.vue'))
  const sheet=postcss.parse(descriptor.styles[0].content),rules=[];sheet.walkRules(rule=>rules.push(rule))
  const declarations=rule=>Object.fromEntries(rule.nodes.filter(node=>node.type==='decl').map(node=>[node.prop,node.value]))
  const palette={total:['#edf2ee','#315b49'],pending:['#e8f0f5','#315d78'],approved:['#e7f3e9','#287347'],rejected:['#fbe8e5','#a33f35'],correction:['#fff1db','#926119'],flagged:['#f0eaf8','#69459a']}
  for(const [theme,[background,ink]]of Object.entries(palette)){
    const values=declarations(rules.find(rule=>rule.selector===`.observation-${theme}`));assert.equal(values['--stat-background'],background);assert.equal(values['--stat-ink'],ink)
  }
  const values=declarations(rules.find(rule=>rule.selector.endsWith('.operational-report .report-stat')))
  assert.equal(values['min-height'],'0');assert.equal(values.height,'auto');assert.equal(values.padding,'14px');assert.equal(values['justify-content'],'flex-start');assert.match(values.border,/1px solid/)
  assert.ok(rules.some(rule=>rule.selector==='.iot-metrics'&&declarations(rule)['grid-template-columns']==='repeat(3, minmax(0, 1fr))'))
  for(const [breakpoint,columns]of [['(min-width: 1700px)','repeat(6, minmax(0, 1fr))'],['(max-width: 800px)','repeat(2, minmax(0, 1fr))'],['(max-width: 520px)','minmax(0, 1fr)']])assert.ok(rules.some(rule=>rule.parent.name==='container'&&rule.parent.params===breakpoint&&declarations(rule)['grid-template-columns']===columns))
  assert.ok(!rules.some(rule=>rule.selector.includes('.latest-stat strong')))
  assert.ok(rules.some(rule=>rule.selector.endsWith('.report-stat .stat-value')&&declarations(rule)['font-size']==='1.5rem'))
  assert.ok(rules.some(rule=>rule.selector.endsWith('.timestamp-part')&&declarations(rule)['white-space']==='normal'))
})
