import test from 'node:test'
import assert from 'node:assert/strict'
import {createAuth,hashPassword,digest} from './auth.mjs'
import {createAuthServer} from './http.mjs'
import {createStaffInvitations} from './activation.mjs'
import {createMobileApi} from '../../mobileapp/utils/faceApi.js'
import {changeFirstLoginPassword} from '../../mobileapp/utils/firstLoginPassword.js'
import {createMobileLoginGateway} from '../../deploy/mobile-login-gateway.mjs'
import {createRequire} from 'node:module'
import {readFileSync} from 'node:fs'
import {createFaceSessionManager} from '../../mobileapp/utils/faceSessionLifecycle.js'
import {validFaceUser} from '../../mobileapp/utils/faceApi.js'
import {can} from '../../mobileapp/utils/rbac.js'
const require=createRequire(import.meta.url)
const {identity}=require('../../plant-conservation-backend/authorization.cjs')
const {createPlantApp}=require('../../plant-conservation-backend/server.js')
// In-memory adapter: executes no SQL and opens no database connections.
function fixture(users){
 const sessions=new Map(), expired=new Set(), activationTokens=[]
 const db={close:async()=>{},transaction:async fn=>fn(),prepare(sql){return {
 async get(...args){
  if(sql.includes('schema_migrations'))return {version:1}
  if(sql.includes('pg_advisory'))return {}
  if(sql.includes('security_settings'))return {login_limit:1000,session_hours:8}
  if(sql.includes('COUNT(*)'))return {count:0,n:0}
  if(sql.includes('activation_tokens'))return expired.has(args[0])||activationTokens.some(t=>t.userId===args[0]&&!t.used&&t.expiresAt<=args[1])?{exists:1}:undefined
  if(sql.includes('FROM auth_events'))return undefined
  if(sql.includes('JOIN users')){const id=sessions.get(args[0]);return users.find(u=>u.id===id&&u.status==='Active')}
  if(sql.includes('visitor_sessions')||sql.includes('FROM visitors'))return undefined
  if(sql.includes('WHERE email=?'))return users.find(u=>u.email===args[0])
  if(sql.includes('FROM users WHERE id=?'))return users.find(u=>u.id===args[0])
  throw Error('Unexpected read: '+sql)
 },async run(...args){
  if(sql.startsWith('INSERT INTO users'))users.push({id:args[0],name:args[1],username:args[2],email:args[3],role:args[4],password_hash:args[5],status:'Active',must_change_password:1})
  else if(sql.startsWith('INSERT INTO activation_tokens'))activationTokens.push({userId:args[1],expiresAt:args[2],used:false})
  else if(sql.startsWith('UPDATE activation_tokens')){for(const t of activationTokens)if(t.userId===args[0])t.used=true}
  else if(sql.startsWith('INSERT INTO sessions'))sessions.set(args[0],args[1])
  else if(sql.startsWith('DELETE FROM sessions')){if(sql.includes('user_id')){for(const [key,id]of sessions)if(id===args[0])sessions.delete(key)}else sessions.delete(args[0])}
  else if(sql.startsWith("UPDATE users SET password_hash=?,status='Active'")){const u=users.find(u=>u.id===args[1]);u.password_hash=args[0];u.status='Active';u.must_change_password=1}
  else if(sql.startsWith('UPDATE users SET password_hash')){const u=users.find(u=>u.id===args[1]);if(!u||u.status!=='Active'||u.password_hash!==args[2])return {changes:0};u.password_hash=args[0];u.must_change_password=0}
  else if(!sql.startsWith('INSERT INTO auth_events')&&!sql.startsWith('UPDATE users SET last_login')&&!sql.startsWith('UPDATE activation_tokens')&&!sql.startsWith('DELETE FROM visitor_sessions'))throw Error('Unexpected write: '+sql)
  return {changes:1}
 }}}}
 return {db,sessions,expired,activationTokens}
}
test('website role boundary and complete Botanist mobile first-login lifecycle without a database',async()=>{
 const permanent='permanent dummy password',temporary='temporary dummy password'
 const users=await Promise.all(['Administrator','Conservation Officer','Botanist','Visitor'].map(async(role,i)=>({id:String(i),name:role,email:`user${i}@example.invalid`,role,status:'Active',must_change_password:0,password_hash:await hashPassword(permanent)})))
 const f=fixture(users),auth=await createAuth(f.db),server=createAuthServer({auth,env:{APP_ORIGIN:'http://localhost:5173'}})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const base=`http://127.0.0.1:${server.address().port}`
 const mobileRequests=[]
 const mobileClient=createMobileApi({resolveUrl: service=>`https://${service}.example.invalid${service==='auth'?'/api/mobile':'/face'}`,fetchImpl:async(address,options)=>{
  const url=new URL(address);assert.equal(url.hostname,'auth.example.invalid');mobileRequests.push(url.pathname)
  // Test-only transport maps synthetic HTTPS authority to real loopback HTTP.
  return fetch(base+url.pathname,options)
 }})
 const request=async(path,body,token,web=false)=>{
 if(!web && path.startsWith('/api/mobile/')){
  try{return {status:200,body:await mobileClient(path.slice('/api/mobile'.length),body||{},token,body?'POST':'GET')}}
  catch(error){return {status:error.status,body:{error:error.message}}}
 }

 const response=await fetch(base+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...(web?{Origin:'http://localhost:5173'}:{}),...(token?web?{Cookie:`niah_session=${token}`}:{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined})
 return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')}
 }
 try{
 for(let i=0;i<4;i++){const r=await request('/api/auth/login',{email:users[i].email,password:permanent},null,true);assert.equal(r.status,i<2?200:401);if(i>=2)assert.equal(r.cookie,null)}
 users[2].password_hash=await hashPassword(temporary);users[2].must_change_password=1
 assert.equal((await request('/api/auth/login',{email:users[2].email,password:temporary},null,true)).status,401)
 assert.equal((await request('/api/mobile/password',{email:users[2].email,password:'wrong'})).status,401)
 users[2].status='Inactive'
 assert.equal((await request('/api/mobile/password',{email:users[2].email,password:temporary})).status,401)
 users[2].status='Active';f.expired.add('2')
 assert.equal((await request('/api/mobile/password',{email:users[2].email,password:temporary})).status,401)
 f.expired.clear()
 const login=await request('/api/mobile/password',{email:users[2].email,password:temporary});assert.equal(login.status,200);assert.equal(login.body.user.role,'botanist');assert.equal(login.body.user.mustChangePassword,true)
 const token=login.body.token
 for(const path of ['/api/auth/me','/api/admin/users','/api/auth/password'])assert.equal((await request(path,path.endsWith('password')?{password:permanent}:null,token,true)).status,401)
 assert.equal((await request('/api/mobile/me',null,token)).status,403)
 assert.equal((await request('/api/mobile/change-password',{password:permanent},token)).status,200)
 assert.equal(await auth.session(token),null)
 assert.equal((await request('/api/mobile/password',{email:users[2].email,password:temporary})).status,401)
 const next=await request('/api/mobile/password',{email:users[2].email,password:permanent});assert.equal(next.status,200);assert.equal(next.body.user.mustChangePassword,false)
 assert.equal((await request('/api/mobile/me',null,next.body.token)).status,200)
 assert.equal((await request('/api/auth/me',null,next.body.token,true)).status,401)
 // Current role is rechecked for existing sessions.
 users[2].status='Suspended';assert.equal(await auth.session(next.body.token),null)
 assert.ok(mobileRequests.includes('/api/mobile/password'));assert.ok(mobileRequests.includes('/api/mobile/change-password'))
 }finally{await new Promise(resolve=>server.close(resolve))}
})
test('plant identity rejects Botanist browser credentials and preserves native bearer identity',async()=>{
 const user={id:'botanist',role:'Botanist',status:'Active',mustChangePassword:false}
 const middleware=identity({session:async()=>user})
 for(const headers of [{cookie:`niah_session=${'a'.repeat(64)}`},{origin:'http://localhost:5173',authorization:`Bearer ${'a'.repeat(64)}`}]){
 let status;await middleware({headers},{status(n){status=n;return this},json(){}},()=>assert.fail('browser accepted'));assert.equal(status,403)
 }
 let passed=false;await middleware({headers:{authorization:`Bearer ${'a'.repeat(64)}`}},{},()=>{passed=true});assert.equal(passed,true)
})

test('direct mobile health and Visitor registration need no Face ID service',async()=>{
 const auth={createVisitor:async body=>({user:{id:'dummy-visitor',name:body.name,email:body.email,role:'Visitor',status:'Active',mustChangePassword:false}})}
 const server=createAuthServer({auth,env:{APP_ORIGIN:'http://localhost:5173'}})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 try{
  const base=`http://127.0.0.1:${server.address().port}`
  const health=await fetch(base+'/api/mobile/health');assert.equal(health.status,200);assert.equal((await health.json()).service,'Niah Authentication API')
  const api=createMobileApi({resolveUrl:service=>{assert.equal(service,'auth');return 'https://auth.example.invalid/api/mobile'},fetchImpl:(url,options)=>fetch(base+new URL(url).pathname,options)})
  const result=await api('/register',{name:'Dummy',email:'dummy@example.invalid',password:'dummy visitor password'})
  assert.equal(result.user.role,'visitor')
 }finally{await new Promise(resolve=>server.close(resolve))}
})

test('Administrator-issued temporary password reaches mobile through the same auth instance; separate store cannot authenticate it',async()=>{
 // Explicit synthetic fixture only. No account is created in any runtime store.
 const adminPassword='synthetic administrator password';const users=[{id:'fixture-admin',name:'Fixture Admin',email:'fixture-admin@example.invalid',role:'Administrator',status:'Active',must_change_password:0,password_hash:await hashPassword(adminPassword)}]
 const memory=fixture(users), logs=[], delivered=[]
 const auth=await createAuth(memory.db,{diagnostic:entry=>logs.push(entry)})
 const staff=createStaffInvitations({auth,origin:'http://localhost:5173',deliver:async message=>delivered.push(message)})
 const server=createAuthServer({auth,staff,env:{APP_ORIGIN:'http://localhost:5173'}})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const base=`http://127.0.0.1:${server.address().port}`
 const postWeb=async(path,body,cookie)=>fetch(base+path,{method:'POST',headers:{Origin:'http://localhost:5173','Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)})
 const api=createMobileApi({resolveUrl:()=> 'https://fixture.example.invalid/api/mobile',fetchImpl:(url,options)=>fetch(base+new URL(url).pathname,options)})
 try{
  const admin=await postWeb('/api/auth/login',{email:users[0].email,password:adminPassword})
  assert.equal(admin.status,200);const cookie=admin.headers.get('set-cookie').split(';')[0]
  const invitation=await postWeb('/api/admin/users',{name:'Synthetic Botanist',username:'synthetic.botanist',email:'synthetic-botanist@example.invalid',role:'Botanist'},cookie)
  assert.equal(invitation.status,201);const provisioned=await invitation.json();assert.equal(delivered.length,1)
  const temporary=delivered[0].temporaryPassword,email=delivered[0].email
  const stored=users.find(user=>user.id===provisioned.user.id)
  assert.match(stored.password_hash,/^[a-f0-9]{32}:[a-f0-9]{128}$/);assert.notEqual(stored.password_hash,temporary)
  assert.equal(stored.must_change_password,1);assert.equal(memory.activationTokens[0].used,false)
  assert.equal(JSON.stringify(provisioned).includes(temporary),false)
  // Missing account and wrong password return indistinguishable public errors.
  let missingError,wrongError
  try{await api('/password',{email:'absent@example.invalid',password:temporary},undefined,'POST','111111111111')}catch(error){missingError=error}
  try{await api('/password',{email,password:'incorrect synthetic password'},undefined,'POST','222222222222')}catch(error){wrongError=error}
  assert.equal(missingError.status,401);assert.equal(wrongError.status,401)
  assert.equal(missingError.message.split(' Reference:')[0],wrongError.message.split(' Reference:')[0])
  assert.ok(logs.some(log=>log.reference==='111111111111'&&log.reason==='account_missing'))
  assert.ok(logs.some(log=>log.reference==='222222222222'&&log.reason==='password_mismatch'))
  const first=await api('/password',{email,password:temporary});assert.equal(first.user.mustChangePassword,true)
  const second=await api('/password',{email,password:temporary})
  await assert.rejects(api('/me',{},first.token),error=>error.status===403)
  await assert.rejects(api('/change-password',{password:temporary},first.token),error=>error.status===401)
  const fresh='new synthetic botanist password'
  assert.equal((await api('/change-password',{password:fresh},first.token)).changed,true)
  assert.equal(await auth.session(first.token),null);assert.equal(await auth.session(second.token),null)
  assert.equal(memory.activationTokens[0].used,true);assert.equal(stored.must_change_password,0)
  await assert.rejects(api('/password',{email,password:temporary}),error=>error.status===401)
  const next=await api('/password',{email,password:fresh});assert.equal(next.user.mustChangePassword,false)
  assert.equal((await api('/me',{},next.token)).user.id,stored.id)
  for(const password of [temporary,fresh])assert.equal((await postWeb('/api/auth/login',{email,password})).status,401)
  const denial=await postWeb('/api/auth/password',{password:'another synthetic password'},`niah_session=${next.token}`);assert.equal(denial.status,401)
  const isolated=await createAuth(fixture([]).db,{diagnostic:entry=>logs.push(entry)})
  assert.equal((await isolated.login(email,fresh,'dummy',{roles:['Botanist'],reference:'333333333333'})).status,401)
  assert.ok(logs.some(log=>log.reference==='333333333333'&&log.reason==='account_missing'))
  const captured=JSON.stringify(logs)
  for(const secret of [temporary,fresh,stored.password_hash,next.token,email])assert.equal(captured.includes(secret),false)
 }finally{await new Promise(resolve=>server.close(resolve))}
})

test('private login diagnostics distinguish policy failures without exposing reasons to the caller',async()=>{
 const password='synthetic temporary password'
 const user={id:'policy-fixture',name:'Synthetic Botanist',email:'policy@example.invalid',role:'Botanist',status:'Active',must_change_password:1,password_hash:await hashPassword(password)}
 const memory=fixture([user]),logs=[],auth=await createAuth(memory.db,{diagnostic:entry=>logs.push(entry)})
 const request=async requirements=>auth.login(user.email,password,'dummy',{roles:['Botanist'],reference:'abcdef123456',...requirements})
 for(const [mutate,requirements,expected] of [
  [()=>{user.status='Inactive'}, {}, 'account_inactive'],
  [()=>{user.status='Active';memory.expired.add(user.id)}, {}, 'temporary_password_expired'],
  [()=>{memory.expired.clear()}, {roles:['Administrator','Conservation Officer']}, 'role_denied'],
  [()=>{}, {requirePermanent:true}, 'permanent_password_required'],
 ]){
  mutate();const result=await request(requirements);assert.equal(result.status,401)
  assert.equal(logs.at(-1).reason,expected);assert.equal(JSON.stringify(result).includes(expected),false)
 }
 const before=logs.length
 await auth.login(user.email,'bad password','dummy',{reference:'malformed\nlog injection'})
 assert.equal(logs.length,before)
})

test('expired Administrator-issued temporary password requires resend; resend revokes sessions and the old credential',async()=>{
 const memory=fixture([]),deliveries=[],logs=[]
 const auth=await createAuth(memory.db,{diagnostic:entry=>logs.push(entry)})
 const body={name:'Expiry Fixture',username:'expiry.fixture',email:'expiry-fixture@example.invalid',role:'Botanist'}
 const expiredStaff=createStaffInvitations({auth,origin:'http://localhost:5173',now:()=>Date.now()-2*60*60*1000,deliver:async value=>deliveries.push(value)})
 const old=await expiredStaff.invite(body,'synthetic-admin','dummy')
 assert.equal(old.status,201)
 const rejected=await auth.login(body.email,deliveries[0].temporaryPassword,'dummy',{roles:['Botanist'],reference:'444444444444'})
 assert.equal(rejected.status,401);assert.equal(logs.at(-1).reason,'temporary_password_expired')
 const staff=createStaffInvitations({auth,origin:'http://localhost:5173',deliver:async value=>deliveries.push(value)})
 memory.sessions.set('synthetic-old-session',old.user.id)
 const resent=await staff.invite(body,'synthetic-admin','dummy',old.user.id)
 assert.equal(resent.status,201);assert.equal(memory.sessions.size,0)
 assert.notEqual(deliveries[0].temporaryPassword,deliveries[1].temporaryPassword)
 assert.equal((await auth.login(body.email,deliveries[0].temporaryPassword,'dummy',{roles:['Botanist']})).status,401)
 assert.equal((await auth.login(body.email,deliveries[1].temporaryPassword,'dummy',{roles:['Botanist']})).user.mustChangePassword,true)
 assert.equal(memory.activationTokens[0].used,true);assert.equal(memory.activationTokens[1].used,false)
})

test('mock email delivery targets the stored recipient; failures are reported and resend ignores a replacement recipient',async()=>{
 const users=[],memory=fixture(users),auth=await createAuth(memory.db),attempts=[]
 const body={name:'Delivery Fixture',username:'delivery.fixture',email:'delivery-fixture@example.invalid',role:'Botanist'}
 const failed=createStaffInvitations({auth,origin:'http://localhost:5173',deliver:async value=>{attempts.push(value);throw Object.assign(Error('Synthetic provider error'),{deliveryCode:'provider',providerStatus:503})}})
 const result=await failed.invite(body,'synthetic-admin','dummy')
 assert.equal(result.status,202);assert.equal(result.delivery,'failed');assert.ok(result.message.includes('not confirmed'))
 assert.equal(result.user.mustChangePassword,true);assert.equal(attempts[0].email,body.email)
 assert.equal(JSON.stringify(result).includes(attempts[0].temporaryPassword),false)
 const retry=createStaffInvitations({auth,origin:'http://localhost:5173',deliver:async value=>attempts.push(value)})
 const resent=await retry.invite({...body,email:'different-synthetic@example.invalid'},'synthetic-admin','dummy',result.user.id)
 assert.equal(resent.delivery,'sent');assert.equal(attempts[1].email,body.email)
 assert.notEqual(attempts[0].temporaryPassword,attempts[1].temporaryPassword)
 assert.equal((await auth.login(body.email,attempts[0].temporaryPassword,'dummy',{roles:['Botanist']})).status,401)
 assert.equal((await auth.login(body.email,attempts[1].temporaryPassword,'dummy',{roles:['Botanist']})).user.mustChangePassword,true)
})

test('isolated Administrator issuance -> real gateway -> mobile client -> mandatory-change helper -> permanent login',async()=>{
 const users=[{id:'gateway-admin',name:'Synthetic Administrator',email:'gateway-admin@example.invalid',role:'Administrator',status:'Active',must_change_password:0,password_hash:await hashPassword('synthetic administrator credential')}]
 const memory=fixture(users),deliveries=[],diagnostics=[],requestMetadata=[]
 const auth=await createAuth(memory.db,{diagnostic:entry=>diagnostics.push(entry)})
 const staff=createStaffInvitations({auth,origin:'http://localhost:5173',deliver:async value=>deliveries.push(value)})
 const server=createAuthServer({auth,staff,env:{APP_ORIGIN:'http://localhost:5173'}})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const plantQueries=[]
 const plant=createPlantApp({auth,origins:new Set(['http://localhost:5173']),pool:{async query(sql,args){
  assert.ok(sql.includes('FROM species s'));plantQueries.push(args)
  return {rows:[{species_id:1,scientific_name:'Synthetic species',common_name:'Synthetic',visibility:'internal',rbac_data:{},conservation_status:'Synthetic status'}]}
 }}}).listen(0,'127.0.0.1')
 await new Promise(resolve=>plant.once('listening',resolve))
 const gateway=createMobileLoginGateway({authPort:server.address().port,plantPort:plant.address().port,facePort:1})
 await new Promise(resolve=>gateway.listen(0,'127.0.0.1',resolve))
 const base=`http://127.0.0.1:${gateway.address().port}`
 const webPost=(path,body,cookie)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost:5173',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)})
 const api=createMobileApi({resolveUrl:service=>{assert.equal(service,'auth');return 'https://synthetic.invalid/api/mobile'},fetchImpl:(url,options)=>{
  const path=new URL(url).pathname
  requestMetadata.push({path,method:options.method,fields:Object.keys(JSON.parse(options.body||'{}')).sort(),bearer:Boolean(options.headers.Authorization),reference:/^[a-f0-9]{12}$/.test(options.headers['X-Face-Request-ID'])})
  return fetch(base+path,options)
 }})
 try{
  const admin=await webPost('/api/auth/login',{email:users[0].email,password:'synthetic administrator credential'});assert.equal(admin.status,200)
  const cookie=admin.headers.get('set-cookie').split(';')[0]
  const created=await webPost('/api/admin/users',{name:'Synthetic Gateway Botanist',username:'gateway.botanist',email:'gateway-botanist@example.invalid',role:'Botanist'},cookie)
  assert.equal(created.status,201);const provisioned=await created.json();assert.equal(deliveries.length,1)
  const email=deliveries[0].email,oldTemporary=deliveries[0].temporaryPassword
  const originalSession=await api('/password',{email:`  ${email.toUpperCase()}  `,password:oldTemporary});assert.equal(originalSession.user.mustChangePassword,true)
  assert.deepEqual(requestMetadata[0],{path:'/api/mobile/password',method:'POST',fields:['email','password'],bearer:false,reference:true})
  await assert.rejects(api('/me',{},originalSession.token),error=>error.status===403)
  assert.equal((await fetch(base+'/api/species?scope=scientific',{headers:{Authorization:`Bearer ${originalSession.token}`}})).status,403)
  assert.equal(plantQueries.length,0)
  const activation=memory.activationTokens[0],expiry=activation.expiresAt;activation.expiresAt=Date.now()-1
  await assert.rejects(api('/password',{email,password:oldTemporary},undefined,'POST','555555555555'),error=>error.status===401)
  assert.ok(diagnostics.some(entry=>entry.reference==='555555555555'&&entry.reason==='temporary_password_expired'))
  activation.expiresAt=expiry
  const resend=await webPost(`/api/admin/users/${provisioned.user.id}/resend`,{},cookie);assert.equal(resend.status,201);assert.equal(deliveries.length,2)
  assert.equal(await auth.session(originalSession.token),null)
  await assert.rejects(api('/password',{email,password:oldTemporary}),error=>error.status===401)
  const newest=deliveries[1].temporaryPassword
  const pending=await api('/password',{email,password:newest}),another=await api('/password',{email,password:newest})
  assert.equal(pending.user.mustChangePassword,true);assert.equal(pending.user.role,'botanist')
  const replacement='synthetic permanent gateway credential'
  const before=requestMetadata.length
  await assert.rejects(changeFirstLoginPassword({api,session:pending,password:replacement,confirmation:'mismatched synthetic confirmation'}))
  assert.equal(requestMetadata.length,before)
  await changeFirstLoginPassword({api,session:pending,password:replacement,confirmation:replacement})
  assert.deepEqual(requestMetadata.at(-1),{path:'/api/mobile/change-password',method:'POST',fields:['password'],bearer:true,reference:true})
  assert.equal(await auth.session(pending.token),null);assert.equal(await auth.session(another.token),null)
  assert.ok(memory.activationTokens.every(record=>record.used))
  await assert.rejects(api('/password',{email,password:newest}),error=>error.status===401)
  const permanent=await api('/password',{email,password:replacement});assert.equal(permanent.user.mustChangePassword,false)
  assert.equal((await api('/me',{},permanent.token)).user.id,provisioned.user.id)
  let saved=null
  const session=createFaceSessionManager({backend:'https://synthetic.invalid/api/mobile',api,validUser:validFaceUser,storage:{get:async()=>saved,set:async(_,value)=>{saved=value},remove:async()=>{saved=null}}})
  const verified=await session.establish(permanent)
  assert.equal(can(verified,'plants.create'),true);assert.equal(can(verified,'accounts.manage'),false)
  // Execute the actual mobile plant client against the gateway with the actual
  // session manager; only storage, network authority and database are isolated.
  const ts=createRequire(new URL('../../mobileapp/package.json',import.meta.url))('typescript')
  const compiled=ts.transpileModule(readFileSync(new URL('../../mobileapp/utils/plantApi.js',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  const module={exports:{}},businessRequests=[]
  new Function('require','module','exports','fetch',compiled)(name=>{
   if(name==='./faceSession')return {faceSession:session}
   assert.equal(name,'./apiConfiguration.js');return {mobileApiUrl:service=>{assert.equal(service,'plant');return 'https://synthetic.invalid'}}
  },module,module.exports,(url,options)=>{
   assert.equal(options.headers.Authorization,`Bearer ${permanent.token}`)
   const path=new URL(url).pathname+new URL(url).search;businessRequests.push(path)
   return fetch(base+path,options)
  })
  const scientific=await module.exports.plantApi('/species')
  assert.equal(scientific.species[0].conservation_status,'Synthetic status')
  assert.equal(businessRequests.at(-1),'/api/species?scope=scientific')
  assert.deepEqual(plantQueries.at(-1)[0],['public','internal'])
  await assert.rejects(module.exports.plantApi('/db-test'),/Access denied/)
  assert.equal(plantQueries.length,1)
  for(const headers of [{Authorization:`Bearer ${permanent.token}`},{Cookie:`niah_session=${permanent.token}`,Origin:'http://localhost:5173'}])assert.equal((await fetch(base+'/api/admin/users',{headers})).status,401)
  assert.equal((await fetch(base+'/api/species?scope=scientific',{headers:{Authorization:`Bearer ${permanent.token}`,Origin:'http://localhost:5173'}})).status,403)
  assert.equal((await webPost('/api/auth/login',{email,password:replacement})).status,401)
  assert.equal((await webPost('/api/auth/password',{password:'synthetic website replacement'},`niah_session=${permanent.token}`)).status,401)
  const safeLog=JSON.stringify(diagnostics)
  for(const value of [oldTemporary,newest,replacement,pending.token,permanent.token])assert.equal(safeLog.includes(value),false)
  await session.logout();assert.equal(saved,null)
  assert.equal((await fetch(base+'/api/species?scope=scientific',{headers:{Authorization:`Bearer ${permanent.token}`}})).status,401)
 }finally{await new Promise(resolve=>gateway.close(resolve));await new Promise(resolve=>server.close(resolve));await new Promise(resolve=>plant.close(resolve))}
})
