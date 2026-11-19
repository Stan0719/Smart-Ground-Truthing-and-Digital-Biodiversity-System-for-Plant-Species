const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
// Use the repository's declared Web test dependency through its isolated adapter.
test('edit review notification migration preserves delivery, deduplication, read state and rollback', async () => {
 const {testPool}=await import('../../web/server/test-postgres.mjs'); const db=await testPool();
 try {
 await db.query(`CREATE SCHEMA plant_app; SET search_path TO plant_app;
 CREATE TABLE botanist_notification(id text primary key,recipient_subject text,type text,source_key text,plant_id bigint,observation_id text,review_id text,metadata jsonb,read_at timestamptz, UNIQUE(recipient_subject,source_key));`);
 await db.query(readFileSync(join(__dirname,'../migrations/030-record-change-review-notifications.sql'),'utf8'));
 const source=readFileSync(join(__dirname,'../record-changes.cjs'),'utf8');
 const sql=source.match(/INSERT INTO (?:plant_app\.)?botanist_notification\(id,recipient_subject,type,source_key,plant_id,metadata\)\s+VALUES\(\$1,\$2,\$6,[\s\S]*?DO NOTHING/)[0];
 for(const kind of ['plant','species']) for(const decision of ['approved','rejected','correction']) {
 const key=`${kind}:${decision}`; const args=[key,'staff:owner',key,kind==='plant'?30:null,{entityType:'record_change',changeId:key,recordKind:kind,targetId:'30',revision:1},`record_change_${decision}`];
 await db.query(sql,args); await db.query(sql,args);
 }
 assert.equal((await db.query('SELECT count(*)::int AS n FROM botanist_notification')).rows[0].n,6);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM botanist_notification WHERE recipient_subject=$1',['staff:other'])).rows[0].n,0);
 await db.query('UPDATE botanist_notification SET read_at=CURRENT_TIMESTAMP WHERE recipient_subject=$1',['staff:owner']);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM botanist_notification WHERE read_at IS NOT NULL')).rows[0].n,6);
 await db.query('BEGIN'); await db.query(sql,['rollback','staff:owner','rollback',30,{entityType:'record_change',changeId:'rollback',recordKind:'plant',targetId:'30',revision:1},'record_change_approved']); await db.query('ROLLBACK');
 assert.equal((await db.query("SELECT count(*)::int AS n FROM botanist_notification WHERE id='rollback'")).rows[0].n,0);
 } finally {await db.end();}
});
