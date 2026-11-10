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

test('Expo recovery screen keeps the existing endpoints and provides localized responsive stages',()=>{
 const screen=readFileSync(new URL('../src/app/forgot-password.js',import.meta.url),'utf8');
 assert.match(screen,/faceApi\("\/recovery\/request"/);
 assert.match(screen,/faceApi\("\/recovery\/confirm"/);
 assert.match(screen,/requestLock\.current/);
 assert.match(screen,/email\.trim\(\)\.toLowerCase\(\)/);
 assert.match(screen,/result\.reset\s*!==\s*true/);
 assert.match(screen,/KeyboardAvoidingView/);
 assert.match(screen,/keyboardShouldPersistTaps="handled"/);
 assert.match(screen,/heroIcon/);
 assert.match(screen,/styles\.formCard/);
 assert.match(screen,/styles\.primaryButton/);
 assert.match(screen,/variant="plain"/,'compact shared chevron link');
 assert.match(screen,/backLink:\s*\{[^}]*alignSelf:\s*"flex-start"/,'Back link aligns to the card edge');
 assert.match(screen,/backgroundColor:\s*"#FFFFFF"/,'light card surface');
 assert.match(screen,/textAlign:\s*"left"/,'left aligned form content');
 for(const language of ['en','ms','zh']) {
  const catalogue=JSON.parse(readFileSync(new URL(`../translations/${language}.json`,import.meta.url),'utf8'));
  for(const key of ['forgotPasswordHeading','recoveryIntro','recoveryStepTitle','passwordUpdatedTitle','rememberYourPassword','signIn'])
   assert.ok(catalogue['forgot-password'][key],`${language} missing ${key}`);
 }
});

test('Expo recovery card stays compact and centered at phone and tablet widths',()=>{
 const screen=readFileSync(new URL('../src/app/forgot-password.js',import.meta.url),'utf8');
 const pageStyle=screen.match(/page:\s*\{([^}]*)\}/)?.[1]||'';
 const scrollStyle=screen.match(/scrollContent:\s*\{([^}]*)\}/)?.[1]||'';
 const maxWidth=Number(pageStyle.match(/maxWidth:\s*(\d+)/)?.[1]);
 const sidePadding=Number(scrollStyle.match(/paddingHorizontal:\s*(\d+)/)?.[1]);
 assert.equal(maxWidth,420,'tablet card cap');
 assert.equal(sidePadding,20,'comfortable viewport margins');
 assert.match(pageStyle,/alignSelf:\s*"center"/);
 assert.doesNotMatch(pageStyle,/flexGrow|minHeight/,'card height must follow its content');
 assert.match(scrollStyle,/flexGrow:\s*1/);
 assert.match(scrollStyle,/justifyContent:\s*"center"/);
 const cardWidth=(viewportWidth)=>Math.min(maxWidth,viewportWidth-(sidePadding*2));
 assert.equal(cardWidth(375),335,'iPhone card leaves 20pt side margins');
 assert.equal(cardWidth(834),420,'iPad card uses a wider cap and remains centered');
 assert.match(screen,/behavior=\{Platform\.OS === "ios" \? "padding"/,'iPhone keyboard resizes the available form viewport');
 assert.match(screen,/keyboardShouldPersistTaps="handled"/);
});
