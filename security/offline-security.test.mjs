import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { sealDummyRecord, openDummyRecord } from './dummy-encryption.mjs';
const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const baseline = process.env.SECURITY_BASELINE === '1';
const source = baseline ? (await import('node:child_process')).execFileSync('git', ['show', '7241fb7:plant-conservation-backend/server.js'], {encoding:'utf8'}) : read('plant-conservation-backend/server.js');
let handler;
vm.runInNewContext(source.slice(source.indexOf('  app.use((error, _req, res, _next) => {'), source.indexOf('\n  return app;')), {app:{use:fn=>handler=fn},console:{error(){}},SyntaxError});
test('database error response confidentiality (baseline reproduces finding)', () => {
 for (const [code,expected] of [['23505',409],['23503',409],['23514',400],['22P02',400],['XX000',503]]) {
  let status,body;
  handler({code,message:'DUMMY_PRIVATE_COLUMN'}, {}, {status(n){status=n;return this},json(v){body=v}},()=>{});
  assert.equal(status,expected);
  assert.equal(body.error.includes('DUMMY_PRIVATE_COLUMN'), baseline && code !== 'XX000');
 }
});
const draftSource = baseline ? (await import('node:child_process')).execFileSync('git',['show','7241fb7:mobileapp/utils/offlineDraftStore.js'],{encoding:'utf8'}) : read('mobileapp/utils/offlineDraftStore.js');
const {createDraftStore} = await import('data:text/javascript;base64,'+Buffer.from(draftSource).toString('base64'));
function fixture(failure) {
 const rows=[{client_key:'dummy',notes:'DUMMY_PRIVATE_OBSERVATION'}], original=JSON.stringify(rows), key=randomBytes(32);
 let raw=original;
 const store=createDraftStore({storage:{getItem:async()=>raw,setItem:async(k,v)=>{if(failure==='write')throw Error('disk');raw=v}},authorize:async()=>{},encrypt:async(id,p)=>{if(failure==='encrypt')throw Error('key');return sealDummyRecord(JSON.parse(p),key,id)},decrypt:async(id,e)=>failure==='verify'?'wrong':JSON.stringify(openDummyRecord(e,key,id)),availableBytes:async()=>failure==='space'?0:1e9});
 return {store,rows,original,raw:()=>raw};
}
test('legacy plaintext conversion and encrypted restart',async()=>{
 const f=fixture();assert.deepEqual(await f.store.readDrafts('dummy-owner'),f.rows);
 assert.equal(f.raw().includes('DUMMY_PRIVATE_OBSERVATION'),baseline);
 assert.deepEqual(await f.store.readDrafts('dummy-owner'),f.rows);
});
if(!baseline) for(const failure of ['encrypt','verify','write','space']) test('conversion failure preserves original: '+failure,async()=>{
 const f=fixture(failure);await assert.rejects(f.store.readDrafts('dummy-owner'));assert.equal(f.raw(),f.original);
});
for(const category of ['personal-data','assessment','hypothetical-performance']) test('dummy encryption integrity: '+category,()=>{
 const key=randomBytes(32), record={category,subject:'dummy-person',value:'DUMMY_SECRET'},context=category+':dummy-id';
 const a=sealDummyRecord(record,key,context),b=sealDummyRecord(record,key,context);
 assert.deepEqual(openDummyRecord(a,key,context),record);assert.notEqual(a.ciphertext,b.ciphertext);
 assert.ok(!JSON.stringify(a).includes('DUMMY_SECRET'));
 assert.throws(()=>openDummyRecord(a,randomBytes(32),context));assert.throws(()=>openDummyRecord(a,key,'different-record'));
 const bytes=Buffer.from(a.ciphertext,'base64');bytes[0]^=1;
 assert.throws(()=>openDummyRecord({...a,ciphertext:bytes.toString('base64')},key,context));
 assert.throws(()=>sealDummyRecord(record,Buffer.alloc(0),context));
});
test('production password hashing with dummy passwords; no createAuth call',async()=>{
 const {hashPassword}=await import('../web/server/auth.mjs');
 const password='Dummy-only-password-2026!',a=await hashPassword(password),b=await hashPassword(password);
 assert.notEqual(a,b);assert.match(a,/^[a-f0-9]{32}:[a-f0-9]{128}$/);
 const [salt,hex]=a.split(':'),options={N:32768,r:8,p:3,maxmem:64*1024*1024};
 assert.ok(timingSafeEqual(scryptSync(password,salt,64,options),Buffer.from(hex,'hex')));
 assert.ok(!timingSafeEqual(scryptSync('wrong-dummy',salt,64,options),Buffer.from(hex,'hex')));
});
test('HTTPS production origin enforcement and mock API headers',async()=>{
 const {createAuthServer}=await import('../web/server/http.mjs');
 assert.throws(()=>createAuthServer({auth:{},env:{NODE_ENV:'production',APP_ORIGIN:'http://localhost:5173'}}),/HTTPS/);
 const server=createAuthServer({auth:{session:async()=>null},env:{NODE_ENV:'production',APP_ORIGIN:'https://dummy.example.invalid'}});
 const response=await new Promise(resolve=>server.emit('request',{url:'/health',method:'GET',headers:{},socket:{}},{headers:{},setHeader(k,v){this.headers[k]=v},writeHead(status){this.status=status},end(body){resolve({status:this.status,headers:this.headers,body:JSON.parse(body)})}}));
 assert.equal(response.status,200);assert.equal(response.headers['Cache-Control'],'no-store');assert.equal(response.headers['X-Content-Type-Options'],'nosniff');
});
if (!baseline) test('conversion ownership change prevents replacement and disclosure', async()=>{
 const original=JSON.stringify([{client_key:'owner-only',notes:'dummy'}]);
 let owner=true,raw=original;
 const store=createDraftStore({storage:{getItem:async()=>raw,setItem:async(k,v)=>{raw=v}},authorize:async()=>{if(!owner)throw Error('owner changed')},encrypt:async()=>{owner=false;return {version:1,ciphertext:'dummy'}},decrypt:async()=>original});
 await assert.rejects(store.readDrafts('dummy-owner'));assert.equal(raw,original);
});
if (!baseline) test('malformed JSON and oversized requests have generic public errors',()=>{
 for(const [error,expected,message] of [[new SyntaxError('DUMMY_PRIVATE_INPUT'),400,'Invalid request.'],[{type:'entity.too.large',message:'DUMMY_PRIVATE_INPUT'},413,'Request too large.']]){
  let status,body;handler(error,{}, {status(n){status=n;return this},json(v){body=v}},()=>{});
  assert.equal(status,expected);assert.equal(body.error,message);
 }
});
