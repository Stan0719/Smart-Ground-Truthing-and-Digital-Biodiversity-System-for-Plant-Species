// Reuse only the approved EmailJS public settings; never expose the server reset key.
import {readFileSync,existsSync,mkdirSync,openSync,writeFileSync,closeSync,statSync} from 'node:fs'
import {dirname,join} from 'node:path'
import {randomBytes} from 'node:crypto'
export function recoveryConfig(database,env=process.env){
 const settings={...env}
 const source=new URL('../../mobileapp/.env.local',import.meta.url)
 if(existsSync(source)){
  for(const line of readFileSync(source,'utf8').split(/\r?\n/)){
   const match=/^EXPO_PUBLIC_(EMAILJS_SERVICE_ID|EMAILJS_OTP_TEMPLATE_ID|EMAILJS_PUBLIC_KEY)=(.*)$/.exec(line)
   if(match&&!settings[match[1]])settings[match[1]]=match[2].trim().replace(/^['"]|['"]$/g,'')
  }
 }
 const path=settings.AUTH_RESET_KEY_FILE??join(dirname(database),'recovery.key')
 mkdirSync(dirname(path),{recursive:true,mode:0o700})
 try{const fd=openSync(path,'wx',0o600);try{writeFileSync(fd,randomBytes(32))}finally{closeSync(fd)}}catch(error){if(error.code!=='EEXIST')throw error}
 if(statSync(path).mode&0o077)throw Error('Recovery key permissions must be 600')
 if(env.AUTH_RECOVERY_DELIVERY_DISABLED==='1')delete settings.EMAILJS_SERVICE_ID
 return {settings,key:readFileSync(path)}
}
