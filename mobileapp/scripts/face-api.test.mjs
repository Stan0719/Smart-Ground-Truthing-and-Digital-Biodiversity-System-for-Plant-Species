import assert from 'node:assert/strict';
import test from 'node:test';
import { createFaceClient, normalizeFaceUrl, validateFaceSession, createAuthConnectionProbe, createMobileApi } from '../utils/faceApi.js';
const url = 'https://backend.example';
const response = (status, text) => ({ status, ok: status >= 200 && status < 300, text: async () => text });

test('health probe uses the same auth hostname as login and never sends credentials',async()=>{
 const sent=[];const resolveUrl=service=>{assert.equal(service,'auth');return 'https://synthetic.invalid/api/mobile'};
 const fetchImpl=async(address,options)=>{sent.push({address,options});return response(200,'{"service":"Niah Authentication API","ready":true}')};
 const result=await createAuthConnectionProbe({resolveUrl,fetchImpl})();
 await createMobileApi({resolveUrl,fetchImpl})('/password',{email:'synthetic@example.invalid',password:'synthetic'});
 assert.equal(sent[0].address,result.base+'/health');assert.equal(sent[1].address,result.base+'/password');
 assert.equal(sent[0].options.method,'GET');assert.equal(sent[0].options.body,undefined);assert.equal(sent[0].options.credentials,'omit');assert.equal(sent[0].options.headers.Authorization,undefined);
 assert.equal(result.status,200);
});

test('probe failures always include a reference and preserve HTTP status versus network failure',async()=>{
 for(const [fetchImpl,status,code] of [[async()=>{throw Error('Network request failed')},undefined,'API_UNREACHABLE'],[async()=>response(403,'{"error":"Denied"}'),403,'API_HTTP_ERROR'],[async()=>response(200,'{"ready":false}'),200,'API_WRONG_SERVICE']]) {
  await assert.rejects(createAuthConnectionProbe({resolveUrl:()=>url,fetchImpl})(),e=>e.status===status&&e.code===code&&/^[a-f0-9]{12}$/.test(e.requestId));
 }
 await assert.rejects(createAuthConnectionProbe({resolveUrl:()=>{throw Error('Configure auth API')}})(),e=>e.code==='API_CONFIGURATION'&&/^[a-f0-9]{12}$/.test(e.requestId));
});

test('URL validation and normalization', () => {
  assert.equal(normalizeFaceUrl('https://backend.example/'),url);
  for (const invalid of ['http://localhost:8000','https://user:password@backend.example','https://backend.example/?secret=1','garbage']) assert.equal(normalizeFaceUrl(invalid), null);
});
test('empty gateway and tunnel responses have specific errors', async () => {
  for (const [status, pattern] of [[401,/access denied/],[502,/unreachable/],[200,/empty response/]]) {
    await assert.rejects(createFaceClient({url,fetchImpl:async()=>response(status,'')} )('/challenge'),pattern);
  }
});
test('malformed JSON and invalid response shapes fail safely', async () => {
  for (const text of ['<html>Login</html>','null','[]']) await assert.rejects(createFaceClient({url,fetchImpl:async()=>response(200,text)})('/challenge'));
});
test('POST image body, headers and session token match backend contract', async () => {
  const client=createFaceClient({url,fetchImpl:async(address, options)=> {
    assert.equal(address,url+'/enroll');
    assert.equal(options.headers.Authorization,'Bearer test-token');
    assert.equal(options.headers['Content-Type'],'application/json');
    assert.deepEqual(JSON.parse(options.body),{image:'aW1hZ2U=',consent:true});
    return response(200,'{"enrolled":true}');
  }});
  assert.equal((await client('/enroll',{image:'aW1hZ2U=',consent:true},'test-token')).enrolled,true);
});
test('timeout works even if fetch never settles', async () => {
  await assert.rejects(createFaceClient({url,timeoutMs:10,fetchImpl:()=>new Promise(()=>{})})('/enroll'),/timed out/);
});
test('network failure is understandable', async () => {
  await assert.rejects(createFaceClient({url,fetchImpl:async()=>{throw new TypeError('Network request failed');}})('/challenge'),/Cannot connect/);
});
test('server rejection and request reference are preserved', async () => {
  await assert.rejects(createFaceClient({url,fetchImpl:async()=>response(422,'{"error":"No face detected","requestId":"abcdef123456"}')})('/enroll'),/No face detected.*abcdef123456/);
});
test('session shape and allowed roles validated', () => {
  assert.throws(()=>validateFaceSession({token:'forged',user:{}}));
  const session={token:'a'.repeat(64),user:{id:'test',email:'test@example.com',name:'Test',role:'botanist'}};
  assert.equal(validateFaceSession(session),session);
});

test('readiness uses GET without a request body', async () => {
  const client=createFaceClient({url,fetchImpl:async(address,options)=> {
    assert.equal(address,url+'/health');
    assert.equal(options.method,'GET');
    assert.equal(options.body,undefined);
    return response(200,'{"ready":true}');
  }});
  assert.equal((await client('/health',{},undefined,'GET')).ready,true);
});

test('enrollment conflict retains typed code, status and reference', async () => {
  for (const code of ['already_enrolled', 'duplicate_face']) {
    const client = createFaceClient({url, fetchImpl: async () => response(409, JSON.stringify({error:'Enrollment conflict', code, requestId:'a835b69eb447'}))});
    await assert.rejects(client('/enroll'), error => error.status === 409 && error.code === code && error.requestId === 'a835b69eb447');
  }
});

test('shared correlation reference is sent without credentials in the body', async () => {
  const reference='abcdef123456';
  const client=createFaceClient({url,fetchImpl:async(_,options)=>{
    assert.equal(options.headers['X-Face-Request-ID'],reference);
    assert.deepEqual(JSON.parse(options.body),{});
    return response(200,JSON.stringify({requestId:reference}));
  }});
  assert.equal((await client('/challenge',{},undefined,'POST',reference)).requestId,reference);
});

test('native transport details classify only known DNS/TLS/timeout causes without leaking errors', async () => {
  for (const [code, expected] of [['ENOTFOUND','API_DNS'],['CERT_HAS_EXPIRED','API_TLS'],['UND_ERR_CONNECT_TIMEOUT','API_TIMEOUT'],['UNKNOWN','API_UNREACHABLE']]) {
    const entries=[];
    const client=createFaceClient({url,service:'auth',diagnostic:entry=>entries.push(entry),fetchImpl:async()=>{throw Object.assign(new Error('secret-password-personal-value'),{cause:{code}});}});
    await assert.rejects(client('/password',{password:'secret-password-personal-value'}),error=>error.code===expected&&/^[a-f0-9]{12}$/.test(error.requestId));
    assert.equal(entries.find(e=>e.phase==='failed_before_response').responseReceived,false);
    assert.equal(entries[0].endpoint,url+'/password');
    assert.equal(typeof entries.at(-1).durationMs,'number');
    assert.doesNotMatch(JSON.stringify(entries),/secret-password-personal-value/);
  }
});

test('HTTP and invalid response errors retain status instead of becoming transport failures', async () => {
  for(const status of [400,401,403,404,429,500]) {
    const client=createFaceClient({url,service:'auth',fetchImpl:async()=>response(status,'{"error":"Synthetic rejection"}')});
    await assert.rejects(client('/password'),error=>error.status===status&&!error.transient&&error.code!=='API_UNREACHABLE');
  }
  for(const text of ['','<html>private data</html>','[]']) {
    await assert.rejects(createFaceClient({url,fetchImpl:async()=>response(503,text)})('/password'),error=>error.status===503&&!error.transient&&!error.message.includes('private data'));
  }
  const client=createFaceClient({url,fetchImpl:async()=>({status:200,ok:true,text:async()=>{throw Error('private data')}})});
  await assert.rejects(client('/password'),error=>error.status===200&&error.code==='API_RESPONSE_INTERRUPTED');
});

test('serialization failures are not labelled as network failures and unsafe endpoint paths are rejected',async()=>{
  let calls=0;const client=createFaceClient({url,fetchImpl:async()=>{calls++;return response(200,'{}')}});
  const circular={};circular.self=circular;
  await assert.rejects(client('/password',circular),error=>error.code!=='API_UNREACHABLE');
  await assert.rejects(client('/password?secret=value'),error=>error.code==='API_CONFIGURATION');
  assert.equal(calls,0);
});
