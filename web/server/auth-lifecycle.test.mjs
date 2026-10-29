import test from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {createServer} from 'node:http'
import {createAuthLifecycle} from './auth-lifecycle.mjs'
function fixture(){
 const events=[],exits=[],processRef=new EventEmitter();processRef.ppid=123
 let resolveExit
 const exited=new Promise(resolve=>{resolveExit=resolve})
 processRef.exit=code=>{exits.push(code);processRef.emit('exit',code);resolveExit(code)}
 const lifecycle=createAuthLifecycle({processRef,diagnostics:{lifecycle:(event,fields)=>events.push({event,...fields})}})
 return {events,exits,processRef,lifecycle,exited}
}
async function listen(server){await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))}

test('listener remains healthy; overlapping shutdown requests close the listener and database only once',async()=>{
 const f=fixture(),server=createServer((_req,res)=>res.end('healthy'));let closes=0
 f.lifecycle.attach(server,async()=>{closes++})
 try{
  await listen(server)
  assert.equal((await fetch(`http://127.0.0.1:${server.address().port}`,{headers:{Connection:'close'}})).status,200)
  assert.equal(f.exits.length,0);assert.equal(server.listening,true)
  f.processRef.emit('SIGINT');f.processRef.emit('SIGTERM')
  assert.equal(await f.exited,0);assert.equal(closes,1);assert.equal(server.listening,false)
  assert.ok(f.events.some(e=>e.event==='server_listening'))
  assert.ok(f.events.some(e=>e.event==='server_closed'&&e.reason==='signal'))
  assert.ok(f.events.some(e=>e.event==='process_exit'&&e.reason==='signal'&&e.code===0))
 }finally{f.lifecycle.dispose();if(server.listening)await new Promise(r=>server.close(r))}
})
test('unexpected server closure and event-loop drain are distinguishable from requested shutdown',async()=>{
 const f=fixture(),server=createServer();f.lifecycle.attach(server,async()=>{})
 try{
  await listen(server);await new Promise(r=>server.close(r))
  f.processRef.emit('beforeExit',0);f.processRef.emit('exit',0)
  assert.ok(f.events.some(e=>e.event==='server_closed'&&e.reason==='server_closed'))
  assert.ok(f.events.some(e=>e.event==='before_exit'&&e.listenerActive===false&&e.reason==='server_closed'))
  assert.equal(f.exits.length,0)
 }finally{f.lifecycle.dispose()}
})
test('database shutdown failure is recorded safely and produces a nonzero exit',async()=>{
 const f=fixture(),server=createServer();f.lifecycle.attach(server,async()=>{throw Object.assign(Error('private synthetic detail'),{code:'ECONNRESET'})})
 try{
  await listen(server);f.processRef.emit('SIGTERM');assert.equal(await f.exited,1)
  assert.ok(f.events.some(e=>e.event==='shutdown_failed'&&e.errorCode==='ECONNRESET'))
  assert.equal(JSON.stringify(f.events).includes('private synthetic detail'),false)
 }finally{f.lifecycle.dispose();if(server.listening)await new Promise(r=>server.close(r))}
})
test('fatal observers retain safe metadata without swallowing exceptions or unhandled rejections',()=>{
 const f=fixture()
 try{
  assert.equal(f.processRef.listenerCount('uncaughtException'),0);assert.equal(f.processRef.listenerCount('unhandledRejection'),0)
  f.processRef.emit('uncaughtExceptionMonitor',Object.assign(Error('private synthetic detail'),{code:'ERR_SYNTHETIC'}),'unhandledRejection')
  f.processRef.emit('exit',1)
  assert.ok(f.events.some(e=>e.event==='uncaught_exception'&&e.origin==='unhandledRejection'))
  assert.ok(f.events.some(e=>e.event==='process_exit'&&e.reason==='uncaught_exception'))
  assert.equal(JSON.stringify(f.events).includes('private synthetic detail'),false)
 }finally{f.lifecycle.dispose()}
})
