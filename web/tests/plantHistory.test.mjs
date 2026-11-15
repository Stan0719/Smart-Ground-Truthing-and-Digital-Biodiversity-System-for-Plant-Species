import assert from 'node:assert/strict'
import test from 'node:test'
import { createPlantHistory } from '../src/services/plantHistory.ts'
const content = {heightCm:12,healthStatus:'Healthy',lifeStage:'Mature',morphology:'Leaves',notes:'Real notes',latitude:4,longitude:113,accuracy_m:5,altitude_m:18,zone:'Submitted'}
const row = (id, extra = {}) => ({id,plant_id:'1',origin:'subsequent_observation',date:'2026-11-01T00:00:00Z',status:'Approved',recorded_by:'Botanist',content,assets:[{id:'photo-'+id,content_type:'image/jpeg'}],review:null,...extra})
const page = (observations, next = null, plant = '1') => Response.json({plant_id:plant,observations,page:{limit:20,has_more:next!==null,next_cursor:next}})
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
