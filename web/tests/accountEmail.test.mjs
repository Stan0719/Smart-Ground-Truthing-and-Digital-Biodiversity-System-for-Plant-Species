import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sendTemporaryPasswordEmail } from '../src/services/accountEmail.ts'

const user = { name: 'Test User', email: 'test@example.com', role: 'Conservation Officer', password: 'Temporary@123' }
const config = { serviceId: 'service_test', templateId: 'template_test', publicKey: 'public_test', loginUrl: 'https://example.com/' }

test('missing configuration makes no network request', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response('OK'))
  await assert.rejects(sendTemporaryPasswordEmail(user, {}), /not configured/)
  assert.equal(fetchMock.mock.callCount(), 0)
})

test('sends account details to the configured EmailJS template', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.emailjs.com/api/v1.0/email/send')
    assert.equal(options.method, 'POST')
    assert.deepEqual(JSON.parse(options.body), {
      service_id: config.serviceId, template_id: config.templateId, user_id: config.publicKey,
      template_params: { to_name: user.name, to_email: user.email, role: user.role, temporary_password: user.password, login_url: config.loginUrl },
    })
    return new Response('OK')
  })
  await sendTemporaryPasswordEmail(user, config)
})

test('service failures and limits are reported without exposing provider responses', async (t) => {
  for (const status of [400, 429, 500]) {
    t.mock.method(globalThis, 'fetch', async () => new Response('Sensitive provider details', { status }))
    await assert.rejects(sendTemporaryPasswordEmail(user, config), status === 429 ? /limit reached/ : /rejected/)
    t.mock.restoreAll()
  }
})

test('network failure is reported as uncertain delivery', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Network error') })
  await assert.rejects(sendTemporaryPasswordEmail(user, config), /may already have been sent/)
})
