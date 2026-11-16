"use strict";
async function requireReviewCycle(c, fail) {
  const ready = (await c.query(`SELECT
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema()
      AND table_name='species_request_submission' AND column_name='review_cycle'
      AND data_type='integer' AND is_nullable='NO' AND column_default='1')
    AND EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='species_request_submission'::regclass
      AND conname='species_request_review_cycle_positive' AND convalidated)
    AND EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
      WHERE t.tgrelid='species_request_submission'::regclass AND t.tgname='species_request_review_cycle'
      AND t.tgenabled IN ('O','A') AND NOT t.tgisinternal AND t.tgtype=19
      AND p.proname='advance_species_request_review_cycle') AS ready`)).rows[0].ready;
  if (!ready) fail(503, "Species review cycle setup is incomplete. Verify migration 017.");
}
module.exports = { requireReviewCycle };
