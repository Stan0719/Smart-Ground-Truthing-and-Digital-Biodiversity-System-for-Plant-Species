import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {changeFirstLoginPassword} from '../utils/firstLoginPassword.js';
import {createFaceCameraController,FACE_CAPTURE_VERSION} from '../utils/faceCaptureFlow.js';
import {createLocalization,createDisplayTranslator} from '../translations/core.js';
const require=createRequire(import.meta.url), ts=require('typescript'), React=require('react');
const english=JSON.parse(readFileSync(new URL('../translations/en.json',import.meta.url),'utf8'));
const fixtureI18n=createLocalization({storage:{getItem:async()=>null,setItem:async()=>{}},resources:{en:{translation:english}}}).i18n;
const display=createDisplayTranslator(fixtureI18n,english);
const translationFixture={t:(key,values)=>fixtureI18n.t(key,values),translateLabel:display.label,translateUIMessage:display.message,useAppTranslation:()=>({i18n:fixtureI18n})};
const sharedStylesModule={exports:{}};
const sharedStylesSource=ts.transpileModule(readFileSync(new URL('../components/authNavigationStyles.js',import.meta.url),'utf8'),{fileName:'authNavigationStyles.js',compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
new Function('require','module','exports',sharedStylesSource)(()=>({StyleSheet:{create:styles=>styles}}),sharedStylesModule,sharedStylesModule.exports);
const {authNavigationStyles}=sharedStylesModule.exports;
const session={token:'a'.repeat(64),user:{id:'synthetic-user',name:'Synthetic',email:'synthetic@example.invalid',role:'botanist',mustChangePassword:true}};

function loginFixture({cameraEnabled=false,register=false,pending=null,previousError='',busy=false,email='synthetic@example.invalid',api=async()=>session,development=false,connectionCheck='',expandedFace=false,expandedBenefits=false,faceWorkflow=null,previousEmail='',previousPassword='',probe=async()=>({base:'https://synthetic.invalid/api/mobile',reference:'abcdef123456',status:200})}={}) {
 const states=[email,'synthetic temporary password',pending,previousError,busy,connectionCheck,false,null,register];let index=0;const assignments=[],requests=[],navigation=[],cameras=[],alerts=[];
 const hooks={...React,useEffect:()=>{},useRef:value=>({current:value}),useState:initial=>{const key=index++;return [key===10?expandedFace:key===11?expandedBenefits:key===12?faceWorkflow:key===13?previousEmail:key===14?previousPassword:key<states.length?states[key]:initial,value=>assignments.push([key,value])]}};
 const native={Alert:{alert:(...args)=>alerts.push(args)},StyleSheet:{create:styles=>styles},Platform:{OS:'android'},Animated:{Value:class{interpolate(){return 0}},View:'AnimatedView',Text:'AnimatedText'}};
 for(const name of ['SafeAreaView','KeyboardAvoidingView','ScrollView','Text','View','TextInput','TouchableOpacity','Switch','Modal'])native[name]=name;
 function MandatoryScreen(){}
 const deps={'../translations/i18n':translationFixture,'../components/LanguageSelector':{default:'LanguageSelector'},'../components/authNavigationStyles':{authNavigationStyles},react:hooks,'react-native':native,'expo-router':{router:{push:path=>navigation.push(path)}},'@expo/vector-icons':{Ionicons:'Icon'},'expo-local-authentication':{},'expo-secure-store':{},'expo-constants':{},'../utils/faceCaptureFlow':{FACE_CAPTURE_VERSION,createFaceCameraController:options=>createFaceCameraController({...options,onChange:request=>{options.onChange(request);if(request)cameras.push(request);}})},'../utils/completeFaceLogin':{},'../utils/faceSession':{faceSession:{establish:async result=>{assert.notEqual(result.user.mustChangePassword,true,'Pending session entered normal features');return result.user;}}},'../utils/faceApi':{faceApi:async(...args)=>{requests.push(args);return api(...args)},validateFaceSession:value=>value,faceDiagnostic:()=>{},faceReference:()=> '123456abcdef'},'../components/FaceCameraModal':{default:'FaceCamera',faceCameraConfigured:()=>cameraEnabled},'./MandatoryPasswordChange':{default:MandatoryScreen},'../utils/firstLoginPassword':{changeFirstLoginPassword}};
 deps['../components/PasswordVisibilityButton']={default:'PasswordVisibilityButton'};
 const compiled=ts.transpileModule(readFileSync(new URL('../screens/Login.js',import.meta.url),'utf8'),{fileName:'Login.jsx',compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};
 deps['expo-constants']={default:{expoConfig:{hostUri:'192.0.2.1:8082'}}};
 deps['react-native-safe-area-context']={SafeAreaView:'SafeAreaView'};
 deps['../utils/faceApi'].probeAuthConnection=probe;
 new Function('require','module','exports','__DEV__',compiled)(name=>{assert.ok(name in deps,`Unexpected dependency ${name}`);return {...deps[name],__esModule:name!=='react'}},module,module.exports,development);
 const tree=module.exports.default({navigation:{replace:()=>navigation.push('replace'),navigate:()=>navigation.push('navigate')},onLogin:()=>navigation.push('authenticated')});
 return {tree,assignments,requests,navigation,MandatoryScreen,cameras,alerts};
}
function find(node,predicate){if(!node||typeof node!=='object')return; if(predicate(node))return node;for(const child of React.Children.toArray(node.props?.children)){const found=find(child,predicate);if(found)return found;}}
function text(node){if(typeof node==='string')return node;return React.Children.toArray(node?.props?.children).map(child=>typeof child==='string'?child:text(child)).join('');}

function registerFixture(){
 const navigation=[],assignments=[],requests=[];let index=0;
 const hooks={...React,useEffect:()=>{},useRef:value=>({current:value}),useState:initial=>{const key=index++;return [initial,value=>assignments.push([key,value])];}};
 const native={StyleSheet:{create:styles=>styles},Platform:{OS:'android'},Animated:{Value:class{interpolate(){return 0}},View:'AnimatedView',Text:'AnimatedText'}};
 for(const name of ['KeyboardAvoidingView','ScrollView','Text','View','TextInput','TouchableOpacity'])native[name]=name;
 const deps={'../translations/i18n':translationFixture,'../components/authNavigationStyles':{authNavigationStyles},react:hooks,'react-native':native,'react-native-safe-area-context':{SafeAreaView:'SafeAreaView'},'@expo/vector-icons':{Ionicons:'Icon'},'../utils/faceApi':{faceApi:async(...args)=>{requests.push(args);return {};}}};
 deps['../components/PasswordVisibilityButton']={default:'PasswordVisibilityButton'};
 const compiled=ts.transpileModule(readFileSync(new URL('../screens/VisitorRegister.js',import.meta.url),'utf8'),{fileName:'VisitorRegister.jsx',compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};
 new Function('require','module','exports',compiled)(name=>{assert.ok(name in deps,`Unexpected dependency ${name}`);return {...deps[name],__esModule:name!=='react'}},module,module.exports);
 return {tree:module.exports.default({navigation:{goBack:()=>navigation.push('back'),navigate:screen=>navigation.push(screen)}}),navigation,assignments,requests};
}

test('Login and Register use the same secondary navigation design and retain their destinations',()=>{
 const login=loginFixture();
 const register=registerFixture();
 const create=find(login.tree,node=>node.type==='TouchableOpacity'&&text(node)==='Create an Account');
 const signIn=find(register.tree,node=>node.type==='TouchableOpacity'&&text(node)==='Log In');
 assert.ok(create);assert.ok(signIn);
 assert.strictEqual(create.props.style,authNavigationStyles.button);
 assert.strictEqual(signIn.props.style,authNavigationStyles.button);
 assert.strictEqual(React.Children.only(create.props.children).props.style,authNavigationStyles.text);
 assert.strictEqual(React.Children.only(signIn.props.children).props.style,authNavigationStyles.text);
 assert.equal(create.props.activeOpacity,signIn.props.activeOpacity);
 assert.equal(create.props.style.width,'100%');
 assert.ok(create.props.style.minHeight>=48);
 assert.equal(signIn.props.accessibilityLabel,'Log In');
 create.props.onPress();signIn.props.onPress();
 assert.deepEqual(login.navigation,['navigate']);
 assert.deepEqual(register.navigation,['back']);
 const card=find(register.tree,node=>node.type==='AnimatedView'&&node.props.style[0].maxWidth===390);
 assert.ok(card);
 assert.equal(find(register.tree,node=>node.type==='ScrollView').props.contentContainerStyle.flexGrow,1);
 for(const locale of ['en','ms','zh']){
  const labels=JSON.parse(readFileSync(new URL(`../translations/${locale}.json`,import.meta.url),'utf8'));
  assert.ok(labels.login.createAnAccount);
  assert.ok(labels.login.logIn);
 }
});

test('Register keeps required-field validation and does not submit an empty form',async()=>{
 const register=registerFixture();
 const submit=find(register.tree,node=>node.type==='TouchableOpacity'&&text(node)==='Create Account');
 assert.ok(submit);
 await submit.props.onPress();
 assert.equal(register.requests.length,0);
 assert.ok(register.assignments.some(([,value])=>value?.name==='Full Name is required.'&&value?.email==='Email is required.'));
});

test('Login exposes the language selector without requiring authentication',()=>{
 const login=loginFixture();
 assert.ok(find(login.tree,node=>node?.type==='LanguageSelector'));
 assert.equal(login.requests.length,0);
});

test('Login keeps advanced settings and account help in compact dialogs',async()=>{
 const collapsed=loginFixture({cameraEnabled:true});
 assert.ok(find(collapsed.tree,node=>node.type==='TouchableOpacity'&&text(node)==='Log In with Face ID'));
 assert.equal(find(collapsed.tree,node=>node.type==='TouchableOpacity'&&text(node)==='Set Up Face ID'),undefined);
 assert.equal(find(collapsed.tree,node=>node.type==='TouchableOpacity'&&text(node)==='Remove Face ID'),undefined);
 assert.equal(find(collapsed.tree,node=>node.type==='Text'&&text(node)==='Without a Visitor Account'),undefined);
 assert.equal(text(collapsed.tree).includes("Explore Niah's biodiversity as a visitor"),false);
 assert.equal(text(collapsed.tree).includes('Face flow:'),false);
 assert.ok(text(collapsed.tree).includes('Log in to your account'));
 assert.ok(text(collapsed.tree).indexOf('Log In')<text(collapsed.tree).indexOf('Log In with Face ID'));
 const passwordButton=find(collapsed.tree,node=>node.type==='TouchableOpacity'&&text(node)==='Log In');
 const faceButton=find(collapsed.tree,node=>node.type==='TouchableOpacity'&&text(node)==='Log In with Face ID');
 const registrationButton=find(collapsed.tree,node=>node.type==='TouchableOpacity'&&text(node)==='Create an Account');
 const settingsButton=find(collapsed.tree,node=>node.type==='TouchableOpacity'&&text(node)==='Face ID Settings');
 assert.equal(passwordButton.props.accessibilityLabel,'Login with Email and Password');
 assert.equal(passwordButton.props.style.height,52);
 assert.equal(faceButton.props.accessibilityLabel,'Log In with Face ID');
 assert.equal(faceButton.props.style.minHeight,48);
 assert.equal(registrationButton.props.accessibilityLabel,'Create an Account');
 assert.equal(registrationButton.props.style.minHeight,50);
 registrationButton.props.onPress();
 assert.ok(collapsed.navigation.includes('navigate'));
 assert.equal(settingsButton.props.style.minHeight,48);
 assert.ok(find(collapsed.tree,node=>node.type==='TouchableOpacity'&&text(node)==='Continue as Guest'));
 const card=find(collapsed.tree,node=>node.type==='AnimatedView'&&node.props?.style?.some?.(style=>style?.maxWidth===390));
 const scroller=find(collapsed.tree,node=>node.type==='ScrollView'&&node.props?.contentContainerStyle?.flexGrow===1);
 assert.ok(card,'the Login card keeps its tablet width cap');
 assert.ok(scroller,'the Login card remains scrollable on small screens');
 assert.equal(card.props.style[0].width,'100%');
 assert.equal(scroller.props.contentContainerStyle.paddingHorizontal,20);
 assert.equal(find(collapsed.tree,node=>node.type==='KeyboardAvoidingView').props.behavior,'height');
 assert.equal(find(collapsed.tree,node=>node.type==='KeyboardAvoidingView').props.style.overflow,undefined);
 settingsButton.props.onPress();
 find(collapsed.tree,node=>node.type==='TouchableOpacity'&&text(node)==='Why Create a Visitor Account?').props.onPress();
 assert.ok(collapsed.assignments.some(([key,value])=>key===10&&value===true));
 assert.ok(collapsed.assignments.some(([key,value])=>key===11&&value===true));
 const expanded=loginFixture({cameraEnabled:true,expandedFace:true,expandedBenefits:true});
 const settingsModal=find(expanded.tree,node=>node.type==='Modal'&&text(node).includes('Set Up Face ID'));
 assert.ok(settingsModal);
 assert.equal(find(expanded.tree,node=>node.type==='View'&&node.props?.style?.maxWidth===430).props.style.width,'100%');
 assert.ok(find(expanded.tree,node=>node.type==='TouchableOpacity'&&text(node)==='Set Up Face ID'));
 assert.equal(find(expanded.tree,node=>node.props?.accessibilityLabel==='Previous account email'),undefined);
 assert.ok(find(expanded.tree,node=>node.type==='Text'&&text(node)==='Without a Visitor Account'));
 assert.ok(find(expanded.tree,node=>node.type==='Text'&&text(node)==='With a Visitor Account'));
 assert.match(text(expanded.tree),/scan QR codes/);
 assert.match(text(expanded.tree),/authorized Botanists/);
 settingsModal.props.onRequestClose();
 assert.ok(expanded.assignments.some(([key,value])=>key===10&&value===false));
 find(expanded.tree,node=>node.type==='TouchableOpacity'&&text(node)==='Link Existing Face ID').props.onPress();
 assert.ok(expanded.assignments.some(([key,value])=>key===12&&value==='link'));
 const linked=loginFixture({cameraEnabled:true,expandedFace:true,faceWorkflow:'link'});
 assert.ok(find(linked.tree,node=>node.props?.label==='Previous account email'));
 assert.ok(find(linked.tree,node=>node.props?.label==='Previous account password'));
 const remove=loginFixture({cameraEnabled:true,expandedFace:true,faceWorkflow:'remove'});
 find(remove.tree,node=>node.type==='TouchableOpacity'&&text(node)==='Remove Face ID').props.onPress();
 assert.equal(remove.requests.length,0,'removal waits for confirmation');
 await remove.alerts[0][2][1].onPress();
 assert.deepEqual(remove.requests.map(([path])=>path),['/password','/delete-face']);
 find(expanded.tree,node=>node.type==='TouchableOpacity'&&text(node)==='Create an Account').props.onPress();
 assert.ok(expanded.navigation.includes('navigate'));
});

test('registration selection authenticates before opening enrollment and never opens recognition',async()=>{
 const permanent={...session,user:{...session.user,mustChangePassword:false}};
 const view=loginFixture({cameraEnabled:true,register:true,api:async path=>path==='/password'?permanent:{user:permanent.user,enrolled:false}});
 const button=find(view.tree,node=>node.type==='TouchableOpacity'&&text(node)==='Log In');
 const pending=button.props.onPress();
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(view.requests.map(args=>args[0]),['/password','/enrollment-status']);
 assert.equal(view.cameras.length,1);assert.equal(view.cameras[0].mode,'enroll');
 assert.equal(view.cameras[0].userId,permanent.user.id);assert.equal(view.cameras[0].token,permanent.token);
 assert.equal(view.navigation.length,0);assert.equal(view.alerts.length,0);
 find(view.tree,node=>node.type==='FaceCamera').props.onResult({enrolled:true,user:permanent.user},view.cameras[0].id);
 await pending;
 assert.equal(view.alerts[0][0],'Face registered');assert.deepEqual(view.navigation,['authenticated']);
});

test('dedicated setup enrolls, while Face ID always opens recognition even with optional enrollment selected',async()=>{
 const permanent={...session,user:{...session.user,mustChangePassword:false}};
 const view=loginFixture({cameraEnabled:true,expandedFace:true,faceWorkflow:'setup',api:async path=>path==='/password'?permanent:{user:permanent.user,enrolled:false}});
 const pending=find(view.tree,node=>node.type==='TouchableOpacity'&&text(node)==='Set Up Face ID').props.onPress();
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(view.requests.map(args=>args[0]),['/password','/enrollment-status']);
 assert.equal(view.cameras[0].mode,'enroll');
 find(view.tree,node=>node.type==='FaceCamera').props.onResult(null,view.cameras[0].id);
 await pending;
 const selected=loginFixture({cameraEnabled:true,expandedFace:true});
 find(selected.tree,node=>node.props?.accessibilityLabel==='Set up Face ID after login').props.onValueChange(true);
 find(selected.tree,node=>node.type==='TouchableOpacity'&&text(node)==='Log In with Face ID').props.onPress();
 assert.equal(selected.cameras.length,1);assert.equal(selected.cameras[0].mode,'recognize');
 assert.equal(selected.requests.length,0);
});

test('dedicated registration with temporary password waits for mandatory change and preserves intent',async()=>{
 const view=loginFixture({cameraEnabled:true,expandedFace:true,faceWorkflow:'setup'});
 await find(view.tree,node=>node.type==='TouchableOpacity'&&text(node)==='Set Up Face ID').props.onPress();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(view.cameras.length,0);
 assert.ok(view.assignments.some(([key,value])=>key===8&&value===true));
 assert.ok(view.assignments.some(([key,value])=>key===2&&value===session));
});

test('linking and adding a new face scan keep separate password-verified consent flows',async()=>{
 const permanent={...session,user:{...session.user,mustChangePassword:false}};
 const options={cameraEnabled:true,expandedFace:true,previousEmail:'prior@example.invalid',previousPassword:'prior synthetic password',
  api:async path=>path==='/password'?permanent:path==='/legacy-link'?{enrolled:true}:{}};
 const link=loginFixture({...options,faceWorkflow:'link'});
 const linking=find(link.tree,node=>node.type==='TouchableOpacity'&&text(node)==='Link Existing Face ID').props.onPress();
 assert.equal(link.requests.length,0);
 assert.match(link.alerts[0][1],/previous face scan/);
 link.alerts[0][2][1].onPress();await linking;
 assert.deepEqual(link.requests.map(([path])=>path),['/password','/legacy-link','/logout']);
 assert.equal(link.cameras.length,0);

 const add=loginFixture({...options,faceWorkflow:'add'});
 const adding=find(add.tree,node=>node.type==='TouchableOpacity'&&text(node)==='Add New Face Scan').props.onPress();
 assert.equal(add.requests.length,0);
 assert.match(add.alerts[0][1],/previous scan/);
 add.alerts[0][2][1].onPress();
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(add.requests.map(([path])=>path),['/password']);
 assert.equal(add.cameras[0].mode,'enroll');
 assert.equal(add.cameras[0].legacyProof.legacyEmail,'prior@example.invalid');
 const layers=React.Children.toArray(add.tree.props.children);
 assert.ok(layers.findIndex(node=>node.type==='FaceCamera')>layers.findIndex(node=>node.type==='Modal'),
  'the capture camera opens above Face ID Settings');
 find(add.tree,node=>node.type==='FaceCamera').props.onResult({enrolled:true},add.cameras[0].id);
 await adding;
 assert.deepEqual(add.requests.map(([path])=>path),['/password','/logout']);
});

test('temporary password cannot open registration and selection survives mandatory password change',async()=>{
 const view=loginFixture({cameraEnabled:true,register:true});
 await find(view.tree,node=>node.type==='TouchableOpacity'&&text(node)==='Log In').props.onPress();
 assert.equal(view.cameras.length,0);assert.deepEqual(view.requests.map(args=>args[0]),['/password']);
 assert.equal(view.assignments.some(([key,value])=>key===8&&value===false),false);
 const mandatory=loginFixture({cameraEnabled:true,register:true,pending:session,api:async()=>({changed:true})});
 await mandatory.tree.props.onSubmit('replacement synthetic password','replacement synthetic password');
 assert.equal(mandatory.assignments.some(([key,value])=>key===8&&value===false),false);
 assert.equal(mandatory.cameras.length,0);
});

test('missing enrollment closes recognition and selects password registration instead of another scan',()=>{
 const view=loginFixture({cameraEnabled:true});
 find(view.tree,node=>node.type==='TouchableOpacity'&&text(node)==='Log In with Face ID').props.onPress();
 assert.equal(view.cameras[0].mode,'recognize');
 find(view.tree,node=>node.type==='FaceCamera').props.onResult({enrollmentRequired:true},view.cameras[0].id);
 assert.ok(view.assignments.some(([key,value])=>key===8&&value===true));
 assert.ok(view.assignments.some(([,value])=>typeof value==='string'&&value.includes('No face scan found')));
 assert.equal(view.cameras.length,1);assert.equal(view.requests.length,0);
});

test('registration cancellation and wrong-account acknowledgement never announce success',async()=>{
 const permanent={...session,user:{...session.user,mustChangePassword:false}};
 for(const result of [null,{enrolled:true,user:{...permanent.user,id:'another-user'}}]){
  const view=loginFixture({cameraEnabled:true,register:true,api:async path=>path==='/password'?permanent:{user:permanent.user,enrolled:false}});
  const pending=find(view.tree,node=>node.type==='TouchableOpacity'&&text(node)==='Log In').props.onPress();
  await new Promise(resolve=>setImmediate(resolve));
  find(view.tree,node=>node.type==='FaceCamera').props.onResult(result,view.cameras[0].id);
  await pending;
  assert.equal(view.alerts.some(([title])=>title==='Face registered'),false);
 }
});

test('actual camera shows registration consent and only missing enrollment exits recognition',async()=>{
 for(const [mode,code] of [['recognize','not_enrolled'],['recognize','face_not_matched'],['enroll','not_enrolled']]){
  const results=[],states=[];let index=0,refIndex=0;
  const hooks={...React,useEffect:()=>{},useCallback:callback=>callback,
   useRef:value=>({current:refIndex++===0?{}:value}),useState:initial=>{
    const key=index++;return [key===0?true:initial,value=>states.push(value)];
   }};
  const native={Modal:'Modal',SafeAreaView:'SafeAreaView',Text:'Text',TouchableOpacity:'TouchableOpacity',View:'View',
   ScrollView:'ScrollView',ActivityIndicator:'ActivityIndicator',StyleSheet:{create:styles=>styles},useWindowDimensions:()=>({width:390,height:844})};
  const deps={'../translations/i18n':translationFixture,'../components/LanguageSelector':{default:'LanguageSelector'},react:hooks,'react-native':native,'expo-camera':{CameraView:'Camera',useCameraPermissions:()=>[{granted:true},()=>{}]},
   '../utils/faceApi':{faceReference:()=> 'abcdef123456',faceDiagnostic:()=>{}},
   '../utils/faceCaptureFlow':{runFaceCapture:async()=>{throw Object.assign(Error('Synthetic capture rejection'),{code});}}};
  const compiled=ts.transpileModule(readFileSync(new URL('../components/FaceCameraModal.js',import.meta.url),'utf8'),{fileName:'Camera.jsx',compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};new Function('require','module','exports',compiled)(name=>({...deps[name],__esModule:name!=='react'}),module,module.exports);
  const modal=module.exports.default({request:{mode,id:'camera-request'},isCurrent:()=>true,onResult:(...args)=>results.push(args)});
  const capture=modal.props.children;
  // A mounted native camera ref; no actual camera or image is used.
  const tree=capture.type(capture.props);
  const label=mode==='enroll'?'Agree and register my face':'Scan and Log In';
  assert.ok(text(tree).includes(mode==='enroll'?'Face Registration':'Face Login'));
  await find(tree,node=>node.type==='TouchableOpacity'&&text(node)===label).props.onPress();
  if(mode==='recognize'&&code==='not_enrolled')assert.deepEqual(results,[[{enrollmentRequired:true},'camera-request']]);
  else {assert.equal(results.length,0);assert.ok(states.includes(mode==='enroll'?'Synthetic capture rejection':
   'We could not verify your face. Try again in good light or use your password.'));}
 }
});

test('Face Login camera layout keeps a compact preview and clear accessible actions',()=>{
 for(const [width,height,maximum] of [[390,844,350],[820,1180,400],[1180,820,400]]){
  const {tree,closed}=faceCameraFixture({width,height});
  const preview=find(tree,node=>node.props?.style?.[0]?.aspectRatio===3/4);
  assert.ok(preview);
  assert.ok(preview.props.style[1].width<=maximum);
  assert.ok(find(preview,node=>node.type==='Camera'));
  assert.ok(find(preview,node=>node.props?.pointerEvents==='none'));
  assert.ok(text(tree).includes('Position your face inside the frame.'));
  assert.ok(text(tree).includes('Keep your face visible and hold still.'));
  const back=find(tree,node=>node.props?.accessibilityLabel==='Back to Login');
  assert.ok(back);assert.equal(back.props.style.minHeight,48);
  back.props.onPress();assert.deepEqual(closed,['camera-request']);
  const scan=find(tree,node=>node.type==='TouchableOpacity'&&text(node)==='Scan and Log In');
  assert.ok(scan);assert.equal(scan.props.style[0].minHeight,54);
 }
});

test('Face Login permission, processing and supported errors are explained clearly',async()=>{
 const denied=faceCameraFixture({permission:{granted:false,canAskAgain:false}}).tree;
 assert.equal(find(denied,node=>node.type==='Camera'),undefined);
 assert.ok(text(denied).includes('Turn it on in your device settings'));
 assert.equal(find(denied,node=>text(node)==='Allow camera'),undefined);
 const waiting=faceCameraFixture({busy:true}).tree;
 const checking=find(waiting,node=>node.type==='TouchableOpacity'&&text(node).includes('Checking face'));
 assert.ok(checking);assert.equal(checking.props.disabled,true);
 assert.ok(find(checking,node=>node.type==='ActivityIndicator'));
 for(const [code,message] of [
  ['no_face','No face detected'],
  ['multiple_faces','More than one face detected'],
  ['face_not_matched','We could not verify your face'],
  ['API_UNREACHABLE','Check your connection'],
 ]){
  const view=faceCameraFixture({code});
  await find(view.tree,node=>node.type==='TouchableOpacity'&&text(node)==='Scan and Log In').props.onPress();
  assert.ok(view.states.some(value=>typeof value==='string'&&value.includes(message)),code);
 }
});

function faceCameraFixture({width=390,height=844,permission={granted:true},busy=false,code='face_not_matched'}={}){
 let index=0,refIndex=0;const states=[],closed=[];
 const hooks={...React,useEffect:()=>{},useCallback:callback=>callback,
  useRef:value=>({current:refIndex++===0?{}:value}),useState:initial=>{
   const key=index++;return [key===0?true:key===2?busy:initial,value=>states.push(value)];
  }};
 const native={Modal:'Modal',SafeAreaView:'SafeAreaView',Text:'Text',TouchableOpacity:'TouchableOpacity',View:'View',
  ScrollView:'ScrollView',ActivityIndicator:'ActivityIndicator',StyleSheet:{create:styles=>styles},useWindowDimensions:()=>({width,height})};
 const deps={'../translations/i18n':translationFixture,react:hooks,'react-native':native,
  'expo-camera':{CameraView:'Camera',useCameraPermissions:()=>[permission,()=>{}]},
  '../utils/faceApi':{faceReference:()=> 'abcdef123456',faceDiagnostic:()=>{}},
  '../utils/faceCaptureFlow':{runFaceCapture:async()=>{throw Object.assign(Error('Synthetic capture rejection'),{code});}}};
 const compiled=ts.transpileModule(readFileSync(new URL('../components/FaceCameraModal.js',import.meta.url),'utf8'),
  {fileName:'Camera.jsx',compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};new Function('require','module','exports',compiled)(name=>({...deps[name],__esModule:name!=='react'}),module,module.exports);
 const modal=module.exports.default({request:{mode:'recognize',id:'camera-request'},isCurrent:()=>true,
  onResult:()=>{},onClose:id=>closed.push(id)});
 return {tree:modal.props.children.type(modal.props.children.props),states,closed};
}

test('actual Android login renders a prominent credential-free diagnostic control only in development',async()=>{
 const dev=loginFixture({development:true});
 const control=find(dev.tree,node=>node.props?.accessibilityLabel==='Check authentication connection (no credentials)');
 assert.ok(control);assert.match(text(dev.tree),/Development build: 20261029\.4/);
 const panel=React.Children.toArray(dev.tree.props.children).find(node=>text(node).includes('Development build:'));
 assert.ok(panel);assert.ok(find(panel,node=>node.props?.accessibilityLabel==='Check authentication connection (no credentials)'));
 assert.equal(find(find(dev.tree,node=>node.type==='KeyboardAvoidingView'),node=>node.props?.accessibilityLabel==='Check authentication connection (no credentials)'),undefined);
 assert.ok(text(dev.tree).indexOf('Development build:')<text(dev.tree).indexOf('Log In'));
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
 const button=find(view.tree,node=>node.type==='TouchableOpacity'&&text(node)==='Log In');
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
 const button=find(login.tree,node=>node.type==='TouchableOpacity'&&text(node)==='Log In');
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
 const assignments=[],alerts=[],values=['replacement synthetic password','replacement synthetic password','',false];let index=0;
 const hooks={...React,useRef:initial=>({current:initial}),useState:initial=>{const key=index++;return [values[key]??initial,value=>assignments.push([key,value])]}};
 const native={Alert:{alert:(...args)=>alerts.push(args)},StyleSheet:{create:styles=>styles},Platform:{OS:'android'}};
 for(const name of ['KeyboardAvoidingView','SafeAreaView','ScrollView','Text','TextInput','TouchableOpacity','View'])native[name]=name;
 const compiled=ts.transpileModule(readFileSync(new URL('../screens/MandatoryPasswordChange.js',import.meta.url),'utf8'),{fileName:'Mandatory.jsx',compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};new Function('require','module','exports',compiled)(name=>name==='../translations/i18n'?translationFixture:name==='react'?hooks:name==='../components/PasswordVisibilityButton'?{default:'PasswordVisibilityButton'}:native,module,module.exports);
 let submitted,signOuts=0;
 const tree=module.exports.default({onSubmit:async(...args)=>{submitted=args},onCancel:async()=>{signOuts++}});
 const card=find(tree,node=>node.type==='View'&&node.props.style?.maxWidth===390);
 assert.ok(card,'tablet form stays inside a centered width-limited card');
 assert.equal(card.props.style.backgroundColor,'#2B5651');
 assert.equal(card.props.style.borderRadius,22);
 assert.equal(card.props.style.borderColor,'rgba(222, 249, 196, 0.18)');
 assert.equal(tree.props.style.backgroundColor,'#244B47');
 assert.ok(find(tree,node=>node.type==='View'&&node.props.style?.top===-90));
 assert.ok(find(tree,node=>node.type==='View'&&node.props.style?.bottom===-130));
 for(const label of ['New password','Confirm new password'])assert.equal(find(tree,node=>node.props?.accessibilityLabel===label).props.secureTextEntry,true);
 assert.equal(find(tree,node=>node.type==='ScrollView').props.contentContainerStyle.justifyContent,'center');
 const fields=find(tree,node=>node.type==='ScrollView');
 const passwordInput=find(fields,node=>node.type==='TextInput'&&node.props.accessibilityLabel==='New password');
 assert.equal(passwordInput.props.returnKeyType,'next');
 assert.equal(passwordInput.props.style[0].backgroundColor,'#1F403D');
 assert.equal(passwordInput.props.style[0].borderRadius,12);
 assert.equal(passwordInput.props.placeholderTextColor,'#9BBDB4');
 assert.equal(find(tree,node=>node.props.accessibilityRole==='header').props.style.color,'#FFF6DC');
 assert.doesNotMatch(text(tree),/Continue as Guest|Face ID|New visitor|Forget password/);
 const primary=find(tree,node=>node.type==='TouchableOpacity'&&text(node)==='Change password');
 assert.equal(primary.props.style[0].backgroundColor,'#50B498');
 assert.equal(primary.props.style[0].height,52);
 await primary.props.onPress();
 assert.deepEqual(submitted,values.slice(0,2));assert.ok(assignments.some(([key,value])=>key===3&&value===true));
 const signOut=find(tree,node=>node.type==='TouchableOpacity'&&text(node)==='Sign out and return to login');
 assert.equal(signOut.props.style.borderWidth,1);
 assert.equal(signOut.props.style.borderColor,'#50B498');
 assert.equal(signOut.props.style.backgroundColor,'transparent');
 assert.ok(signOut.props.style.minHeight>=44);
 await signOut.props.onPress();assert.equal(signOuts,1);
});
