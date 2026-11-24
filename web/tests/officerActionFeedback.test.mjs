import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import { parse, compileScript } from '@vue/compiler-sfc'
import { officerActionError, officerSaveUncertain } from '../src/services/officerActionFeedback.ts'

test('safe action error classification retains HTTP distinctions and never exposes server details',()=>{
 for(const [status,key] of [[400,'validation'],[422,'validation'],[401,'session'],[403,'permission'],[404,'unavailable'],[409,'conflict'],[429,'rateLimited'],[500,'server'],[503,'server'],[0,'network']]){
  const error=Object.assign(Error('private server payload'),{status})
  assert.equal(officerActionError(error),key)
  assert.equal(officerSaveUncertain(error),status===0||status>=500)
 }
 assert.equal(officerActionError({name:'ObservationEditEvidenceError',status:409}),'evidence')
 assert.equal(officerSaveUncertain({name:'ObservationEditEvidenceError',status:409}),false)
 assert.equal(officerSaveUncertain(new TypeError('Failed to fetch')),true)
})

test('all shared action messages have English, Malay and Chinese translations',()=>{
 const dictionaries=['en','ms','zh-CN'].map(lang=>JSON.parse(readFileSync(new URL('../src/locales/'+lang+'.json',import.meta.url),'utf8')).officerFeedback)
 for(const dictionary of dictionaries){assert.deepEqual(Object.keys(dictionary),Object.keys(dictionaries[0]));for(const value of Object.values(dictionary))assert.equal(typeof value,'string')}
 assert.equal(dictionaries[0].savedReloadFailed,"Decision saved. Latest information couldn't be loaded.")
 assert.notEqual(dictionaries[0].uncertain,dictionaries[0].saved)
})

test('Officer profile is read-only and password changes use the authenticated account services',async()=>{
 const source=readFileSync(new URL('../src/views/conservation/ConservationProfileView.vue',import.meta.url),'utf8')
 const {descriptor}=parse(source),script=compileScript(descriptor,{id:'profile-feedback'})
 const exports={},scope=vue.effectScope(),mounted=[],cleanups=[],listeners=[],requests=[],redirects=[],alerts=[]
 const account={id:'officer-1',name:'Officer',email:'officer@example.test',role:'Conservation Officer',status:'Active',mustChangePassword:false}
 const context={exports,window:{alert:value=>alerts.push(value)},require(name){
  if(name==='vue')return {...vue,onMounted:fn=>mounted.push(fn),onBeforeUnmount:fn=>cleanups.push(fn)}
  if(name==='vue-i18n')return {useI18n:()=>({t:key=>key})}
  if(name==='vue-router')return {useRouter:()=>({replace:async value=>redirects.push(value)})}
  if(name.endsWith('/services/auth'))return {
   sessionSnapshot:()=>({user:account}),subscribeSession:fn=>{listeners.push(fn);return()=>{listeners.splice(listeners.indexOf(fn),1)}},currentUser:async()=>account,
   api:async(path,method,body)=>{requests.push({path,method,body});return path==='/auth/login'?{user:account}:{changed:true}},
  }
  throw Error(name)
 }}
 vm.runInNewContext(ts.transpileModule(script.content,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context)
 const state=scope.run(()=>exports.default.setup({},{expose(){}}))
 try{
  assert.equal(state.profile.fullName,'Officer')
  state.saveProfile();assert.equal(state.profileSuccess.value,'officerFeedback.prototypeValidated')
  assert.equal(requests.length,0)
  Object.assign(state.password,{current:'current-password',next:'replacement-password-long',confirm:'replacement-password-long'})
  await state.updatePassword()
  assert.deepEqual(requests.map(x=>x.path),['/auth/login','/auth/password'])
  assert.equal(requests[0].body.email,account.email)
  assert.equal(requests[1].body.password,'replacement-password-long')
  assert.equal(alerts.length,1)
  assert.equal(redirects.length,1)
  assert.equal(redirects[0].path,'/')
  assert.equal(redirects[0].query.passwordChanged,'1')
  assert.match(descriptor.template.content,/officerFeedback\.prototype/)
  assert.match(script.content,/officerFeedback\.passwordChanged/)
  const switched={...account,id:'officer-2',name:'Second Officer',email:'second@example.test'}
  listeners[0](switched,false)
  assert.equal(state.profile.fullName,'Second Officer')
  assert.equal(state.profile.email,'second@example.test')
  listeners[0](null,false)
  assert.equal(state.account.value,null)
  assert.equal(state.profile.email,'')
  assert.equal(state.password.current,'')
  cleanups.forEach(cleanup=>cleanup())
  assert.equal(listeners.length,0)
 }finally{scope.stop()}
})
