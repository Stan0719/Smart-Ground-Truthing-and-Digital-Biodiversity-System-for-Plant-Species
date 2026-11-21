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

test('Officer prototype validates inputs without persisting, claiming a save, or erasing the password draft',()=>{
 const source=readFileSync(new URL('../src/views/conservation/ConservationProfileView.vue',import.meta.url),'utf8')
 const {descriptor}=parse(source),script=compileScript(descriptor,{id:'profile-feedback'})
 const exports={},scope=vue.effectScope();let requests=0
 const context={exports,fetch(){requests++;throw Error('No live requests')},require(name){
  if(name==='vue')return vue
  if(name==='vue-i18n')return {useI18n:()=>({t:key=>key})}
  if(name.endsWith('conservationProfile'))return {conservationProfile:vue.reactive({fullName:'Officer',email:'officer@example.test'})}
  throw Error(name)
 }}
 vm.runInNewContext(ts.transpileModule(script.content,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context)
 const state=scope.run(()=>exports.default.setup({},{expose(){}}))
 try{
  state.saveProfile();assert.equal(state.profileSuccess.value,'officerFeedback.prototypeValidated')
  Object.assign(state.password,{current:'existing-password',next:'replacement-password',confirm:'replacement-password'})
  state.updatePassword();assert.equal(state.passwordSuccess.value,'officerFeedback.prototypeValidated')
  assert.equal(state.password.next,'replacement-password');assert.equal(requests,0)
  state.password.confirm='mismatch';state.updatePassword();assert.equal(state.passwordSuccess.value,'');assert.ok(state.passwordErrors.confirm)
  assert.match(descriptor.template.content,/officerFeedback.prototype/)
  assert.doesNotMatch(descriptor.template.content,/adminProfile.saveChanges|adminProfile.updatePassword/)
 }finally{scope.stop()}
})
