const test = require('node:test');
const assert = require('node:assert/strict');
const { submissionUpdate, withSubmissionUpdates } = require('../submission-updates.cjs');
const before = { observation_id: 'observation', observation_revision: 1, scientific_name: 'Plant name', species_id: 1,
  content: { heightCm: 12, healthStatus: 'Healthy', latitude: 4 }, photo_ids: ['photo'] };
const after = { ...before, observation_revision: 2, content: { ...before.content, heightCm: 18 } };
const row = { id: 'observation', plant_id: 1, owner_subject: 'staff:bot', revision: 2, status: 'Pending Review',
  plant_scientific_name: 'Plant name', species_id: 1, content: after.content, assets: [{ id: 'photo' }] };
const version = { plant_id: 1, version_number: 2, edited_by: 'staff:bot', change_id: null, snapshot: after,
  previous_snapshot: before, created_at: '2026-11-13T04:00:00Z' };

test('recorded content edits provide exact earlier/current measurements without using review revision alone', () => {
  const result = submissionUpdate(row, [version]);
  assert.equal(result.state, 'updated');
  assert.equal(result.version, 2);
  assert.deepEqual(result.changes, [{ field: 'heightCm', before: 12, after: 18 }]);
  assert.equal(submissionUpdate({ ...row, revision: 3 }, [version]).state, 'unavailable');
  assert.equal(submissionUpdate(row, [{ ...version, change_id: 'approved-proposal' }]).state, 'unavailable');
  assert.equal(submissionUpdate(row, [{ ...version, edited_by: 'staff:officer' }]).state, 'unavailable');
  assert.equal(submissionUpdate(row, [{ ...version, snapshot: { ...after, observation_id: 'other' } }]).state, 'unavailable');
});
test('unchanged saves do not invent an edit and an earlier real edit survives a later unchanged save', () => {
  const unchanged = { ...version, version_number: 3, snapshot: { ...after, observation_revision: 3 }, previous_snapshot: after };
  assert.equal(submissionUpdate({ ...row, revision: 3 }, [unchanged]).state, 'unchanged');
  assert.equal(submissionUpdate({ ...row, revision: 3 }, [unchanged, version]).state, 'updated');
});
test('history availability, photos, names and location fail safely without revealing historical GPS', async () => {
  const missing = await withSubmissionUpdates({ query: async () => ({ rows: [{ available: false }] }) }, [row], true);
  assert.equal(missing[0].submission_update.state, 'unavailable');
  const privateRows = await withSubmissionUpdates({}, [row], false);
  assert.equal(privateRows[0].submission_update, undefined);
  assert.equal(submissionUpdate({ ...row, assets: [] }, [version]).state, 'unavailable');
  assert.equal(submissionUpdate(row, [{ ...version, previous_snapshot: null }]).state, 'unavailable');
  assert.equal(submissionUpdate({ ...row, plant_scientific_name: 'Different' }, [version]).state, 'unavailable');
  const gps = { ...after, content: { ...after.content, latitude: 5 } };
  const result = submissionUpdate({ ...row, content: gps.content }, [{ ...version, snapshot: gps }]);
  assert.deepEqual(result.changes.find(change => change.field === 'location'), { field: 'location', before: null, after: null });
});
