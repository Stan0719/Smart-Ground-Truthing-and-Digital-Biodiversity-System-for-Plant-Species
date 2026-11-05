import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import {parse,compileScript,compileTemplate} from '@vue/compiler-sfc'
import ts from 'typescript'
import * as vue from 'vue'
import * as integration from '../src/services/plantIntegration.ts'
const file=new URL('../src/views/PlantDetailView.vue',import.meta.url)
const {descriptor}=parse(readFileSync(file,'utf8'))
const script=compileScript(descriptor,{id:'plant-privacy'})
const template=compileTemplate({source:descriptor.template.content,filename:file.pathname,id:'plant-privacy',compilerOptions:{bindingMetadata:script.bindings}})
const js=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const officer={id:'officer',role:'Conservation Officer',status:'Active',mustChangePassword:false}
const publicPlant={plant_id:1,species_id:1}
const privatePlant={...publicPlant,rbac_status:'Approved',registered_subject:'staff:bot',registered_at:'2026-11-01T00:00:00Z',latitude:1,longitude:2,accuracy_m:3,latest_approved:{heightCm:12,notes:'Private notes',taxonomy:{}}}
const species={species_id:1,scientific_name:'Public scientific',common_name:'Public common',genus_name:'Genus',family_name:'Family',description:'Description',habitat:'Private habitat',conservation_status:'Vulnerable',image_url:'/api/assets/approved-image'}
const flush=async()=>{for(let i=0;i<8;i++){await vue.nextTick();await new Promise(setImmediate)}}
function nodes(value){const out=[];function walk(n){if(Array.isArray(n))return n.forEach(walk);if(!n||typeof n!=='object')return;out.push(n);if(Array.isArray(n.children))walk(n.children);else if(n.children?.default)walk(n.children.default())}walk(value);return out}
function harness(initial=null,handler,previous=null){
 const scope=vue.effectScope(),route=vue.reactive({params:{plantId:'PL001'}}),listeners=new Set(),calls=[]
 let verified=initial,pending=false
 const exports={}
 const context={exports,console,require(name){
  if(name==='vue')return {...vue,onMounted(){},onBeforeUnmount(){},resolveComponent:name=>name,withDirectives:n=>n}
  if(name==='vue-router')return {useRoute:()=>route,useRouter:()=>({options:{history:{state:{back:previous}}},resolve(path){const pathname=path.split('?')[0];const names={'/':'home','/species':'species','/conservation/map':'conservation-map','/conservation/observations':'conservation-observations'};return {name:names[pathname]||( /^\/species\/[^/]+$/.test(pathname)?'species-detail':undefined),fullPath:path}}})}
  if(name.endsWith('useConservationText'))return {useConservationText:()=>({ct:x=>String(x),dt:x=>x})}
  if(name.endsWith('/auth'))return {currentUser:async()=>verified,sessionSnapshot:()=>({user:verified,pending}),subscribeSession:fn=>{listeners.add(fn);return()=>listeners.delete(fn)}}
  if(name.endsWith('plantIntegration'))return {...integration,requestPlantApi:async url=>{calls.push(url);if(handler)return handler(url);return url.startsWith('/api/plants/')?{plant:verified?privatePlant:publicPlant}:{species}}}
  if(name.endsWith('.vue'))return {name}
  throw Error(name)
 }}
 vm.runInNewContext(`(function(){${js(script.content)}})()`,context)
 const state=scope.run(()=>exports.default.setup({}, {expose(){}}))
 vm.runInNewContext(`(function(){${js(template.code)}})()`,context)
 return {state,calls,route,change(user,checking=false){verified=user;pending=checking;for(const fn of listeners)fn(user,checking)},render:()=>exports.render({},[],{},vue.proxyRefs(state),{},{}),stop:()=>scope.stop()}
}
test('anonymous detail renders public facts/image and no restricted cards or private requests',async()=>{
 const h=harness();try{await flush();assert.equal(h.state.plant.value.id,'1');const tree=nodes(h.render());
 for(const cls of ['staff-panel','latest-section','history-section','hero-badges'])assert.ok(!tree.some(n=>n.props?.class===cls),cls)
 assert.ok(tree.some(n=>n.children==='Public scientific'));assert.ok(tree.some(n=>n.type==='img'&&n.props.src==='/api/assets/approved-image'))
 assert.ok(!tree.some(n=>n.children==='Private habitat'));assert.ok(!tree.some(n=>n.children==='Vulnerable'))
 assert.deepEqual(h.calls,['/api/plants/1','/api/species/1'])
 }finally{h.stop()}
})
test('verified Officer keeps exact GPS, registration and available observation content',async()=>{
 const h=harness(officer);try{await flush();const tree=nodes(h.render());for(const cls of ['staff-panel','latest-section','history-section','hero-badges'])assert.ok(tree.some(n=>n.props?.class===cls),cls)
 assert.ok(tree.some(n=>n.children==='staff:bot'));assert.ok(tree.some(n=>n.children==='Private notes'));assert.ok(tree.some(n=>n.children==='Vulnerable'));assert.equal(h.state.plant.value.latitude,1)
 }finally{h.stop()}
})
test('logout clears privileged data immediately and late Officer responses cannot restore it',async()=>{
 let resolveOld;let privileged=true
 const h=harness(officer,async url=>{
  if(url.startsWith('/api/plants/'))return privileged?new Promise(resolve=>{resolveOld=resolve}):{plant:publicPlant}
  return {species}
 })
 try{await flush();h.change(null,true);assert.equal(h.state.plant.value,null);assert.equal(h.state.canReadStaff.value,false)
 resolveOld({plant:privatePlant});await flush();assert.equal(h.state.plant.value,null)
 privileged=false;h.change(null);await flush();assert.equal(h.state.plant.value.registeredSubject,'');assert.equal(h.state.plant.value.latitude,null)
 assert.ok(!nodes(h.render()).some(n=>n.props?.class==='staff-panel'))
 }finally{h.stop()}
})
test('account/role changes and failed verification hide old details; Admin denial is preserved',async()=>{
 const h=harness(officer);try{await flush();assert.ok(h.state.plant.value);h.change(null,true);assert.equal(h.state.plant.value,null);await flush();assert.match(h.state.loadError.value,/session/)
 h.change({...officer,role:'Visitor'});await flush();assert.equal(h.state.canReadStaff.value,false);assert.ok(!nodes(h.render()).some(n=>n.props?.class==='staff-panel'))
 }finally{h.stop()}
 const admin=harness({...officer,role:'Administrator'},async()=>{throw Object.assign(Error('Access denied.'),{status:403})});try{await flush();assert.equal(admin.state.plant.value,null);assert.equal(admin.state.errorStatus.value,403)}finally{admin.stop()}
})
test('image adapter accepts only same-origin authorized asset paths',()=>{
 assert.equal(integration.mapSpeciesContract({...species,image_url:'https://external.invalid/image'}).imageUrl,'')
 assert.equal(integration.mapSpeciesContract({...species,image_url:'data:image/jpeg,abc'}).imageUrl,'')
})

test('shared session notifications clear before logout and reject stale session verification',async()=>{
 const source=readFileSync(new URL('../src/services/auth.ts',import.meta.url),'utf8')
 let resolveMe;const events=[];let meWaiting=false
 const exports={};const context={exports,console,fetch:async url=>url==='/api/auth/me'?(meWaiting?new Promise(resolve=>{resolveMe=resolve}):Response.json({user:officer})):Response.json({})}
 vm.runInNewContext(js(source),context)
 const auth=exports;auth.subscribeSession((user,pending)=>events.push({user,pending}))
 await auth.currentUser();assert.equal(auth.sessionSnapshot().user.id,'officer')
 meWaiting=true;const old=auth.currentUser();const logout=auth.logout()
 assert.equal(auth.sessionSnapshot().pending,true);assert.equal(auth.sessionSnapshot().user,null)
 await logout;resolveMe(Response.json({user:officer}));await old
 assert.equal(auth.sessionSnapshot().user,null);assert.equal(auth.sessionSnapshot().pending,false)
 assert.ok(events.some(e=>e.pending&&e.user===null))
})


test('session checks coalesce and cannot verify an old cookie while logout is pending',async()=>{
 const source=readFileSync(new URL('../src/services/auth.ts',import.meta.url),'utf8')
 let resolveMe,resolveLogout;const calls=[];const exports={}
 vm.runInNewContext(js(source),{exports,console,fetch:async url=>{calls.push(url);return new Promise(resolve=>{if(url==='/api/auth/me')resolveMe=resolve;else resolveLogout=resolve})}})
 const a=exports.currentUser(),b=exports.currentUser();assert.equal(calls.length,1)
 resolveMe(Response.json({user:officer}));await Promise.all([a,b]);
 const out=exports.logout();assert.equal(exports.sessionSnapshot().user,null)
 assert.equal(await exports.currentUser(),null);assert.equal(calls.filter(x=>x==='/api/auth/me').length,1)
 resolveLogout(Response.json({}));await out;assert.equal(exports.sessionSnapshot().user,null)
})


test('image and public information share the responsive top grid in image-first order', async()=>{
 const h=harness();try{await flush();const tree=nodes(h.render());const grid=tree.find(n=>n.props?.class==='hero-grid');assert.ok(grid);const children=nodes(grid);assert.ok(children.findIndex(n=>n.props?.class==='image-panel')<children.findIndex(n=>n.props?.class==='record-panel'));assert.equal(tree.filter(n=>n.props?.class==='record-panel').length,1);
 assert.ok(!tree.some(n=>n.props?.class==='hero-copy'));
 for(const value of ['PL001','Public common','Public scientific'])assert.equal(tree.filter(n=>n.children===value).length,1,value);
 assert.ok(tree.some(n=>n.type==='h1'&&n.children==='Plant Information'));
 const back=tree.filter(n=>n.props?.class==='back-link');assert.equal(back.length,1);
 assert.ok(nodes(back[0]).some(n=>n.type==='svg'&&n.props['aria-hidden']==='true'));
 assert.ok(nodes(back[0]).some(n=>n.type==='span'&&n.children==='Back'));
assert.ok(tree.some(n=>n.children==='Species representative image'));
 const css=descriptor.styles[0].content;assert.match(css,/grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1.15fr\)/);assert.match(css,/@media \(max-width: 850px\)[^}]*grid-template-columns: 1fr/s);assert.match(css,/\.back-link:hover/);assert.match(css,/\.back-link:focus-visible/);assert.match(css,/min-height: 44px/);assert.match(css,/height: auto; aspect-ratio: 4 \/ 3; object-fit: contain/);
 const img=tree.find(n=>n.type==='img');img.props.onError();await flush();assert.ok(!nodes(h.render()).some(n=>n.type==='img'));assert.ok(nodes(h.render()).some(n=>n.props?.class==='image-placeholder'));
 }finally{h.stop()}
})

test('Back uses validated internal sources, direct-link fallback and current authorization',async()=>{
 for(const [user,previous,expected] of [[null,null,'/species'],[null,'/species','/species'],[null,'/species/tree','/species/tree'],[officer,'/conservation/map?plant=1','/conservation/map?plant=1'],[null,'/conservation/map','/species'],[null,'https://external.invalid','/species'],[null,'//external.invalid','/species'],[null,'/unknown','/species']]){
 const h=harness(user,undefined,previous);try{await flush();assert.equal(h.state.backTarget.value,expected);assert.ok(nodes(h.render()).some(n=>n.props?.class==='back-link'&&n.props.to===expected));if(user){h.change(null,true);assert.equal(h.state.backTarget.value,'/species')}}finally{h.stop()}
 }
})
