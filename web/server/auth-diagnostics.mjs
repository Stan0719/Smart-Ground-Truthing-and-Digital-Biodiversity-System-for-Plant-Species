// Private development diagnostics. Never record request bodies, identity fields or credentials.
import {appendFileSync,existsSync,mkdirSync,renameSync,statSync} from 'node:fs'
import {join} from 'node:path'
import {createHash,randomBytes} from 'node:crypto'
const reasons=new Set(['account_missing','password_mismatch','account_inactive','temporary_password_expired','credentials_changed','role_denied','permanent_password_required','rate_limited','eligible','authenticated'])
const stages=new Set(['verification','locked_recheck','session_created'])
export function authStoreFingerprint(options,schema){
 const url=options.connectionString?new URL(options.connectionString):null
 const target=[(url?.hostname||options.host||'localhost').toLowerCase(),String(url?.port||options.port||5432),url?decodeURIComponent(url.pathname.slice(1)):options.database,schema]
 return createHash('sha256').update(JSON.stringify(target)).digest('hex').slice(0,24)
}
export function createAuthDiagnostics({env=process.env,directory,storeFingerprint,consoleSink=entry=>console.info(JSON.stringify(entry)),now=()=>new Date(),maxBytes=1024*1024}){
 const enabled=env.AUTH_DEBUG==='1'||env.NODE_ENV!=='production'
 const identity=Object.freeze({instanceId:randomBytes(12).toString('hex'),processId:process.pid,storeFingerprint,diagnosticsEnabled:enabled})
 const path=join(directory,'auth-diagnostics.ndjson')
 const emit=fields=>{
  if(!enabled)return
  const entry={at:now().toISOString(),...identity,...fields}
  try{
   mkdirSync(directory,{recursive:true,mode:0o700})
   if(existsSync(path)&&statSync(path).size>=maxBytes)renameSync(path,path+'.previous')
   appendFileSync(path,JSON.stringify(entry)+'\n',{encoding:'utf8',mode:0o600})
  }catch{console.error('Private authentication diagnostic retention unavailable.')}
  try{consoleSink(entry)}catch{ /* Diagnostic output must not change authentication outcomes. */ }
 }
 return {enabled,identity,
  runtime(){emit({event:'auth_runtime'})},
  lifecycle(event,fields={}){
   if(!new Set(['process_started','server_listening','shutdown_requested','server_closed','database_closed','shutdown_complete','shutdown_failed','uncaught_exception','before_exit','process_exit','server_error']).has(event))return
   const safe={}
   for(const key of ['parentProcessId','port','code'])if(Number.isSafeInteger(fields[key]))safe[key]=fields[key]
   for(const key of ['listenerActive','shutdownInProgress'])if(typeof fields[key]==='boolean')safe[key]=fields[key]
   if(['SIGINT','SIGTERM'].includes(fields.signal))safe.signal=fields.signal
   if(['signal','uncaught_exception','server_closed','event_loop_drained'].includes(fields.reason))safe.reason=fields.reason
   if(['uncaughtException','unhandledRejection'].includes(fields.origin))safe.origin=fields.origin
   if(['Error','TypeError','RangeError','SyntaxError','ReferenceError','URIError','EvalError','AggregateError','SystemError'].includes(fields.errorName))safe.errorName=fields.errorName
   if(/^(?:E[A-Z0-9_]{2,48}|ERR_[A-Z0-9_]{1,48}|[0-9A-Z]{5})$/.test(fields.errorCode||''))safe.errorCode=fields.errorCode
   emit({event,...safe})
  },
  record(entry){
   if(entry?.event!=='password_verification'||!/^[a-f0-9]{12}$/.test(entry.reference||'')||!reasons.has(entry.reason)||!stages.has(entry.stage))return
   emit({event:'password_verification',reference:entry.reference,reason:entry.reason,stage:entry.stage})
  },
 }
}
