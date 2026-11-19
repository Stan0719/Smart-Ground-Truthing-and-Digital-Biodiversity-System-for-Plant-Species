import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { useOfficerCopyConfirmation } from '../src/composables/useOfficerCopyConfirmation.ts'
function clock() {
  let now = 0, id = 0
  const timers = new Map()
  return { timers, schedule(fn, ms) { const key=++id;timers.set(key,{fn,due:now+ms});return key }, cancel(key) { timers.delete(key) }, advance(ms) { now+=ms;for(const [key,t] of timers)if(t.due<=now){timers.delete(key);t.fn()} } }
}
test('all Officer copy instances share one toast while checkmarks and expiry remain control-specific',()=>{
 const time=clock(),a=useOfficerCopyConfirmation(time),b=useOfficerCopyConfirmation(time)
 try{
  a.confirm('table:observation:id');assert.equal(a.toastKey.value,'table:observation:id')
  time.advance(1000);b.confirm('modal:observation:id')
  assert.equal(a.toastKey.value,'');assert.equal(b.toastKey.value,'modal:observation:id')
  assert.equal(a.copied.value['table:observation:id'],true)
  time.advance(1000);assert.equal(a.copied.value['table:observation:id'],undefined)
  assert.equal(b.copied.value['modal:observation:id'],true)
  time.advance(1000);assert.equal(b.toastKey.value,'');assert.equal(time.timers.size,0)
 }finally{a.clear();b.clear()}
})
test('recopy restarts two seconds and stale callbacks cannot clear the latest confirmation',()=>{
 const time=clock(),copy=useOfficerCopyConfirmation(time)
 try{
  copy.confirm('same');const old=[...time.timers.values()][0].fn
  time.advance(1500);copy.confirm('same');old();assert.equal(copy.copied.value.same,true)
  time.advance(500);assert.equal(copy.toastKey.value,'same')
  time.advance(1500);assert.equal(copy.toastKey.value,'');assert.equal(copy.copied.value.same,undefined)
 }finally{copy.clear()}
})
test('refresh, removed controls and unmount cancel timers without dismissing another instance toast',()=>{
 const time=clock(),a=useOfficerCopyConfirmation(time),b=useOfficerCopyConfirmation(time)
 a.confirm('table');b.confirm('dialog');a.clear()
 assert.equal(a.copied.value.table,undefined);assert.equal(b.toastKey.value,'dialog');assert.equal(time.timers.size,1)
 b.clear();assert.equal(time.timers.size,0);assert.equal(b.toastKey.value,'')
})
test('existing Submitted By timers coordinate with shared identifier and QR toasts',()=>{
 const time=clock(),page=useOfficerCopyConfirmation(time),identifier=useOfficerCopyConfirmation(time)
 try{
  page.activate('submitter:observation:one')
  identifier.confirm('identifier');assert.equal(page.toastKey.value,'')
  page.dismiss('submitter:observation:one');assert.equal(identifier.toastKey.value,'identifier')
  page.confirm('qr:one');assert.equal(identifier.toastKey.value,'');assert.equal(page.toastKey.value,'qr:one')
 }finally{page.clear();identifier.clear()}
})
test('shared copy visuals remain anchored above icons, light green/dark green, non-interactive and motion-free',()=>{
 const css=readFileSync(new URL('../src/styles/officer-copy.css',import.meta.url),'utf8')
 assert.match(css,/position: relative/);assert.match(css,/bottom: calc\(100% \+ 8px\)/)
 assert.match(css,/background: #DCF3E4; color: #245A46/);assert.match(css,/pointer-events: none/)
 assert.doesNotMatch(css,/animation:|transition:/)
 const shared=readFileSync(new URL('../src/components/conservation/MonitoringIdentifier.vue',import.meta.url),'utf8')
 assert.match(shared,/confirmation.confirm\('identifier'\)/);assert.doesNotMatch(shared,/feedback.value = t\('monitoringDisplay.copied'\)/)
 for(const name of ['ReviewSubmissionsView','ObservationsView']) {
  const source=readFileSync(new URL(`../src/views/conservation/${name}.vue`,import.meta.url),'utf8')
  assert.match(source,/useOfficerCopyConfirmation/);assert.match(source,/class="officer-copy-anchor"/)
  assert.match(source,/class="officer-copy-live" role="status" aria-live="polite"/)
 }
})
