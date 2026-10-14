import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
const source = readFileSync(new URL('../utils/faceApi.js', import.meta.url), 'utf8');
const { createFaceClient, normalizeFaceUrl, validateFaceSession } = await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const url = 'https://backend.example';
const response = (status, text) => ({ status, ok: status >= 200 && status < 300, text: async () => text });

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
  await assert.rejects(createFaceClient({url,fetchImpl:async()=>response(422,'{"error":"No face detected","requestId":"abc"}')})('/enroll'),/No face detected.*abc/);
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
