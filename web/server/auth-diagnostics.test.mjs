import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createAuthDiagnostics,authStoreFingerprint} from './auth-diagnostics.mjs'
import {createAuthServer} from './http.mjs'

test('retained diagnostics correlate references and discard all non-allowlisted fields',()=>{
 const directory=mkdtempSync(join(tmpdir(),'auth-diagnostics-')),seen=[]
 try{
  const diagnostics=createAuthDiagnostics({env:{NODE_ENV:'development'},directory,storeFingerprint:'synthetic-store',consoleSink:entry=>seen.push(entry)})
  diagnostics.runtime();diagnostics.record({event:'password_verification',reference:'abcdef123456',stage:'verification',reason:'password_mismatch',email:'private-personal-value',password:'private-password-value',password_hash:'private-hash-value',token:'private-token-value'})
  const retained=readFileSync(join(directory,'auth-diagnostics.ndjson'),'utf8');const rows=retained.trim().split('\n').map(JSON.parse)
  assert.equal(rows[1].reference,'abcdef123456');assert.equal(rows[1].reason,'password_mismatch');assert.equal(rows[1].instanceId,rows[0].instanceId)
  assert.equal(seen.length,2);assert.doesNotMatch(retained,/private-(?:personal|password|hash|token)-value/)
  diagnostics.record({event:'password_verification',reference:'bad\ninjection',stage:'verification',reason:'account_missing'});assert.equal(seen.length,2)
 }finally{rmSync(directory,{recursive:true,force:true})}
})

test('transport retention excludes bodies, query values and arbitrary metadata',()=>{
 const directory=mkdtempSync(join(tmpdir(),'auth-transport-'))
 try{
  const diagnostics=createAuthDiagnostics({env:{NODE_ENV:'development'},directory,storeFingerprint:'synthetic',consoleSink:()=>{}})
  diagnostics.transport({event:'mobile_transport',component:'auth',reference:'abcdef123456',path:'/api/mobile/password',method:'POST',phase:'completed',status:401,durationMs:10,password:'private-password',body:'private-personal-data'})
  diagnostics.transport({event:'mobile_transport',component:'auth',reference:'abcdef123456',path:'/api/mobile/password?secret=private-query',method:'POST',phase:'received'})
  const retained=readFileSync(join(directory,'auth-diagnostics.ndjson'),'utf8')
  assert.equal(retained.trim().split('\n').length,1);assert.match(retained,/"status":401/);assert.doesNotMatch(retained,/private-|password":|body":/)
 }finally{rmSync(directory,{recursive:true,force:true})}
})
test('production diagnostics stay off unless explicitly enabled; retention is bounded',()=>{
 const directory=mkdtempSync(join(tmpdir(),'auth-diagnostics-'))
 try{
  const disabled=createAuthDiagnostics({env:{NODE_ENV:'production'},directory,storeFingerprint:'synthetic',consoleSink:()=>{}});disabled.runtime();assert.equal(existsSync(join(directory,'auth-diagnostics.ndjson')),false)
  const enabled=createAuthDiagnostics({env:{NODE_ENV:'production',AUTH_DEBUG:'1'},directory,storeFingerprint:'synthetic',consoleSink:()=>{},maxBytes:1})
  enabled.runtime();enabled.runtime();enabled.runtime();assert.ok(existsSync(join(directory,'auth-diagnostics.ndjson.previous')))
 }finally{rmSync(directory,{recursive:true,force:true})}
})
test('store fingerprint distinguishes database/schema without depending on credentials',()=>{
 const first=authStoreFingerprint({connectionString:'postgresql://first:secret@db.invalid:5432/plants'},'plant_auth')
 assert.equal(first,authStoreFingerprint({connectionString:'postgresql://second:different@db.invalid:5432/plants'},'plant_auth'))
 assert.notEqual(first,authStoreFingerprint({connectionString:'postgresql://first:secret@db.invalid:5432/plants'},'other_schema'))
 assert.notEqual(first,authStoreFingerprint({connectionString:'postgresql://first:secret@db.invalid:5432/other'},'plant_auth'))
})
test('runtime identity is available only through the loopback-only internal endpoint',async()=>{
 const identity={instanceId:'synthetic-instance',processId:42,storeFingerprint:'opaque',diagnosticsEnabled:true}
 const server=createAuthServer({auth:{},diagnostics:{enabled:true,identity},env:{APP_ORIGIN:'http://localhost:5173'}})
 await new Promise(r=>server.listen(0,'127.0.0.1',r))
 try{
  const url=`http://127.0.0.1:${server.address().port}/internal/auth/diagnostics`
  assert.deepEqual(await (await fetch(url)).json(),identity)
  assert.equal((await fetch(url,{headers:{Origin:'https://untrusted.invalid'}})).status,403)
 }finally{await new Promise(r=>server.close(r))}
})

test('direct and gateway-compatible health aliases never invoke authentication or expose store identity',async()=>{
 const server=createAuthServer({auth:{session:()=>assert.fail('Health must not perform account/session lookup')},env:{APP_ORIGIN:'http://localhost:5173'}})
 await new Promise(r=>server.listen(0,'127.0.0.1',r))
 try{
  for(const path of ['/health','/auth-health','/api/mobile/health']){
   const response=await fetch(`http://127.0.0.1:${server.address().port}${path}`)
   assert.equal(response.status,200)
   assert.deepEqual(await response.json(),{service:'Niah Authentication API',ready:true,accountAdapter:false})
  }
 }finally{await new Promise(r=>server.close(r))}
})

test('lifecycle retention discards error messages, stacks, and arbitrary secret fields',()=>{
 const directory=mkdtempSync(join(tmpdir(),'auth-lifecycle-'))
 try{
  const diagnostics=createAuthDiagnostics({env:{AUTH_DEBUG:'1'},directory,storeFingerprint:'synthetic',consoleSink:()=>{}})
  diagnostics.lifecycle('uncaught_exception',{errorName:'Error',errorCode:'EPIPE',origin:'uncaughtException',message:'private synthetic value',stack:'private synthetic value',password:'private synthetic value'})
  const text=readFileSync(join(directory,'auth-diagnostics.ndjson'),'utf8')
  assert.match(text,/EPIPE/);assert.doesNotMatch(text,/private synthetic value|password|stack|message/)
 }finally{rmSync(directory,{recursive:true,force:true})}
})
