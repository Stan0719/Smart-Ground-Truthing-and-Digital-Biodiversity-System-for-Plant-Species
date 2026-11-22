const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createPlantDatabase } = require('./postgres-fixture.cjs');
const { createPlantApp } = require('../server.js');
test('Officer registry paginates the full dataset, filters safely, and never writes', async t => {
  const pool = await createPlantDatabase(); t.after(() => pool.end());
  await pool.query(`CREATE TABLE plant_app.qr_code(qr_id integer,plant_id integer,qr_code text,status text);
    INSERT INTO species(species_id,scientific_name,common_name) VALUES(1,'Shorea','Meranti'),(2,'Other','Other');
    ALTER TABLE plant_record DROP CONSTRAINT plant_record_rbac_status_check;
    INSERT INTO plant_record(plant_id,species_id,registered_subject,rbac_status,qr_token)
      SELECT n,CASE WHEN n=2 THEN 2 ELSE 1 END,'staff:bot',CASE WHEN n%4=1 THEN 'Withdrawn' WHEN n%4=2 THEN 'Rejected' WHEN n%4=3 THEN 'Pending Review' ELSE 'Approved' END,'token-'||n FROM generate_series(1,620) n;
    UPDATE plant_record SET scientific_name='Plant name '||plant_id;
    INSERT INTO qr_code VALUES(42,1,'token-1','assigned');`);
  const auth = { session: async token => ({ id:'tester',role: token==='a'.repeat(64)?'Conservation Officer':'Botanist',status:'Active',mustChangePassword:false }), event:async()=>{} };
  const server = createPlantApp({pool,auth,origins:new Set()}).listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve)}));
  async function call(query='',token='a'.repeat(64)) {const r=await fetch(`http://127.0.0.1:${server.address().port}/api/officer/plants${query}`,{headers:token?{Authorization:'Bearer '+token}:{}});return {status:r.status,data:await r.json()};}
  assert.equal((await call('',null)).status,401);assert.equal((await call('','b'.repeat(64))).status,403);
  const first=await call();assert.equal(first.status,200);assert.equal(first.data.plants.length,25);assert.equal(first.data.plants[0].id,'620');assert.equal(first.data.plants[0].status,'Approved');
  const ids=[];let page=first;
  while(true){ids.push(...page.data.plants.map(row=>row.id));if(!page.data.page.has_more)break;page=await call('?cursor='+encodeURIComponent(page.data.page.next_cursor));}
  assert.equal(ids.length,155);assert.equal(new Set(ids).size,155);
  for(const query of ['?q=PL004','?q=QR-0042']) {const p=await call(query);assert.equal(p.status,200);assert.ok(p.data.plants.every(row=>row.status==='Approved'));}
  assert.equal((await call('?q=QR-0042')).data.plants[0].id,'4');
  assert.equal((await call('?q=PL001')).data.plants.length,0);
  assert.equal((await call('?species=2')).data.plants[0].id,'4');
  assert.equal((await call('?q=absent')).data.plants.length,0);
  assert.equal((await call('?status=Invalid')).status,400);
  assert.equal((await call('?q=changed&cursor='+encodeURIComponent(first.data.page.next_cursor))).status,400);
  assert.equal((await call('?species=1%20OR%201=1')).status,400);
  assert.equal((await pool.query('SELECT count(*)::integer AS n FROM plant_record')).rows[0].n,620);
});
