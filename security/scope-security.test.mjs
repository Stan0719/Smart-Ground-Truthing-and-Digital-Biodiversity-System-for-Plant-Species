import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes,createHmac} from 'node:crypto';
import {createFaceServiceHandler} from '../web/server/face-service.mjs';
import {sealDummyRecord,openDummyRecord} from './dummy-encryption.mjs';
const configSource=readFileSync(new URL('../mobileapp/utils/apiConfiguration.js',import.meta.url),'utf8');
const {validatedApiUrl,selectApiConfiguration}=await import('data:text/javascript;base64,'+Buffer.from(configSource).toString('base64'));
test('mobile HTTPS URL validation rejects insecure and credential-bearing URLs without network',()=>{
 for(const value of ['http://dummy.example.invalid','https://user:secret@dummy.example.invalid','https://dummy.example.invalid/?token=dummy','https://dummy.example.invalid/#dummy'])
  assert.throws(()=>validatedApiUrl(value,'production','face'));
 for(const value of ['https://localhost','https://127.0.0.1','https://dummy.app.github.dev'])assert.throws(()=>validatedApiUrl(value,'production','face'));
 assert.equal(validatedApiUrl('https://dummy.example.invalid/face','production','face'),'https://dummy.example.invalid/face');
 assert.equal(validatedApiUrl('https://dummy.app.github.dev/face','development','face'),'https://dummy.app.github.dev/face');
 const release=selectApiConfiguration({environment:'production',faceDevelopment:'https://dev.example.invalid/face'},true);
 assert.equal(release.face,undefined);
});
test('Conservation Officer assessment dummy preparation excludes plant/location data',()=>{
 const record={id:'dummy-assessment-1',officer:'dummy-officer',assessmentType:'synthetic training exercise',result:'dummy satisfactory'};
 const key=randomBytes(32),context='conservation-officer-assessment:dummy-assessment-1';
 const sealed=sealDummyRecord(record,key,context);
 assert.deepEqual(openDummyRecord(sealed,key,context),record);
 assert.ok(!JSON.stringify(sealed).includes(record.officer));
 assert.throws(()=>openDummyRecord(sealed,key,'different-assessment'));
 const tag=Buffer.from(sealed.tag,'base64');tag[0]^=1;
 assert.throws(()=>openDummyRecord({...sealed,tag:tag.toString('base64')},key,context));
});
test('Face account bridge rejects disabled, remote, stale, forged and oversized requests before persistence',async()=>{
 const key=Buffer.alloc(32,7),timestamp='1700000000',nonce='a'.repeat(32),url='/internal/face/health';
 const auth=new Proxy({}, {get(){throw Error('No authentication or database access allowed in rejection test')}});
 async function call({enabled=true,remote='127.0.0.1',body='{}',time=timestamp,signature='0'.repeat(64),type='application/json'}={}){
  const req={method:'POST',url,socket:{remoteAddress:remote},headers:{'content-type':type,'x-face-timestamp':time,'x-face-nonce':nonce,'x-face-signature':signature},async *[Symbol.asyncIterator](){yield body}};
  let status,result;
  await createFaceServiceHandler({auth,key:enabled?key:null,now:()=>1700000000000})(req,{writeHead(n){status=n},end(raw){result=JSON.parse(raw)}});
  return {status,result};
 }
 assert.equal((await call({enabled:false})).status,404);
 assert.equal((await call({remote:'192.0.2.1'})).status,403);
 assert.equal((await call({type:'text/plain'})).status,415);
 assert.equal((await call({body:'x'.repeat(8193)})).status,413);
 assert.equal((await call()).status,403);
 const stale='1699999900',signed=createHmac('sha256',key).update(`${stale}\n${nonce}\n${url}\n{}`).digest('hex');
 assert.equal((await call({time:stale,signature:signed})).status,403);
 assert.throws(()=>createFaceServiceHandler({auth,key:Buffer.alloc(1)}),/32 bytes/);
});
