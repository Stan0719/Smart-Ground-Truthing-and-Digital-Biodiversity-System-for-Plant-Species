import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {createHmac,randomBytes} from 'node:crypto'
import {once} from 'node:events'
import {createAuth} from './auth.mjs'
import {createFaceServiceHandler} from './face-service.mjs'

test('signed service requests enforce replay, role/status, expiry and account changes',async()=>{
 const auth=await createAuth(':memory:'),key=randomBytes(32)
 const user=await auth.createUser({name:'Botanist',email:'botanist@example.invalid',role:'Botanist',password:'fixture-account-password',mustChangePassword:false})
 const handler=createFaceServiceHandler({auth,key})
 const server=createServer(handler);server.listen(0,'127.0.0.1');await once(server,'listening')
 const request=async(path,body,options={})=>{
  const raw=JSON.stringify(body),timestamp=String(options.timestamp ?? Math.floor(Date.now()/1000)),nonce=options.nonce ?? randomBytes(16).toString('hex')
  const signature=createHmac('sha256',options.key ?? key).update(`${timestamp}\n${nonce}\n${path}\n${raw}`).digest('hex')
  return fetch(`http://127.0.0.1:${server.address().port}${path}`,{method:'POST',headers:{'Content-Type':'application/json','X-Face-Timestamp':timestamp,'X-Face-Nonce':nonce,'X-Face-Signature':signature},body:raw})
 }
 try{
  const path='/internal/face/issue',body={userId:user.id},nonce=randomBytes(16).toString('hex')
  assert.equal((await request(path,body,{key:randomBytes(32)})).status,403)
  assert.equal((await request(path,body,{timestamp:1})).status,403)
  const success=await request(path,body,{nonce});assert.equal(success.status,200)
  const session=await success.json();assert.equal(auth.session(session.token).id,user.id)
  assert.equal((await request(path,body,{nonce})).status,403)
  auth.setStatus(user.id,'Suspended','fixture','fixture')
  assert.equal(auth.session(session.token),null)
  assert.equal((await request(path,body)).status,401)
  auth.setStatus(user.id,'Active','fixture','fixture')
  auth.db.prepare("UPDATE users SET role='Conservation Officer' WHERE id=?").run(user.id)
  assert.equal((await request(path,body)).status,401)
  auth.db.prepare("UPDATE users SET role='Botanist',must_change_password=1 WHERE id=?").run(user.id)
  assert.equal((await request(path,body)).status,401)
  auth.db.prepare('UPDATE users SET must_change_password=0 WHERE id=?').run(user.id)
  const next=await (await request(path,body)).json()
  auth.db.prepare('UPDATE sessions SET expires_at=0').run()
  assert.equal((await request('/internal/face/me',{token:next.token})).status,401)
 }finally{await new Promise(resolve=>server.close(resolve));auth.db.close()}
})
