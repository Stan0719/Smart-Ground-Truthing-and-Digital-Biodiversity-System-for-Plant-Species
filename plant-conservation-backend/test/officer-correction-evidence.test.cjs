const test=require('node:test'),assert=require('node:assert/strict');
const {correctionEvidence}=require('../officer-correction-evidence.cjs');
const draft={revision:3,owner_subject:'staff:owner'};
const review={id:'review-one',decision:'Correction Required',reviewer_subject:'staff:officer',reviewed_at:'2026-11-09 01:00:00.123456+00',precedes_draft:true};
test('correction evidence distinguishes first submissions, corrections and later cycles',()=>{
 assert.equal(correctionEvidence(draft,[]).kind,'ordinary');
 assert.deepEqual(correctionEvidence(draft,[review]),{kind:'correction',reviewId:'review-one'});
 assert.deepEqual(correctionEvidence({...draft,revision:7},[{...review,id:'review-two'}]),{kind:'correction',reviewId:'review-two'});
 assert.equal(correctionEvidence(draft,[{...review,decision:'Rejected'}]).kind,'ordinary');
});
test('ambiguous ordering, missing identity, self review and inconsistent revision evidence fail closed',()=>{
 for(const bad of [{...review,id:''},{...review,precedes_draft:false},{...review,reviewer_subject:'staff:owner'},{...review,decision:'Unknown'}])assert.equal(correctionEvidence(draft,[bad]).kind,'ambiguous');
 assert.equal(correctionEvidence(draft,[review,{...review,id:'tie'}]).kind,'ambiguous');
 assert.equal(correctionEvidence({...draft,revision:1},[review]).kind,'ambiguous');
});
