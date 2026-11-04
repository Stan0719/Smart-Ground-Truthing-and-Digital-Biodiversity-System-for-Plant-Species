// Inspect the environment actually served by Metro, rather than only .env.local.
// Never evaluate the bundle or print credentials, account data or its full text.
import {selectApiConfiguration,validatedApiUrl} from '../utils/apiConfiguration.js';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const metro=new URL(process.argv[2]||'http://127.0.0.1:8081');
if(!['127.0.0.1','localhost'].includes(metro.hostname)||metro.protocol!=='http:')
 throw Error('Use the local running Metro HTTP origin.');
const manifestResponse=await fetch(metro,{headers:{'expo-platform':'android',Accept:'application/expo+json'},signal:AbortSignal.timeout(15000)});
if(!manifestResponse.ok)throw Error(`Expo Android manifest returned HTTP ${manifestResponse.status}; a bundle-only check cannot verify Expo Go launch readiness.`);
const manifest=await manifestResponse.json();
const expectedRoot=resolve(fileURLToPath(new URL('..',import.meta.url)));
const actualRoot=manifest.extra?.expoGo?.developer?.projectRoot;
if(!actualRoot||resolve(actualRoot).toLowerCase()!==expectedRoot.toLowerCase())throw Error('Expo manifest does not identify this mobileapp project root.');
const launch=new URL(manifest.launchAsset?.url);
if(launch.searchParams.get('platform')!=='android'||launch.searchParams.get('dev')!=='true')throw Error('Manifest is not an Android development bundle.');
console.log(JSON.stringify({projectRoot:actualRoot,expoGoUrl:`exp://${manifest.extra?.expoClient?.hostUri}`,manifestStatus:manifestResponse.status,development:true}));
// Inspect readable JS from the actual manifest entry rather than inventing an entry path.
launch.searchParams.set('transform.bytecode','0');launch.searchParams.set('lazy','false');
const response=await fetch(new URL(launch.pathname+launch.search,metro),{signal:AbortSignal.timeout(45000)});
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
const developmentBuildMarker=source.includes('Development build: 20261029.4');
const diagnosticControl=source.includes('Check authentication connection (no credentials)');
const developmentRuntime=/__DEV__\s*=\s*true/.test(source.slice(0,1000));
console.log(JSON.stringify({environment:config.environment,ready,developmentBuildMarker,diagnosticControl,developmentRuntime}));
ready=ready&&developmentBuildMarker&&diagnosticControl&&developmentRuntime;
if(!ready)process.exitCode=1;
