import selectorParser from 'postcss-selector-parser'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { parse, compileScript, compileTemplate, compileStyle } from '@vue/compiler-sfc'
import postcss from 'postcss'
import { monitoringDate, monitoringLabels } from '../src/utils/officerMonitoringDisplay.ts'
import { formatPlantId } from '../src/utils/plantId.ts'
import * as reviewRules from '../src/services/observationReview.ts'
import * as speciesRequestRules from '../src/services/reviewSpeciesRequest.ts'
import { observationOrigin, readQueuePage } from '../src/services/observationQueue.ts'
import { formatObservationId } from '../src/utils/observationId.ts'
import * as threatAlertService from '../src/services/threatAlerts.ts'
import { alertSource, alertStatusLabel, alertTypeLabel } from '../src/utils/threatAlertDisplay.ts'
import { threatAlertBadgeStyle } from '../src/utils/workflowBadge.ts'
const read = path => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')
const source = read('views/conservation/ConservationDashboardView.vue')
const { descriptor } = parse(source)
const script = compileScript(descriptor, { id: 'overview-test' })
const template = compileTemplate({ source: descriptor.template.content, filename: 'Overview.vue', id: 'overview-test', compilerOptions: { bindingMetadata: script.bindings } })
const transpile = value => ts.transpileModule(value, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const owner = '2ace382f-1111-4111-8111-111111111111'
const seed = () => ({
  observations: ['Pending Review','Pending Review','Pending Review','Correction Required','Pending Review','Approved','Rejected','Draft'].map((status,index)=>({id:`4451e4cb-${String(index).padStart(4,'0')}-4000-8000-000000000001`,plant_id:18,revision:3,species_id:1,owner_subject:`staff:${index ? '2ace382f-2222-4222-8222-222222222222' : owner}`,status,origin_type:['initial_registration','subsequent_observation','initial_registration','subsequent_observation','unknown','initial_registration','subsequent_observation','subsequent_observation'][index],scientific_name:'Shorea macrophylla',created_at:`2026-11-${String(20-index).padStart(2,'0')}T00:00:00Z`})),
  species: ['Not Assessed','Least Concern','Near Threatened','Vulnerable','Endangered','Critically Endangered'].map((conservation_status,index)=>({species_id:index+1,scientific_name:'Shorea '+index,conservation_status})),
  plants: [
    {plant_id:18,species_id:1,registered_subject:`staff:${owner}`,rbac_status:'Approved',registered_at:'2026-11-05T03:44:00Z',latitude:0,longitude:0,observed_at:null},
    {plant_id:19,species_id:2,registered_subject:'staff:2ace382f-2222-4222-8222-222222222222',rbac_status:'Pending Review',registered_at:'2026-11-04T03:00:00Z',latitude:4,longitude:114},
    {plant_id:20,species_id:3,registered_subject:null,rbac_status:'Approved',registered_at:null,latitude:999,longitude:0},
    {plant_id:21,species_id:4,rbac_status:'Approved',registered_at:'2026-11-03T03:00:00Z',latitude:4,longitude:114,observed_at:'2026-11-04T12:00:00+08:00'},
    {plant_id:22,species_id:5,rbac_status:'Rejected',registered_at:'2026-11-02T03:00:00Z'},
  ],
  alerts:[
    {id:'alert-1',device_id:'sensor-1',reading_id:'reading-1',camera_id:null,metric:'temperature',value:42.1,status:'New',detected_at:'2026-11-05T00:00:00Z',created_at:'2026-11-05T00:00:00Z',video_path:null},
    {id:'alert-2',device_id:'camera-2',reading_id:null,camera_id:'camera-2',metric:'human_detected',value:1,status:'Resolved',detected_at:'2026-11-04T00:00:00Z',created_at:'2026-11-04T00:00:00Z',video_path:null},
  ], responses:[],
})
function nodes(root) { const all=[];const walk=node=>{if(Array.isArray(node))return node.forEach(walk);if(!node||typeof node!=='object')return;all.push(node);if(Array.isArray(node.children))walk(node.children);else if(node.children?.default)walk(node.children.default())};walk(root);return all }
const text = root => nodes(root).filter(node=>node.type!==vue.Comment).map(node=>typeof node.children==='string'?node.children:'').join(' ')
function harness(language='en',data=seed(),transport=null) {
  const messages=JSON.parse(read(`locales/${language}.json`)),locale=vue.ref(language),calls=[],routes=[],cleanups=[]
  const resolve=key=>key.split('.').reduce((value,part)=>value?.[part],messages)
  let listener,unsubscribed=false,session={pending:false,user:{id:owner,name:'Authorized Officer',role:'Conservation Officer',status:'Active',mustChangePassword:false}}
  const translate=value=>{const key=String(value).toLowerCase().replace(/[^a-z0-9]+/g,'');return resolve(`conservationText.${key}`)||resolve(`dashboardValues.${key}`)||value}
  const context={exports:{},Error,AbortSignal,AbortController,URLSearchParams,console,fetch:async(url,options)=>{calls.push({url,options});if(transport){const supplied=await transport(url,options);if(supplied)return supplied}const key=url.includes('/api/data/alerts')?'alerts':url.includes('/iot/')?'alerts':url.includes('/observations')?'observations':url.includes('/plants')?'plants':'species';if(url.includes('/api/data/alerts'))return Response.json({alerts:data.alerts,responses:data.responses||[]});if(url.includes('view=dashboard-counts'))return Response.json({totals:{total:data.observations.length,pending:data.observations.filter(row=>['Pending Review','Flagged','Correction Required'].includes(row.status)).length}});if(url.includes('view=dashboard')){const q=new URL(url,'http://localhost').searchParams;return Response.json({observations:data.observations.filter(row=>row.origin_type===q.get('origin_type')&&row.status==='Pending Review'),page:{has_more:false,next_cursor:null}})}return Response.json({[key]:data[key]})},require(name){
    if(name==='vue')return{...vue,onMounted(){},onBeforeUnmount:fn=>cleanups.push(fn),resolveComponent:name=>name}
    if(name==='vue-router')return{useRouter:()=>({push:value=>routes.push(value)})}
    if(name==='vue-i18n')return{useI18n:()=>({locale,te:key=>typeof resolve(key)==='string',t:(key,params={})=>Object.entries(params).reduce((value,[key,item])=>value.replaceAll('{'+key+'}',String(item)),resolve(key)||key)})}
    if(name.endsWith('/observationReview'))return reviewRules
    if(name.endsWith('/reviewSpeciesRequest'))return speciesRequestRules
    if(name.endsWith('/auth'))return{sessionSnapshot:()=>session,subscribeSession:fn=>{listener=fn;return()=>{unsubscribed=true}}}
    if(name.endsWith('observationQueue'))return{observationOrigin,readQueuePage}
    if(name.endsWith('officerMonitoringDisplay'))return{monitoringDate,monitoringLabels}
    if(name.endsWith('plantId'))return{formatPlantId}
    if(name.endsWith('observationId'))return{formatObservationId}
    if(name.endsWith('/threatAlerts'))return{...threatAlertService,loadCanonicalAlertQueue:async signal=>{
      const response=await context.fetch('/api/data/alerts',{signal}),body=await response.json()
      if(!response.ok||!Array.isArray(body.alerts)||!Array.isArray(body.responses))throw Error('invalid canonical alert response')
      const alerts=body.alerts.map(item=>({...item,id:item.id,deviceId:item.device_id,readingId:item.reading_id,cameraId:item.camera_id,metric:item.metric,value:item.value,status:item.status,detectedAt:item.detected_at||item.created_at,createdAt:item.created_at,videoPath:item.video_path,responses:body.responses.filter(row=>row.alert_id===item.id).map(row=>({id:row.id,alertId:row.alert_id,officerSubject:row.officer_subject,note:row.note,status:row.status,createdAt:row.created_at}))}))
      return{alerts,alertsCapped:false,historyCapped:false}
    }}
    if(name.endsWith('/threatAlertRefresh'))return{createThreatAlertRefresh:()=>({start(){},stop(){},refresh(){}})}
    if(name.endsWith('/threatAlertDisplay'))return{alertSource,alertStatusLabel,alertTypeLabel}
    if(name.endsWith('/workflowBadge'))return{threatAlertBadgeStyle}
    if(name.endsWith('/useConservationText'))return{useConservationText:()=>({ct:translate})}
    if(name.endsWith('.vue'))return{__esModule:true,default:{name:name.split('/').at(-1).replace('.vue','')}}
    throw Error(name)
  }}
  vm.runInNewContext(`(function(){${transpile(script.content)}})()`,context)
  const scope=vue.effectScope(),state=scope.run(()=>context.exports.default.setup({}, {expose(){}}))
  vm.runInNewContext(`(function(){${transpile(template.code)}})()`,context)
  return{state,calls,routes,render:()=>context.exports.render({},[],{},vue.proxyRefs(state),{},{}),async load(){await Promise.all([state.loadObservations(),state.loadRegistrations(),state.loadFieldObservations(),state.loadPlants(),state.loadSpecies(),state.loadAlerts()]);await vue.nextTick()},session(user,pending=false){session={user,pending};listener(user,pending)},stop(){cleanups.forEach(fn=>fn());scope.stop();assert.ok(unsubscribed)}}
}

test('Overview keeps all six loaded count sources and removes visible count scope notes',async()=>{
  assert.deepEqual(template.errors,[])
  const h=harness();try{
    await h.load();assert.deepEqual(Array.from(h.state.summaries.value,card=>card[1]),[6,5,5,2,1,8])
    assert.equal(h.state.observationTotals.value.pending,5);assert.equal(h.state.plants.value.length,5)
    const tree=nodes(h.render()),cards=tree.filter(node=>node.type==='article'&&node.props?.class==='summary-card')
    assert.equal(cards.length,6);assert.ok(cards.every(card=>!nodes(card).some(node=>node.type==='small')))
    assert.ok(cards.some(card=>text(card).includes('Observations')));assert.ok(!text(h.render()).includes('Loaded Observations'))
    assert.equal(tree.filter(node=>node.props?.class==='summary-scope').length,0)
    assert.ok(!text(h.render()).includes('Observation counts cover all accessible records; other counts reflect loaded records.'));assert.ok(!text(h.render()).includes('Approved plants with valid coordinates'))
    assert.deepEqual(h.calls.filter(call=>!call.url.startsWith('/api/conservation/submitter-names?')).map(call=>call.url).sort(),['/api/data/alerts','/api/observations?view=dashboard-counts','/api/observations?view=dashboard&origin_type=initial_registration&status=Pending+Review&limit=10','/api/observations?view=dashboard&origin_type=subsequent_observation&status=Pending+Review&limit=10','/api/plants','/api/species?scope=scientific'].sort())
    assert.ok(h.calls.every(call=>!call.options.method||call.options.method==='GET'))
  }finally{h.stop()}
})

test('compact Observation IDs are collision-safe across the loaded collection and review navigation retains original UUIDs',async()=>{
  const h=harness();try{
    await h.load();const labels=h.state.observationDisplayLabels.value
    assert.equal(new Set(labels.values()).size,2);assert.equal(labels.get(seed().observations[2].id),'OBS-4451E4CB0002')
    const table=nodes(h.render()).find(node=>node.type==='table'&&node.props.class.includes('pending-review-table'))
    const fieldTable=nodes(h.render()).find(node=>node.type==='table'&&node.props.class.includes('field-observations-table'))
    const identifiers=nodes(fieldTable).filter(node=>node.type?.name==='MonitoringIdentifier')
    assert.equal(identifiers[0].props.value,seed().observations[1].id)
    assert.equal(identifiers[0].props.labels.get(identifiers[0].props.value),'OBS-4451E4CB0001')
    const review=nodes(table).find(node=>node.type==='button');review.props.onClick()
    assert.deepEqual(JSON.parse(JSON.stringify(h.routes[0])),{name:'conservation-reviews',query:{review:seed().observations[2].id}})
    h.state.observations.value.push({id:18,plant_id:18,status:'Approved'});assert.equal(h.state.observationDisplayLabels.value.get('18'),'OBS018')
  }finally{h.stop()}
})

test('compact previews show submission dates without a separate submitter directory request',async()=>{
 const h=harness();try{
  await h.load();const tables=nodes(h.render()).filter(n=>n.type==='table');
  assert.ok(tables.every(table=>nodes(table).some(n=>n.type==='time'&&text(n).includes('2026'))));
  assert.equal(h.calls.filter(c=>c.url.includes('submitter-names')).length,0);
  assert.ok(tables.every(table=>!text(table).includes('Staff')));
 }finally{h.stop()}
})

test('Pending Observations uses only the subsequent-observation preview and remains independent of plant-list errors',async()=>{
  const h=harness();try{
    await h.load()
    const table=nodes(h.render()).find(node=>node.type==='table'&&node.props.class.includes('field-observations-table'))
    assert.deepEqual(nodes(table).filter(node=>node.type==='th').map(text),['Observation ID','Plant ID','Species','Submitted','Status','Action'])
    assert.ok(text(table).includes('PL018'));assert.ok(nodes(table).some(node=>node.type==='em'&&text(node).includes('Shorea')))
    assert.deepEqual(Array.from(h.state.pendingFieldObservations.value,item=>item.id),[seed().observations[1].id])
    assert.equal(nodes(table).filter(node=>node.type==='tr'&&node.key).length,1)
    const action=nodes(table).find(node=>node.type==='button');assert.equal(action.children,'View Observations');action.props.onClick()
    assert.deepEqual(JSON.parse(JSON.stringify(h.routes[0])),{name:'conservation-observations',query:{observation:seed().observations[1].id}})
    h.state.plantsError.value='Plant list unavailable'
    assert.equal(nodes(h.render()).filter(node=>node.type==='table'&&node.props.class.includes('field-observations-table')).length,1)
  }finally{h.stop()}
})

test('map, health breakdown, alerts and all navigation shortcuts retain actual sources and destinations',async()=>{
  const h=harness();try{
    await h.load();assert.equal(h.state.statusCount('Endangered'),1);assert.equal(h.state.statusCount('Critically Endangered'),1)
    assert.equal(h.state.recentAlerts.value.length,2)
    const tree=nodes(h.render()),map=tree.find(node=>node.type?.name==='BiodiversityMapPreview')
    assert.equal(map.props.plants.length,2);assert.equal(map.props.plants[0].latitude,0);assert.equal(map.props.plants[0].longitude,0)
    assert.ok(!map.props.plants.some(plant=>plant.id==='PL019'))
    for(const button of tree.filter(node=>node.type==='button'&&node.props?.onClick))button.props.onClick()
    for(const destination of ['conservation-species','conservation-reviews','conservation-observations','conservation-reports','conservation-map','conservation-alerts'])assert.ok(h.routes.some(route=>route.name===destination))
    assert.ok(text(h.render()).includes('Temperature Threshold'))
  }finally{h.stop()}
})

test('Conservation Alerts uses canonical alerts, sorts the newest three, and opens detail with the raw ID',async()=>{
  const data=seed()
  data.alerts.push(
    {id:'alert-older',device_id:'sensor-3',reading_id:null,camera_id:null,metric:'humidity',value:81,status:'Reviewing',created_at:'2026-11-03T00:00:00Z'},
    {id:'alert-newest',device_id:'camera-4',reading_id:null,camera_id:'camera-4',metric:'animal_detected',value:1,status:'New',created_at:'2026-11-06T00:00:00Z'},
  )
  const h=harness('en',data);try{
    await h.load()
    assert.deepEqual(h.calls.filter(call=>call.url.includes('alerts')).map(call=>call.url),['/api/data/alerts'])
    assert.deepEqual(Array.from(h.state.recentAlerts.value,item=>item.id),['alert-newest','alert-1','alert-2'])
    assert.equal(h.state.activeAlertCount.value,3)
    const alertButton=nodes(h.render()).find(node=>node.type==='button'&&node.props?.class==='alert-preview')
    alertButton.props.onClick()
    assert.deepEqual(JSON.parse(JSON.stringify(h.routes[0])),{name:'conservation-alerts',query:{alert:'alert-newest'}})
    const all=nodes(h.render()).find(node=>node.type==='button'&&text(node).includes('View All Alerts'))
    all.props.onClick();assert.equal(h.routes[1].name,'conservation-alerts');assert.equal(h.routes[1].query,undefined)
  }finally{h.stop()}
})

test('Active Threats counts only New and Reviewing canonical statuses, including saved response status changes',async()=>{
  const data=seed();const h=harness('en',data);try{
    await h.load();assert.equal(h.state.activeAlertCount.value,1)
    data.alerts[0].status='Reviewing'
    data.responses=[{id:'response-1',alert_id:'alert-1',officer_subject:'staff:officer',note:'Review started',status:'Reviewing',created_at:'2026-11-06T00:00:00Z'}]
    await h.state.loadAlerts();assert.equal(h.state.activeAlertCount.value,1)
    assert.equal(h.state.alerts.value[0].responses[0].status,'Reviewing')
    data.alerts[0].status='Resolved'
    data.responses=[{...data.responses[0],status:'Resolved',note:'Resolved'}]
    await h.state.loadAlerts();assert.equal(h.state.activeAlertCount.value,0)
  }finally{h.stop()}
})

test('background alert refresh retains the visible rows and KPI until canonical results arrive',async()=>{
  const data=seed();let release=null,deferred=false
  const h=harness('en',data,async url=>url==='/api/data/alerts'&&deferred?new Promise(resolve=>{release=()=>resolve(Response.json({alerts:data.alerts,responses:[]}))}):undefined);try{
    await h.load();const prior=h.state.alerts.value
    deferred=true;data.alerts[0].status='Resolved'
    const pending=h.state.loadAlerts();await new Promise(resolve=>setImmediate(resolve))
    assert.equal(h.state.alertsLoading.value,false);assert.equal(h.state.alerts.value,prior);assert.equal(h.state.activeAlertCount.value,1)
    release();await pending;assert.equal(h.state.activeAlertCount.value,0)
  }finally{h.stop()}
})

test('canonical empty, API failure and malformed responses stay distinct and a background failure preserves loaded data',async()=>{
  const empty=harness('en',{...seed(),alerts:[],responses:[]});try{
    await empty.load();assert.equal(empty.state.alertsLoaded.value,true);assert.equal(empty.state.alertsError.value,'')
    assert.ok(text(empty.render()).includes('No threat alerts found.'))
  }finally{empty.stop()}
  let fail=false
  const failed=harness('en',seed(),async url=>url==='/api/data/alerts'&&fail?Response.json({error:'private backend detail'},{status:500}):undefined);try{
    await failed.load();assert.equal(failed.state.alertsLoaded.value,true)
    fail=true;await failed.state.loadAlerts()
    assert.equal(failed.state.alerts.value.length,2);assert.equal(failed.state.activeAlertCount.value,1)
    assert.equal(failed.state.alertsError.value,'Unable to retrieve threat alerts.')
    assert.ok(text(failed.render()).includes('Unable to retrieve threat alerts.'))
    assert.ok(!text(failed.render()).includes('private backend detail'))
  }finally{failed.stop()}
  const malformed=harness('en',seed(),async url=>url==='/api/data/alerts'?Response.json({alerts:{},responses:[]}):undefined);try{
    await malformed.load();assert.equal(malformed.state.alertsLoaded.value,false)
    assert.equal(malformed.state.alertsError.value,'Unable to retrieve threat alerts.')
    assert.equal(malformed.state.summaries.value.find(card=>card[0]==='activeThreats')[1],'—')
    assert.ok(!text(malformed.render()).includes('No threat alerts found.'))
  }finally{malformed.stop()}
})

test('alert identifiers that cannot be safely used by detail lookup cannot navigate',async()=>{
  const data=seed();data.alerts[0].id='bad/id'
  const h=harness('en',data);try{
    await h.load();const button=nodes(h.render()).find(node=>node.type==='button'&&node.props?.class==='alert-preview')
    assert.equal(button.props.disabled,true);button.props.onClick();assert.equal(h.routes.length,0)
  }finally{h.stop()}
})

test('non-Officer sessions do not request canonical conservation alerts',async()=>{
  const h=harness();try{
    h.session({id:'botanist',name:'Botanist',role:'Botanist',status:'Active',mustChangePassword:false})
    await h.state.loadAlerts();assert.equal(h.calls.some(call=>call.url==='/api/data/alerts'),false)
    assert.equal(h.state.alerts.value.length,0)
  }finally{h.stop()}
})

test('loading, successful empty data and errors remain distinct without invented counts or dates',async()=>{
  const h=harness('en',{observations:[],plants:[],species:[],alerts:[]});try{
    assert.equal(h.state.summaries.value[0][1],'\u2014')
    await h.load();assert.ok(h.state.summaries.value.every(card=>card[1]===0));assert.ok(text(h.render()).includes('No pending plant registrations in loaded records.')&&text(h.render()).includes('No pending field observations in loaded records.'))
    h.state.observationsError.value='Unavailable';assert.equal(h.state.summaries.value[2][1],'\u2014');assert.ok(!text(h.render()).includes('Unavailable'),'count failure does not hide independent previews')
  }finally{h.stop()}
})

test('Overview labels, table headings and shortcuts localize consistently in English, Malay and Chinese',async()=>{
  for(const language of ['en','ms','zh-CN']){
    const h=harness(language);try{
      await h.load();const data=JSON.parse(read(`locales/${language}.json`)).conservationDashboard
      assert.ok(text(h.render()).includes(data.summary.recentObservations));assert.ok(!text(h.render()).includes(data.countScope));assert.ok(!text(h.render()).includes(data.approvedMapRecords))
      const messages=JSON.parse(read(`locales/${language}.json`)),alertMessages=messages.conservationText
      assert.ok(text(h.render()).includes(alertMessages.temperaturethreshold));assert.ok(text(h.render()).includes(messages.dashboardValues.new))
      for(const key of ['pendingPlantRegistrations','pendingObservations','fieldRecords'])assert.ok(text(h.render()).includes(data[key]))
      assert.ok(text(h.render()).includes(data.actions.searchObservations));assert.ok(!text(h.render()).includes('conservationDashboard.'))
    }finally{h.stop()}
  }
})

test('Overview opts into established table styling with middle alignment, status themes, bounded scrolling and responsive grids',()=>{
  const sheet=postcss.parse(descriptor.styles[0].content),rules=[];sheet.walkRules(rule=>rules.push(rule))
  const declarations=rule=>Object.fromEntries(rule.nodes.filter(node=>node.type==='decl').map(node=>[node.prop,node.value]))
  assert.match(source, /styles\/officer-data-tables.css/)
  const shared=read('styles/officer-data-tables.css');assert.match(shared,/background: #245443/);assert.match(shared,/vertical-align: middle/);assert.match(shared,/color: #fff/)
  assert.equal((source.match(/<th scope="col"/g)||[]).length,11)
  const scrolling=rules.find(rule=>rule.selector.endsWith('.overview-table-scroll'));assert.equal(declarations(scrolling)['overflow-x'],'auto');assert.equal(declarations(scrolling)['min-width'],'0')
  assert.ok(rules.some(rule=>rule.selector.includes('.field-observations-table) .badge.pending-review')&&declarations(rule).background==='#FEF9C3'))
  assert.ok(rules.some(rule=>rule.selector.includes('.field-observations-table) .badge.flagged')&&declarations(rule).background==='#f0eaf8'))
  assert.ok(!rules.some(rule=>rule.selector.includes('.recent-records-table .badge')),'plant status palette remains inherited')
  for(const width of [1250,1000,650,400])assert.ok(rules.some(rule=>rule.parent.name==='container'&&rule.parent.params===`(max-width: ${width}px)`))
  assert.doesNotMatch(descriptor.styles[0].content,/text-overflow: ellipsis|overflow-x: hidden/)
  assert.match(source,/:aria-label="t\('conservationDashboard.pendingPlantRegistrations'\)" tabindex="0"/)
  assert.match(source,/:aria-label="t\('conservationDashboard.pendingObservations'\)" tabindex="0"/)
})

test('attention-first cards reuse the original metric values and show consistent blue/red/amber/green themes',async()=>{
  const h=harness();try{
    await h.load();const cards=nodes(h.render()).filter(node=>node.type==='article'&&node.props?.class==='summary-card')
    assert.deepEqual(cards.map(card=>card.props['data-metric']),['pendingReviews','activeThreats','endangeredSpecies','plantRecords','plantSpecies','recentObservations'])
    assert.deepEqual(Array.from(h.state.orderedSummaries.value,card=>card[1]),[5,1,2,5,6,8])
    for(const card of h.state.orderedSummaries.value)assert.ok(h.state.summaries.value.includes(card))
    const rules=[];postcss.parse(descriptor.styles[0].content).walkRules(rule=>rules.push(rule))
    const expected={pendingReviews:['#e8f0f5','#315d78'],activeThreats:['#fbe8e5','#a33f35'],endangeredSpecies:['#fff1db','#926119']}
    for(const[key,[background,ink]]of Object.entries(expected)){
      const rule=rules.find(rule=>rule.selector.endsWith(`[data-metric="${key}"]`)),values=Object.fromEntries(rule.nodes.map(node=>[node.prop,node.value]))
      assert.equal(values['--summary-background'],background);assert.equal(values['--summary-ink'],ink)
    }
  }finally{h.stop()}
})

test('full-width registrations precede paired field observations/status while map, alerts and shortcuts remain in place',async()=>{
  const h=harness();try{
    await h.load();const root=h.render(),sections=nodes(root).filter(node=>node.type==='section'&&String(node.props?.class).includes('panel'))
    assert.equal(sections.length,6)
    assert.ok(sections[0].props.class.includes('pending-review-panel'))
    assert.ok(sections[1].props.class.includes('pending-observations-panel'))
    assert.ok(sections[2].props.class.includes('conservation-status-panel'))
    assert.ok(text(sections[3]).includes('Species Distribution'));assert.ok(text(sections[4]).includes('Conservation Alerts'));assert.ok(text(sections[5]).includes('Quick Actions'))
    const medium=nodes(root).find(node=>node.type==='div'&&node.props?.class==='two-column overview-medium')
    assert.ok(nodes(medium).includes(sections[1]));assert.ok(nodes(medium).includes(sections[2]));assert.ok(!nodes(medium).includes(sections[0]))
    const table=nodes(sections[0]).find(node=>node.type==='table')
    assert.deepEqual(nodes(table).filter(node=>node.type==='th').map(text),['Plant ID','Species','Submitted','Status','Action'])
    assert.deepEqual(nodes(table).filter(node=>node.type==='col').slice(0,2).map(node=>node.props.class),['overview-plant','overview-species'])
    const row=nodes(table).find(node=>node.type==='tr'&&node.key===seed().observations[2].id)
    assert.ok(text(nodes(row).filter(node=>node.type==='td')[0]).includes('PL018'))
    assert.equal(h.state.observationTotals.value.pending,5);assert.ok(h.state.observations.value.every(item=>item.status==='Pending Review'))
  }finally{h.stop()}
})

test('six accessible conservation bars use loaded species as denominator without changing status counts',async()=>{
  const h=harness();try{
    await h.load();const tracks=nodes(h.render()).filter(node=>node.props?.class==='status-track')
    assert.equal(tracks.length,6)
    for(const track of tracks){assert.equal(track.props.role,'img');assert.match(track.props['aria-label'],/1 of 6 loaded species/);const bar=nodes(track).find(node=>node.props?.class==='status-fill');assert.ok(Math.abs(parseFloat(bar.props.style.width)-100/6)<.00001)}
    h.state.species.value=[]
    const empty=nodes(h.render()).filter(node=>node.props?.class==='status-fill');assert.equal(empty.length,6);assert.ok(empty.every(node=>node.props.style.width==='0%'))
    assert.ok(text(h.render()).includes('Of 0 loaded species'))
    h.state.speciesError.value='Species unavailable'
    assert.equal(nodes(h.render()).filter(node=>node.props?.class==='status-track').length,0)
  }finally{h.stop()}
})

test('five newest pending eligible previews scan past ineligible rows without truncating the KPI',async()=>{
 const data=seed();const base={plant_id:18,revision:3,species_id:1,owner_subject:'staff:actor',status:'Pending Review',scientific_name:'Species'};
 const h=harness('en',data,async url=>{
  if(!url.includes('view=dashboard&'))return;
  const q=new URL(url,'http://localhost').searchParams, origin=q.get('origin_type'), next=q.has('cursor');
  const rows=Array.from({length:10},(_,i)=>({...base,id:String((origin==='initial_registration'?0:1000)+(next?200:100)+i),origin_type:origin,owner_subject:next?'staff:actor':`staff:${owner}`,created_at:`2026-11-${20-i}T00:00:00Z`}));
  return Response.json({observations:rows,page:{has_more:!next,next_cursor:next?null:'page-two'}});
 });try{
  await h.load();assert.equal(h.state.pendingRegistrations.value.length,5);assert.equal(h.state.pendingFieldObservations.value.length,5);
  assert.deepEqual(Array.from(h.state.pendingRegistrations.value,row=>row.id),['200','201','202','203','204']);
  assert.equal(h.state.observationTotals.value.total,8);assert.equal(h.state.observationTotals.value.pending,5);
  assert.equal(h.calls.filter(c=>c.url.includes('view=dashboard&')).length,4);
 }finally{h.stop()}
})

test('conflicting duplicate origin classifications are excluded from both queues rather than guessed',async()=>{
  const h=harness();try{
    await h.load()
    h.state.fieldRows.value=[];h.state.registrationRows.value=[
      {id:'conflict',plant_id:18,status:'Pending Review',origin_type:'initial_registration'},
      {id:'conflict',plant_id:18,status:'Pending Review',origin_type:'subsequent_observation'},
      {id:'321',plant_id:18,revision:3,species_id:1,owner_subject:'staff:actor',scientific_name:'Test species',status:'Pending Review',origin_type:'subsequent_observation'},
      {id:'321',plant_id:18,revision:3,species_id:1,owner_subject:'staff:actor',scientific_name:'Test species',status:'Pending Review',origin_type:'subsequent_observation'},
    ]
    assert.equal(h.state.pendingRegistrations.value.length,0)
    assert.deepEqual(Array.from(h.state.pendingFieldObservations.value,item=>item.id),['321'])
  }finally{h.stop()}
})

test('review sections use independent loading/error states and keep their existing safe navigation destinations',async()=>{
  const h=harness();try{
    assert.equal(text(h.render()).split('Loading observations...').length-1,2)
    await h.load()
    const panels=nodes(h.render()).filter(node=>node.type==='section'&&String(node.props?.class).includes('panel'))
    assert.ok(text(panels[0]).includes('Pending Plant Registrations'));assert.ok(!text(panels[0]).includes('Observation ID'))
    assert.ok(text(panels[1]).includes('Pending Observations'));assert.ok(text(panels[1]).includes('Field Records'))
    nodes(panels[0]).find(node=>node.type==='button'&&text(node).includes('View All Submissions')).props.onClick()
    nodes(panels[1]).find(node=>node.type==='button'&&text(node).includes('View All Observations')).props.onClick()
    assert.equal(h.routes[0].name,'conservation-reviews');assert.equal(h.routes[1].name,'conservation-observations')
    h.state.registrationError.value='Observation source unavailable'
    assert.equal(nodes(h.render()).filter(node=>node.type==='table').length,1)
    assert.equal(text(h.render()).split('Observation source unavailable').length-1,1)
  }finally{h.stop()}
})

test('welcome greeting and enlarged dynamic date share a desktop baseline, with stacking only on narrow content',()=>{
  const rules=[];postcss.parse(descriptor.styles[0].content).walkRules(rule=>rules.push(rule))
  const declarations=rule=>Object.fromEntries(rule.nodes.filter(node=>node.type==='decl').map(node=>[node.prop,node.value]))
  const desktop=rules.find(rule=>rule.selector.endsWith('.page-intro > time')&&rule.parent.type==='root')
  assert.equal(declarations(desktop)['font-size'],'1.125rem');assert.equal(declarations(desktop)['font-weight'],'600');assert.equal(declarations(desktop)['grid-row'],'2');assert.equal(declarations(desktop)['grid-column'],'2')
  const title=rules.find(rule=>rule.selector.endsWith('.page-intro h2'))
  assert.equal(declarations(title)['grid-row'],'2')
  const grid=rules.find(rule=>rule.selector==='.dashboard-overview .page-intro'&&rule.parent.type==='root')
  assert.equal(declarations(grid).display,'grid');assert.equal(declarations(grid)['align-items'],'baseline')
  assert.ok(rules.some(rule=>rule.selector.endsWith('.page-intro > time')&&rule.parent.params==='(max-width: 800px)'&&declarations(rule)['grid-row']==='3'))
  const h=harness();try{
    const header=nodes(h.render()).find(node=>node.props?.class==='page-intro')
    const date=nodes(header).find(node=>node.type==='time')
    assert.equal(date.props.datetime,h.state.currentDateKey);assert.equal(date.children,h.state.currentDate.value)
  }finally{h.stop()}
})

test('English welcome date puts day before month and omits the comma before year',()=>{
  const h=harness();try{
    const formatted=h.state.currentDate.value
    assert.match(formatted,/^[A-Za-z]+, \d{1,2} [A-Za-z]+ \d{4}$/)
    assert.equal(formatted,new Intl.DateTimeFormat('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(h.state.today))
    assert.equal(h.state.dateLocale.value,'en-GB')
  }finally{h.stop()}
})

test('preview eligibility rejects self-review, missing evidence, unresolved dependencies and unverified sessions',async()=>{
 const h=harness();try{
  await h.load()
  const base={id:'123',plant_id:18,species_id:1,scientific_name:'Species',owner_subject:'staff:actor',revision:3,status:'Pending Review',origin_type:'initial_registration'}
  const pendingRequest={request_id:9,request_status:'Pending Review',requested_by:'staff:request-owner',proposed_scientific_name:'New species',review_cycle:1,content_revision:1}
  for(const changes of [{},{status:'Flagged'},{status:'Correction Required'},{status:'Draft'},{status:'Rejected'},{status:'Approved'},{revision:0},{revision:undefined},{owner_subject:`staff:${owner}`},{owner_subject:''},{species_id:undefined},{scientific_name:''},{species_request_id:9},{species_request_id:9,species_request:pendingRequest},{species_request_id:9,species_request:{...pendingRequest,requested_by:`staff:${owner}`}},{species_request_id:9,species_request:{...pendingRequest,requested_by:''}},{origin_type:'subsequent_observation',species_request_id:9,species_request:pendingRequest}]){
   const row={...base,...changes};h.state.registrationRows.value=[row];h.state.fieldRows.value=[]
   const eligible=row.status==='Pending Review'&&row.revision===3&&row.owner_subject==='staff:actor'&&Boolean(row.species_id&&row.scientific_name)&&(!row.species_request_id||row.species_request?.requested_by==='staff:request-owner'&&row.origin_type==='initial_registration')
   assert.equal(h.state.pendingRegistrations.value.length+h.state.pendingFieldObservations.value.length,eligible?1:0,JSON.stringify(changes))
  }
  h.state.registrationRows.value=[base]
  for(const user of [null,{id:owner,role:'Botanist',status:'Active',mustChangePassword:false},{id:owner,role:'Conservation Officer',status:'Inactive',mustChangePassword:false},{id:owner,role:'Conservation Officer',status:'Active',mustChangePassword:true}]){h.session(user);assert.equal(h.state.pendingRegistrations.value.length,0)}
 }finally{h.stop()}
})
test('every eligible row action preserves its full authoritative ID and no count scope note is rendered',async()=>{
 const h=harness();try{
  await h.load();const tree=nodes(h.render()),tables=tree.filter(n=>n.type==='table')
  for(const table of tables)for(const row of nodes(table).filter(n=>n.type==='tr'&&n.key)){
   nodes(row).find(n=>n.type==='button').props.onClick();const target=h.routes.at(-1)
   if(table.props.class.includes('field-observations-table')){assert.equal(target.name,'conservation-observations');assert.equal(target.query.observation,row.key)}else{assert.equal(target.name,'conservation-reviews');assert.equal(target.query.review,row.key)}
  }
  assert.equal(tree.filter(n=>n.props?.class==='statistics-scope').length,0)
  const cards=tree.filter(n=>n.type==='article'&&n.props?.class==='summary-card');assert.equal(cards.length,6)
  assert.ok(cards.every(card=>!text(card).includes('loaded records')&&!nodes(card).some(n=>n.type==='small')))
  assert.equal(h.calls.length,6)
 }finally{h.stop()}
})


test('Overview kickers and loading/empty states meet normal-text contrast on their actual surfaces',()=>{
 const rules=[];postcss.parse(descriptor.styles[0].content).walkRules(r=>rules.push(r));
 const declarations=r=>Object.fromEntries(r.nodes.filter(n=>n.type==='decl').map(n=>[n.prop,n.value]));
 const luminance=hex=>{const c=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;};
 const contrast=(a,b)=>{const [x,y]=[luminance(a),luminance(b)].sort((a,b)=>a-b);return(y+.05)/(x+.05);};
 const kicker=declarations(rules.find(r=>r.selector.includes(':is(.page-kicker, .section-kicker)'))).color;
 const state=declarations(rules.find(r=>r.selector==='.dashboard-state')).color;
 const empty=declarations(rules.find(r=>r.selector.includes(':deep(.dashboard-map-empty)'))).color;
 assert.ok(contrast(kicker,'#ffffff')>=4.5);assert.ok(contrast(kicker,'#f3f6f2')>=4.5);
 assert.ok(contrast(state,'#ffffff')>=4.5);assert.ok(contrast(empty,'#dce8dc')>=4.5);
 assert.equal(declarations(rules.find(r=>r.selector==='.error-state')).color,'#a04d3f');
});

test('Pending Observations retains six accessible columns and translated compact labels without duplicate actions',async()=>{
 for(const language of ['en','ms','zh-CN']){
  const h=harness(language);try{
   await h.load();const table=nodes(h.render()).find(n=>n.type==='table'&&n.props.class.includes('field-observations-table'));
   assert.equal(table.props.role,'table');const heads=nodes(table).filter(n=>n.type==='th');assert.equal(heads.length,6);
   assert.ok(heads.every(n=>n.props.scope==='col'&&n.props.role==='columnheader'));
   for(const row of nodes(table).filter(n=>n.type==='tr'&&n.key)){
    assert.equal(row.props.role,'row');const cells=nodes(row).filter(n=>n.type==='td');assert.equal(cells.length,6);
    assert.ok(cells.every(n=>n.props.role==='cell'));
    const labels=nodes(row).filter(n=>n.props?.class==='overview-cell-label');assert.equal(labels.length,6);
    assert.ok(labels.every((n,i)=>n.props['aria-hidden']==='true'&&text(n)===text(heads[i])));
    assert.equal(nodes(row).filter(n=>n.type==='button').length,1);
   }
  }finally{h.stop()}
 }
});

test('Overview table touch target overrides the shared compact rule without changing shared controls',()=>{
 const compare=(a,b)=>a[0]-b[0]||a[1]-b[1]||a[2]-b[2],add=(a,b)=>a.map((v,i)=>v+b[i]);
 const score=n=>{if(n.type==='id')return[1,0,0];if(['class','attribute'].includes(n.type))return[0,1,0];if(n.type==='tag')return[0,0,1];if(n.type==='pseudo'){if(n.value===':where')return[0,0,0];if([':is',':not',':has'].includes(n.value))return n.nodes.map(score).sort(compare).at(-1)||[0,0,0];return n.value.startsWith('::')?[0,0,1]:[0,1,0];}return(n.nodes||[]).reduce((a,b)=>add(a,score(b)),[0,0,0]);};
 const specificity=s=>selectorParser().astSync(s).nodes.map(score).sort(compare).at(-1);
 const compiled=compileStyle({source:descriptor.styles[0].content,id:'data-v-overview-touch',scoped:true});assert.deepEqual(compiled.errors,[]);
 const local=[];postcss.parse(compiled.code).walkRules(r=>{if(r.selector.includes('.overview-table-scroll')&&r.selector.includes('table')&&r.nodes.some(d=>d.prop==='min-height'&&d.value==='44px'))local.push(r)});
 const shared=[];postcss.parse(read('styles/dashboard-buttons.css')).walkRules(r=>{if(r.selector.includes('table')&&r.nodes.some(d=>d.prop==='min-height'&&d.value==='var(--dashboard-button-compact)'))shared.push(r)});
 assert.equal(local.length,1);assert.equal(shared.length,1);assert.ok(compare(specificity(local[0].selector),specificity(shared[0].selector))>0);
 assert.ok(local[0].nodes.some(d=>d.prop==='min-height'&&d.value==='44px'));assert.ok(local[0].nodes.some(d=>d.prop==='height'&&d.value==='auto'));
});

test('Overview adapts the field table locally and keeps compact KPI spacing',()=>{
 const rules=[];postcss.parse(descriptor.styles[0].content).walkRules(r=>rules.push(r));
 const values=r=>Object.fromEntries(r.nodes.filter(n=>n.type==='decl').map(n=>[n.prop,n.value]));
 const medium=rules.find(r=>r.selector==='.dashboard-overview .two-column.overview-medium'&&r.parent.type==='root');
 assert.equal(values(medium)['margin-top'],'24px');assert.equal(values(medium).gap,'24px');assert.match(values(medium)['grid-template-columns'],/18rem/);
 assert.ok(rules.some(r=>r.selector===medium.selector&&r.parent.params==='(max-width: 1250px)'&&values(r)['grid-template-columns']==='minmax(0, 1fr)'));
 const field=rules.find(r=>r.selector.endsWith('.field-observations-table')&&r.parent.type==='root');assert.equal(values(field)['min-width'],'0');assert.equal(values(field)['table-layout'],'fixed');
 assert.ok(rules.some(r=>r.selector.includes('.field-observations-table')&&r.selector.endsWith(' tbody tr')&&r.parent.params==='(max-width: 800px)'&&values(r).display==='grid'));
 assert.equal(values(rules.find(r=>r.selector==='.dashboard-overview .summary-grid')).gap,'12px');
 assert.equal(values(rules.find(r=>r.selector==='.dashboard-overview .summary-card')).padding,'16px');
 assert.equal(values(rules.find(r=>r.selector==='.dashboard-overview .two-column > .panel'))['margin-top'],'0');
 assert.equal(values(medium)['align-items'],'start');
 assert.equal(values(rules.find(r=>r.selector==='.dashboard-overview .panel-header'))['flex-direction'],'row');
});


test('failed registration preview keeps field records and counts visible; its Retry reloads only registrations',async()=>{
 let failed=true;
 const h=harness('en',seed(),async url=>{
  if(failed&&url.includes('view=dashboard&origin_type=initial_registration'))return Response.json({error:'unavailable'},{status:503});
 });try{
  await h.load();assert.ok(h.state.registrationError.value);assert.equal(h.state.fieldError.value,'');assert.equal(h.state.pendingFieldObservations.value.length,1);assert.equal(h.state.observationTotals.value.total,8);
  const panel=nodes(h.render()).find(n=>n.props?.class==='panel pending-review-panel');const retry=nodes(panel).find(n=>n.type==='button'&&text(n)==='Retry');assert.ok(retry);
  const before=h.calls.length;failed=false;await retry.props.onClick();assert.equal(h.calls.length,before+1);assert.equal(h.state.registrationError.value,'');assert.equal(h.state.pendingRegistrations.value.length,1);
 }finally{h.stop()}
})

test('replaced preview requests are cancelled and stale responses cannot overwrite the latest records',async()=>{
 let resolveOld,oldSignal,delayed=true;
 const row={id:'501',plant_id:18,revision:2,species_id:1,scientific_name:'Species',owner_subject:'staff:actor',origin_type:'initial_registration',status:'Pending Review'};
 const h=harness('en',seed(),async(url,options)=>{
  if(!url.includes('view=dashboard&origin_type=initial_registration'))return;
  if(delayed){oldSignal=options.signal;return new Promise(resolve=>{resolveOld=resolve})}
  return Response.json({observations:[row],page:{has_more:false,next_cursor:null}});
 });try{
  const old=h.state.loadRegistrations();delayed=false;await h.state.loadRegistrations();assert.equal(oldSignal.aborted,true);
  resolveOld(Response.json({observations:[{...row,id:'502'}],page:{has_more:false,next_cursor:null}}));await old;
  assert.deepEqual(Array.from(h.state.pendingRegistrations.value,r=>r.id),['501']);
 }finally{h.stop()}
})

test('incomplete or malformed preview never appears as an empty success; session recovery reloads read-only sources',async()=>{
 const h=harness('en',seed(),async url=>url.includes('view=dashboard&origin_type=initial_registration')?Response.json({observations:[],page:{has_more:true,next_cursor:null}}):undefined);
 try{
  await h.load();assert.ok(h.state.registrationError.value);assert.equal(h.state.pendingFieldObservations.value.length,1);
  h.session({id:owner,name:'Officer',role:'Conservation Officer',status:'Active',mustChangePassword:false},true);await vue.nextTick();
  const before=h.calls.length;h.session({id:owner,name:'Officer',role:'Conservation Officer',status:'Active',mustChangePassword:false},false);await vue.nextTick();await new Promise(resolve=>setTimeout(resolve,0));
  assert.ok(h.calls.length>before);assert.ok(h.calls.every(c=>!c.options.method||c.options.method==='GET'));
  const after=h.calls.length;await vue.nextTick();assert.equal(h.calls.length,after);
 }finally{h.stop()}
})


test('new-species registrations retain their linked Species Request review path before species approval',async()=>{
 const data=seed();data.observations=[{...data.observations[2],scientific_name:null,species_id:null,species_request_id:9,species_request:{request_id:9,request_status:'Pending Review',requested_by:'staff:request-owner',proposed_scientific_name:'New species',review_cycle:1,content_revision:1}}];
 const h=harness('en',data);try{await h.load();assert.equal(h.state.pendingRegistrations.value.length,1);
 const panel=nodes(h.render()).find(n=>n.props?.class==='panel pending-review-panel');const row=nodes(panel).find(n=>n.type==='tr'&&n.key);nodes(row).find(n=>n.type==='button').props.onClick();assert.equal(h.routes.at(-1).query.review,data.observations[0].id);
 }finally{h.stop()}
})
