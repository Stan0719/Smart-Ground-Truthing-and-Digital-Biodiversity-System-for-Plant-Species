"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const {once} = require("node:events");
const {reportPeriod} = require("../report-period.cjs");
const {createPlantDatabase} = require("./postgres-fixture.cjs");
const {createPlantApp} = require("../server.js");

test("report periods resolve calendar months and midnight boundaries in Kuala Lumpur", () => {
  assert.deepEqual(reportPeriod({}), {period:'all-time',timezone:'Asia/Kuala_Lumpur',startDate:null,endDate:null,startInclusive:null,endExclusive:null});
  // Already November in Kuala Lumpur, still October in UTC.
  const now = new Date('2026-10-31T17:00:00Z');
  const current = reportPeriod({period:'this-month'}, now);
  assert.equal(current.startDate, '2026-11-01'); assert.equal(current.endDate, '2026-11-30');
  assert.equal(current.startInclusive, '2026-10-31T16:00:00.000Z');
  assert.equal(current.endExclusive, '2026-11-30T16:00:00.000Z');
  const prior = reportPeriod({period:'last-month'}, new Date('2026-01-01T00:00:00Z'));
  assert.equal(prior.startDate, '2025-12-01'); assert.equal(prior.endDate, '2025-12-31');
  const leap = reportPeriod({period:'custom',start:'2024-02-29',end:'2024-02-29'});
  assert.equal(leap.startInclusive, '2024-02-28T16:00:00.000Z');
  assert.equal(leap.endExclusive, '2024-02-29T16:00:00.000Z');
});

test("report API aggregates approved registrations before grouping and retains every species", async t => {
  const pool = await createPlantDatabase(); t.after(()=>pool.end());
  await pool.query("INSERT INTO species(scientific_name,common_name,rbac_data) VALUES('Alpha','A','{}'),('Zero','Z','{}'),('Pending species','P','{\"approvalStatus\":\"Pending Review\"}')");
  const insert = async (status, timestamp, token) => pool.query("INSERT INTO plant_record(species_id,registered_subject,rbac_status,qr_token,registered_at) VALUES(1,'staff:bot',$1,$2,$3)", [status, token, timestamp]);
  await insert('Approved','2026-10-31T15:59:59.999Z','before');
  await insert('Approved','2026-10-31T16:00:00Z','start');
  await insert('Approved','2026-11-01T15:59:59.999Z','end');
  await insert('Approved','2026-11-01T16:00:00Z','after');
  await insert('Pending Review','2026-11-01T00:00:00Z','pending');
  await insert('Rejected','2026-11-01T00:00:00Z','rejected');
  const auth={session:async()=>({id:'officer',role:'Conservation Officer',status:'Active',mustChangePassword:false}),event:async()=>{}};
  const server=createPlantApp({pool,auth,origins:new Set()}).listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve)}));
  const call=async query=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/reports${query}`,{headers:{Authorization:`Bearer ${'a'.repeat(64)}`}});return {status:r.status,data:await r.json()}};
  const all=await call('');assert.equal(all.status,200);assert.equal(all.data.rows.length,3);
  assert.equal(Number(all.data.rows.find(r=>r.scientific_name==='Alpha').approved_plants),4);
  const filtered=await call('?period=custom&start=2026-11-01&end=2026-11-01');
  assert.equal(filtered.status,200);assert.equal(filtered.data.rows.length,3);
  assert.equal(Number(filtered.data.rows.find(r=>r.scientific_name==='Alpha').approved_plants),2);
  assert.equal(Number(filtered.data.rows.find(r=>r.scientific_name==='Zero').approved_plants),0);
  assert.equal(filtered.data.scope.startInclusive,'2026-10-31T16:00:00.000Z');
  const empty=await call('?period=custom&start=2027-01-01&end=2027-01-01');
  assert.equal(empty.status,200);assert.ok(empty.data.rows.every(r=>Number(r.approved_plants)===0));
  for (const period of ['this-month','last-month']) {
    const r=await call('?period='+period);assert.equal(r.status,200);
    assert.equal(r.data.scope.period,period);assert.equal(r.data.scope.timezone,'Asia/Kuala_Lumpur');
  }
  for(const query of ['?period=unknown','?category=iot','?start=2026-01-01&end=2026-01-02','?period=custom',
    '?period=custom&start=2026-02-30&end=2026-03-01','?period=custom&start=2025-02-29&end=2025-03-01',
    '?period=custom&start=2026-12-01&end=2026-11-01','?period=custom&start=2026-01-01',
    '?period=all-time&start=2026-01-01','?period=custom&start=1900-01-01&end=2026-01-01',
    '?period=custom&start=2026-11-01T00:00:00Z&end=2026-11-02','?period=custom&period=all-time',
    '?period=custom&start=2026-01-01&end=9999-12-31']) {
    assert.equal((await call(query)).status,400,query);
  }
});
