import test from 'node:test'
import assert from 'node:assert/strict'
import { temporaryPasswordDelivery } from './activation.mjs'
import { sanitizedEmailResponse, emailRuntimeConfiguration } from './email-diagnostics.mjs'

test('server sender includes public and optional private authentication and captures safe HTTP failure', async () => {
  const env = { EMAILJS_SERVICE_ID: 'service-test', EMAILJS_TEMPLATE_ID: 'template-test', EMAILJS_PUBLIC_KEY: 'public-test', EMAILJS_PRIVATE_KEY: 'private-test' }
  const diagnostics = []
  const deliver = temporaryPasswordDelivery(env, async (url, request) => {
    assert.equal(url, 'https://api.emailjs.com/api/v1.0/email/send')
    const payload = JSON.parse(request.body)
    assert.equal(payload.user_id, env.EMAILJS_PUBLIC_KEY)
    assert.equal(payload.accessToken, env.EMAILJS_PRIVATE_KEY)
    assert.equal(payload.service_id, env.EMAILJS_SERVICE_ID)
    assert.equal(payload.template_id, env.EMAILJS_TEMPLATE_ID)
    return new Response('The private key is invalid: private-test; person@example.invalid; password-test', { status: 403 })
  }, entry => diagnostics.push(entry))
  await assert.rejects(() => deliver({ email: 'person@example.invalid', temporaryPassword: 'password-test' }), error => {
    assert.equal(error.providerStatus, 403)
    assert.equal(error.deliveryCode, 'unauthorized')
    assert.equal(error.providerResponse, 'The private key is invalid')
    return true
  })
  const output = JSON.stringify(diagnostics)
  for (const secret of ['public-test', 'private-test', 'person@example.invalid', 'password-test']) assert.ok(!output.includes(secret))
  assert.equal(diagnostics[0].status, 403)
})

test('provider diagnostics withhold arbitrary response content', () => {
  assert.equal(sanitizedEmailResponse('secret with email@example.invalid'), '[provider response withheld: unrecognized text]')
  const report = emailRuntimeConfiguration({ EMAILJS_PUBLIC_KEY: 'never-print-this' }, { EMAILJS_PUBLIC_KEY: 'never-print-this' })
  assert.deepEqual(report.credentials.EMAILJS_PUBLIC_KEY, { present: true, source: 'processEnvironment' })
  assert.ok(!JSON.stringify(report).includes('never-print-this'))
})
