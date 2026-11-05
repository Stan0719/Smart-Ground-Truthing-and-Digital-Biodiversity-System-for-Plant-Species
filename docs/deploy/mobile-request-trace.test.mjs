import test from 'node:test'
import assert from 'node:assert/strict'
import {createAuthServer} from '../web/server/http.mjs'
import {createMobileLoginGateway} from './mobile-login-gateway.mjs'

test('gateway and auth correlate credential-free rejection without recording request values',async()=>{
 const entries=[]
 const auth=createAuthServer({auth:{},env:{NODE_ENV:'development'},diagnostics:{transport:e=>entries.push(e)}})
 await new Promise(r=>auth.listen(0,'127.0.0.1',r))
 const gateway=createMobileLoginGateway({authPort:auth.address().port},{trace:true,emit:e=>entries.push(e)})
 await new Promise(r=>gateway.listen(0,'127.0.0.1',r))
 try{
  const reference='abcdef123456'
  const r=await fetch(`http://127.0.0.1:${gateway.address().port}/api/mobile/password?secret=never-record`,{method:'POST',headers:{'Content-Type':'application/json','X-Face-Request-ID':reference},body:'{}'})
  await r.text();assert.equal(r.status,401);assert.equal(r.headers.get('x-request-id'),reference)
  for(const component of ['gateway','auth'])for(const phase of ['received','completed'])assert.ok(entries.some(e=>e.component===component&&e.phase===phase&&e.reference===reference))
  assert.doesNotMatch(JSON.stringify(entries),/never-record|secret=/)
 }finally{await Promise.all([new Promise(r=>gateway.close(r)),new Promise(r=>auth.close(r))])}
})
