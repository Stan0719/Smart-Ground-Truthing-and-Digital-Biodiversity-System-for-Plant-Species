import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {randomBytes} from 'node:crypto';
import {sealDummyRecord,openDummyRecord} from './dummy-encryption.mjs';
import {createAuthServer} from '../web/server/http.mjs';
const source=readFileSync(new URL('../mobileapp/utils/offlineDraftStore.js',import.meta.url),'utf8');
const {createDraftStore}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
for(const [category,record] of [
 ['personal',{name:'Dummy Person',email:'dummy@example.invalid'}],
 ['officer-assessment',{id:'dummy-assessment',officer:'dummy-officer',type:'synthetic training assessment',result:'dummy pass'}],
]) test(category+': missing keys, context, malformed envelope and encryption failures',()=>{
 const key=randomBytes(32),context=category+':dummy',envelope=sealDummyRecord(record,key,context);
 assert.deepEqual(openDummyRecord(envelope,key,context),record);
 for(const missing of [undefined,null,Buffer.alloc(0),Buffer.alloc(31),'not-a-key']){
  assert.throws(()=>sealDummyRecord(record,missing,context),/32-byte/);
  assert.throws(()=>openDummyRecord(envelope,missing,context),/32-byte/);
 }
 assert.throws(()=>sealDummyRecord(record,key,''),/context/);
 assert.throws(()=>openDummyRecord(envelope,key,''),/context/);
 for(const bad of [null,{...envelope,version:2},{...envelope,tag:Buffer.from(envelope.tag,'base64').subarray(0,4).toString('base64')},{...envelope,iv:'bad'},{...envelope,ciphertext:'!!!'}])assert.throws(()=>openDummyRecord(bad,key,context));
 const cyclic={};cyclic.self=cyclic;assert.throws(()=>sealDummyRecord(cyclic,key,context));
 assert.ok(!JSON.stringify(envelope).includes(record.officer||record.email));
});
async function mockResponse(server,path){
 return new Promise(resolve=>server.emit('request',{url:path,method:'GET',headers:{},socket:{remoteAddress:'127.0.0.1'}},{headers:{},setHeader(k,v){this.headers[k]=v},writeHead(status){this.status=status},end(body){resolve({status:this.status,headers:this.headers,body:JSON.parse(body)})}}));
}
test('actual web handler clears cookies with secure flags in production and preserves HTTP development',async()=>{
 for(const production of [true,false]){
  const server=createAuthServer({auth:{session:async()=>null},env:production?{NODE_ENV:'production',APP_ORIGIN:'https://dummy.example.invalid'}:{NODE_ENV:'development',APP_ORIGIN:'http://localhost:5173'}});
  const r=await mockResponse(server,'/api/auth/me');
  assert.equal(r.status,401);const cookie=r.headers['Set-Cookie'];
  assert.match(cookie,/HttpOnly; SameSite=Strict; Path=\//);assert.match(cookie,/Max-Age=0/);assert.equal(cookie.includes('; Secure'),production);
  assert.equal(r.headers['Cache-Control'],'no-store');assert.equal(r.headers['X-Content-Type-Options'],'nosniff');assert.equal(r.headers['Content-Type'],'application/json');
 }
});
test('actual cookie formatter issues dummy session cookies with production/development flags without SQL',()=>{
 const src=readFileSync(new URL('../web/server/http.mjs',import.meta.url),'utf8');
 const formatter=src.slice(src.indexOf('  const cookie ='),src.indexOf('  const server ='));
 for(const secure of [true,false]){
  const result=vm.runInNewContext(formatter+'\ncookie("a".repeat(64))',{secure});
  assert.match(result,/Max-Age=28800/);assert.equal(result.includes('; Secure'),secure);assert.match(result,/HttpOnly; SameSite=Strict/);
 }
});
test('web error responses hide dummy internal details without database calls',async()=>{
 const original=console.error,logs=[];console.error=(...args)=>logs.push(args.join(' '));
 try{
  for(const [error,status] of [[{name:'Error',message:'DUMMY_PRIVATE_STACK'},500],[{code:'23505',message:'DUMMY_PRIVATE_COLUMN'},409],[{status:404,message:'DUMMY_PRIVATE_PATH'},404]]){
   const server=createAuthServer({auth:{session:async()=>{throw error}},env:{NODE_ENV:'production',APP_ORIGIN:'https://dummy.example.invalid'}});
   const r=await mockResponse(server,'/api/auth/me');assert.equal(r.status,status);assert.ok(!JSON.stringify(r).includes('DUMMY_PRIVATE'));
  }
  assert.ok(!logs.join('\n').includes('DUMMY_PRIVATE'));
 }finally{console.error=original;}
});
test('generic offline drafts: wrong key/account, corrupt data, failed conversion and retry preserve bytes',async()=>{
 const key=randomBytes(32),rows=[{client_key:'dummy',label:'ordinary synthetic draft'}],initial=JSON.stringify(rows);
 let raw=initial,full=true;
 const make=(owner='owner',decryptionKey=key)=>createDraftStore({storage:{getItem:async()=>raw,setItem:async(k,v)=>{if(full)throw Error('disk full');raw=v}},authorize:async id=>{if(id!==owner)throw Error('wrong account')},encrypt:async(id,p)=>sealDummyRecord(JSON.parse(p),key,id),decrypt:async(id,e)=>JSON.stringify(openDummyRecord(e,decryptionKey,id))});
 await assert.rejects(make().readDrafts('owner'));assert.equal(raw,initial);
 full=false;assert.deepEqual(await make().readDrafts('owner'),rows);assert.ok(!raw.includes(rows[0].label));
 const encrypted=raw;
 await assert.rejects(make('other').readDrafts('owner'));assert.equal(raw,encrypted);
 await assert.rejects(make('owner',randomBytes(32)).readDrafts('owner'));assert.equal(raw,encrypted);
 const envelope=JSON.parse(raw),bytes=Buffer.from(envelope.ciphertext,'base64');bytes[0]^=1;raw=JSON.stringify({...envelope,ciphertext:bytes.toString('base64')});const corrupt=raw;
 await assert.rejects(make().readDrafts('owner'));assert.equal(raw,corrupt);
 raw=encrypted;assert.deepEqual(await make().readDrafts('owner'),rows);
});
