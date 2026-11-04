// Lifecycle observers do not add keep-alive timers or suppress fatal exceptions.
const safeError = error => ({
 errorName: ['Error','TypeError','RangeError','SyntaxError','ReferenceError','URIError','EvalError','AggregateError','SystemError'].includes(error?.name)?error.name:'Error',
 errorCode: /^(?:E[A-Z0-9_]{2,48}|ERR_[A-Z0-9_]{1,48}|[0-9A-Z]{5})$/.test(error?.code||'')?error.code:undefined,
})
export function createAuthLifecycle({diagnostics,processRef=process}) {
 let server=null,shutdownSignal=null,closing=false,fatal=false
 const listeners=[]
 const observe=(event,handler,once=false)=>{processRef[once?'once':'on'](event,handler);listeners.push([event,handler])}
 const record=(event,fields={})=>diagnostics.lifecycle(event,fields)
 const reason=()=>fatal?'uncaught_exception':shutdownSignal?'signal':server&&!server.listening?'server_closed':'event_loop_drained'
 observe('uncaughtExceptionMonitor',(error,origin)=>{fatal=true;record('uncaught_exception',{...safeError(error),origin})})
 observe('beforeExit',code=>record('before_exit',{code,reason:reason(),listenerActive:Boolean(server?.listening),shutdownInProgress:closing}),true)
 observe('exit',code=>record('process_exit',{code,reason:reason(),listenerActive:Boolean(server?.listening),shutdownInProgress:closing}),true)
 record('process_started',{parentProcessId:processRef.ppid})
 return {
  attach(httpServer,closeDatabase){
   if(server)throw Error('Lifecycle already attached')
   server=httpServer
   server.on('listening',()=>record('server_listening',{port:server.address()?.port,listenerActive:server.listening}))
   server.on('close',()=>record('server_closed',{reason:shutdownSignal?'signal':'server_closed',signal:shutdownSignal,listenerActive:false}))
   server.on('error',error=>{record('server_error',safeError(error));throw error})
   for(const signal of ['SIGINT','SIGTERM'])observe(signal,()=>{
    record('shutdown_requested',{signal,shutdownInProgress:closing})
    if(closing)return
    closing=true;shutdownSignal=signal
    server.close(async error=>{
     try{
      if(error&&error.code!=='ERR_SERVER_NOT_RUNNING')throw error
      await closeDatabase()
      record('database_closed',{signal})
      record('shutdown_complete',{signal,code:0})
      processRef.exit(0)
     }catch(failure){record('shutdown_failed',{signal,...safeError(failure)});processRef.exit(1)}
    })
   },true)
  },
  dispose(){for(const [event,handler]of listeners)processRef.removeListener(event,handler)},
 }
}
