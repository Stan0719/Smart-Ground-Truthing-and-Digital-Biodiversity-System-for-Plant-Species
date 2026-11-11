"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {readFileSync}=require('node:fs'),{join}=require('node:path');
const {createOfficerNotificationReconciliation:create}=require('../officer-notification-reconciliation.cjs');
const {createOfficerNotificationDelivery}=require('../officer-notification-delivery.cjs');
const lowerBound='2026-11-05T00:00:00Z';
test('reconciliation defaults fail closed without touching a pool',async()=>{
  const pool={connect(){throw Error('must not connect');}};
  const r=create({pool});assert.equal(r.enabled,false);assert.deepEqual(await r.runOnce(),{disabled:true});r.start();await r.stop();
  await assert.rejects(r.preview(),/lowerBound/);
  assert.throws(()=>create({pool,config:{enabled:true}}),/lowerBound/);
  assert.throws(()=>create({pool,config:{enabled:true,lowerBound:'2026-02-31T00:00:00Z'}}),/lowerBound/);
  assert.throws(()=>create({pool,config:{batchSize:51}}),/limits/);
  assert.throws(()=>create({pool,config:{enabled:true,lowerBound}}),/enqueue/);
});
test('isolated reconciliation recovery, preview and existing delivery contracts',async t=>{
  const {testPool}=await import('../../web/server/test-postgres.mjs');const db=await testPool();t.after(()=>db.end());
  await db.query('CREATE SCHEMA plant_app; SET search_path=plant_app,pg_catalog');
  await db.query(readFileSync(join(__dirname,'../schema.postgres.sql'),'utf8'));
  for(const name of ['004-species-requests.sql','006-atomic-plant-submissions.sql','008-record-change-submissions.sql','009-record-version-history.sql','011-botanist-notification-history.sql','013-staff-notification-foundation.sql'])
    await db.query(readFileSync(join(__dirname,'../migrations',name),'utf8'));
  await db.query(`INSERT INTO species(scientific_name,common_name) VALUES('Fixture','Fixture');
    INSERT INTO rbac_species_visibility VALUES(1,'public');
    INSERT INTO plant_record(species_id,registered_subject,qr_token,scientific_name) VALUES(1,'staff:owner','fixture','Fixture');`);
  const auth={db:{prepare:()=>({all:async()=>[
    {id:'owner',role:'Conservation Officer',status:'Active',must_change_password:0},
    {id:'officer',role:'Conservation Officer',status:'Active',must_change_password:0}
  ]})}};
  const delivery=createOfficerNotificationDelivery({pool:db,auth});t.after(()=>delivery.stop());
  const config={enabled:true,lowerBound,batchSize:2};
  const make=(override={})=>create({pool:db,officerNotifications:delivery,config:{...config,...override}});
  async function observation(id,origin='initial_registration',at='2026-11-05T03:44:37Z'){
    await db.query(`INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key,origin_type,created_at,updated_at)
      VALUES($1,1,'staff:owner','Pending Review','{}',$1,$2,$3,$3)`,[id,origin,at]);
  }
  async function receipt(id,extra={}){
    await db.query('INSERT INTO plant_submission_receipt(owner_subject,client_key,payload_hash,result,created_at) VALUES($1,$2,$3,$4,$5)',
      ['staff:owner',id,'a'.repeat(64),{id,plant_id:1,species_id:1,qr_token:'fixture',status:'Pending Review',species_request_id:null,...extra},'2026-11-05T03:44:37Z']);
  }
  const count=async table=>Number((await db.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
  await t.test('Plant 18-like valid receipt and read-only preview',async()=>{
    await observation('initial');await receipt('initial');
    const preview=await make({enabled:false}).preview();assert.equal(preview.enabled,false);
    assert.equal(preview.candidates[0].reason,'ELIGIBLE_MISSING_EVENT');
    assert.equal(preview.candidates[0].source_key,'officer:registration_submitted:initial');
    assert.equal(JSON.stringify(preview).includes('staff:owner'),false);
    assert.equal(await count('staff_notification_event'),0);assert.equal(await count('staff_notification'),0);
    assert.equal((await make().runOnce()).enqueued,1);
  });
  await t.test('standalone requires creation and pending-submit audit evidence',async()=>{
    await observation('field','subsequent_observation');
    let r=make({batchSize:50});assert.equal((await r.preview()).candidates.find(x=>x.observation_id==='field').reason,'UNVERIFIED_STANDALONE_SUBMISSION');
    await db.query(`INSERT INTO business_audit(id,actor_subject,action,target,created_at) VALUES
      ('creation','staff:owner','observation_submitted','field','2026-11-05T03:44:37Z'),
      ('submit','staff:owner','observation_submitted','field','2026-11-05T03:44:37Z')`);
    assert.equal((await r.runOnce()).enqueued,1);
    assert.equal((await db.query("SELECT source_key FROM staff_notification_event WHERE observation_id='field'")).rows[0].source_key,'officer:field_observation_submitted:field:1');
  });
  await t.test('multi-instance duplicate protection, self-review and read-state preservation',async()=>{
    await Promise.all([make({batchSize:50}).runOnce(),make({batchSize:50}).runOnce()]);
    assert.equal(await count('staff_notification_event'),2);
    await delivery.deliverBatch();assert.equal(await count('staff_notification'),2);
    assert.ok((await db.query('SELECT recipient_subject FROM staff_notification')).rows.every(x=>x.recipient_subject==='staff:officer'));
    await db.query('UPDATE staff_notification SET read_at=clock_timestamp()');
    const before=(await db.query('SELECT id,read_at FROM staff_notification ORDER BY id')).rows;
    await make({batchSize:50}).runOnce();await delivery.deliverBatch();
    assert.deepEqual((await db.query('SELECT id,read_at FROM staff_notification ORDER BY id')).rows,before);
    assert.equal(await count('botanist_notification'),0);
  });
  await t.test('missing and ambiguous receipts, unknown origins and historical boundary excluded',async()=>{
    await observation('missing');await observation('unknown','unknown');
    const old='2026-11-04T00:00:00Z';await observation('old','subsequent_observation',old);
    // A second conflicting receipt makes initial classification unknown.
    await db.query(`INSERT INTO plant_submission_receipt(owner_subject,client_key,payload_hash,result)
      VALUES('staff:other','replay',$1,$2)`,['b'.repeat(64),{id:'initial',plant_id:1}]);
    const preview=await make({batchSize:50}).preview();
    for(const id of ['initial','missing','unknown'])assert.equal(preview.candidates.find(x=>x.observation_id===id).excluded_by_policy,true);
    assert.equal(preview.candidates.some(x=>x.observation_id==='old'),false);
    assert.equal((await make({batchSize:50}).runOnce()).enqueued,0);
    await db.query("DELETE FROM plant_submission_receipt WHERE client_key='replay'");
  });
  await t.test('species proposals preserve dependency, invalid linkage excluded',async()=>{
    // A different plant avoids ambiguity with the first registration receipt.
    await db.query("INSERT INTO plant_record(species_id,registered_subject,qr_token,scientific_name) VALUES(1,'staff:owner','proposal','Fixture')");
    await observation('proposal');await db.query("UPDATE plant_observation SET plant_id=2 WHERE id='proposal'");
    const request=(await db.query(`INSERT INTO species_request_submission(owner_subject,client_key,payload_hash,scientific_name,common_name,genus_name,family_name,conservation_status,description,habitat,photo,proposed_species_id)
      VALUES('staff:owner','proposal',$1,'Fixture','Fixture','Fixture','Fixture','Least Concern','Fixture','Fixture',$2,1) RETURNING request_id`,['a'.repeat(64),Buffer.from('fixture')])).rows[0];
    await receipt('proposal',{plant_id:2,species_request_id:request.request_id});
    assert.equal((await make({batchSize:50}).runOnce()).enqueued,1);
    assert.equal((await db.query("SELECT metadata FROM staff_notification_event WHERE observation_id='proposal'")).rows[0].metadata.species_review_required,true);
    await db.query("UPDATE plant_submission_receipt SET result=jsonb_set(result,'{species_request_id}','999') WHERE client_key='proposal'");
    assert.equal((await make({batchSize:50}).preview()).candidates.find(x=>x.observation_id==='proposal').excluded_by_policy,true);
  });
  await t.test('bounded pagination, existing events and repeated sweeps',async()=>{
    const r=make({enabled:false,batchSize:1});let after=null,seen=[];
    do{const p=await r.preview({after});seen.push(...p.candidates);after=p.next_cursor;}while(after);
    assert.equal(new Set(seen.map(x=>x.observation_id)).size,seen.length);
    assert.equal(seen.find(x=>x.observation_id==='field').event_exists,true);
    assert.equal((await make({batchSize:50}).runOnce()).enqueued,0);
  });
  await t.test('receipt boundary excludes historical registration even when recently updated',async()=>{
    await db.query("UPDATE plant_submission_receipt SET created_at='2026-11-04T00:00:00Z' WHERE client_key='initial'");
    assert.equal((await make({batchSize:50}).preview()).candidates.find(x=>x.observation_id==='initial').reason,'BEFORE_POLICY_BOUNDARY');
    await db.query("UPDATE plant_submission_receipt SET created_at='2026-11-05T03:44:37Z' WHERE client_key='initial'");
  });
  await t.test('two recovery instances and normal-producer race retain one event per pending revision',async()=>{
    await observation('race','subsequent_observation');
    await db.query(`INSERT INTO business_audit(id,actor_subject,action,target,created_at) VALUES
      ('race-create','staff:owner','observation_submitted','race','2026-11-05T03:44:37Z'),
      ('race-submit','staff:owner','observation_submitted','race','2026-11-05T03:44:37Z')`);
    const before=await count('staff_notification_event');
    await Promise.all([make({batchSize:50}).runOnce(),make({batchSize:50}).runOnce()]);
    assert.equal(await count('staff_notification_event'),before+1);
    await db.query("UPDATE plant_observation SET revision=2 WHERE id='race'");
    const competing={enqueue:async(c,id,dependency)=>{
      // Simulate normal producer winning source-key insertion after discovery.
      await delivery.enqueue(c,id,dependency);return delivery.enqueue(c,id,dependency);
    }};
    await create({pool:db,officerNotifications:competing,config:{...config,batchSize:50}}).runOnce();
    assert.equal(await count('staff_notification_event'),before+2);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM staff_notification_event WHERE source_key='officer:field_observation_submitted:race:2'")).rows[0].n,1);
  });
  await t.test('rollback and release on SQL failure; no overlapping passes; cross-instance lock contention',async()=>{
    const commands=[];let releaseCount=0;
    const failed=create({pool:{connect:async()=>({release(){releaseCount++;},query:async sql=>{
      commands.push(sql);if(sql.includes('pg_try_advisory'))throw Error('fixture query failure');return {rows:sql.includes('current_schema')?[{ready:true}]:[]};
    }})},officerNotifications:delivery,config});
    const first=failed.runOnce();assert.equal(failed.runOnce(),first);await assert.rejects(first,/fixture query failure/);
    assert.equal(commands.at(-1),'ROLLBACK');assert.equal(releaseCount,1);
    const busy=create({pool:{connect:async()=>({release(){},query:async sql=>({rows:sql.includes('pg_try_advisory')?[{locked:false}]:sql.includes('current_schema')?[{ready:true}]:[]})})},officerNotifications:delivery,config});
    assert.deepEqual(await busy.runOnce(),{busy:true});
    const wrongSchema=create({pool:{connect:async()=>({release(){},query:async()=>({rows:[]})})},officerNotifications:delivery,config});
    await assert.rejects(wrongSchema.runOnce(),/scoped pool/);
  });
  await t.test('status and revision races are skipped; connection failures propagate safely',async()=>{
    let changed=false;
    const pool={connect:async()=>{const c=await db.connect();return {release:()=>c.release(),query:async(sql,args)=>{
      if(sql.includes('FOR UPDATE SKIP LOCKED')&&!changed){changed=true;await c.query("UPDATE plant_observation SET status='Approved',revision=revision+1 WHERE id=$1",[args[0]]);}
      return c.query(sql,args);
    }};}};
    const r=create({pool,officerNotifications:{enqueue(){throw Error('must not enqueue');}},config:{...config,batchSize:1}});
    assert.equal((await r.runOnce()).enqueued,0);
    const broken=create({pool:{connect:async()=>{throw Error('fixture pool outage');}},officerNotifications:delivery,config});
    await assert.rejects(broken.runOnce(),/fixture pool outage/);
  });
});
