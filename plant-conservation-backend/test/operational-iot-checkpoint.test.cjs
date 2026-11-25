"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {createPlantDatabase,installIoTLiveReadingAggregates}=require('./postgres-fixture.cjs');
const {generateOperationalReport:generate}=require('../operational-reports.cjs');
const query={period:'custom',start:'2026-11-04',end:'2026-11-04',device:'report-sensor'};
const stat=(r,key)=>r.statistics.find(s=>s.key===key).value;
test('incoming Environmental report combines legacy, completed and active durable data with sample-weighted statistics',async t=>{
 const db=await createPlantDatabase();t.after(()=>db.end());
 await installIoTLiveReadingAggregates(db);
 await db.query("INSERT INTO iot_device(id,name,key_hash) VALUES('report-sensor','Report sensor','synthetic'),('checkpoint-only','Checkpoint only','synthetic')");
 await db.query(`INSERT INTO sensor_reading(id,device_id,"values",created_at) VALUES
 ('legacy-zero','report-sensor','{"temperature":0,"movement":0}','2026-11-04T00:00Z'),
 ('legacy-missing','report-sensor','{}','2026-11-04T00:05Z')`);
 await db.query(`INSERT INTO iot_reading_aggregate(device_id,bucket_start,bucket_end,sample_count,metrics)
 VALUES('report-sensor','2026-11-04T01:00Z','2026-11-04T01:10Z',4,
 '{"temperature":{"count":3,"sum":90,"min":10,"max":50},"movement":{"count":4,"sum":2,"min":0,"max":1}}')`);
 await db.query(`INSERT INTO iot_reading_checkpoint(device_id,bucket_start,last_observed_at,sample_count,metrics)
 VALUES('report-sensor','2026-11-04T02:00Z','2026-11-04T02:07Z',2,
 '{"temperature":{"count":2,"sum":80,"min":35,"max":45},"movement":{"count":2,"sum":1,"min":0,"max":1}}'),
 ('checkpoint-only','2026-11-04T03:00Z','2026-11-04T03:02Z',2,'{"temperature":{"count":2,"sum":-10,"min":-10,"max":0}}')`);
 let r=await generate(db,'iot',{...query,measurement:'temperature'});
 assert.equal(stat(r,'totalReadings'),8);assert.equal(stat(r,'minimum'),0);assert.equal(stat(r,'maximum'),50);assert.equal(stat(r,'average'),170/6);assert.equal(stat(r,'latestReading'),'2026-11-04T02:07:00.000Z');assert.deepEqual(r.chart.series[0].values,[0,null,30,40]);assert.equal(r.rows.length,4);
 assert.ok(r.devices.some(d=>d.id==='checkpoint-only'));
 r=await generate(db,'iot',{...query,device:'checkpoint-only',measurement:'temperature'});assert.equal(stat(r,'totalReadings'),2);assert.equal(stat(r,'average'),-5);assert.equal(stat(r,'minimum'),-10);assert.equal(stat(r,'maximum'),0);
 for(const measurement of ['temperature','humidity','soilMoisture','rainfall','sound','movement']){
  r=await generate(db,'iot',{...query,measurement});assert.equal(r.measurement,measurement);assert.equal(stat(r,'totalReadings'),8);assert.ok(r.measurements.includes(measurement));
  if(measurement==='movement')assert.equal(stat(r,'average'),3/7);
  if(['humidity','soilMoisture','rainfall','sound'].includes(measurement)){assert.equal(stat(r,'average'),null);assert.ok(r.chart.series[0].values.every(v=>v===null));}
 }
 // A stale checkpoint already represented in the completed table must not count twice.
 await db.query("UPDATE iot_reading_checkpoint SET bucket_start='2026-11-04T01:00Z' WHERE device_id='report-sensor'");
 r=await generate(db,'iot',{...query,measurement:'temperature'});assert.equal(stat(r,'totalReadings'),6);assert.equal(stat(r,'average'),90/4);assert.equal(r.rows.length,3);
 // Malaysia inclusive start / exclusive end excludes the following local day.
 await db.query("UPDATE iot_reading_checkpoint SET bucket_start='2026-11-04T16:00Z',last_observed_at='2026-11-04T16:02Z' WHERE device_id='checkpoint-only'");
 r=await generate(db,'iot',{period:'custom',start:'2026-11-04',end:'2026-11-04'});assert.ok(!r.devices.some(d=>d.id==='checkpoint-only'));
 r=await generate(db,'iot',{period:'custom',start:'2027-01-01',end:'2027-01-01'});assert.equal(r.rows.length,0);assert.equal(stat(r,'totalReadings'),0);assert.equal(stat(r,'average'),null);
});
