import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { reportCsv, reportFilename, reportPalette } from '../src/utils/reportExport.ts'
import postcss from 'postcss'
import { parse } from '@vue/compiler-sfc'
const source = readFileSync(new URL('../src/utils/reportExport.ts', import.meta.url), 'utf8')
const transpile = value => ts.transpileModule(value, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const model = (category = 'observations', length = 3) => ({
  category, title: category + ' 中文', period: 'Nov 1–7, 2026', timezone: 'Malaysia Time (MYT)', generatedAt: '2026-11-07T13:31:00Z', generatedLabel: 'Generated At: Nov 7, 2026, 21:31',
  statistics: [{ label: 'Pending Review', value: 3, display: '3', background: reportPalette['Pending Review'][0], ink: reportPalette['Pending Review'][1] }, { label: 'Average', value: -1.1234567, display: '-1.1235', unit: '°C' }],
  columns: category === 'observations' ? ['Period','Total','Pending','Approved','Rejected','Correction','Flagged'] : ['Recorded At','Device','Measurement','Value','Unit'],
  rows: Array.from({length}, (_,i) => category === 'observations' ? ['2026-11-01',3,1,2,0,0,0] : ['2026-11-07T13:31:00Z', i ? 'Sensor 中文' : '=FORMULA("x")','temperature',i ? 0 : null,'°C']),
  displayRows: Array.from({length}, (_,i) => category === 'observations' ? ['Nov 1, 2026','3','1','2','0','0','0'] : ['Nov 7, 2026, 21:31','Sensor 中文','Temperature',i ? '0' : '—','°C']),
  chart: [{series:'Temperature',point:'2026-11-07T13:31:00Z',value:0,unit:'°C'},{series:'Temperature',point:'2026-11-07T13:32:00Z',value:null,unit:'°C'}],
})
// Parse quoted CSV including embedded CRLF/commas and escaped quotation marks.
function parseCsv(csv) {
  const rows=[];let row=[],cell='',quoted=false
  for(let i=1;i<csv.length;i++){
    const char=csv[i]
    if(char==='"'){if(quoted&&csv[i+1]==='"'){cell+='"';i++}else quoted=!quoted}
    else if(char===','&&!quoted){row.push(cell);cell=''}
    else if(char==='\r'&&csv[i+1]==='\n'&&!quoted){row.push(cell);rows.push(row);row=[];cell='';i++}
    else cell+=char
  }
  row.push(cell);rows.push(row);return rows
}
test('all four CSV exports begin with their exact table headers and contain only every matching detail row',()=>{
  const tables={
    'species-approved':{columns:['Scientific Name','Common Name','Approved Plants'],row:['Shorea macrophylla','Engkabang jantong',6793]},
    observations:{columns:['Period starting','Total observations','Pending Review','Approved','Rejected','Correction Required','Flagged'],row:['2026-11-01',6,1,2,1,1,1]},
    threats:{columns:['Threat category','Severity','Status','Device-linked plant (current)','Species (current device link)','Created At'],row:['temperature',null,'New','PL018','Shorea macrophylla','2026-11-07T13:31:00Z']},
    iot:{columns:['Recorded At','Device / sensor','Measurement','Value','Unit'],row:['2026-11-07T13:31:00Z','Sensor 中文','Temperature',-12.1234567,'°C']},
  }
  for(const category of ['species-approved','observations','threats','iot']){
    const snapshot=model(category,600)
    snapshot.columns=tables[category].columns;snapshot.rows=Array.from({length:600},()=>[...tables[category].row])
    const csv=reportCsv(snapshot),rows=parseCsv(csv),headers=rows.shift()
    assert.equal(csv[0],'\uFEFF');assert.deepEqual(headers,snapshot.columns)
    assert.ok(rows.every(row=>row.length===headers.length));assert.equal(rows.length,600)
    const safe=value=>value===null?'':typeof value==='string'&&/^[\s\u0000-\u001f]*[=+@-]/.test(value)?"'"+value:String(value)
    assert.deepEqual(rows,snapshot.rows.map(row=>row.map(safe)))
    assert.ok(!csv.includes(snapshot.title));assert.ok(!csv.includes(snapshot.timezone));assert.ok(!csv.includes(snapshot.generatedLabel))
    assert.ok(!csv.includes('export_section'));assert.ok(!csv.includes('Average'))
    assert.ok(reportFilename(snapshot,'csv').includes(category));assert.ok(!reportFilename(snapshot,'csv').includes('/'))
  }
})
test('CSV preserves Unicode, quotes, multiline text, legitimate negatives and formula-injection protection',()=>{
  const snapshot=model('iot',1)
  snapshot.rows=[['\t =HYPERLINK("x")','comma, quote" and\n中文','@SUM(A1)',-12.1234567,null]]
  const row=parseCsv(reportCsv(snapshot))[1]
  assert.equal(row[0],"'\t =HYPERLINK(\"x\")");assert.equal(row[1],'comma, quote" and\n中文');assert.equal(row[2],"'@SUM(A1)")
  assert.equal(row[3],'-12.1234567');assert.equal(row[4],'')
})
function renderer() {
  const pages=[],events=[],fonts=[];let chartConfig
  class PrintImage { naturalWidth=1000;naturalHeight=400;async decode(){} }
  const document={fonts:{ready:Promise.resolve()},createElement(){const page={width:0,height:0,events:[]};pages.push(page);let font='24px sans-serif',fillStyle='#fff';const context={
    get font(){return font},set font(value){font=value;fonts.push(value)},get fillStyle(){return fillStyle},set fillStyle(value){fillStyle=value},
    beginPath(){},roundRect(...args){page.events.push({type:'card',args,color:fillStyle})},fill(){},stroke(){},strokeRect(){},
    fillRect(...args){page.events.push({type:'rect',args,color:fillStyle})},
    fillText(text,x,y){const event={type:'text',text:String(text),x,y,font,color:fillStyle};page.events.push(event);events.push(event)},
    measureText(text){return{width:Array.from(String(text)).length*parseFloat(font.replace('700 ',''))*.52}},
    drawImage(){page.events.push({type:'chart'})},
  };return Object.assign(page,{getContext:()=>context,toDataURL:()=> 'data:image/png;base64,offline'})}}
  const context={exports:{},document,Image:PrintImage,Error,require(name){if(name==='chart.js')return{Chart:class{constructor(canvas,config){chartConfig=config}update(){}destroy(){}}};throw Error(name)}}
  vm.runInNewContext(transpile(source),context)
  const pdf={images:[],pages:1,addPage(){this.pages++},addImage(...args){this.images.push(args)}}
  return{...context.exports,pdf,pages,events,fonts,chartConfig:()=>chartConfig}
}
test('PDF order is title/period/cards/chart/table; palette, Unicode, readable dates and green headers match report content',async()=>{
  for(const category of ['species-approved','observations','threats','iot']){
    const r=renderer(),snapshot=model(category)
    assert.equal(await r.renderReportPdf(snapshot,'data:chart',r.pdf),true)
    assert.equal(r.events[0].text,snapshot.title);assert.equal(r.events[1].text,snapshot.period+' · '+snapshot.timezone)
    const commands=r.pages.flatMap(page=>page.events),card=commands.findIndex(event=>event.type==='card'),chart=commands.findIndex(event=>event.type==='chart'),header=commands.findIndex(event=>event.type==='rect'&&event.color==='#245443')
    assert.ok(card>0&&chart>card&&header>chart);assert.equal(commands[card].color,'#e8f0f5')
    assert.ok(r.events.some(event=>event.text==='Pending Review'&&event.color==='#315d78'))
    assert.ok(r.events.some(event=>event.text===snapshot.columns[0]&&event.color==='#fff'))
    assert.equal(r.pdf.images[0].at(-2),snapshot.columns.length>5?297:210)
    assert.ok(r.pages.every(page=>page.width===0&&page.height===0),'release print bitmaps after embedding')
  }
})
test('all six observation summary cards use exactly the same palette in the page and PDF',async()=>{
  const source=readFileSync(new URL('../src/components/conservation/OperationalReport.vue',import.meta.url),'utf8')
  const {descriptor}=parse(source),rules=[]
  postcss.parse(descriptor.styles[0].content).walkRules(rule=>rules.push(rule))
  const themes={totalObservations:'total','Pending Review':'pending',Approved:'approved',Rejected:'rejected','Correction Required':'correction',Flagged:'flagged'}
  const snapshot=model();snapshot.statistics=Object.entries(themes).map(([key,theme])=>{
    const rule=rules.find(rule=>rule.selector===`.observation-${theme}`)
    const declarations=Object.fromEntries(rule.nodes.map(node=>[node.prop,node.value]))
    assert.deepEqual(reportPalette[key],[declarations['--stat-background'],declarations['--stat-ink']])
    return{label:key,value:2,display:'2',background:reportPalette[key][0],ink:reportPalette[key][1]}
  })
  const r=renderer();await r.renderReportPdf(snapshot,null,r.pdf)
  const cards=r.pages.flatMap(page=>page.events).filter(event=>event.type==='card')
  assert.deepEqual(cards.map(card=>card.color),Object.values(reportPalette).map(colors=>colors[0]))
})
test('long PDF tables paginate, repeat headers, number pages and wrap exceptionally long rows without omission',async()=>{
  const r=renderer(),snapshot=model('observations',150)
  snapshot.displayRows[30][0]='中文 '+ 'long species name '.repeat(450)
  await r.renderReportPdf(snapshot,'data:chart',r.pdf)
  assert.ok(r.pdf.pages>3)
  assert.equal(r.events.filter(event=>event.text==='Period'&&event.color==='#fff').length,r.pdf.pages)
  assert.equal(r.events.filter(event=>event.text==='3'&&event.color==='#315b49').length>=150,true)
  assert.ok(r.events.some(event=>event.text.includes('中文')))
  assert.ok(r.events.every(event=>event.x>=70&&event.y>0&&event.y<=1600-35),'all text stays within printable bounds')
  assert.equal(r.pdf.images.length,r.pdf.pages)
})
test('stale exports are not finalized, and fixed-size print charts preserve series, gaps and colors without touching screen config',async()=>{
  const r=renderer();assert.equal(await r.renderReportPdf(model(),null,r.pdf,()=>false),false)
  const config={type:'line',data:{datasets:[{data:[{x:1,y:0},{x:2,y:null}],borderColor:'#32745b',spanGaps:false}]},options:{responsive:true,scales:{x:{ticks:{font:{size:12}}}}}}
  const original=JSON.stringify(config)
  await r.printChart(config)
  assert.equal(JSON.stringify(config),original)
  assert.equal(r.pages.at(-1).width,1000);assert.equal(r.pages.at(-1).height,400)
  assert.equal(r.chartConfig().options.responsive,false);assert.equal(r.chartConfig().options.devicePixelRatio,2)
  assert.equal(r.chartConfig().data.datasets[0].data[1].y,null);assert.equal(r.chartConfig().data.datasets[0].borderColor,'#32745b')
})
