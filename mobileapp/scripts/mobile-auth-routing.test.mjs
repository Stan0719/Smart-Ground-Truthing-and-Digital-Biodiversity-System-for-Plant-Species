import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createMobileApi} from '../utils/faceApi.js';
import {selectApiConfiguration, validatedApiUrl} from '../utils/apiConfiguration.js';

test('auth selects development/production explicitly and unified gateways derive the mobile path',()=>{
 const settings={auth:'https://legacy.invalid/api/mobile',authDevelopment:'https://dev.invalid/api/mobile',authProduction:'https://release.invalid/api/mobile',face:'https://face.invalid'};
 assert.equal(selectApiConfiguration(settings).auth,settings.authDevelopment);
 assert.equal(selectApiConfiguration(settings,true).auth,settings.authProduction);
 assert.equal(selectApiConfiguration({auth:settings.auth},true).auth,undefined);
 assert.equal(selectApiConfiguration({backend:'https://gateway.invalid'}).auth,'https://gateway.invalid/api/mobile');
 for(const url of ['http://localhost:3001/api/mobile','https://face.invalid/face','https://auth.invalid','not a URL'])assert.throws(()=>validatedApiUrl(url,'development','auth'));
});

test('real HTTP routing keeps account operations separate from Face ID recognition',async()=>{
 const paths=[];
 const server=createServer(async(req,res)=>{paths.push(req.url);let raw='';for await(const c of req)raw+=c;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
 const api=createMobileApi({resolveUrl:s=>`https://dummy.invalid/${s==='auth'?'api/mobile':'face'}`,fetchImpl:(url,options)=>fetch(`http://127.0.0.1:${server.address().port}${new URL(url).pathname}`,options)});
 for(const path of ['/password','/change-password','/me','/logout','/register','/recovery/request','/recovery/confirm','/challenge','/face-login','/enroll'])await api(path,{dummy:true},'a'.repeat(64));
 assert.deepEqual(paths,['/api/mobile/password','/api/mobile/change-password','/api/mobile/me','/api/mobile/logout','/api/mobile/register','/api/mobile/recovery/request','/api/mobile/recovery/confirm','/face/challenge','/face/face-login','/face/enroll']);
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('missing auth config never sends credentials to Face ID',async()=>{
 let sent=false;const api=createMobileApi({resolveUrl:s=>{if(s==='auth')throw Error('Configure auth HTTPS URL');return 'https://face.invalid';},fetchImpl:()=>{sent=true;}});
 await assert.rejects(api('/password',{password:'dummy'}),e=>e.code==='API_CONFIGURATION');assert.equal(sent,false);
});

test('unreachable authentication service and invalid credentials are distinct',async()=>{
 const resolveUrl=()=> 'https://auth.invalid/api/mobile';
 const api=createMobileApi({resolveUrl,fetchImpl:async()=>{throw Error('network failed');}});
 await assert.rejects(api('/password'),e=>e.code==='API_UNREACHABLE'&&e.transient&&e.message.includes('authentication service')&&!e.message.includes('face backend'));
 const invalid=createMobileApi({resolveUrl,fetchImpl:async()=>new Response(JSON.stringify({error:'Unable to sign in.'}),{status:401})});
 await assert.rejects(invalid('/password'),e=>e.status===401&&!e.transient);
 const wrong=createMobileApi({resolveUrl,fetchImpl:async()=>new Response('{}',{status:404})});
 await assert.rejects(wrong('/password'),e=>e.code==='API_WRONG_SERVICE');
});

test('closed local port produces an authentication network error over real HTTP',async()=>{
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
 const api=createMobileApi({resolveUrl:()=> 'https://auth.invalid/api/mobile',fetchImpl:(url,options)=>fetch(`http://127.0.0.1:${port}${new URL(url).pathname}`,options)});
 await assert.rejects(api('/password'),e=>e.code==='API_UNREACHABLE');
});
