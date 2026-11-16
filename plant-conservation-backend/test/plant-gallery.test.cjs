"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {once}=require('node:events'),{readFileSync}=require('node:fs'),{join}=require('node:path');
const {createPlantDatabase}=require('./postgres-fixture.cjs');
const {createPlantApp}=require('../server.js');
test('plant-scoped gallery metadata retains existing image authorization and authoritative provenance',async t=>{
  const db=await createPlantDatabase();t.after(()=>db.end());
  for(const name of ['004-species-requests.sql','006-atomic-plant-submissions.sql'])await db.query(readFileSync(join(__dirname,'../migrations',name),'utf8'));
  await db.query(`INSERT INTO species(species_id,scientific_name,rbac_data) VALUES
    (1,'Public','{}'),(2,'Protected','{}'),(3,'Proposal','{"approvalStatus":"Pending Review","submittedBy":"staff:bot"}');
    INSERT INTO rbac_species_visibility VALUES(1,'public'),(2,'protected'),(3,'protected');
    INSERT INTO plant_record(plant_id,species_id,registered_subject,rbac_status,qr_token) VALUES
    (1,1,'staff:bot','Approved','one'),(2,1,'staff:bot','Pending Review','two'),
    (3,2,'staff:bot','Approved','three'),(4,1,'staff:other','Approved','four'),(5,3,'staff:bot','Pending Review','five');
    INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key,origin_type) VALUES
    ('101',1,'staff:bot','Approved','{}','initial','unknown'),
    ('102',1,'staff:bot','Approved','{}','field','subsequent_observation'),
    ('103',1,'staff:bot','Approved','{}','legacy','unknown'),
    ('104',1,'staff:bot','Draft','{}','draft','subsequent_observation'),
    ('201',2,'staff:bot','Pending Review','{}','pending','initial_registration'),
    ('301',3,'staff:bot','Approved','{}','protected','unknown'),
    ('401',4,'staff:other','Approved','{}','foreign','unknown'),
    ('501',5,'staff:bot','Pending Review','{}','proposal','unknown');`);
  for(const [plantId,id,key]of [[1,'101','initial'],[2,'201','pending']])
    await db.query('INSERT INTO plant_submission_receipt(owner_subject,client_key,payload_hash,result) VALUES($1,$2,$3,$4)',
      ['staff:bot',key,'a'.repeat(64),{plant_id:plantId,id,species_id:1,qr_token:'fixture',status:'Pending Review',species_request_id:null}]);
  const fixtures=[
    ['i10',1,'101',false,'initial:photo:10'],['i2',1,'101',false,'initial:photo:2'],['i0',1,'101',false,'initial:photo:0'],
    ['field0',1,'102',true,'field:photo:0'],['fallback-b',1,'102',true,'fallback-b'],['fallback-a',1,'102',true,'fallback-a'],
    ['legacy',1,'103',true,'legacy'],['unlinked',1,null,true,'unlinked'],['private-unlinked',1,null,false,'private-unlinked'],
    ['draft',1,'104',false,'draft'],['p0',2,'201',false,'pending:photo:0'],['p1',2,'201',false,'pending:photo:1'],['p2',2,'201',false,'pending:photo:2'],
    ['protected',3,'301',true,'protected'],['foreign',4,'401',true,'foreign'],['proposal',5,'501',false,'proposal'],
    ['bad-link',1,'401',true,'bad-link'],
  ];
  for(const [id,plant,observation,approved,key]of fixtures)await db.query(`INSERT INTO plant_asset(id,plant_id,observation_id,approved,client_key,owner_subject,content_type,content)
    VALUES($1,$2,$3,$4,$5,'staff:bot','image/jpeg',$6)`,[id,plant,observation,approved,key,Buffer.from('fixture image')]);
  await db.query("INSERT INTO plant_asset(id,species_id,approved,client_key,owner_subject,content_type,content) VALUES('reference',1,TRUE,'reference','staff:bot','image/jpeg',$1)",[Buffer.from('reference')]);
  const users={bot:{id:'bot',role:'Botanist'},other:{id:'other',role:'Botanist'},officer:{id:'officer',role:'Conservation Officer'},visitor:{id:'visitor',role:'Visitor'},admin:{id:'admin',role:'Administrator'},inactive:{id:'inactive',role:'Conservation Officer',status:'Inactive'}};
  for(const u of Object.values(users)){u.status??='Active';u.mustChangePassword=false;}
  const tokens=Object.fromEntries(Object.keys(users).map((k,i)=>[k,String(i+1).repeat(64)]));
  let outage=false;
  const pool={query:(...a)=>db.query(...a),connect:async()=>{if(outage)throw Object.assign(Error('DO_NOT_EXPOSE_FIXTURE_MESSAGE'),{code:'XX000'});return db.connect();}};
  const auth={session:async token=>users[Object.keys(tokens).find(k=>tokens[k]===token)]??null,event:async()=>{}};
  const server=createPlantApp({pool,auth,origins:new Set()}).listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
  const call=async(path,role)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{headers:role?{Authorization:'Bearer '+tokens[role]}:{}});return {status:r.status,data:r.headers.get('content-type')?.includes('json')?await r.json():null};};
  async function all(plant,role,limit=2){let cursor=null,assets=[],pages=0;do{
    const r=await call(`/plants/${plant}/gallery?limit=${limit}`+(cursor?'&cursor='+cursor:''),role);assert.equal(r.status,200,JSON.stringify(r.data));
    assert.ok(r.data.assets.length<=limit);assets.push(...r.data.assets);cursor=r.data.page.next_cursor;
    assert.equal(Boolean(cursor),r.data.page.has_more);assert.ok(++pages<30);
  }while(cursor);return assets;}
  await t.test('public approved photos retain numeric and deterministic fallback order without private counts or context',async()=>{
    // Ordinary byte reads expose only the current approved observation. Verify
    // historical ordering separately through the authorized Officer view.
    const assets=await all(1,'officer');
    assert.deepEqual(assets.filter(a=>a.observation_id==='101').map(a=>a.asset_id),['i0','i2','i10']);
    assert.deepEqual(assets.filter(a=>a.observation_id==='102').map(a=>a.asset_id),['field0','fallback-a','fallback-b']);
    assert.deepEqual(assets.filter(a=>a.observation_id==='101').map(a=>a.photo_order),['0','2','10']);
    const publicAssets=await all(1);
    assert.ok(publicAssets.every(a=>a.observation_date===null&&a.observation_status===null&&a.observation_revision===null));
    assert.deepEqual(publicAssets.map(a=>a.asset_id),['unlinked','legacy']);
    assert.equal(new Set(assets.map(a=>a.asset_id)).size,assets.length);
    assert.ok(!JSON.stringify(publicAssets).includes('staff:'));assert.ok(!publicAssets.some(a=>['draft','foreign','bad-link','private-unlinked'].includes(a.asset_id)));
    assert.equal(assets.find(a=>a.asset_id==='i0').effective_origin,'initial_registration');
    assert.equal(assets.find(a=>a.asset_id==='field0').effective_origin,'subsequent_observation');
    assert.equal(assets.find(a=>a.asset_id==='legacy').effective_origin,'unknown');
    assert.equal(assets.find(a=>a.asset_id==='unlinked').linkage,'unlinked');
    assert.equal(assets.find(a=>a.asset_id==='unlinked').observation_id,null);
    const r=await call('/plants/1/gallery?limit=100');assert.deepEqual(Object.keys(r.data.page).sort(),['has_more','limit','next_cursor']);
  });
  await t.test('pending registration is private but Officer/owner retain existing access',async()=>{
    for(const role of [undefined,'visitor','other'])assert.equal((await call('/plants/2/gallery',role)).status,404);
    const officer=await all(2,'officer');assert.equal(officer.length,3);
    assert.ok(officer.every(a=>a.effective_origin==='initial_registration'&&a.observation_status==='Pending Review'&&a.observation_revision===1));
    assert.equal((await all(2,'bot')).length,3);
    for(const role of ['admin','inactive'])assert.equal((await call('/plants/2/gallery',role)).status,403);
  });
  await t.test('gallery image eligibility agrees with existing content gate for public, owner, other Botanist and Officer',async()=>{
    for(const role of [undefined,'visitor','bot','other','officer']){
      const assets=await all(1,role);
      for(const a of assets)assert.equal((await call('/assets/'+a.asset_id,role)).status,200,role+':'+a.asset_id);
      for(const id of fixtures.filter(f=>f[1]===1&&f[0]!=='bad-link').map(f=>f[0]))
        assert.equal(assets.some(a=>a.asset_id===id),(await call('/assets/'+id,role)).status===200,role+':'+id);
    }
    assert.equal((await call('/assets/reference')).status,200);
    assert.equal((await call('/assets/draft')).status,404);
    assert.ok((await all(1,'officer')).some(a=>a.asset_id==='draft'));
    assert.ok((await all(1,'other')).every(a=>a.observation_status===null));
  });
  await t.test('restricted species and owner proposal exceptions do not broaden access',async()=>{
    for(const role of [undefined,'visitor','bot','other'])assert.equal((await call('/plants/3/gallery',role)).status,404);
    assert.equal((await all(3,'officer')).length,1);
    const ownProtected=await call('/plants/3/gallery?scope=mine','bot');
    assert.equal(ownProtected.status,200);assert.equal(ownProtected.data.assets.length,0);
    assert.equal((await call('/assets/protected?scope=mine','bot')).status,404);
    for(const role of [undefined,'visitor','other'])assert.equal((await call('/plants/5/gallery',role)).status,404);
    assert.equal((await all(5,'bot')).length,1);assert.equal((await all(5,'officer')).length,1);
    assert.equal((await call('/plants/5/gallery?scope=mine','bot')).status,200);
    assert.equal((await call('/plants/5/gallery?scope=mine','officer')).status,403);
  });
  await t.test('cursor binding, bounds, unavailable parents and empty galleries fail safely',async()=>{
    const page=await call('/plants/1/gallery?limit=1');const cursor=page.data.page.next_cursor;
    assert.equal((await call('/plants/4/gallery?cursor='+cursor)).status,400);
    for(const query of ['limit=0','limit=101','limit[]=1','cursor=invalid','scope=other','plant_id=4'])assert.equal((await call('/plants/1/gallery?'+query)).status,400);
    assert.equal((await call('/plants/999/gallery')).status,404);assert.equal((await call('/plants/0/gallery')).status,400);
    await db.query("INSERT INTO plant_record(plant_id,species_id,registered_subject,rbac_status,qr_token) VALUES(6,1,'staff:bot','Approved','empty')");
    const empty=await call('/plants/6/gallery');assert.equal(empty.status,200);assert.deepEqual(empty.data.assets,[]);assert.equal(empty.data.page.next_cursor,null);
  });
  await t.test('database failure is sanitized and no gallery request writes fixture data',async()=>{
    const before=(await db.query('SELECT count(*)::int AS n FROM plant_asset')).rows[0].n;
    outage=true;const r=await call('/plants/1/gallery');outage=false;assert.equal(r.status,503);
    assert.ok(!JSON.stringify(r.data).includes('DO_NOT_EXPOSE'));
    await all(1,'officer');assert.equal((await db.query('SELECT count(*)::int AS n FROM plant_asset')).rows[0].n,before);
  });
});
