import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import ts from '../../web/node_modules/typescript/lib/typescript.js';
const sfc=readFileSync(new URL('../../web/src/views/ForgotPasswordView.vue',import.meta.url),'utf8');
const script=sfc.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1].replace(/import[^\n]+\n/g,'');
function setup(){
 const calls=[],context=vm.createContext({ref:v=>({value:v}),api:async(path,method,body)=>{
  calls.push({path,method,body});return path.endsWith('/request')?{recoveryId:'a'.repeat(32),message:'Recovery request accepted.'}:{reset:true};
 }});
 vm.runInContext(ts.transpileModule(script+'\nglobalThis.flow={email,code,password,confirm,requestId,message,error,busy,done,submit};',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,context);
 return {flow:context.flow,calls};
}
test('recovery UI calls server request/confirm and clears password/code only after confirmation',async()=>{
 const {flow,calls}=setup();flow.email.value=' Visitor@Example.invalid ';await flow.submit();
 assert.equal(calls[0].path,'/auth/recovery/request');assert.equal(calls[0].body.email,'visitor@example.invalid');
 flow.code.value='123456';flow.password.value='replacement-test-password';flow.confirm.value=flow.password.value;
 await flow.submit();assert.equal(calls[1].path,'/auth/recovery/confirm');assert.equal(calls[1].body.recoveryId,'a'.repeat(32));
 assert.equal(flow.done.value,true);assert.equal(flow.password.value,'');assert.equal(flow.code.value,'');
});
test('mismatched password never invokes reset endpoint',async()=>{
 const {flow,calls}=setup();await flow.submit();flow.password.value='one';flow.confirm.value='two';await flow.submit();
 assert.equal(calls.length,1);assert.equal(flow.done.value,false);assert.match(flow.error.value,/match/);
});
