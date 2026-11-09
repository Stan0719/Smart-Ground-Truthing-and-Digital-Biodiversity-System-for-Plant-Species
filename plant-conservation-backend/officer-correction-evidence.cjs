"use strict";
// Reviews are read newest-first with a database-precision ordering key. Ties
// cannot be resolved by arbitrary UUID order. No review means an ordinary submit.
function correctionEvidence(draft,reviews){
  if(!reviews.length)return {kind:'ordinary'};
  const latest=reviews[0];
  if(!latest.id || !latest.reviewed_at || (reviews[1] && latest.reviewed_at===reviews[1].reviewed_at) ||
    !['Approved','Rejected','Flagged','Correction Required'].includes(latest.decision) ||
    !latest.reviewer_subject || latest.reviewer_subject===draft.owner_subject || !latest.precedes_draft ||
    !Number.isSafeInteger(draft.revision) || draft.revision<3)return {kind:'ambiguous'};
  return latest.decision==='Correction Required'?{kind:'correction',reviewId:latest.id}:{kind:'ordinary'};
}
module.exports={correctionEvidence};
