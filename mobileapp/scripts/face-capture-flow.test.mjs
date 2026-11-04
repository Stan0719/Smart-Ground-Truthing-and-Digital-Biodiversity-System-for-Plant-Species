import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
const importSource = async path => import('data:text/javascript;base64,'+Buffer.from(readFileSync(new URL(path,import.meta.url),'utf8')).toString('base64'));
const {createFaceCameraController,runFaceCapture,FACE_CAPTURE_VERSION}=await importSource('../utils/faceCaptureFlow.js');
import {validateFaceSession} from '../utils/faceApi.js';
const {completeFaceLogin}=await importSource('../utils/completeFaceLogin.js');
const {createFaceSessionManager}=await importSource('../utils/faceSessionLifecycle.js');
const token='a'.repeat(64),challenge='b'.repeat(64),user={id:'real-account-id',email:'fixture@example.invalid',name:'Fixture',role:'botanist'};
function fixture(){
 let sequence=0,current=null,message='old enrollment error';const calls=[],logs=[];
 const controller=createFaceCameraController({reference:()=>String(++sequence).padStart(12,'0'),onChange:r=>current=r,clearMessages:()=>message='',diagnostic:(...args)=>logs.push(args)});
 const api=async(path,body,bearer)=>{
  calls.push({path,body,bearer});
  if(path==='/health')return {ready:true};
  if(path==='/challenge')return {challenge};
  if(path==='/me')return {user};
  if(path==='/face-login')return {token,user,requestId:current.id};
  if(path==='/enroll'||path==='/legacy-reenroll')return {enrolled:true,user};
  if(path==='/logout')return {};
  throw Error('Unexpected endpoint');
 };
 const run=(request,options={})=>runFaceCapture({request,api,capture:async()=>({base64:'ZmFrZS1waG90bw==',width:720,height:916}),validateSession:validateFaceSession,reference:request.id,isActive:()=>controller.isCurrent(request.id),stage:()=>{},diagnostic:(...args)=>logs.push(args),...options});
 return {controller,api,run,calls,logs,message:()=>message,current:()=>current};
}
test('Face Login handler path invokes /face-login and never /enroll',async()=>{
 const f=fixture(),request=f.controller.openLogin();await f.run(request);
 assert.deepEqual(f.calls.map(c=>c.path),['/health','/challenge','/face-login']);
 assert.equal(f.calls.at(-1).bearer,undefined);
 assert.deepEqual(f.calls.at(-1).body,{image:'ZmFrZS1waG90bw==',challenge});
 assert.ok(f.logs.some(([stage,,details])=>stage==='capture_endpoint_selected'&&details.endpoint==='/face-login'&&details.flowVersion===FACE_CAPTURE_VERSION));
});
test('Register Face requires explicit consent and authenticated same-account /me',async()=>{
 const f=fixture(),request=f.controller.openEnrollment({token,user});
 await assert.rejects(f.run(request),/explicit consent/);assert.equal(f.calls.length,0);
 await f.run(request,{consent:true});
 assert.deepEqual(f.calls.map(c=>c.path),['/health','/me','/enroll']);
 assert.deepEqual(f.calls.at(-1).body,{image:'ZmFrZS1waG90bw==',consent:true});assert.equal(f.calls.at(-1).bearer,token);
 const other=fixture(),second=other.controller.openEnrollment({token,user});
 await assert.rejects(other.run(second,{consent:true,api:async path=>path==='/health'?{ready:true}:{user:{...user,id:'different'}}}),/different account/);
});
test('closing enrollment and opening login resets mode; old callback cannot close new camera',async()=>{
 const f=fixture(),enroll=f.controller.openEnrollment({token,user});
 assert.equal(f.controller.finish(enroll.id).mode,'enroll');
 const login=f.controller.openLogin();assert.notEqual(login.id,enroll.id);
 assert.equal(f.controller.finish(enroll.id),null);assert.equal(f.current(),login);
 await f.run(login);assert.equal(f.calls.some(c=>c.path==='/enroll'),false);
});
test('closing during a pending capture prevents stale enrollment upload',async()=>{
 const f=fixture(),enroll=f.controller.openEnrollment({token,user});let resolvePhoto;
 const pending=f.run(enroll,{consent:true,capture:()=>new Promise(resolve=>{resolvePhoto=resolve;})});
 while(!resolvePhoto) await new Promise(resolve=>setTimeout(resolve,0));
 f.controller.finish(enroll.id);const login=f.controller.openLogin();
 resolvePhoto({base64:'ZmFrZQ==',width:720,height:916});assert.equal(await pending,null);
 await f.run(login);assert.equal(f.calls.some(c=>c.path==='/enroll'),false);
});
test('logout and fresh Face Login verify /me before authorized dashboard navigation',async()=>{
 const f=fixture();let saved=null;const navigation=[];
 const manager=createFaceSessionManager({storage:{get:async()=>saved,set:async(_,v)=>saved=v,remove:async()=>saved=null},api:f.api,backend:'https://fixture.invalid',validUser: u=>u?.id===user.id});
 for(let attempt=0;attempt<2;attempt++){
  const request=f.controller.openLogin(),result=await f.run(request);f.controller.finish(request.id);
  await completeFaceLogin({result,session:manager,navigation:{replace:(...args)=>navigation.push(args)},diagnostic:()=>{}});
  await manager.logout();assert.equal(saved,null);
 }
 assert.deepEqual(navigation,[['MainTabs',{screen:'AccountTab'}],['MainTabs',{screen:'AccountTab'}]]);
 assert.equal(f.calls.filter(c=>c.path==='/me').length,2);assert.equal(f.calls.some(c=>c.path==='/enroll'),false);
});
test('reload/reset clears enrollment messages and request; opening login never restores enrollment',async()=>{
 const f=fixture();assert.equal(f.message(),'old enrollment error');const old=f.controller.openEnrollment({token,user});
 f.controller.reset();assert.equal(f.message(),'');assert.equal(f.current(),null);
 const request=f.controller.openLogin();assert.equal(f.controller.finish(old.id),null);
 await f.run(request);assert.equal(f.calls.some(c=>c.path==='/enroll'),false);
 const remounted=fixture();assert.equal(remounted.controller.openLogin().mode,'recognize');assert.equal(remounted.message(),'');
});
test('invalid modes and rejected real-account verification never enroll or navigate',async()=>{
 const f=fixture();await assert.rejects(f.run({id:'invalid',mode:'registration'}),/Invalid camera operation/);assert.equal(f.calls.length,0);
 const request=f.controller.openLogin();const result=await f.run(request);let published=false;
 await assert.rejects(completeFaceLogin({result,session:{establish:async()=>{throw Error('Account restricted');}},onLogin:()=>published=true,diagnostic:()=>{}}),/restricted/);
 assert.equal(published,false);assert.equal(f.calls.some(c=>c.path==='/enroll'),false);
});
test('explicit legacy recovery needs consent, verifies /me and cannot leak into Face Login',async()=>{
 const f=fixture(),legacyProof={realPassword:'transient-real-proof',legacyEmail:'legacy@example.invalid',legacyPassword:'transient-legacy-proof'};
 const request=f.controller.openEnrollment({token,user,legacyProof});
 await assert.rejects(f.run(request),/explicit consent/);
 await f.run(request,{consent:true});
 assert.deepEqual(f.calls.map(c=>c.path),['/health','/me','/legacy-reenroll']);
 assert.equal(f.calls.at(-1).body.legacyPassword,legacyProof.legacyPassword);
 assert.equal(f.logs.some(log=>JSON.stringify(log).includes('transient-')),false);
 f.controller.finish(request.id);
 const login=f.controller.openLogin();assert.equal(login.legacyProof,undefined);
 await f.run(login);
 assert.deepEqual(f.calls.at(-1).body,{image:'ZmFrZS1waG90bw==',challenge});
});
