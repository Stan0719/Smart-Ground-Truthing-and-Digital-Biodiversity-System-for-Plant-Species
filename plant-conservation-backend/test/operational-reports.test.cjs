"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { once } = require("node:events");
const { createPlantDatabase } = require("./postgres-fixture.cjs");
const { generateOperationalReport: generate, options, mountOperationalReports } = require("../operational-reports.cjs");
const { createPlantApp } = require("../server.js");

test("strict report dispatch and period/device/measurement validation", () => {
  for (const [category, query] of [["camera", {}], ["observations", { limit: 500 }], ["threats", { device: "x" }], ["iot", { measurement: "__proto__" }], ["iot", { device: ["a", "b"] }], ["iot", { period: "custom", start: "2026-02-30", end: "2026-03-01" }]]) assert.throws(() => options(category, query), error => error.status === 400);
  for (const category of ["observations", "threats", "iot"]) assert.equal(options(category, {}).scope.timezone, "Asia/Kuala_Lumpur");
});

test("complete persisted operational reports: statuses, boundaries, no double-counts, units, gaps and privacy", async t => {
  const pool = await createPlantDatabase(); t.after(() => pool.end());
  await pool.query("INSERT INTO species(scientific_name,rbac_data) VALUES('Test species','{\"private\":\"secret-evidence\"}')");
  await pool.query("INSERT INTO plant_record(species_id,registered_subject,qr_token) VALUES(1,'private-owner','private-qr')");
  const statuses = ['Pending Review','Approved','Rejected','Correction Required','Flagged'];
  for (let i = 0; i < 505; i++) await pool.query("INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key,origin_type,created_at) VALUES($1,1,'private-owner',$2,'{\"gps\":\"secret-location\"}',$1,$3,'2026-10-31T16:00:00Z')", [String(i), statuses[i % 5], i % 2 ? 'initial_registration' : 'subsequent_observation']);
  await pool.query("INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key,created_at) VALUES('draft',1,'private','Draft','{}','draft','2026-11-01T00:00:00Z'),('before',1,'private','Approved','{}','before','2026-10-31T15:59:59Z'),('after',1,'private','Approved','{}','after','2026-11-01T16:00:00Z')");
  // Multiple reviews cannot multiply the observation aggregate.
  await pool.query("INSERT INTO observation_review(id,observation_id,reviewer_subject,decision,comment) VALUES('review-a','0','private','Flagged','secret-note'),('review-b','0','private','Approved','secret-note')");
  const filters = { period: 'custom', start: '2026-11-01', end: '2026-11-01' };
  const observations = await generate(pool, 'observations', filters);
  assert.equal(observations.statistics[0].value, 505);
  assert.deepEqual(observations.statistics.slice(1).map(s => s.value), [101,101,101,101,101]);
  assert.equal(observations.chart.series.reduce((sum, series) => sum + series.values.reduce((a,b) => a+b,0),0), 505);
  assert.equal(observations.bucket, 'week'); assert.equal(observations.rows[0][0], '2026-10-26');
  assert.equal((await generate(pool, 'observations', {})).bucket, 'month');
  assert.equal((await generate(pool, 'observations', {})).statistics[0].value, 507);
  await pool.query("INSERT INTO iot_device(id,name,plant_id,key_hash) VALUES('sensor','Sensor one',1,'secret-key'),('sensor2','Sensor two',NULL,'secret-key2')");
  for (const [id, timestamp, value] of [['a','2026-10-31T16:00:00Z',{temperature:0,humidity:80,soilMoisture:300}],['b','2026-10-31T17:00:00Z',{humidity:70}],['c','2026-10-31T18:00:00Z',{temperature:20}],['d','2026-11-01T16:00:00Z',{temperature:999}]]) await pool.query('INSERT INTO sensor_reading(id,device_id,"values",created_at) VALUES($1,\'sensor\',$2,$3)', [id, JSON.stringify(value), timestamp]);
  await pool.query('INSERT INTO sensor_reading(id,device_id,"values",created_at) VALUES(\'other\',\'sensor2\',\'{"temperature":500}\',\'2026-11-01T00:00:00Z\')');
  const iot = await generate(pool, 'iot', {...filters,device:'sensor'});
  assert.deepEqual(iot.chart.series[0].values, [0,null,20]); assert.equal(iot.chart.unit, '°C');
  assert.equal(iot.statistics.find(s=>s.key==='totalReadings').value,3);
  assert.equal(iot.statistics.find(s=>s.key==='devicesWithReadings').value,2);
  assert.deepEqual(iot.statistics.slice(-3).map(s=>s.value),[0,10,20]);
  assert.equal((await generate(pool,'iot',{...filters,device:'sensor',measurement:'soilMoisture'})).chart.unit,'raw');
  await assert.rejects(generate(pool,'iot',{...filters,device:'missing'}),error=>error.status===400);
  await pool.query(`INSERT INTO sensor_reading(id,device_id,"values",created_at) SELECT 'bulk-'||g,'sensor2',jsonb_build_object('humidity',g%100),'2026-11-01T00:00:00Z'::timestamptz FROM generate_series(1,605) AS g`);
  const uncapped = await generate(pool,'iot',{...filters,device:'sensor2',measurement:'humidity'});
  assert.equal(uncapped.rows.length,606); assert.equal(uncapped.statistics.find(stat=>stat.key==='totalReadings').value,606);
  assert.equal(uncapped.chart.series[0].values.filter(value=>value===null).length,1);
  await pool.query("INSERT INTO threat_alert_history(id,device_id,metric,value,status,created_at) VALUES('incident1','sensor','temperature',40,'New','2026-10-31T16:00:00Z'),('incident2','sensor','temperature',41,'Resolved','2026-11-01T00:00:00Z'),('incident3','sensor2','movement',1,'Reviewing','2026-11-01T00:00:00Z'),('outside','sensor','temperature',42,'New','2026-11-01T16:00:00Z')");
  const threats = await generate(pool,'threats',filters);
  assert.deepEqual(threats.statistics.map(s=>s.value),[3,2,1]);
  assert.deepEqual(threats.chart.labels,['temperature','movement']); assert.deepEqual(threats.chart.series[0].values,[2,1]);
  assert.equal(threats.rows[0][1], null); assert.equal(threats.rows[0][3], 'PL001');
  for (const report of [observations,threats,iot]) assert.doesNotMatch(JSON.stringify(report),/private-owner|private-qr|secret-key|secret-location|secret-note|secret-evidence/);
  for (const category of ['observations','threats','iot']) {
    const empty = await generate(pool,category,{period:'custom',start:'2027-01-01',end:'2027-01-01'});
    assert.deepEqual(empty.rows,[]);
    if (category==='iot') assert.deepEqual(empty.statistics.slice(-3).map(s=>s.value),[null,null,null]);
  }
  const auth={session:async()=>({id:'officer',role:'Conservation Officer',status:'Active',mustChangePassword:false}),event:async()=>{}};
  const server=createPlantApp({pool,auth,origins:new Set()}).listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve)}));
  for(const path of ['observations','threats','iot']){
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/reports/${path}`,{headers:{Authorization:`Bearer ${'a'.repeat(64)}`}});
    assert.equal(response.status,200);assert.equal((await response.json()).category,path);
  }
  for(const path of ['camera','observations?limit=500','iot?measurement=invalid']){
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/reports/${path}`,{headers:{Authorization:`Bearer ${'a'.repeat(64)}`}});
    assert.equal(response.status,400);
  }
});

test("unavailable sources produce 503 with rollback, not fabricated empty reports", async () => {
  let handler; const statements=[]; let released=false;
  const client={query:async sql=>{statements.push(sql);if(sql.includes('plant_observation'))throw Object.assign(Error('private SQL detail'),{code:'42P01'});return{rows:[]}},release(){released=true}};
  mountOperationalReports({get(path,permission,fn){assert.equal(path,'/api/reports/:category');assert.equal(permission,'reports.read');handler=fn}}, {pool:{connect:async()=>client},allow:value=>value});
  let status,body;
  await handler({params:{category:'observations'},query:{}},{status(value){status=value;return this},json(value){body=value}});
  assert.equal(status,503);assert.doesNotMatch(JSON.stringify(body),/private SQL/);assert.ok(statements.includes('ROLLBACK'));assert.ok(released);
  assert.equal(statements[0],'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
});

test("new report HTTP routes enforce existing Officer-only authorization before storage", async t => {
  let calls=0;
  const pool={query:async()=>{calls++;throw Error('storage must not be called')},connect:async()=>{calls++;throw Error('storage must not be called')}};
  let role=null;
  const auth={session:async()=>role?{id:'actor',role,status:'Active',mustChangePassword:false}:null,event:async()=>{}};
  const server=createPlantApp({pool,auth,origins:new Set()}).listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve)}));
  for(const candidate of [null,'Visitor','Botanist','Administrator'])for(const category of ['observations','threats','iot']){
    role=candidate;
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/reports/${category}`,{headers:role?{Authorization:`Bearer ${'a'.repeat(64)}`}:{}});
    assert.equal(response.status,role?403:401);
  }
  assert.equal(calls,0);
});
