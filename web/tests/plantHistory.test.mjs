import assert from 'node:assert/strict'
import test from 'node:test'
import { createPlantHistory } from '../src/services/plantHistory.ts'
const content = {heightCm:12,healthStatus:'Healthy',lifeStage:'Mature',morphology:'Leaves',notes:'Real notes',latitude:4,longitude:113,accuracy_m:5,altitude_m:18,zone:'Submitted'}
const row = (id, extra = {}) => ({id,plant_id:'1',origin:'subsequent_observation',date:'2026-11-01T00:00:00Z',status:'Approved',recorded_by:'Botanist',content,assets:[{id:'photo-'+id,content_type:'image/jpeg'}],review:null,...extra})
const page = (observations, next = null, plant = '1') => Response.json({plant_id:plant,observations,page:{limit:20,has_more:next!==null,next_cursor:next}})

test('background history replaces a refreshed prefix atomically without resetting detail keys', async () => {
  const pages = [page([row('new')], 'old-page'), page([row('old')]),
    page([row('new', { content: { ...content, heightCm: 20 } })], 'fresh-page'), page([row('old', { status: 'Withdrawn' })])]
  const h = createPlantHistory({ transport: async () => pages.shift() })
  await h.load('1'); await h.load('1', true)
  const epoch = h.state.epoch
  await h.refresh('1')
  assert.equal(h.state.epoch, epoch)
  assert.equal(h.state.observations[0].content.heightCm, 20)
  assert.equal(h.state.observations[1].status, 'Withdrawn')
  assert.equal(h.state.complete, true)
})

test('background history discards late navigation results and removes evidence after access denial', async () => {
  let resolve
  const h = createPlantHistory({ transport: async () => resolve ? new Promise(r => { resolve = r }) : page([row('a')]) })
  await h.load('1')
  resolve = true
  const pending = h.refresh('1')
  h.reset(); resolve(page([row('late')]))
  await pending
  assert.equal(h.state.observations.length, 0)
  const responses = [page([row('a')]), new Response('{}', { status: 403 })]
  const denied = createPlantHistory({ transport: async () => responses.shift() })
  await denied.load('1'); await denied.refresh('1')
  assert.equal(denied.state.observations.length, 0)
  assert.match(denied.state.error, /403/)
  assert.equal(denied.state.complete, false)
})

test('transient background failure retains visible history with an incomplete/error indication', async () => {
  const responses = [page([row('a')]), new Response('{}', { status: 503 })]
  const h = createPlantHistory({ transport: async () => responses.shift() })
  await h.load('1'); await h.refresh('1')
  assert.equal(h.state.observations[0].id, 'a')
  assert.match(h.state.error, /503/)
  assert.equal(h.state.complete, false)
})
test('history merges real plant pages in server order and binds each photo to page-scoped bytes', async () => {
  const calls = [], pages = [page([row('new')],'next'),page([row('old')])]
  const history = createPlantHistory({transport:async (url,options) => {calls.push({url,options});return pages.shift()}})
  await history.load('1');assert.equal(history.state.complete,false);assert.equal(history.state.hasMore,true)
  await history.load('1',true);assert.equal(history.state.complete,true)
  assert.deepEqual(history.state.observations.map(o=>o.id),['new','old'])
  assert.equal(history.state.observations[1].assets[0].url,'/api/data/plants/1/detail/assets/photo-old')
  assert.ok(calls[1].url.endsWith('cursor=next'));assert.ok(calls.every(c=>c.options.credentials==='same-origin'))
})
test('history fails closed on wrong plants, malformed evidence, conflicting pages and repeated cursors', async () => {
  for(const response of [page([row('a',{plant_id:'2'})]),page([row('a',{recorded_by:42})]),page([row('a',{content:{...content,latitude:91}})]),page([row('a',{assets:[{id:'../unsafe',content_type:'image/jpeg'}]})]),page([row('a')],null,'2')]) {
    const h=createPlantHistory({transport:async()=>response});await h.load('1');assert.ok(h.state.error);assert.equal(h.state.observations.length,0)
  }
  for(const second of [page([row('a')]),page([row('b')],'next')]) {
    const pages=[page([row('a')],'next'),second],h=createPlantHistory({transport:async()=>pages.shift()})
    await h.load('1');await h.load('1',true);assert.ok(h.state.error);assert.equal(h.state.observations.length,0);assert.equal(h.state.complete,false)
  }
})
test('reset aborts history and late results cannot restore staff evidence', async () => {
  let resolve,signal
  const h=createPlantHistory({transport:async (url,options)=>{signal=options.signal;return new Promise(yes=>{resolve=yes})}})
  const loading=h.load('1');h.reset();assert.equal(signal.aborted,true);resolve(page([row('private')]))
  await loading;assert.equal(h.state.observations.length,0);assert.equal(h.state.error,'');assert.equal(h.state.loading,false)
})
test('history displays honest completion and errors for empty or unavailable reads', async () => {
  for(const status of [401,403,404,503]) {
    const h=createPlantHistory({transport:async()=>new Response('',{status})});await h.load('1');assert.ok(h.state.error);assert.equal(h.state.complete,false)
  }
  const h=createPlantHistory({transport:async()=>page([])});await h.load('1');assert.equal(h.state.complete,true);assert.equal(h.state.observations.length,0)
})

test('Withdrawn observations retain authorized history while Withdrawn is never accepted as a review decision',async()=>{
 const h=createPlantHistory({transport:async()=>page([row('withdrawn',{status:'Withdrawn'})])});await h.load('1');assert.equal(h.state.observations[0].status,'Withdrawn');assert.equal(h.state.complete,true)
 const invalid=createPlantHistory({transport:async()=>page([row('bad-review',{review:{decision:'Withdrawn',comment:'not a decision',created_at:'2026-11-01T00:00:00Z'}})])});await invalid.load('1');assert.ok(invalid.state.error);assert.equal(invalid.state.observations.length,0)
})

const deferredRefresh = () => { let resolve; const promise = new Promise(yes => { resolve = yes }); return { promise, resolve } }
test('complete verified snapshot survives slow refresh, 503 and Retry without changing epoch or row identity', async () => {
  let next = () => page([row('initial', { origin: 'initial_registration', status: 'Pending Review' }), row('visit')])
  const h = createPlantHistory({ transport: () => next() })
  await h.load('1'); const epoch = h.state.epoch, rows = h.state.observations
  assert.equal(h.state.verifiedComplete, true)
  const wait = deferredRefresh(); next = () => wait.promise
  const pending = h.refresh('1')
  assert.equal(h.state.refreshing, true); assert.equal(h.state.verifiedComplete, true); assert.equal(h.state.observations, rows)
  wait.resolve(new Response('{}', { status: 503 })); await pending
  assert.equal(h.state.observations, rows); assert.equal(h.state.verifiedComplete, true); assert.equal(h.state.complete, false)
  const retryWait = deferredRefresh(); next = () => retryWait.promise
  const retry = h.retry('1')
  assert.equal(h.state.epoch, epoch); assert.equal(h.state.observations, rows); assert.equal(h.state.verifiedComplete, true)
  retryWait.resolve(page([row('initial', { origin: 'initial_registration', status: 'Pending Review', content: { ...content, heightCm: 20 } }), row('visit', { status: 'Correction Required' })])); await retry
  assert.equal(h.state.verifiedComplete, true); assert.equal(h.state.observations[0].content.heightCm, 20)
  assert.deepEqual(h.state.observations.map(o => o.status), ['Pending Review', 'Correction Required'])
  assert.equal(h.state.epoch, epoch)
})
test('complete snapshot replacement waits for all pages and does not publish a prefix when a later page fails', async () => {
  const responses = [page([row('initial', { origin: 'initial_registration' })]), page([row('new')], 'next'), new Response('{}', { status: 503 })]
  const h = createPlantHistory({ transport: async () => responses.shift() })
  await h.load('1'); const before = h.state.observations
  await h.refresh('1')
  assert.equal(h.state.observations, before); assert.equal(h.state.verifiedComplete, true); assert.equal(h.state.hasMore, false)
})
test('first load failure stays unverified, successful partial history stays incomplete, and malformed replacements invalidate evidence', async () => {
  const responses = [new Response('{}', { status: 503 }), page([row('initial', { origin: 'initial_registration' })], 'next'), page([row('visit')]), new Response('{', { status: 200 })]
  const h = createPlantHistory({ transport: async () => responses.shift() })
  await h.load('1'); assert.equal(h.state.hasSnapshot, false); assert.equal(h.state.verifiedComplete, false)
  await h.retry('1'); assert.equal(h.state.hasSnapshot, true); assert.equal(h.state.verifiedComplete, false)
  await h.load('1', true); assert.equal(h.state.verifiedComplete, true)
  await h.refresh('1'); assert.equal(h.state.verifiedComplete, false); assert.equal(h.state.observations.length, 0)
})
for (const status of [401, 403, 404]) test(`HTTP ${status} invalidates a retained complete history snapshot`, async () => {
  const responses = [page([row('initial')]), new Response('{}', { status })]
  const h = createPlantHistory({ transport: async () => responses.shift() })
  await h.load('1'); await h.refresh('1')
  assert.equal(h.state.observations.length, 0); assert.equal(h.state.verifiedComplete, false); assert.equal(h.state.hasSnapshot, false)
})
test('pause and reset prevent old refresh completion from republishing private evidence', async () => {
  let response = () => page([row('old')]); const h = createPlantHistory({ transport: () => response() })
  await h.load('1'); const wait = deferredRefresh(); response = () => wait.promise
  const refresh = h.refresh('1'); h.pause()
  assert.equal(h.state.observations[0].id, 'old'); assert.equal(h.state.verifiedComplete, true)
  h.reset(); wait.resolve(page([row('late')]))
  await refresh; assert.equal(h.state.observations.length, 0); assert.equal(h.state.verifiedComplete, false)
})
