import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {changeFirstLoginPassword} from '../utils/firstLoginPassword.js';
const require=createRequire(import.meta.url), ts=require('typescript'), React=require('react');
const session={token:'a'.repeat(64),user:{id:'synthetic-user',name:'Synthetic',email:'synthetic@example.invalid',role:'botanist',mustChangePassword:true}};

function loginFixture({pending=null,previousError='',busy=false,email='synthetic@example.invalid',api=async()=>session,development=false,connectionCheck='',probe=async()=>({base:'https://synthetic.invalid/api/mobile',reference:'abcdef123456',status:200})}={}) {
 const states=[email,'synthetic temporary password',pending,previousError,busy,connectionCheck,false];let index=0;const assignments=[],requests=[],navigation=[];
 const hooks={...React,useEffect:()=>{},useRef:value=>({current:value}),useState:initial=>{const key=index++;return [key<states.length?states[key]:initial,value=>assignments.push([key,value])]}};
 const native={StyleSheet:{create:styles=>styles},Platform:{OS:'android'},Animated:{Value:class{interpolate(){return 0}},View:'AnimatedView',Text:'AnimatedText'}};
 for(const name of ['SafeAreaView','KeyboardAvoidingView','ScrollView','Text','View','TextInput','TouchableOpacity','Switch'])native[name]=name;
 function MandatoryScreen(){}
 const deps={react:hooks,'react-native':native,'expo-router':{router:{push:path=>navigation.push(path)}},'@expo/vector-icons':{Ionicons:'Icon'},'expo-local-authentication':{},'expo-secure-store':{},'expo-constants':{},'../utils/faceCaptureFlow':{createFaceCameraController:()=>({reset(){}})},'../utils/completeFaceLogin':{},'../utils/faceSession':{faceSession:{establish:()=>assert.fail('Pending session entered normal features')}},'../utils/faceApi':{faceApi:async(...args)=>{requests.push(args);return api(...args)},validateFaceSession:value=>value,faceDiagnostic:()=>{},faceReference:()=> '123456abcdef'},'../components/FaceCameraModal':{default:'FaceCamera',faceCameraConfigured:()=>false},'./MandatoryPasswordChange':{default:MandatoryScreen},'../utils/firstLoginPassword':{changeFirstLoginPassword}};
 const compiled=ts.transpileModule(readFileSync(new URL('../screens/Login.js',import.meta.url),'utf8'),{fileName:'Login.jsx',compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};
 deps['expo-constants']={default:{expoConfig:{hostUri:'192.0.2.1:8082'}}};
 deps['../utils/faceApi'].probeAuthConnection=probe;
 new Function('require','module','exports','__DEV__',compiled)(name=>{assert.ok(name in deps,`Unexpected dependency ${name}`);return {...deps[name],__esModule:name!=='react'}},module,module.exports,development);
 const tree=module.exports.default({navigation:{replace:()=>navigation.push('replace'),navigate:()=>navigation.push('navigate')},onLogin:()=>navigation.push('authenticated')});
 return {tree,assignments,requests,navigation,MandatoryScreen};
}
function find(node,predicate){if(!node||typeof node!=='object')return; if(predicate(node))return node;for(const child of React.Children.toArray(node.props?.children)){const found=find(child,predicate);if(found)return found;}}
function text(node){if(typeof node==='string')return node;return React.Children.toArray(node?.props?.children).map(child=>typeof child==='string'?child:text(child)).join('');}

test('actual Android login renders a prominent credential-free diagnostic control only in development',async()=>{
 const dev=loginFixture({development:true});
 const control=find(dev.tree,node=>node.props?.accessibilityLabel==='Check authentication connection (no credentials)');
 assert.ok(control);assert.match(text(dev.tree),/Development build: 20261029\.4/);
 const panel=React.Children.toArray(dev.tree.props.children).find(node=>text(node).includes('Development build:'));
 assert.ok(panel);assert.ok(find(panel,node=>node.props?.accessibilityLabel==='Check authentication connection (no credentials)'));
 assert.equal(find(find(dev.tree,node=>node.type==='KeyboardAvoidingView'),node=>node.props?.accessibilityLabel==='Check authentication connection (no credentials)'),undefined);
 assert.ok(text(dev.tree).indexOf('Development build:')<text(dev.tree).indexOf('Login with Email and Password'));
 await control.props.onPress();assert.equal(dev.requests.length,0);
 assert.ok(dev.assignments.some(([,value])=>typeof value==='string'&&value.includes('HTTP 200: Connected')&&value.includes('https://synthetic.invalid/api/mobile')));
 assert.equal(find(loginFixture().tree,node=>node.props?.accessibilityLabel==='Check authentication connection (no credentials)'),undefined);
});

test('development check displays HTTP versus transport failure, safe code and reference on screen',async()=>{
 for(const [status,code,label] of [[undefined,'API_UNREACHABLE','No HTTP response received'],[403,'API_HTTP_ERROR','HTTP 403 received']]) {
  const dev=loginFixture({development:true,probe:async()=>{throw Object.assign(Error('Synthetic failure'),{status,code,requestId:'abcdef123456'})}});
  await find(dev.tree,node=>node.props?.accessibilityLabel==='Check authentication connection (no credentials)').props.onPress();
  const result=dev.assignments.filter(([key])=>key===5).at(-1)[1];
  const updated=loginFixture({development:true,connectionCheck:result});
  const alert=find(updated.tree,node=>node.props?.accessibilityRole==='alert'&&text(node).includes(code));
  assert.ok(alert);assert.match(text(alert),new RegExp(label));assert.match(text(alert),/Reference: abcdef123456/);
  assert.equal(dev.requests.length,0);
 }
});

test('password retry clears the old reference while pending and replaces it with the current failure',async()=>{
 let reject;
 const response=new Promise((resolve,deny)=>{reject=deny});
 const view=loginFixture({previousError:'Reference: aaaaaaaaaaaa',api:()=>response});
 const button=find(view.tree,node=>node.type==='TouchableOpacity'&&text(node).includes('Login with Email and Password'));
 const attempt=button.props.onPress();
 assert.ok(view.assignments.some(([key,value])=>key===3&&value===''));
 assert.ok(view.assignments.some(([key,value])=>key===4&&value===true));
 await button.props.onPress();assert.equal(view.requests.length,1);
 reject(Error('Reference: bbbbbbbbbbbb'));await attempt;
 assert.equal(view.assignments.filter(([key])=>key===3).at(-1)[1],'Reference: bbbbbbbbbbbb');
 assert.equal(view.assignments.filter(([key])=>key===4).at(-1)[1],false);
 const pending=loginFixture({busy:true});
 assert.equal(find(pending.tree,node=>node.type==='TouchableOpacity'&&text(node)==='Signing in…').props.disabled,true);
});

test('actual Login screen switches a successful temporary login to mandatory change without establishing normal access',async()=>{
 const login=loginFixture({email:'  Synthetic@Example.Invalid  '});
 const button=find(login.tree,node=>node.type==='TouchableOpacity'&&text(node).includes('Login with Email and Password'));
 assert.ok(button);await button.props.onPress();
 assert.equal(login.requests[0][0],'/password');assert.ok(login.assignments.some(([key,value])=>key===2&&value===session));assert.equal(login.navigation.length,0);
 assert.deepEqual(login.requests[0][1],{email:'synthetic@example.invalid',password:'synthetic temporary password'});
 const mandatory=loginFixture({pending:session});assert.equal(mandatory.tree.type,mandatory.MandatoryScreen);
 assert.equal(find(mandatory.tree,node=>node.type==='TouchableOpacity'),undefined);
});

test('mandatory screen completes only after confirmed server password change, then clears pending credentials',async()=>{
 const view=loginFixture({pending:session,api:async()=>({changed:true})});
 await view.tree.props.onSubmit('new synthetic password','new synthetic password');
 assert.equal(view.requests[0][0],'/change-password');assert.equal(view.requests[0][2],session.token);
 assert.ok(view.assignments.some(([key,value])=>key===2&&value===null));assert.equal(view.navigation.length,0);
 const denied=loginFixture({pending:session,api:async()=>{throw Object.assign(Error('expired'),{status:401})}});
 await assert.rejects(denied.tree.props.onSubmit('new synthetic password','new synthetic password'));
 assert.equal(denied.assignments.some(([key,value])=>key===2&&value===null),false);
 await assert.rejects(denied.tree.props.onCancel());assert.ok(denied.assignments.some(([key,value])=>key===2&&value===null));
});

test('new-password confirmation and server acknowledgement are required',async()=>{
 let sent=0;const api=async()=>{sent++;return {changed:true}};
 for(const [password,confirmation]of [['short','short'],['a'.repeat(129),'a'.repeat(129)],['new synthetic password','different password']])await assert.rejects(changeFirstLoginPassword({api,session,password,confirmation}));
 assert.equal(sent,0);
 await assert.rejects(changeFirstLoginPassword({api,session:{...session,user:{mustChangePassword:false}},password:'new synthetic password',confirmation:'new synthetic password'}));
 await assert.rejects(changeFirstLoginPassword({api:async()=>({}),session,password:'new synthetic password',confirmation:'new synthetic password'}),/did not confirm/);
});

test('mandatory change UI contains only secure replacement fields and sign-out controls',async()=>{
 const assignments=[],values=['replacement synthetic password','replacement synthetic password','',false];let index=0;
 const hooks={...React,useRef:initial=>({current:initial}),useState:initial=>{const key=index++;return [values[key]??initial,value=>assignments.push([key,value])]}};
 const native={StyleSheet:{create:styles=>styles},Platform:{OS:'android'}};
 for(const name of ['KeyboardAvoidingView','SafeAreaView','ScrollView','Text','TextInput','TouchableOpacity'])native[name]=name;
 const compiled=ts.transpileModule(readFileSync(new URL('../screens/MandatoryPasswordChange.js',import.meta.url),'utf8'),{fileName:'Mandatory.jsx',compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};new Function('require','module','exports',compiled)(name=>name==='react'?hooks:native,module,module.exports);
 let submitted;
 const tree=module.exports.default({onSubmit:async(...args)=>{submitted=args},onCancel:async()=>{}});
 for(const label of ['New password','Confirm new password'])assert.equal(find(tree,node=>node.props?.accessibilityLabel===label).props.secureTextEntry,true);
 assert.doesNotMatch(text(tree),/Continue as Guest|Face ID|New visitor|Forget password/);
 await find(tree,node=>node.type==='TouchableOpacity'&&text(node)==='Change password').props.onPress();
 assert.deepEqual(submitted,values.slice(0,2));assert.ok(assignments.some(([key,value])=>key===3&&value===true));
});
