import test from 'node:test';
import assert from 'node:assert/strict';
import { can, canCollectDrafts, accountScreen } from '../utils/rbac.js';
const botanist = { id: 'staff-a', role: 'botanist' };
test('mobile identities use backend grants and deny unknown privileges', () => {
  assert.equal(can(null, 'plants.public.read'), true);
  assert.equal(can(null, 'plants.create'), false);
  assert.equal(can({ id: 'visitor-a', role: 'visitor' }, 'plants.create'), false);
  assert.equal(can(botanist, 'plants.scientific.read'), true);
  assert.equal(can(botanist, 'plants.create'), true);
  assert.equal(can(botanist, 'observations.review'), false);
  assert.equal(can({ ...botanist, role: 'administrator' }, 'accounts.manage'), false);
  assert.equal(can(botanist, 'unknown'), false);
});
test('disabled and temporary-password accounts cannot collect', () => {
  for (const user of [{ ...botanist, status: 'Suspended' }, { ...botanist, mustChangePassword: true }]) {
    assert.equal(canCollectDrafts(user), false);
    assert.equal(accountScreen(user), 'HomeTab');
  }
});
test('verified offline Botanist keeps draft UI without online permission', () => {
  const user = { ...botanist, offline: true };
  assert.equal(can(user, 'plants.create'), false);
  assert.equal(canCollectDrafts(user), true);
  assert.equal(accountScreen(user), 'AccountTab');
  assert.equal(canCollectDrafts(null), false);
});

 test('Officer mobile reference access preserves Officer-only and Botanist-only boundaries',()=>{const officer={id:'officer',role:'conservation-officer',status:'Active',mustChangePassword:false};assert.equal(can(officer,'plants.scientific.read'),true);assert.equal(can(officer,'plants.protected.read'),true);assert.equal(can(officer,'plants.create'),false);assert.equal(can(officer,'accounts.manage'),false)});
