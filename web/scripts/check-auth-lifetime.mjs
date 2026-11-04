// Health-only observer; this process cannot keep the auth server's event loop alive.
const duration=Number(process.argv[2]??45)
if(!Number.isInteger(duration)||duration<1||duration>600)throw Error('Use a duration of 1–600 seconds')
const base='http://127.0.0.1:3001'
async function sample(){
 const response=await fetch(base+'/health',{headers:{Connection:'close'},signal:AbortSignal.timeout(2000)})
 if(response.status!==200)throw Error('AUTH_HEALTH_FAILED')
 const identityResponse=await fetch(base+'/internal/auth/diagnostics',{headers:{Connection:'close'},signal:AbortSignal.timeout(2000)})
 const identity=await identityResponse.json()
 if(!identityResponse.ok||!identity.diagnosticsEnabled||!Number.isInteger(identity.processId))throw Error('AUTH_DIAGNOSTICS_UNAVAILABLE')
 return identity
}
try{
 const first=await sample(),started=Date.now();let samples=1
 console.log(JSON.stringify({check:'auth_lifetime_start',pid:first.processId,seconds:duration,diagnosticsActive:true}))
 while(Date.now()-started<duration*1000){
  await new Promise(resolve=>setTimeout(resolve,Math.min(5000,duration*1000-(Date.now()-started))))
  const current=await sample();samples++
  if(current.processId!==first.processId||current.instanceId!==first.instanceId)throw Error('AUTH_PROCESS_REPLACED')
  console.log(JSON.stringify({check:'auth_lifetime_sample',elapsedSeconds:Math.round((Date.now()-started)/1000),pid:current.processId,healthStatus:200,sameInstance:true}))
 }
 console.log(JSON.stringify({check:'auth_lifetime_pass',pid:first.processId,samples,seconds:duration}))
}catch(error){console.log(JSON.stringify({check:'auth_lifetime_fail',code:/^[A-Z0-9_]+$/.test(error.message||'')?error.message:error.cause?.code||error.name}));process.exitCode=1}
