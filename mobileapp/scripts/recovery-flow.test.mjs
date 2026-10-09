import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from '../../web/node_modules/typescript/lib/typescript.js';

// Exercise the actual shared SFC script with asynchronous app account adapters.
const sfc = readFileSync(new URL('../../web/src/views/ForgotPasswordView.vue', import.meta.url), 'utf8');
const script = sfc.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
  .replace(/import[\s\S]*?from ['"][^'"]+['"]\s*/g, '');
function setup() {
  let now = 100000;
  let deliveredCode;
  let failSend = false;
  let failSave = false;
  const user = { email: 'visitor@example.com', name: 'Visitor', password: 'oldpassword' };
  const context = vm.createContext({
    ref: (value) => ({ value }), computed: (get) => ({ get value() { return get(); } }),
    onUnmounted: () => {}, useRouter: () => ({ push: () => {} }),
    findPrototypeUserByEmail: async (email) => email === user.email ? user : undefined,
    updatePrototypePassword: async (email, password) => {
      if (failSave) throw new Error('storage failed');
      if (email !== user.email) return false;
      user.password = password;
      return true;
    },
    sendOtpEmail: async (_email, _name, code) => {
      if (failSend) throw new Error('Email could not be sent.');
      deliveredCode = code;
    },
    crypto: globalThis.crypto, Uint32Array,
    Date: { now: () => now }, setInterval: () => 1, clearInterval: () => {},
  });
  const exposed = '\nglobalThis.flow = { email, step, activeOtp, enteredOtp, newPassword, confirmPassword, sending, error, secondsLeft, sendCode, verifyCode, resetPassword, updateCountdown };';
  vm.runInContext(ts.transpileModule(script + exposed, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, context);
  return { flow: context.flow, user, code: () => deliveredCode, advance: (ms) => { now += ms; }, failSend: () => { failSend = true; }, failSave: () => { failSave = true; } };
}
test('email, six-digit code, verification, persistence and single-use reset', async () => {
  const { flow, user, code } = setup();
  flow.email.value = ' Visitor@Example.com ';
  await flow.sendCode();
  assert.equal(flow.step.value, 'otp');
  assert.match(code(), /^\d{6}$/);
  assert.equal(flow.secondsLeft.value, 20);
  flow.enteredOtp.value = code(); flow.verifyCode();
  assert.equal(flow.step.value, 'password');
  assert.equal(flow.activeOtp.value, '');
  flow.newPassword.value = 'newpassword'; flow.confirmPassword.value = 'different';
  await flow.resetPassword(); assert.equal(flow.error.value, 'Passwords do not match.');
  flow.confirmPassword.value = 'newpassword'; await flow.resetPassword();
  assert.equal(flow.step.value, 'done'); assert.equal(user.password, 'newpassword');
  await flow.resetPassword(); assert.equal(flow.error.value, 'Verify your email code first.');
});
test('expiry uses wall-clock time, resend waits for expiry and replaces the code', async () => {
  const { flow, code, advance } = setup();
  flow.email.value = 'visitor@example.com'; await flow.sendCode();
  const first = code(); await flow.sendCode(); assert.equal(code(), first);
  advance(20001); flow.enteredOtp.value = first; flow.verifyCode();
  assert.equal(flow.error.value, 'The code has expired. Click Resend OTP.');
  await flow.sendCode(); assert.equal(flow.secondsLeft.value, 20);
  flow.enteredOtp.value = code(); flow.verifyCode(); assert.equal(flow.step.value, 'password');
});
test('five incorrect attempts invalidate the code and allow resend', async () => {
  const { flow, code } = setup(); flow.email.value = 'visitor@example.com'; await flow.sendCode();
  flow.enteredOtp.value = code() === '000000' ? '111111' : '000000';
  for (let attempt = 0; attempt < 5; attempt++) flow.verifyCode();
  assert.equal(flow.error.value, 'Too many incorrect attempts. Request a new code.');
  assert.equal(flow.activeOtp.value, ''); assert.equal(flow.secondsLeft.value, 0);
  await flow.sendCode(); assert.equal(flow.secondsLeft.value, 20);
});
test('unknown account and failed delivery never activate an OTP', async () => {
  const { flow, failSend } = setup(); flow.email.value = 'unknown@example.com'; await flow.sendCode();
  assert.match(flow.error.value, /No locally created account/); assert.equal(flow.sending.value, false);
  flow.email.value = 'visitor@example.com'; failSend(); await flow.sendCode();
  assert.equal(flow.step.value, 'email'); assert.equal(flow.activeOtp.value, '');
  assert.equal(flow.sending.value, false);
});
test('password length and storage failures keep the verified form available for retry', async () => {
  const { flow, code, failSave } = setup(); flow.email.value = 'visitor@example.com'; await flow.sendCode();
  flow.enteredOtp.value = code(); flow.verifyCode();
  flow.newPassword.value = 'short'; flow.confirmPassword.value = 'short'; await flow.resetPassword();
  assert.match(flow.error.value, /at least 8 characters/);
  flow.newPassword.value = 'newpassword'; flow.confirmPassword.value = 'newpassword'; failSave();
  await flow.resetPassword(); assert.equal(flow.step.value, 'password'); assert.equal(flow.sending.value, false);
  assert.equal(flow.error.value, 'Account could not be updated.');
});

test('app storage updates the existing account and preserves other records', async () => {
  const original = [
    { id: 'VIS001', name: 'Visitor', email: 'visitor@example.com', password: 'oldpassword', role: 'Visitor', status: 'Active' },
    { id: 'VIS002', email: 'other@example.com', password: 'unchanged', role: 'Visitor', status: 'Active' },
  ];
  let stored = JSON.stringify(original);
  const storageSource = readFileSync(new URL('../utils/visitorStorage.js', import.meta.url), 'utf8')
    .replace(/import[^;]+;/, '').replace(/export /g, '');
  const context = vm.createContext({ AsyncStorage: { getItem: async () => stored, setItem: async (_key, value) => { stored = value; } } });
  vm.runInContext(storageSource + '\nglobalThis.update = updateVisitorPassword;', context);
  assert.equal(await context.update(' Visitor@Example.com ', 'newpassword'), true);
  const accounts = JSON.parse(stored);
  assert.equal(accounts[0].password, 'newpassword');
  assert.equal(accounts[0].id, 'VIS001');
  assert.equal(accounts[1].password, 'unchanged');
  assert.equal(await context.update('missing@example.com', 'newpassword'), false);
});

test('generated WebView bundle starts without a Node process global', async () => {
  const generated = readFileSync(new URL('../generated/recoveryHtml.js', import.meta.url), 'utf8');
  const html = JSON.parse(generated.slice(generated.indexOf('export default ') + 15).trim().replace(/;$/, ''));
  const js = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  assert.doesNotMatch(js, /\bprocess\.env\b/);
  // Stop at the first DOM operation. A WebView has document, but no process.
  const reachedDom = new Error('Reached browser DOM bootstrap');
  const context = vm.createContext({
    document: { createElement: () => { throw reachedDom; } },
    window: {}, navigator: { userAgent: '' }, console,
  });
  await assert.rejects(
    vm.runInContext(`(async () => { ${js}\n })()`, context),
    (error) => error === reachedDom,
  );
});
