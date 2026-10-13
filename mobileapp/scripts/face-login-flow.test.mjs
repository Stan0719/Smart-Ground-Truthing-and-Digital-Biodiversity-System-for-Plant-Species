import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
const source = readFileSync(new URL('../utils/completeFaceLogin.js', import.meta.url), 'utf8');
const { completeFaceLogin } = await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const result = { token: 'a'.repeat(64), user: { id: 'a', role: 'visitor' }, requestId: 'abcdef123456' };
const diagnostic = () => {};
test('authenticated profile controls fallback dashboard navigation', async () => {
  for (const [role, screen] of [['botanist', 'AccountTab'], ['visitor', 'HomeTab']]) {
    const calls = [], trusted = {id:'a', role};
    await completeFaceLogin({result, session:{establish:async()=>trusted}, navigation:{replace:(...args)=>calls.push(args)}, diagnostic});
    assert.deepEqual(calls, [['MainTabs', {screen}]]);
  }
});
test('auth context receives verified account and shared reference', async () => {
  const trusted={id:'a',role:'botanist'}; let published;
  await completeFaceLogin({result,session:{establish:async()=>trusted},onLogin:(...args)=>{published=args;},diagnostic});
  assert.deepEqual(published,[trusted,{reference:result.requestId}]);
});
test('failed /me or secure storage never publishes or navigates', async () => {
  let calls=0;
  await assert.rejects(completeFaceLogin({result,session:{establish:async()=>{throw Error('Session rejected');}},onLogin:()=>calls++,navigation:{replace:()=>calls++},diagnostic}),/Session rejected/);
  assert.equal(calls,0);
});
