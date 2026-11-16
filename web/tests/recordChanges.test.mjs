import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { workflowBadgeStyle } from '../src/utils/workflowBadge.ts'
import { comparisonEqual, compareChange, readCompleteQueue, unifiedReviewRows, changeMatches } from '../src/services/recordChanges.ts'
const id='12345678-1234-1234-1234-123456789abc'
const proposal={id,plant_id:24,species_id:null,owner_subject:'staff:bot',status:'Pending Review',created_at:'2026-11-14T00:00:00Z',base_snapshot:{scientific_name:'Approved name',photo_ids:['fixture-asset'],content:{heightCm:12,notes:'Retained'}},proposed_snapshot:{scientific_name:'Proposed name',content:{heightCm:18}},proposal_photo_count:1}
const flush=async()=>{await new Promise(resolve=>setImmediate(resolve));await vue.nextTick()}
const text=node=>node.text||node.children?.map(text).join(' ')||''
const nodes=(node,predicate)=>[...(predicate(node)?[node]:[]),...(node.children||[]).flatMap(child=>nodes(child,predicate))]
async function harness(language='en', overrides={}, fetchHandler=async()=>Response.json({})) {
  const route=vue.reactive({query:{}}),calls=[]
  const messages=JSON.parse(readFileSync(new URL('../src/locales/'+language+'.json',import.meta.url),'utf8'))
  const translate=key=>key.split('.').reduce((value,key)=>value?.[key],messages)||key
  let latest={...proposal,...overrides},fail=false,sessionChanged
  const request=async(path='',body)=>{
    calls.push({path,body})
    if(body) {if(fail)throw Object.assign(Error('Competing decision'),{status:409});latest={...latest,status:body.decision};return {change:latest}}
    return path.startsWith('?')?{changes:[latest,{...latest,id:'species-proposal',plant_id:null,species_id:6}],page:{has_more:false,next_cursor:null}}:{change:latest}
  }
  const source=readFileSync(new URL('../src/components/conservation/ApprovedRecordChanges.vue',import.meta.url),'utf8')
  const {descriptor}=parse(source),script=compileScript(descriptor,{id:'changes-test'})
  const template=compileTemplate({source:descriptor.template.content,filename:'ApprovedRecordChanges.vue',id:'changes-test',compilerOptions:{bindingMetadata:script.bindings}})
  const exports={},context={exports,AbortSignal,URLSearchParams,fetch:fetchHandler,require(name){
    if(name==='vue')return {...vue,vModelText:{},vModelSelect:{}}
    if(name==='vue-i18n')return {useI18n:()=>({t:translate,te:key=>translate(key)!==key})}
    if(name.endsWith('workflowBadge'))return {workflowBadgeStyle}
    if(name.endsWith('MonitoringIdentifier.vue'))return {props:['value'],setup(props){return ()=>vue.h('span',{},String(props.value))}}
    if(name.endsWith('PlantPhotoLightbox.vue'))return {setup(_props,{expose}){expose({open(){},close(){}});return ()=>null}}
    if(name.endsWith('officerMonitoringDisplay'))return {reviewDateTime:value=>value}
    if(name.endsWith('AppModal.vue'))return {setup(_props,{slots}){return ()=>vue.h('section',{},slots.default?.())}}
    if(name==='vue-router')return {useRoute:()=>route,useRouter:()=>({replace:async({query})=>{route.query=query}})}
    if(name.endsWith('/auth'))return {sessionSnapshot:()=>({user:{id:'officer',role:'Conservation Officer',status:'Active',mustChangePassword:false},pending:false}),subscribeSession:callback=>{sessionChanged=callback;return ()=>{}}}
    return {changeApi:'/api/data/record-changes',changeRequest:request,compareChange}
  }}
  for(const code of [script.content,template.code])vm.runInNewContext('(function(){'+ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText+'})()',context)
  exports.default.render=exports.render
  const make=tag=>({tag,children:[],props:{},text:'',showModal(){this.open=true},close(){this.open=false}})
  const renderer=vue.createRenderer({createElement:make,createText:text=>({...make('text'),text}),createComment:()=>make('comment'),setText:(n,t)=>n.text=t,setElementText:(n,t)=>{n.text=t;n.children=[]},parentNode:n=>n.parent,nextSibling:n=>n?.parent?.children[n.parent.children.indexOf(n)+1]||null,patchProp:(n,k,_old,v)=>n.props[k]=v,insert:(n,p,anchor)=>{if(n.parent)n.parent.children=n.parent.children.filter(c=>c!==n);n.parent=p;const i=anchor?p.children.indexOf(anchor):-1;if(i<0)p.children.push(n);else p.children.splice(i,0,n)},remove:n=>{if(n?.parent)n.parent.children=n.parent.children.filter(child=>child!==n)}})
  const root=make('root'),app=renderer.createApp(exports.default);app.mount(root);await flush()
  return {root,calls,route,app,expire:()=>sessionChanged(null,true),setConflict:()=>fail=true,complete:(status='Approved')=>{fail=false;latest={...latest,status}},button:label=>nodes(root,n=>n.tag==='button'&&text(n).trim()===label).at(-1)}
}
test('comparisons retain omitted fields, expose true changed values and never fabricate missing baseline',()=>{
  const rows=compareChange({...proposal,proposed_snapshot:{...proposal.proposed_snapshot,new_field:'new'}})
  assert.deepEqual(rows.find(r=>r.key==='heightCm'),{key:'heightCm',before:12,after:18,changed:true})
  assert.equal(rows.find(r=>r.key==='notes').changed,false)
  assert.equal(rows.find(r=>r.key==='new_field').before,undefined)
})
test('shared proposal dialog preserves comparisons and photos; conflict blocks decisions until explicit reload, and completed proposal is read only',async()=>{
  const h=await harness()
  try {
    assert.equal(h.calls.length,0,'dialog does not render or fetch another queue')
    h.route.query={change:id};await flush()
    assert.match(text(h.root),/Approved name/);assert.match(text(h.root),/Proposed name/)
    const sources=nodes(h.root,n=>n.tag==='img').map(n=>n.props.src)
    assert.ok(sources.includes('/api/data/assets/fixture-asset'));assert.ok(sources.includes('/api/data/record-changes/'+id+'/photos/0'))
    await h.button('Approve Change').props.onClick();await flush()
    assert.match(text(h.root),/Enter a review comment/);assert.equal(h.calls.some(c=>c.body),false)
    const textarea=nodes(h.root,n=>n.tag==='textarea')[0];textarea.props['onUpdate:modelValue']('Keep this comment');await flush()
    h.setConflict();await h.button('Approve Change').props.onClick();await flush()
    assert.equal(h.button('Approve Change').props.disabled,true);assert.match(text(h.root),/Reload Latest Proposal/)
    h.complete();await h.button('Reload Latest Proposal').props.onClick();await flush()
    assert.match(text(h.root),/complete and read-only/);assert.equal(h.button('Approve Change'),undefined)
    assert.equal(h.calls.filter(c=>c.body).length,1,'no automatic retry')
    h.expire();await flush();assert.doesNotMatch(text(h.root),/Approved name|Proposed name/)
  } finally {h.app.unmount()}
})

test('complete queues reject repeated cursors and failed later pages instead of reporting partial results',async()=>{
  await assert.rejects(()=>readCompleteQueue(async()=>({rows:[1],more:true,cursor:'repeat'})),/continuation/)
  let calls=0
  await assert.rejects(()=>readCompleteQueue(async()=>++calls===1?{rows:[1],more:true,cursor:'next'}:Promise.reject(Error('offline'))),/offline/)
  const rows=unifiedReviewRows([{id:proposal.id,createdAt:proposal.created_at,speciesRequest:null}],[proposal,proposal])
  assert.equal(rows.length,2,'canonical identifiers are namespaced by entity type')
  assert.equal(new Set(rows.map(row=>row.key)).size,2)
  assert.equal(changeMatches({...proposal,status:'Cancelled'},{search:'',status:'Pending Review',species:'',date:''},value=>value.slice(0,10)),false)
})
test('cancelled proposals are read-only after explicit reload and proposal dialog is localized in all languages',async()=>{
  for(const language of ['en','ms','zh-CN']) {
    const labels=JSON.parse(readFileSync(new URL('../src/locales/'+language+'.json',import.meta.url),'utf8')).approvedChanges
    const h=await harness(language)
    try {
      h.complete('Cancelled');h.route.query={change:id};await flush()
      assert.ok(text(h.root).includes(labels.readOnly));assert.ok(text(h.root).includes(labels.cancelled))
      assert.equal(h.button(labels.approve),undefined);assert.equal(h.button(labels.reject),undefined)
      assert.equal(h.calls.filter(c=>c.body).length,0)
      h.route.query={review:'original-observation'};await flush();assert.doesNotMatch(text(h.root),/Approved name|Proposed name/)
    } finally {h.app.unmount()}
  }
})

test('comparison equality ignores object key ordering and numeric display formatting without erasing empty, null, zero or false',()=>{
  assert.equal(comparisonEqual({a:1,b:{x:2,y:3}},{b:{y:3,x:2},a:1}),true)
  assert.equal(comparisonEqual('12.00',12,'heightCm'),true)
  assert.equal(comparisonEqual('line\r\nnext','line\nnext','notes'),true)
  for(const [before,after] of [[null,''],[undefined,null],[0,false],['',0],[false,'false']]) assert.equal(comparisonEqual(before,after,'heightCm'),false)
  assert.equal(comparisonEqual([1,2],[2,1]),false)
})
test('polished modal renders derived summary, changed rows, photo retention and masked technical data',async()=>{
  const h=await harness()
  try {
    h.route.query={change:id};await flush()
    assert.match(text(h.root),/Change summary/);assert.match(text(h.root),/Changed fields: 2/)
    const changed=nodes(h.root,n=>n.tag==='tr'&&n.props.class?.includes('changed'))
    assert.equal(changed.length,2)
    assert.ok(changed.every(row=>nodes(row,n=>n.props.class==='changed-badge').length===1))
    assert.ok(nodes(h.root,n=>n.props.class==='photograph-panels').length===1)
    assert.match(text(h.root),/photos requested for removal/)
    assert.ok(nodes(h.root,n=>n.tag==='button'&&n.props.class==='reject-change').length)
    assert.ok(nodes(h.root,n=>n.tag==='button'&&n.props.class==='approve-change').length)
    assert.ok(!text(h.root).includes('fixture-asset'),'raw retained-photo identifiers are absent from the normal form')
  } finally {h.app.unmount()}
})

test('no-new-photo proposals show retained counts and never reveal operational QR tokens',async()=>{
  const h=await harness('en',{proposal_photo_count:0,base_snapshot:{...proposal.base_snapshot,qr_token:'fixture-hidden-operation'},proposed_snapshot:{...proposal.proposed_snapshot,qr_token:'fixture-hidden-operation',photo_ids:['fixture-asset']}})
  try {
    h.route.query={change:id};await flush()
    assert.match(text(h.root),/1 retained photos/);assert.doesNotMatch(text(h.root),/photos requested for removal/)
    assert.doesNotMatch(text(h.root),/fixture-hidden-operation/);assert.match(text(h.root),/Hidden operational value/)
    assert.ok(nodes(h.root,n=>n.tag==='details'&&n.props.class==='technical-details').length)
  } finally {h.app.unmount()}
})


test('species baseline photograph matches the recorded fingerprint rather than an adjacent rejected version',async()=>{
  const fingerprint='a'.repeat(64);
  for (const available of [true,false]) {
    const h=await harness('en',{plant_id:null,species_id:6,base_snapshot:{request_id:73,scientific_name:'Approved species',photo_fingerprint:fingerprint}},async()=>Response.json({versions:[
      {id:'proposal-version',version_number:4,change_id:id,has_species_photo:true,species_photo_fingerprint:'b'.repeat(64)},
      {id:'rejected-version',version_number:3,status:'Rejected',has_species_photo:true,species_photo_fingerprint:'c'.repeat(64)},
      ...(available?[{id:'actual-baseline',version_number:1,status:'Approved',has_species_photo:true,species_photo_fingerprint:fingerprint}]:[])
    ]}));
    try {
      h.route.query={change:id};await flush();await flush();
      const sources=nodes(h.root,n=>n.tag==='img').map(n=>n.props.src);
      assert.equal(sources.includes('/api/data/record-versions/actual-baseline/photo'),available);
      assert.ok(!sources.some(src=>src.includes('rejected-version')));
    } finally {h.app.unmount()}
  }
});
