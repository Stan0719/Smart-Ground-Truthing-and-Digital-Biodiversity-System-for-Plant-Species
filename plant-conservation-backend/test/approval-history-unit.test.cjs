"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {submittedHistoryForReview,captureApprovedReview}=require("../historical-reviews.cjs");
test("submitted-history selection excludes proposals/captures and rejects ambiguity",async()=>{
 for(const status of ["Pending Review","Flagged"]){
  let query;
  const db={query:async(sql)=>{if(sql.includes("information_schema"))return {rows:[{available:true}]};query=sql;return {rows:[{id:"source",status}]}}};
  assert.equal(await submittedHistoryForReview(db,{kind:"plant",targetId:1,submissionId:"o",status}),"source");
  assert.match(query,/change_id IS NULL/);assert.match(query,/NOT \(snapshot \? 'review_provenance'\)/);assert.match(query,/observation_id/);
 }
 for(const rows of [[{id:"a",status:"Pending Review"},{id:"b",status:"Pending Review"}],[{id:"a",status:"Superseded"},{id:"b",status:"Pending Review"}]]){
  const db={query:async sql=>({rows:sql.includes("information_schema")?[{available:true}]:rows})};
  await assert.rejects(submittedHistoryForReview(db,{kind:"species",targetId:1,status:"Pending Review"}),e=>e.status===409);
 }
});
test("legacy absence is not reconstructed and missing optional history skips capture",async()=>{
 assert.equal(await submittedHistoryForReview({query:async sql=>({rows:sql.includes("information_schema")?[{available:true}]:[]})},{kind:"species",targetId:1,status:"Pending Review"}),null);
 let calls=0;await captureApprovedReview({query:async()=>{calls++;return {rows:[{available:false}]}}},{kind:"plant"});assert.equal(calls,1);
});

test("legacy correction without a new submitted row never receives false source attribution",async()=>{
 const db={query:async sql=>({rows:sql.includes("information_schema")?[{available:true}]:[{id:"old-round",status:"Correction Required"}]})};
 assert.equal(await submittedHistoryForReview(db,{kind:"plant",targetId:1,submissionId:"o",status:"Pending Review"}),null);
});

test("read projection validates persisted source identity in one bulk query, including Superseded captures",async t=>{
 const {testPool}=await import('../../web/server/test-postgres.mjs');const db=await testPool();t.after(()=>db.end());
 await db.query(`CREATE TABLE plant_observation(id text PRIMARY KEY,plant_id integer,origin_type text);
 CREATE TABLE observation_review(id text PRIMARY KEY,observation_id text,reviewer_subject text,created_at timestamptz,decision text,comment text);
 CREATE TABLE plant_asset(id text,plant_id integer,content_type text);
 CREATE TABLE record_version_history(id text PRIMARY KEY,record_type text,plant_id integer,change_id text,version_number integer,status text,snapshot jsonb,owner_subject text,edited_by text,species_photo bytea,reviewed_by text,reviewed_at timestamptz,review_comment text,created_at timestamptz);`);
 const {observationHistory}=require('../historical-reviews.cjs');
 const rows=[];
 const scenarios=['valid','superseded','correction-v2','missing-link','missing-source','wrong-plant','wrong-observation','proposal','capture-source','wrong-reviewer','wrong-time','wrong-comment','nonapproved-source','subsequent'];
 for(const [index,scenario] of scenarios.entries()) {
  const id='obs-'+scenario,sourceId='source-'+scenario,reviewId='review-'+scenario,plant=index+1;
  await db.query("INSERT INTO plant_observation VALUES($1,$2,$3)",[id,plant,scenario==='subsequent'?'subsequent_observation':'initial_registration']);
  await db.query("INSERT INTO observation_review VALUES($1,$2,'staff:officer','2026-11-19T00:00:00Z','Approved','Verified.')",[reviewId,id]);
  const sourceSnapshot={plant_id:plant,observation_id:scenario==='wrong-observation'?'foreign':id,content:{notes:'submitted-only'}};
  if(scenario==='capture-source')sourceSnapshot.review_provenance={evidence_type:'approval_capture'};
  if(scenario!=='missing-source')await db.query(`INSERT INTO record_version_history(id,record_type,plant_id,change_id,version_number,status,snapshot,reviewed_by,reviewed_at,review_comment,created_at)
   VALUES($1,'plant',$2,$3,$4,$5,$6,$7,$8,$9,'2026-11-18T00:00:00Z')`,[sourceId,scenario==='wrong-plant'?999:plant,scenario==='proposal'?'proposal':null,scenario==='correction-v2'?2:1,scenario==='nonapproved-source'?'Correction Required':scenario==='superseded'?'Superseded':'Approved',sourceSnapshot,scenario==='wrong-reviewer'?'staff:other':'staff:officer',scenario==='wrong-time'?'2026-11-19T00:00:01Z':'2026-11-19T00:00:00Z',scenario==='wrong-comment'?'Other':'Verified.']);
  const snapshot={plant_id:plant,observation_id:id,content:{notes:'approval-only'},scientific_name:'Approved plant',species_id:1,species_scientific_name:'Approved species',common_name:'Name',photo_ids:[],review_provenance:{kind:'plant',submission_id:id,review_id:reviewId,source_submitted_history_id:scenario==='missing-link'?null:sourceId}};
  await db.query(`INSERT INTO record_version_history(id,record_type,plant_id,version_number,status,snapshot,reviewed_by,reviewed_at,review_comment,created_at)
   VALUES($1,'plant',$2,3,$3,$4,'staff:officer','2026-11-19T00:00:00Z','Verified.','2026-11-19T00:00:00Z')`,['capture-'+scenario,plant,scenario==='superseded'?'Superseded':'Approved',snapshot]);
  rows.push({id,plant_id:plant,status:'Approved'});
 }
 const queries=[];const reader={query(sql,args){queries.push(sql);return db.query(sql,args)}};
 const projected=await observationHistory(reader,rows);
 assert.equal(queries.filter(sql=>sql.includes('LEFT JOIN record_version_history submitted')).length,1);
 assert.equal(queries.filter(sql=>sql.includes('FROM record_version_history')).length,1);
 for(const [index,scenario] of scenarios.entries()) {
  const history=projected[index].historical_review;
  assert.equal(projected[index].status,'Approved');assert.equal(history.state,'available');
  assert.equal(history.fields.content.notes,'approval-only');
  assert.equal(history.approval_capture.source_submitted_history_id,['valid','superseded','correction-v2'].includes(scenario)?'source-'+scenario:null,scenario);
 }
});
