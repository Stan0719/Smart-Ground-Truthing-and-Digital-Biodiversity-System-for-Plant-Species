// Inspect the environment actually served by Metro, rather than only .env.local.
// Never evaluate the bundle or print credentials, account data or its full text.
import {selectApiConfiguration,validatedApiUrl} from '../utils/apiConfiguration.js';

const metro=new URL(process.argv[2]||'http://127.0.0.1:8081');
if(!['127.0.0.1','localhost'].includes(metro.hostname)||metro.protocol!=='http:')
 throw Error('Use the local running Metro HTTP origin.');
const path='/node_modules/expo-router/entry.bundle?platform=android&dev=true&hot=false&lazy=false&transform.engine=hermes&transform.bytecode=0&transform.routerRoot=src%2Fapp';
const response=await fetch(new URL(path,metro),{signal:AbortSignal.timeout(45000)});
if(!response.ok)throw Error(`Metro bundle returned HTTP ${response.status}`);
const source=await response.text();
const keys={environment:'EXPO_PUBLIC_API_ENV',backend:'EXPO_PUBLIC_BACKEND_URL',backendDevelopment:'EXPO_PUBLIC_BACKEND_URL_DEVELOPMENT',auth:'EXPO_PUBLIC_AUTH_API_URL',authDevelopment:'EXPO_PUBLIC_AUTH_API_URL_DEVELOPMENT',plant:'EXPO_PUBLIC_PLANT_API_URL',plantDevelopment:'EXPO_PUBLIC_PLANT_API_URL_DEVELOPMENT',face:'EXPO_PUBLIC_FACE_API_URL',faceDevelopment:'EXPO_PUBLIC_FACE_API_URL_DEVELOPMENT'};
const settings={};
for(const [name,key]of Object.entries(keys)){
 // Expo SDK 58 defines public variables as enumerable value descriptors.
 const escaped=key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const pattern=new RegExp('["\\\\]+'+escaped+'["\\\\]+\\s*:\\s*\\{\\s*enumerable:\\s*true,\\s*value:\\s*["\\\\]+([^"\\\\]*)');
 const value=source.match(pattern)?.[1];
 if(value!==undefined)settings[name]=value;
}
const config=selectApiConfiguration(settings);
let ready=true;
for(const service of ['auth','plant','face']){
 try{
  const value=validatedApiUrl(config[service],config.environment,service);
  console.log(JSON.stringify({service,bundleUrl:value}));
 }catch{
  ready=false;console.log(JSON.stringify({service,configuredInServedBundle:false}));
 }
}
console.log(JSON.stringify({environment:config.environment,ready,developmentBuildMarker:source.includes('Development build: 20261029.1')}));
if(!ready)process.exitCode=1;
