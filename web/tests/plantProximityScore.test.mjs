import test from 'node:test'
import assert from 'node:assert/strict'
import { gpsProximityScore, proximityScoreTone, formatProximityScore, gpsAccuracyUncertain } from '../src/services/plantProximityScore.ts'
const bands={very_close_m:2,close_m:5,nearby_m:10,radius_m:30}
test('approved anchors, interpolation and whole-number rounding are exact',()=>{
 for(const [distance,score] of [[0,100],[0.43,96],[1,90],[2,80],[2.42,76],[3.5,65],[5,50],[7.5,35],[10,20],[15,15],[20,10],[29.6,0],[30,0]])assert.equal(gpsProximityScore(distance,bands),score)
 assert.equal(gpsProximityScore(0.45,bands),96)
 for(const boundary of [2,5,10]){assert.equal(gpsProximityScore(boundary-0.0001,bands),gpsProximityScore(boundary,bands));assert.equal(gpsProximityScore(boundary+0.0001,bands),gpsProximityScore(boundary,bands))}
 let previous=100;for(let d=0;d<=30;d+=0.01){const score=gpsProximityScore(d,bands);assert.ok(Number.isInteger(score));assert.ok(score<=previous&&score>=0);previous=score}
})
test('configuration controls distances, invalid/missing/outside data never invents a score',()=>{
 const configured={very_close_m:4,close_m:10,nearby_m:20,radius_m:60}
 assert.equal(gpsProximityScore(4,configured),80);assert.equal(gpsProximityScore(0.86,configured),96)
 for(const d of [-1,NaN,Infinity,undefined,null,30.001])assert.equal(gpsProximityScore(d,bands),null)
 for(const c of [{...bands,close_m:2},{...bands,very_close_m:0},{...bands,radius_m:NaN}])assert.equal(gpsProximityScore(1,c),null)
 assert.equal(formatProximityScore(null,'en'),'—');assert.equal(formatProximityScore(gpsProximityScore(30,bands),'en'),'0%')
})
test('GPS uncertainty warns without modifying the distance-only score',()=>{
 for(const accuracy of [undefined,null,NaN,-1,0,10.01,13.31,100]){assert.equal(gpsAccuracyUncertain(accuracy,10),true);assert.equal(gpsProximityScore(0.43,bands),96)}
 for(const accuracy of [0.1,2,9.92,10])assert.equal(gpsAccuracyUncertain(accuracy,10),false)
 assert.equal(gpsAccuracyUncertain(13,20),false)
})
test('approved score colours and localized percentages agree at all tier boundaries',()=>{
 for(const [score,tone] of [[100,'high'],[80,'high'],[79,'raised'],[50,'raised'],[49,'moderate'],[20,'moderate'],[19,'low'],[0,'low'],[null,'unknown']])assert.equal(proximityScoreTone(score),tone)
 for(const lang of ['en','ms','zh-CN'])assert.equal(formatProximityScore(96,lang),'96%')
})
