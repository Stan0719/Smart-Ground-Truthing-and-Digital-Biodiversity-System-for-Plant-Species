"use strict";
const test=require('node:test'), assert=require('node:assert/strict');
const {readFileSync}=require('node:fs'), {join}=require('node:path'), {randomUUID}=require('node:crypto'), {once}=require('node:events');
const {createPlantApp}=require('../server.js');
test('N2 staff notification foundation uses isolated PostgreSQL only',async t=>{
  const {testPool}=await import('../../web/server/test-postgres.mjs');
  const pool=await testPool(); t.after(()=>pool.end());
  await pool.query("CREATE ROLE anon; CREATE ROLE authenticated");
  await pool.query('CREATE SCHEMA plant_app; SET search_path=plant_app,pg_catalog');
  await pool.query(readFileSync(join(__dirname,'../schema.postgres.sql'),'utf8'));
  for(const file of ['004-species-requests.sql','008-record-change-submissions.sql'])
    await pool.query(readFileSync(join(__dirname,'../migrations',file),'utf8'));
  const migration=readFileSync(join(__dirname,'../migrations/013-staff-notification-foundation.sql'),'utf8');
  await pool.query(migration);
  const users={officer:{id:'one',role:'Conservation Officer'},other:{id:'two',role:'Conservation Officer'},admin:{id:'admin',role:'Administrator'},bot:{id:'bot',role:'Botanist'},visitor:{id:'guest',role:'Visitor'}};
  const tokens=Object.fromEntries(Object.keys(users).map((key,i)=>[key,String(i+1).repeat(64)]));
  let revoked=false, inactive=false, pending=false, outage=false;
  const auth={session:async token=>{
    const key=Object.keys(tokens).find(k=>tokens[k]===token);
    if(!key || (key==='officer'&&revoked)) return null;
    return {...users[key],status:inactive?'Inactive':'Active',mustChangePassword:pending};
  },event:async()=>{}};
  const appPool={query:(...args)=>{if(outage) throw Error('secret database diagnostic');return pool.query(...args)},connect:(...args)=>pool.connect(...args)};
  const server=createPlantApp({pool:appPool,auth}).listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve)}));
  async function call(path='',method='GET',body,who='officer'){
    const r=await fetch(`http://127.0.0.1:${server.address().port}/api/staff-notifications${path}`,{method,
      headers:{'Content-Type':'application/json',...(who?{Authorization:`Bearer ${tokens[who]}`}:{Origin:'http://localhost:5173'})},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:r.status,data:await r.json()};
  }
  await pool.query(`INSERT INTO species(scientific_name,rbac_data) VALUES('Protected fixture','{}');
    INSERT INTO rbac_species_visibility VALUES(1,'protected');
    INSERT INTO plant_record(plant_id,species_id,registered_subject,qr_token) VALUES(1,1,'staff:bot','fixture');
    INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key) VALUES('1',1,'staff:bot','Pending Review','{}','fixture')`);
  async function deliver({recipient='staff:one',role='Conservation Officer',kind='observation',type='registration_submitted',resource='1',eventId}={}){
    const event=eventId??randomUUID(),id=randomUUID();
    if(!eventId) await pool.query(`INSERT INTO staff_notification_event(id,source_key,event_type,audience_role,resource_kind,observation_id,metadata)
      VALUES($1,$2,$3,$4,$5,$6,'{"private":"do-not-project"}')`,[event,'test:'+event,type,role,kind,kind==='observation'?resource:null]);
    await pool.query('INSERT INTO staff_notification(id,event_id,recipient_subject,intended_role) VALUES($1,$2,$3,$4)',[id,event,recipient,role]);
    return {id,event};
  }
  let first,second,admin;
  await t.test('empty inbox and migration repeatability without seeding',async()=>{
    assert.equal((await call()).data.notifications.length,0);
    await pool.query(migration);
    assert.equal((await call('/unread-count')).data.unread_count,0);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM staff_notification_event')).rows[0].n,0);
  });
  await t.test('authentication, active role and revoked session are checked on every endpoint',async()=>{
    const paths=[['','GET'],['/unread-count','GET'],['/read-all','POST'],['/'+randomUUID()+'/read','POST']];
    for(const [path,method] of paths){
      assert.equal((await call(path,method,method==='POST'?{}:undefined,null)).status,401);
      for(const role of ['bot','visitor']) assert.equal((await call(path,method,method==='POST'?{}:undefined,role)).status,403);
      inactive=true;assert.equal((await call(path,method,method==='POST'?{}:undefined)).status,403);inactive=false;
      pending=true;assert.equal((await call(path,method,method==='POST'?{}:undefined)).status,403);pending=false;
      revoked=true;assert.equal((await call(path,method,method==='POST'?{}:undefined)).status,401);revoked=false;
    }
  });
  await t.test('recipient/role isolation, protected Officer access and safe projection',async()=>{
    first=await deliver();second=await deliver();
    await deliver({recipient:'staff:two'});
    admin=await deliver({recipient:'staff:admin',role:'Administrator',kind:'system',type:'security_event'});
    const list=await call();assert.equal(list.status,200);assert.equal(list.data.notifications.length,2);assert.equal(list.data.unread_count,2);
    assert.equal((await call('/unread-count')).data.unread_count,2);
    const a=await call('','GET',undefined,'admin');assert.equal(a.data.notifications.length,1);assert.equal(a.data.notifications[0].id,admin.id);
    assert.ok(!JSON.stringify(list.data).includes('do-not-project'));assert.ok(!JSON.stringify(list.data).includes('staff:'));
    assert.equal((await call('/'+admin.id+'/read','POST',{})).status,404);
    assert.equal((await call('/'+first.id+'/read','POST',{},'other')).status,404);
    users.officer.role='Administrator';assert.equal((await call()).data.notifications.length,0);users.officer.role='Conservation Officer';
  });
  await t.test('first acknowledgement persists and is idempotent',async()=>{
    const a=await call('/'+first.id+'/read','POST',{}),b=await call('/'+first.id+'/read','POST',{});
    assert.equal(a.status,200);assert.equal(a.data.notification.read_at,b.data.notification.read_at);
    assert.equal((await call('/unread-count')).data.unread_count,1);
    assert.equal((await pool.query('SELECT read_at IS NOT NULL AS read FROM staff_notification WHERE id=$1',[first.id])).rows[0].read,true);
  });
  await t.test('signed recipient/role-bound read-all boundary excludes later deliveries',async()=>{
    const {data}=await call(), boundary=data.read_through;
    const newer=await deliver();
    assert.equal((await call('/read-all','POST',{read_through:boundary},'other')).status,400);
    assert.equal((await call('/read-all','POST',{read_through:boundary},'admin')).status,400);
    assert.equal((await call('/read-all','POST',{read_through:boundary.slice(0,-2)+'xx'})).status,400);
    assert.equal((await call('/read-all','POST',{read_through:boundary})).data.updated,1);
    assert.equal((await call('/read-all','POST',{read_through:boundary})).data.updated,0);
    assert.equal((await pool.query('SELECT read_at IS NULL AS unread FROM staff_notification WHERE id=$1',[newer.id])).rows[0].unread,true);
    assert.equal((await call('/unread-count')).data.unread_count,1);
  });
  await t.test('bounded sequence pagination reaches all records without duplicates and excludes later deliveries',async()=>{
    for(let i=0;i<8;i++) await deliver();
    const all=(await call('?limit=100')).data.notifications.map(n=>n.id);
    const found=[];let cursor;
    do{
      const r=await call('?limit=2'+(cursor?'&cursor='+encodeURIComponent(cursor):''));assert.equal(r.status,200);
      found.push(...r.data.notifications.map(n=>n.id));cursor=r.data.page.next_cursor;
      if(found.length===2){
        assert.equal((await call('?cursor='+encodeURIComponent(cursor),'GET',undefined,'other')).status,400);
        await deliver(); // New delivery must not enter this traversal.
      }
    }while(cursor);
    assert.deepEqual(found,all);assert.equal(new Set(found).size,found.length);
  });
  await t.test('invalid IDs, limits, cursors and arbitrary recipient inputs fail closed',async()=>{
    for(const query of ['limit=0','limit=101','limit=1.2','limit=1&limit=2','cursor=bad','recipient_subject=staff:two','role=Administrator'])
      assert.equal((await call('?'+query)).status,400,query);
    for(const id of ['bad','1','not-a-uuid'])assert.equal((await call('/'+id+'/read','POST',{})).status,400);
    assert.equal((await call('/'+randomUUID()+'/read','POST',{})).status,404);
    assert.equal((await call('/'+first.id+'/read','POST',{recipient_subject:'staff:two'})).status,400);
    assert.equal((await call('/read-all','POST',{})).status,400);
  });
  await t.test('deleted/inaccessible resources vanish consistently from list/count/read/read-all',async()=>{
    await pool.query('DELETE FROM plant_observation WHERE id=$1',['1']);
    assert.equal((await call()).data.notifications.length,0);assert.equal((await call('/unread-count')).data.unread_count,0);
    assert.equal((await call('/'+second.id+'/read','POST',{})).status,404);
    assert.equal((await call('/read-all','POST',{read_through:(await call()).data.read_through})).data.updated,0);
    assert.equal((await call('','GET',undefined,'admin')).data.notifications.length,1);
  });
  await t.test('schema uniqueness, role constraints, immutability, RLS and database failure handling',async()=>{
    async function rejects(sql,args){await assert.rejects(pool.query(sql,args));}
    await rejects('UPDATE staff_notification SET recipient_subject=$1 WHERE id=$2',['staff:two',first.id]);
    await rejects('UPDATE staff_notification SET read_at=NULL WHERE id=$1',[first.id]);
    await rejects('UPDATE staff_notification_event SET source_key=$1 WHERE id=$2',['replaced',first.event]);
    await rejects('INSERT INTO staff_notification(id,event_id,recipient_subject,intended_role) VALUES($1,$2,$3,$4)',[randomUUID(),admin.event,'staff:one','Conservation Officer']);
    await rejects('INSERT INTO staff_notification(id,event_id,recipient_subject,intended_role) VALUES($1,$2,$3,$4)',[randomUUID(),first.event,'staff:one','Conservation Officer']);
    await rejects('INSERT INTO staff_notification_event(id,source_key,event_type,audience_role,resource_kind) VALUES($1,$2,$3,$4,$5)',[randomUUID(),'invalid','registration_submitted','Administrator','system']);
    await rejects('INSERT INTO staff_notification_event(id,source_key,event_type,audience_role,resource_kind) VALUES($1,$2,$3,$4,$5)',[randomUUID(),'test:'+first.event,'registration_submitted','Conservation Officer','observation']);
    const readBefore=(await pool.query('SELECT read_at FROM staff_notification WHERE id=$1',[first.id])).rows[0].read_at;
    await pool.query(migration);
    assert.equal(String((await pool.query('SELECT read_at FROM staff_notification WHERE id=$1',[first.id])).rows[0].read_at),String(readBefore));
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM pg_class WHERE relnamespace='plant_app'::regnamespace AND relname IN ('staff_notification','staff_notification_event') AND relrowsecurity")).rows[0].n,2);
    for(const role of ['anon','authenticated']) for(const table of ['staff_notification','staff_notification_event']){
      const p=(await pool.query('SELECT has_table_privilege($1,$2,$3) AS allowed',[role,'plant_app.'+table,'SELECT,INSERT,UPDATE,DELETE'])).rows[0];
      assert.equal(p.allowed,false);
    }
    outage=true;const r=await call();outage=false;assert.equal(r.status,503);assert.ok(!JSON.stringify(r.data).includes('secret'));
    await pool.query('ALTER TABLE staff_notification RENAME TO fixture_hidden_notification');
    assert.equal((await call()).status,503);
    await pool.query('ALTER TABLE fixture_hidden_notification RENAME TO staff_notification');
    // These existing endpoints retain their Botanist-only gate; N2 did not widen it.
    for(const path of ['/api/notifications','/api/notifications/read','/api/notifications/sync']){
      const method=path==='/api/notifications'?'GET':'POST';
      const r=await fetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${tokens.officer}`},body:method==='POST'?'{}':undefined});
      assert.equal(r.status,403);
    }
  });
  await t.test('species-request and record-change resource visibility uses the same list/count/read gates',async()=>{
    const request=(await pool.query(`INSERT INTO species_request_submission(owner_subject,client_key,payload_hash,scientific_name,common_name,genus_name,family_name,conservation_status,description,habitat,photo)
      VALUES('staff:bot','request-fixture','hash','Fixture species','Fixture','Fixture','Fixture','Fixture','Fixture','Fixture',$1) RETURNING request_id`,[Buffer.from([1])])).rows[0].request_id;
    const change=randomUUID();
    await pool.query(`INSERT INTO record_change_submission(id,plant_id,owner_subject,base_snapshot,proposed_snapshot,base_fingerprint,client_key,payload_hash)
      VALUES($1,1,'staff:bot','{}','{}','fixture','fixture','fixture')`,[change]);
    for(const [kind,type,column,value] of [['species_request','species_request_submitted','species_request_id',request],['record_change','record_change_submitted','record_change_id',change]]){
      const event=randomUUID();
      // Column names are test constants, never client values.
      await pool.query(`INSERT INTO staff_notification_event(id,source_key,event_type,audience_role,resource_kind,${column}) VALUES($1,$2,$3,'Conservation Officer',$4,$5)`,[event,'fixture:'+event,type,kind,value]);
      await deliver({eventId:event});
    }
    assert.equal((await call()).data.notifications.length,2);assert.equal((await call('/unread-count')).data.unread_count,2);
    assert.equal((await call('','GET',undefined,'admin')).data.notifications.length,1);
    await pool.query('DELETE FROM species_request_submission WHERE request_id=$1',[request]);
    assert.equal((await call()).data.notifications.length,1);assert.equal((await call('/unread-count')).data.unread_count,1);
    const boundary=(await call()).data.read_through;
    assert.equal((await call('/read-all','POST',{read_through:boundary})).data.updated,1);
    await pool.query('DELETE FROM record_change_submission WHERE id=$1',[change]);
    assert.equal((await call()).data.notifications.length,0);assert.equal((await call('/unread-count')).data.unread_count,0);
  });
});
