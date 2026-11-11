import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import postcss from 'postcss'
import { monitoringDate, monitoringLabels } from '../src/utils/officerMonitoringDisplay.ts'
import { formatPlantId } from '../src/utils/plantId.ts'
import * as reviewRules from '../src/services/observationReview.ts'
import * as speciesRequestRules from '../src/services/reviewSpeciesRequest.ts'
import { observationOrigin } from '../src/services/observationQueue.ts'
import { formatObservationId } from '../src/utils/observationId.ts'
const read = path => readFileSync(new URL('../src/' + path, import.meta.url), 'utf8')
const source = read('views/conservation/ConservationDashboardView.vue')
const { descriptor } = parse(source)
const script = compileScript(descriptor, { id: 'overview-test' })
const template = compileTemplate({ source: descriptor.template.content, filename: 'Overview.vue', id: 'overview-test', compilerOptions: { bindingMetadata: script.bindings } })
const transpile = value => ts.transpileModule(value, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const owner = '2ace382f-1111-4111-8111-111111111111'
const seed = () => ({
  observations: ['Pending Review','Pending Review','Flagged','Correction Required','Pending Review','Approved','Rejected','Draft'].map((status,index)=>({id:`4451e4cb-${String(index).padStart(4,'0')}-4000-8000-000000000001`,plant_id:18,revision:3,species_id:1,owner_subject:`staff:${index ? '2ace382f-2222-4222-8222-222222222222' : owner}`,status,origin_type:['initial_registration','subsequent_observation','initial_registration','subsequent_observation','unknown','initial_registration','subsequent_observation','subsequent_observation'][index],scientific_name:'Shorea macrophylla'})),
  species: ['Not Assessed','Least Concern','Near Threatened','Vulnerable','Endangered','Critically Endangered'].map((conservation_status,index)=>({species_id:index+1,scientific_name:'Shorea '+index,conservation_status})),
  plants: [
    {plant_id:18,species_id:1,registered_subject:`staff:${owner}`,rbac_status:'Approved',registered_at:'2026-11-05T03:44:00Z',latitude:0,longitude:0,observed_at:null},
    {plant_id:19,species_id:2,registered_subject:'staff:2ace382f-2222-4222-8222-222222222222',rbac_status:'Pending Review',registered_at:'2026-11-04T03:00:00Z',latitude:4,longitude:114},
    {plant_id:20,species_id:3,registered_subject:null,rbac_status:'Approved',registered_at:null,latitude:999,longitude:0},
    {plant_id:21,species_id:4,rbac_status:'Approved',registered_at:'2026-11-03T03:00:00Z',latitude:4,longitude:114,observed_at:'2026-11-04T12:00:00+08:00'},
    {plant_id:22,species_id:5,rbac_status:'Rejected',registered_at:'2026-11-02T03:00:00Z'},
  ],
  alerts:[{alert_id:1,plant_id:18,alert_type:'Temperature',severity:'high',status:'New',created_at:'2026-11-05T00:00:00Z'},{alert_id:2,plant_id:21,alert_type:'Movement',severity:'medium',status:'Resolved',created_at:'2026-11-04T00:00:00Z'}],
})
function nodes(root) { const all=[];const walk=node=>{if(Array.isArray(node))return node.forEach(walk);if(!node||typeof node!=='object')return;all.push(node);if(Array.isArray(node.children))walk(node.children);else if(node.children?.default)walk(node.children.default())};walk(root);return all }
const text = root => nodes(root).filter(node=>node.type!==vue.Comment).map(node=>typeof node.children==='string'?node.children:'').join(' ')
function harness(language='en',data=seed()) {
  const messages=JSON.parse(read(`locales/${language}.json`)),locale=vue.ref(language),calls=[],routes=[],cleanups=[]
  const resolve=key=>key.split('.').reduce((value,part)=>value?.[part],messages)
  let listener,unsubscribed=false,session={pending:false,user:{id:owner,name:'Authorized Officer',role:'Conservation Officer',status:'Active',mustChangePassword:false}}
  const context={exports:{},Error,AbortSignal,console,fetch:async(url,options)=>{calls.push({url,options});const key=url.includes('/iot/')?'alerts':url.includes('/observations')?'observations':url.includes('/plants')?'plants':'species';return Response.json({[key]:data[key]})},require(name){
    if(name==='vue')return{...vue,onMounted(){},onBeforeUnmount:fn=>cleanups.push(fn),resolveComponent:name=>name}
    if(name==='vue-router')return{useRouter:()=>({push:value=>routes.push(value)})}
    if(name==='vue-i18n')return{useI18n:()=>({locale,te:key=>typeof resolve(key)==='string',t:(key,params={})=>Object.entries(params).reduce((value,[key,item])=>value.replaceAll('{'+key+'}',String(item)),resolve(key)||key)})}
    if(name.endsWith('/observationReview'))return reviewRules
    if(name.endsWith('/reviewSpeciesRequest'))return speciesRequestRules
    if(name.endsWith('/auth'))return{sessionSnapshot:()=>session,subscribeSession:fn=>{listener=fn;return()=>{unsubscribed=true}}}
    if(name.endsWith('observationQueue'))return{observationOrigin}
    if(name.endsWith('officerMonitoringDisplay'))return{monitoringDate,monitoringLabels}
    if(name.endsWith('plantId'))return{formatPlantId}
    if(name.endsWith('observationId'))return{formatObservationId}
    if(name.endsWith('.vue'))return{__esModule:true,default:{name:name.split('/').at(-1).replace('.vue','')}}
    throw Error(name)
  }}
  vm.runInNewContext(`(function(){${transpile(script.content)}})()`,context)
  const scope=vue.effectScope(),state=scope.run(()=>context.exports.default.setup({}, {expose(){}}))
  vm.runInNewContext(`(function(){${transpile(template.code)}})()`,context)
  return{state,calls,routes,render:()=>context.exports.render({},[],{},vue.proxyRefs(state),{},{}),async load(){await Promise.all([state.loadObservations(),state.loadPlants(),state.loadSpecies(),state.loadAlerts()]);await vue.nextTick()},session(user,pending=false){session={user,pending};listener(user,pending)},stop(){cleanups.forEach(fn=>fn());scope.stop();assert.ok(unsubscribed)}}
}

test('Overview keeps all six loaded count sources, removes per-card explanations and the two requested visible scope notes',async()=>{
  assert.deepEqual(template.errors,[])
  const h=harness();try{
    await h.load();assert.deepEqual(Array.from(h.state.summaries.value,card=>card[1]),[6,5,5,2,1,8])
    assert.equal(h.state.pending.value.length,4);assert.equal(h.state.recentPlants.value.length,4)
    const tree=nodes(h.render()),cards=tree.filter(node=>node.type==='article'&&node.props?.class==='summary-card')
    assert.equal(cards.length,6);assert.ok(cards.every(card=>!nodes(card).some(node=>node.type==='small')))
    assert.ok(cards.some(card=>text(card).includes('Observations')));assert.ok(!text(h.render()).includes('Loaded Observations'))
    assert.equal(tree.filter(node=>node.props?.class==='summary-scope').length,0)
    assert.equal(text(h.render()).split('Counts reflect loaded records.').length-1,1);assert.ok(!text(h.render()).includes('Approved plants with valid coordinates'))
    assert.deepEqual(h.calls.map(call=>call.url).sort(),['/api/iot/alerts','/api/observations','/api/plants','/api/species?scope=scientific'].sort())
    assert.ok(h.calls.every(call=>!call.options.method||call.options.method==='GET'))
  }finally{h.stop()}
})

test('compact Observation IDs are collision-safe across the loaded collection and review navigation retains original UUIDs',async()=>{
  const h=harness();try{
    await h.load();const labels=h.state.observationDisplayLabels.value
    assert.equal(new Set(labels.values()).size,8);assert.equal(labels.get(seed().observations[0].id),'OBS-4451E4CB0000')
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

test('submitter and registered-by display uses only this authorized session name, with compact fallback and raw copy props',async()=>{
  const h=harness();try{
    await h.load();const raw=`staff:${owner}`,other=seed().observations[1].owner_subject
    assert.equal(h.state.subjectLabels.value.get(raw),'Authorized Officer')
    assert.match(h.state.subjectLabels.value.get(other),/^Staff .*2ACE382F2222$/)
    const components=nodes(h.render()).filter(node=>node.type?.name==='MonitoringIdentifier')
    assert.ok(!components.some(node=>node.props.value===raw),'self-owned observations are not actionable previews');assert.ok(components.some(node=>node.props.value===other))
    h.session({id:owner,name:'Do not expose',role:'Botanist',status:'Active',mustChangePassword:false})
    assert.ok(!h.state.subjectLabels.value.get(raw).includes('Do not expose'))
    h.session(null);assert.match(h.state.subjectLabels.value.get(raw),/^Staff /)
    assert.equal(h.calls.length,4,'no staff directory/account lookup added')
  }finally{h.stop()}
})

test('Pending Observations uses only the subsequent-observation preview and remains independent of plant-list errors',async()=>{
  const h=harness();try{
    await h.load()
    const table=nodes(h.render()).find(node=>node.type==='table'&&node.props.class.includes('field-observations-table'))
    assert.deepEqual(nodes(table).filter(node=>node.type==='th').map(text),['Observation ID','Plant ID','Species','Submitted By','Status','Action'])
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
    assert.ok(tree.some(node=>String(node.props?.class).includes('alert-severity-badge high')))
  }finally{h.stop()}
})

test('loading, successful empty data and errors remain distinct without invented counts or dates',async()=>{
  const h=harness('en',{observations:[],plants:[],species:[],alerts:[]});try{
    assert.equal(h.state.summaries.value[0][1],'\u2014')
    await h.load();assert.ok(h.state.summaries.value.every(card=>card[1]===0));assert.ok(text(h.render()).includes('No pending plant registrations in loaded records.')&&text(h.render()).includes('No pending field observations in loaded records.'))
    h.state.observationsError.value='Unavailable';assert.equal(h.state.summaries.value[2][1],'\u2014');assert.ok(text(h.render()).includes('Unavailable'))
  }finally{h.stop()}
})

test('Overview labels, table headings and shortcuts localize consistently in English, Malay and Chinese',async()=>{
  for(const language of ['en','ms','zh-CN']){
    const h=harness(language);try{
      await h.load();const data=JSON.parse(read(`locales/${language}.json`)).conservationDashboard
      assert.ok(text(h.render()).includes(data.summary.recentObservations));assert.equal(text(h.render()).split(data.countScope).length-1,1);assert.ok(!text(h.render()).includes(data.approvedMapRecords))
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
  assert.equal((source.match(/<th scope="col">/g)||[]).length,11)
  const scrolling=rules.find(rule=>rule.selector.endsWith('.overview-table-scroll'));assert.equal(declarations(scrolling)['overflow-x'],'auto');assert.equal(declarations(scrolling)['min-width'],'0')
  assert.ok(rules.some(rule=>rule.selector.includes('.field-observations-table) .badge.pending-review')&&declarations(rule).background==='#e8eff2'))
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
    assert.deepEqual(nodes(table).filter(node=>node.type==='th').map(text),['Plant ID','Species','Submitted By','Status','Action'])
    assert.deepEqual(nodes(table).filter(node=>node.type==='col').slice(0,2).map(node=>node.props.class),['overview-plant','overview-species'])
    const row=nodes(table).find(node=>node.type==='tr'&&node.key===seed().observations[2].id)
    assert.equal(nodes(row).filter(node=>node.type==='td')[0].children,'PL018')
    assert.equal(h.state.pending.value.length,4);assert.ok(h.state.pending.value.some(item=>item.status==='Flagged'));assert.ok(h.state.pending.value.some(item=>item.status==='Correction Required'))
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

test('initial and subsequent previews use actionable review statuses, cap independently and keep the broader KPI unchanged',async()=>{
  const h=harness();try{
    await h.load()
    const statuses=['Pending Review','Correction Required','Flagged','Pending Review','Flagged','Approved','Rejected','Draft']
    const rows=['initial_registration','subsequent_observation'].flatMap(origin_type=>statuses.map((status,index)=>({id:String((origin_type==='initial_registration'?100:200)+index),plant_id:18,revision:3,species_id:1,owner_subject:'staff:actor',origin_type,status,scientific_name:'Test species'})))
    for(const origin_type of [undefined,'unknown','initial','INITIAL_REGISTRATION'])rows.push({id:'legacy-'+String(origin_type),plant_id:18,status:'Pending Review',origin_type})
    h.state.observations.value=rows
    assert.equal(h.state.pendingRegistrations.value.length,4);assert.equal(h.state.pendingFieldObservations.value.length,4)
    for(const[queue,origin]of [[h.state.pendingRegistrations.value,'initial_registration'],[h.state.pendingFieldObservations.value,'subsequent_observation']]){
      assert.ok(queue.every(item=>item.origin_type===origin))
      assert.ok(queue.some(item=>item.status==='Pending Review'));assert.ok(!queue.some(item=>item.status==='Correction Required'));assert.ok(queue.some(item=>item.status==='Flagged'))
      assert.ok(!queue.some(item=>['Approved','Rejected','Draft'].includes(item.status)))
    }
    const registrationIds=new Set(h.state.pendingRegistrations.value.map(item=>item.id))
    assert.ok(h.state.pendingFieldObservations.value.every(item=>!registrationIds.has(item.id)))
    assert.ok([...h.state.pendingRegistrations.value,...h.state.pendingFieldObservations.value].every(item=>!item.id.startsWith('legacy-')))
    assert.equal(h.state.summaries.value.find(card=>card[0]==='pendingReviews')[1],14,'global KPI keeps all loaded review-required origins, independent of preview caps')
    const tables=nodes(h.render()).filter(node=>node.type==='table')
    assert.equal(tables.length,2);assert.ok(tables.every(table=>nodes(table).filter(node=>node.type==='tr'&&node.key).length===4))
  }finally{h.stop()}
})

test('conflicting duplicate origin classifications are excluded from both queues rather than guessed',async()=>{
  const h=harness();try{
    await h.load()
    h.state.observations.value=[
      {id:'conflict',plant_id:18,status:'Pending Review',origin_type:'initial_registration'},
      {id:'conflict',plant_id:18,status:'Pending Review',origin_type:'subsequent_observation'},
      {id:'321',plant_id:18,revision:3,species_id:1,owner_subject:'staff:actor',scientific_name:'Test species',status:'Flagged',origin_type:'subsequent_observation'},
      {id:'321',plant_id:18,revision:3,species_id:1,owner_subject:'staff:actor',scientific_name:'Test species',status:'Flagged',origin_type:'subsequent_observation'},
    ]
    assert.equal(h.state.pendingRegistrations.value.length,0)
    assert.deepEqual(Array.from(h.state.pendingFieldObservations.value,item=>item.id),['321'])
  }finally{h.stop()}
})

test('both review sections use observation loading/error states and keep their existing safe navigation destinations',async()=>{
  const h=harness();try{
    assert.equal(text(h.render()).split('Loading observations...').length-1,2)
    await h.load()
    const panels=nodes(h.render()).filter(node=>node.type==='section'&&String(node.props?.class).includes('panel'))
    assert.ok(text(panels[0]).includes('Pending Plant Registrations'));assert.ok(!text(panels[0]).includes('Observation ID'))
    assert.ok(text(panels[1]).includes('Pending Observations'));assert.ok(text(panels[1]).includes('Field Records'))
    nodes(panels[0]).find(node=>node.type==='button'&&text(node).includes('View All Submissions')).props.onClick()
    nodes(panels[1]).find(node=>node.type==='button'&&text(node).includes('View All Observations')).props.onClick()
    assert.equal(h.routes[0].name,'conservation-reviews');assert.equal(h.routes[1].name,'conservation-observations')
    h.state.observationsError.value='Observation source unavailable'
    assert.equal(nodes(h.render()).filter(node=>node.type==='table').length,0)
    assert.equal(text(h.render()).split('Observation source unavailable').length-1,2)
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
  const pendingRequest={request_id:9,request_status:'Pending Review',requested_by:'staff:request-owner',proposed_scientific_name:'New species'}
  for(const changes of [{},{status:'Flagged'},{status:'Correction Required'},{status:'Draft'},{status:'Rejected'},{status:'Approved'},{revision:0},{revision:undefined},{owner_subject:`staff:${owner}`},{owner_subject:''},{species_id:undefined},{scientific_name:''},{species_request_id:9},{species_request_id:9,species_request:pendingRequest},{species_request_id:9,species_request:{...pendingRequest,requested_by:`staff:${owner}`}},{species_request_id:9,species_request:{...pendingRequest,requested_by:''}},{origin_type:'subsequent_observation',species_request_id:9,species_request:pendingRequest}]){
   const row={...base,...changes};h.state.observations.value=[row]
   const eligible=['Pending Review','Flagged'].includes(row.status)&&row.revision===3&&row.owner_subject==='staff:actor'&&Boolean(row.species_id&&row.scientific_name)&&(!row.species_request_id||row.species_request?.requested_by==='staff:request-owner'&&row.origin_type==='initial_registration')
   assert.equal(h.state.pendingRegistrations.value.length+h.state.pendingFieldObservations.value.length,eligible?1:0,JSON.stringify(changes))
  }
  h.state.observations.value=[base]
  for(const user of [null,{id:owner,role:'Botanist',status:'Active',mustChangePassword:false},{id:owner,role:'Conservation Officer',status:'Inactive',mustChangePassword:false},{id:owner,role:'Conservation Officer',status:'Active',mustChangePassword:true}]){h.session(user);assert.equal(h.state.pendingRegistrations.value.length,0)}
 }finally{h.stop()}
})
test('every eligible row action preserves its full authoritative ID and the scope note appears only once outside the cards',async()=>{
 const h=harness();try{
  await h.load();const tree=nodes(h.render()),tables=tree.filter(n=>n.type==='table')
  for(const table of tables)for(const row of nodes(table).filter(n=>n.type==='tr'&&n.key)){
   nodes(row).find(n=>n.type==='button').props.onClick();const target=h.routes.at(-1)
   if(table.props.class.includes('field-observations-table')){assert.equal(target.name,'conservation-observations');assert.equal(target.query.observation,row.key)}else{assert.equal(target.name,'conservation-reviews');assert.equal(target.query.review,row.key)}
  }
  assert.equal(tree.filter(n=>n.props?.class==='statistics-scope').length,1)
  const cards=tree.filter(n=>n.type==='article'&&n.props?.class==='summary-card');assert.equal(cards.length,6)
  assert.ok(cards.every(card=>!text(card).includes('loaded records')&&!nodes(card).some(n=>n.type==='small')))
  assert.equal(h.calls.length,4)
 }finally{h.stop()}
})
