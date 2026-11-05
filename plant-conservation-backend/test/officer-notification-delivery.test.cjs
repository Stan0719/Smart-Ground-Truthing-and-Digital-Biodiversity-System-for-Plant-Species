"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {readFileSync}=require('node:fs'),{join}=require('node:path'),{once}=require('node:events');
const sharp=require('sharp');
const {createPlantApp}=require('../server.js');
const {createOfficerNotificationDelivery}=require('../officer-notification-delivery.cjs');
test('Officer real notifications: isolated committed workflows and durable delivery',async t=>{
  const {testPool}=await import('../../web/server/test-postgres.mjs');const database=await testPool();t.after(()=>database.end());
  await database.query('CREATE SCHEMA plant_app; SET search_path=plant_app,pg_catalog');
  await database.query(readFileSync(join(__dirname,'../schema.postgres.sql'),'utf8'));
  for(const file of ['004-species-requests.sql','006-atomic-plant-submissions.sql','008-record-change-submissions.sql','009-record-version-history.sql','013-staff-notification-foundation.sql'])
    await database.query(readFileSync(join(__dirname,'../migrations',file),'utf8'));
  await database.query(`CREATE TABLE public.qr_code(qr_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,plant_id INTEGER UNIQUE,qr_code TEXT UNIQUE,status TEXT,assigned_at timestamptz,activated_at timestamptz,retired_at timestamptz);
    INSERT INTO public.qr_code(qr_code,status) VALUES('one','generated'),('two','generated'),('three','generated');
    INSERT INTO species(scientific_name,common_name) VALUES('Fixture species','Fixture');INSERT INTO rbac_species_visibility VALUES(1,'public')`);
  let failCommit=false,failFanout=false,fanoutWrites=0,directoryDown=false;
  const pool={query:(...args)=>database.query(...args),connect:async()=>{
    const c=await database.connect();return {release:()=>c.release(),query:async(sql,args)=>{
      if(failCommit&&sql==='COMMIT'){failCommit=false;throw Error('fixture commit failure');}
      if(failFanout&&sql.includes('INSERT INTO plant_app.staff_notification(')&&++fanoutWrites===2){failFanout=false;throw Error('fixture delivery failure');}
      return c.query(sql,args);
    }};
  }};
  const users={bot:{id:'bot',role:'Botanist',status:'Active',mustChangePassword:false},one:{id:'one',role:'Conservation Officer',status:'Active',mustChangePassword:false},two:{id:'two',role:'Conservation Officer',status:'Active',mustChangePassword:false},inactive:{id:'inactive',role:'Conservation Officer',status:'Inactive',mustChangePassword:false},temporary:{id:'temporary',role:'Conservation Officer',status:'Active',mustChangePassword:true},admin:{id:'admin',role:'Administrator',status:'Active',mustChangePassword:false}};
  const tokens=Object.fromEntries(Object.keys(users).map((key,i)=>[key,String(i+1).repeat(64)]));
  const auth={session:async token=>users[Object.keys(tokens).find(key=>tokens[key]===token)]??null,event:async()=>{},db:{prepare:sql=>{
    assert.match(sql,/SELECT id,role,status,must_change_password FROM users/);assert.doesNotMatch(sql,/password_hash|name,|email/);
    return {all:async(role,status)=>{if(directoryDown)throw Error('fixture directory outage');return Object.values(users).filter(u=>u.role===role&&u.status===status&&!u.mustChangePassword).map(u=>({id:u.id,role:u.role,status:u.status,must_change_password:Number(u.mustChangePassword)}));}};
  }}};
  const delivery=createOfficerNotificationDelivery({pool,auth});t.after(()=>delivery.stop());
  const app=createPlantApp({pool,auth,officerNotifications:delivery});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve)}));
  async function call(path,method='GET',body,user='bot'){
    const r=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${tokens[user]}`},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:r.status,data:await r.json()};
  }
  const photo={content_type:'image/png',base64:(await sharp({create:{width:4,height:4,channels:3,background:'green'}}).png().toBuffer()).toString('base64')};
  const registration=(qr,key)=>({scientific_name:'Fixture individual',latitude:4,longitude:113,qr_id:qr,client_key:key,photos:[photo,photo,photo],content:{heightCm:20,healthStatus:'Healthy',lifeStage:'Juvenile',morphology:'Fixture'},species_id:1});
  const total=async table=>(await database.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
  let existing,proposal,field;
  await t.test('successful/replayed existing-species and genuine proposals create one event each',async()=>{
    const body=registration(1,'existing');const r=await call('/plant-submissions','POST',body);assert.equal(r.status,201,JSON.stringify(r.data));existing=r.data;
    assert.equal(await total('staff_notification_event'),1);assert.equal(await total('staff_notification'),0);
    assert.equal((await call('/plant-submissions','POST',body)).status,201);assert.equal(await total('staff_notification_event'),1);
    const proposed=registration(2,'proposal');delete proposed.species_id;
    proposed.new_species={scientific_name:'New fixture species',common_name:'New fixture',genus_name:'Fixture',family_name:'Fixture',conservation_status:'Least Concern',description:'Fixture',habitat:'Fixture',photo};
    const p=await call('/plant-submissions','POST',proposed);assert.equal(p.status,201,JSON.stringify(p.data));proposal=p.data;
    assert.equal(await total('staff_notification_event'),2);
    const events=(await database.query('SELECT event_type,metadata FROM staff_notification_event ORDER BY occurred_at')).rows;
    assert.ok(events.every(e=>e.event_type==='registration_submitted'));assert.equal(events[0].metadata.species_review_required,false);assert.equal(events[1].metadata.species_review_required,true);
  });
  await t.test('transaction failure rolls back business records and outbox together',async()=>{
    const before=await total('plant_record');failCommit=true;
    assert.equal((await call('/plant-submissions','POST',registration(3,'rollback'))).status,503);
    assert.equal(await total('plant_record'),before);assert.equal(await total('staff_notification_event'),2);
    assert.equal((await database.query('SELECT plant_id FROM public.qr_code WHERE qr_id=3')).rows[0].plant_id,null);
  });
  await t.test('Draft emits nothing; one verified field submit emits once; unknown provenance emits nothing',async()=>{
    await database.query("UPDATE plant_record SET rbac_status='Approved' WHERE plant_id=$1",[existing.plant_id]);
    const r=await call(`/plants/${existing.plant_id}/observations`,'POST',{client_key:'field',content:{heightCm:30,healthStatus:'Healthy',lifeStage:'Juvenile',morphology:'Fixture'}});assert.equal(r.status,201,JSON.stringify(r.data));field=r.data;
    assert.equal(await total('staff_notification_event'),2);
    assert.equal((await call(`/observations/${field.id}/submit`,'POST',{})).status,200);assert.equal(await total('staff_notification_event'),3);
    assert.equal((await call(`/observations/${field.id}/submit`,'POST',{})).status,200);assert.equal(await total('staff_notification_event'),3);
    await database.query("INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key) VALUES('999',$1,'staff:bot','Pending Review','{}','legacy')",[existing.plant_id]);
    const c=await pool.connect();try{await c.query('BEGIN');assert.equal(await delivery.enqueue(c,'999'),false);await c.query('COMMIT');}finally{c.release();}
    assert.equal(await total('staff_notification_event'),3);
  });
  await t.test('directory failure leaves events durable; partial fan-out rolls back; retry delivers without duplicates',async()=>{
    directoryDown=true;await assert.rejects(delivery.deliverBatch());directoryDown=false;
    assert.equal(await total('staff_notification'),0);
    failFanout=true;await delivery.deliverBatch();
    assert.equal((await database.query("SELECT count(*)::int AS n FROM staff_notification_event WHERE delivery_state='failed'")).rows[0].n,1);
    assert.equal(await total('staff_notification'),4);
    await database.query("UPDATE staff_notification_event SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE delivery_state='failed'");
    await delivery.deliverBatch();assert.equal(await total('staff_notification'),6);
    await delivery.deliverBatch();assert.equal(await total('staff_notification'),6);
    assert.equal((await database.query("SELECT count(*)::int AS n FROM staff_notification_event WHERE delivery_state='delivered'")).rows[0].n,3);
    assert.ok((await database.query('SELECT recipient_subject FROM staff_notification')).rows.every(r=>['staff:one','staff:two'].includes(r.recipient_subject)));
  });
  await t.test('inbox isolation, species-first display and persistent read semantics remain intact',async()=>{
    const list=await call('/staff-notifications','GET',undefined,'one');assert.equal(list.status,200);assert.equal(list.data.notifications.length,3);
    assert.equal(list.data.notifications.find(n=>n.resource.id===proposal.id).species_review_required,true);
    const notice=list.data.notifications[0];assert.equal((await call(`/staff-notifications/${notice.id}/read`,'POST',{},'two')).status,404);
    const first=await call(`/staff-notifications/${notice.id}/read`,'POST',{},'one'),second=await call(`/staff-notifications/${notice.id}/read`,'POST',{},'one');assert.equal(first.data.notification.read_at,second.data.notification.read_at);
    assert.equal((await call('/staff-notifications/unread-count','GET',undefined,'one')).data.unread_count,2);
    assert.equal((await call('/staff-notifications','GET',undefined,'admin')).data.notifications.length,0);
  });
  await t.test('self-review recipients and revoked roles are excluded; zero eligible recipients stay undelivered',async()=>{
    users.one.status='Inactive';users.two.role='Administrator';users.bot.role='Conservation Officer';
    await database.query("UPDATE plant_observation SET status='Draft',revision=revision+1 WHERE id=$1",[field.id]);
    users.bot.role='Botanist';assert.equal((await call(`/observations/${field.id}/submit`,'POST',{})).status,200);users.bot.role='Conservation Officer';
    await delivery.deliverBatch();
    const event=(await database.query("SELECT delivery_state,last_error_code FROM staff_notification_event WHERE delivery_state<>'delivered'")).rows[0];
    assert.equal(event.delivery_state,'failed');assert.equal(event.last_error_code,'NO_ELIGIBLE_OFFICERS');
    assert.equal(await total('staff_notification'),6);
  });
  await t.test('Administrator event handling and response shape are not expanded by the Officer feature',async()=>{
    await database.query(`INSERT INTO staff_notification_event(id,source_key,event_type,audience_role,resource_kind,metadata)
      VALUES('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','fixture-admin','security_event','Administrator','system','{"species_review_required":true}');
      INSERT INTO staff_notification(id,event_id,recipient_subject,intended_role)
      VALUES('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','staff:admin','Administrator')`);
    const result=await call('/staff-notifications','GET',undefined,'admin');assert.equal(result.status,200);
    assert.equal(result.data.notifications.length,1);assert.equal(Object.hasOwn(result.data.notifications[0],'species_review_required'),false);
    await delivery.deliverBatch();
    assert.equal((await database.query("SELECT delivery_state FROM staff_notification_event WHERE source_key='fixture-admin'")).rows[0].delivery_state,'pending');
  });
});
