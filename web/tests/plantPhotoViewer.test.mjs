import { workflowBadgeStyle } from '../src/utils/workflowBadge.ts'
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { formatPlantDateTime } from '../src/utils/plantDateTime.ts'
import { createPlantHistory } from '../src/services/plantHistory.ts'
const js = text => ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
function nodes(value) {const out=[];function walk(n){if(Array.isArray(n))return n.forEach(walk);if(!n||typeof n!=='object')return;out.push(n);if(Array.isArray(n.children))walk(n.children)}walk(value);return out}
function text(value) { return typeof value === 'string' ? value : Array.isArray(value) ? value.map(text).join('') : value && typeof value === 'object' ? text(value.children) : '' }
function component(name, props = {}) {
  const source=readFileSync(new URL('../src/components/'+name+'.vue',import.meta.url),'utf8'),{descriptor}=parse(source)
  const script=compileScript(descriptor,{id:name}),template=compileTemplate({source:descriptor.template.content,filename:name+'.vue',id:name,compilerOptions:{bindingMetadata:script.bindings}})
  const scope=vue.effectScope(),exports={},events=[],document={body:{style:{overflow:'auto'}}},cleanup=[]
  const context={exports,document,require(name) {
    if (name.endsWith('workflowBadge')) return { workflowBadgeStyle }
    if(name==='vue')return {...vue,onBeforeUnmount:fn=>cleanup.push(fn)}
    if(name.endsWith('useConservationText'))return {useConservationText:()=>({ct:x=>x,dt:x=>x})}
    if(name.endsWith('plantDateTime'))return {formatPlantDateTime}
    if(name.endsWith('.vue'))return {name}
    throw Error(name)
  }}
  vm.runInNewContext(`(function(){${js(script.content)}})()`,context)
  const reactive=vue.reactive(props),state=scope.run(()=>exports.default.setup(reactive,{expose(){},emit:e=>events.push(e)}))
  vm.runInNewContext(`(function(){${js(template.code)}})()`,context)
  return {state,props:reactive,events,document,render:()=>nodes(exports.render({$emit:e=>events.push(e)},[],reactive,vue.proxyRefs(state),{},{})),stop(){cleanup.forEach(fn=>fn());scope.stop()}}
}
test('shared lightbox supports wrapping keyboard navigation, unavailable photos, Escape and focus restoration', async () => {
  const h=component('PlantPhotoLightbox'),focused=[]
  const dialog={open:false,showModal(){this.open=true},close(){this.open=false}}
  h.state.dialog.value=dialog;h.state.closeButton.value={focus:()=>focused.push('close')}
  const trigger={isConnected:true,focus:()=>focused.push('trigger')},photos=[{id:'a',url:'/a'},{id:'b',url:'/b'}]
  try {
    await h.state.open(photos,0,'Registration',trigger)
    assert.equal(dialog.open,true);assert.equal(h.document.body.style.overflow,'hidden');assert.deepEqual(focused,['close'])
    let prevented=0;const key=key=>h.state.keydown({key,preventDefault:()=>prevented++})
    key('ArrowRight');assert.equal(h.state.active.value.id,'b')
    key('ArrowRight');assert.equal(h.state.active.value.id,'a')
    key('ArrowLeft');assert.equal(h.state.active.value.id,'b')
    h.state.imageFailed({currentTarget:{getAttribute:()=>'/b'}});await vue.nextTick()
    assert.ok(h.render().some(n=>n.children==='Photo unavailable'))
    key('ArrowRight');await vue.nextTick();assert.ok(h.render().some(n=>n.type==='img'&&n.props.src==='/a'))
    key('Escape');assert.equal(dialog.open,false);assert.equal(h.document.body.style.overflow,'auto');assert.equal(focused.at(-1),'trigger');assert.equal(h.state.photos.value.length,0)
    assert.equal(prevented,5)
  } finally {h.stop()}
})
test('lightbox teardown restores scrolling and invalidates an opening modal on logout', async () => {
  const h=component('PlantPhotoLightbox');let opened=false
  h.state.dialog.value={open:false,showModal(){opened=true},close(){}}
  const work=h.state.open([{id:'a',url:'/a'}],0,'Photo',{isConnected:false,focus(){throw Error('detached')}})
  h.stop();await work;assert.equal(opened,false);assert.equal(h.document.body.style.overflow,'auto')
})
const observation=(id,origin)=>({id,plant_id:'1',origin,date:'2026-11-03T05:31:37.284Z',recorded_by:null,status:'Correction Required',content:{heightCm:null,healthStatus:null,lifeStage:null,morphology:null,notes:null,latitude:null,longitude:null,accuracy_m:null,altitude_m:null,zone:null},assets:[{id:'photo-'+id,url:'/photo-'+id}],review:null})
test('expandable history hides verified registration rows and retains subsequent/unknown details and photos', async () => {
  const h=component('PlantObservationHistory',{observations:[observation('initial','initial_registration'),observation('field','subsequent_observation'),observation('legacy','unknown')],loading:false,error:'',complete:false,hasMore:true})
  try {
    const tree=h.render();assert.equal(tree.filter(n=>n.type==='details').length,2)
    assert.deepEqual(tree.filter(n=>n.type==='img').map(n=>n.props.src),['/photo-field','/photo-legacy'])
    assert.ok(!tree.some(n=>n.children==='Registration photos appear in the gallery above.'))
    assert.ok(tree.some(n=>n.children==='More history pages are available. This is not the complete history.'))
    assert.ok(tree.some(n=>n.children==='Origin not verified'))
    assert.match(text(tree.find(n=>n.props?.class==='history-heading')), /2 observations loaded/)
    const opened=[];h.state.lightbox.value={open:(...args)=>opened.push(args)}
    tree.find(n=>n.type==='button'&&n.props?.['aria-label']?.startsWith('Enlarge observation photo')).props.onClick({currentTarget:{}})
    assert.equal(opened[0][0].length,1);assert.equal(opened[0][0][0].id,'photo-field')
    assert.ok(!tree.some(n=>n.type==='input'||n.type==='select'))
    tree.find(n=>n.type==='button'&&n.children==='Load more observations').props.onClick();assert.deepEqual(h.events,['more'])
  } finally {h.stop()}
})

test('excluded registration-only pages keep continuation and visible counts until history is exhausted', async () => {
  const toApi = row => ({...row,assets:row.assets.map(a=>({id:a.id,content_type:'image/jpeg'}))})
  const pages = [Response.json({plant_id:'1',observations:[toApi(observation('initial','initial_registration'))],page:{limit:20,has_more:true,next_cursor:'next'}}),
    Response.json({plant_id:'1',observations:[toApi(observation('legacy','unknown')),toApi(observation('field','subsequent_observation'))],page:{limit:20,has_more:false,next_cursor:null}})]
  const calls = [], history = createPlantHistory({transport:async url=>{calls.push(url);return pages.shift()}})
  await history.load('1')
  const h = component('PlantObservationHistory',{observations:history.state.observations,loading:false,error:'',complete:history.state.complete,hasMore:history.state.hasMore})
  try {
    assert.equal(h.render().filter(n=>n.type==='details').length,0)
    assert.ok(!h.render().some(n=>n.props?.class==='empty-history'))
    assert.ok(h.render().some(n=>n.children==='No subsequent or unclassified observations are loaded yet. More pages remain.'))
    h.render().find(n=>n.type==='button'&&n.children==='Load more observations').props.onClick();assert.deepEqual(h.events,['more'])
    await history.load('1',true)
    h.props.observations=history.state.observations;h.props.complete=history.state.complete;h.props.hasMore=history.state.hasMore;await vue.nextTick()
    assert.ok(calls[1].includes('cursor=next'));assert.equal(history.state.observations.length,3,'presentation never removes the stored registration from the controller')
    assert.equal(h.render().filter(n=>n.type==='details').length,2)
    assert.match(text(h.render().find(n=>n.props?.class==='history-heading')), /2 observations$/)
    assert.ok(!h.render().some(n=>n.type==='button'&&n.children==='Load more observations'))
    h.props.observations=[observation('initial','initial_registration')];await vue.nextTick()
    assert.ok(h.render().some(n=>n.props?.class==='empty-history'&&n.children==='No subsequent or unclassified observations are available for this plant.'))
    assert.ok(!text(h.render().find(n=>n.props?.class==='history-heading')).includes('1 observations'))
  } finally {h.stop();history.reset()}
})

test('history dates, review dates and enlargement captions share Malaysia formatting and safe unavailable states', async () => {
  const row={...observation('field','unknown'),recorded_by:'Real Botanist',review:{decision:'Rejected',comment:'Reason',created_at:'2026-11-04T16:12:59.398Z'}}
  const h=component('PlantObservationHistory',{observations:[row],loading:false,error:'',complete:true,hasMore:false})
  try {
    const tree=h.render()
    assert.ok(tree.some(n=>n.children==='Nov 3, 2026, 13:31'));assert.ok(tree.some(n=>n.type==='strong'&&n.children==='Rejected · Nov 5, 2026, 00:12'))
    assert.ok(text(tree.find(n=>n.type==='summary')).includes('Real Botanist'))
    const opened=[];h.state.lightbox.value={open:(...args)=>opened.push(args)}
    tree.find(n=>n.type==='button'&&n.props?.['aria-label']?.startsWith('Enlarge observation photo')).props.onClick({currentTarget:{}})
    assert.equal(opened[0][2],'Observation · Nov 3, 2026, 13:31')
    h.props.observations=[{...row,date:null,review:{...row.review,created_at:'invalid'}}];await vue.nextTick()
    assert.ok(h.render().some(n=>n.type==='strong'&&n.children==='Unavailable'))
    assert.ok(h.render().some(n=>n.type==='strong'&&n.children==='Rejected · Unavailable'))
  } finally {h.stop()}
})
