import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {createMobileLoginGateway,gatewayRoute} from './mobile-login-gateway.mjs'
test('gateway routes match existing upstreams and reject internal/private paths',()=>{
 for(const path of ['/internal/auth/diagnostics','/internal/face/password','/face/internal/face/issue','/.env','/data/key','/auth.sqlite','//other.invalid','/face/%69nternal/issue','/unknown'])assert.equal(gatewayRoute(path),null)
 assert.deepEqual(gatewayRoute('/api/mobile/password'),{port:3001,path:'/api/mobile/password'})
 assert.deepEqual(gatewayRoute('/auth-health'),{port:3001,path:'/health'})
 assert.deepEqual(gatewayRoute('/face/face-login'),{port:8000,path:'/face-login'})
 assert.deepEqual(gatewayRoute('/face/health'),{port:8000,path:'/health'})
 assert.deepEqual(gatewayRoute('/api/species?x=1'),{port:3000,path:'/api/species?x=1'})
})

test('Face health strips the prefix, forwards real responses and returns 503 when upstream is missing',async()=>{
 const face=createServer((req,res)=>{assert.equal(req.url,'/health');res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ready:true,accountService:'authoritative'}))})
 await new Promise(r=>face.listen(0,'127.0.0.1',r))
 const port=face.address().port
 const gateway=createMobileLoginGateway({facePort:port},{trace:false})
 await new Promise(r=>gateway.listen(0,'127.0.0.1',r))
 try{
  const url=`http://127.0.0.1:${gateway.address().port}/face/health`
  const healthy=await fetch(url);assert.equal(healthy.status,200);assert.equal((await healthy.json()).ready,true)
  await new Promise(r=>face.close(r))
  const missing=await fetch(url);assert.equal(missing.status,503);assert.deepEqual(await missing.json(),{error:'Service unavailable. Please try again.'})
 }finally{await new Promise(r=>gateway.close(r));if(face.listening)await new Promise(r=>face.close(r))}
})
test('real HTTP gateway forwards auth bodies/bearer/origin, blocks redirects and hides upstream failures',async()=>{
 const received=[]
 const auth=createServer(async(req,res)=>{let raw='';for await(const c of req)raw+=c;received.push({path:req.url,body:raw,authorization:req.headers.authorization,origin:req.headers.origin,forwarded:req.headers['x-forwarded-for']});
 if(req.url==='/api/mobile/redirect'){res.writeHead(302,{Location:'https://other.invalid'});return res.end()}
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify({service:'synthetic-auth',path:req.url}))})
 await new Promise(r=>auth.listen(0,'127.0.0.1',r))
 const gateway=createMobileLoginGateway({authPort:auth.address().port,plantPort:1})
 await new Promise(r=>gateway.listen(0,'127.0.0.1',r))
 const base=`http://127.0.0.1:${gateway.address().port}`
 try{
 const r=await fetch(base+'/api/mobile/password',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer synthetic',Origin:'http://localhost:5173','X-Forwarded-For':'spoofed'},body:'{}'})
 assert.equal(r.status,200);assert.equal((await r.json()).path,'/api/mobile/password');assert.deepEqual(received[0],{path:'/api/mobile/password',body:'{}',authorization:'Bearer synthetic',origin:'http://localhost:5173',forwarded:undefined})
 assert.equal((await (await fetch(base+'/auth-health')).json()).path,'/health')
 assert.equal((await fetch(base+'/api/mobile/redirect',{redirect:'manual'})).status,502)
 assert.equal((await fetch(base+'/internal/face/issue')).status,404)
 const failed=await fetch(base+'/health');assert.equal(failed.status,503);assert.deepEqual(await failed.json(),{error:'Service unavailable. Please try again.'})
 }finally{await Promise.all([new Promise(r=>gateway.close(r)),new Promise(r=>auth.close(r))])}
})
