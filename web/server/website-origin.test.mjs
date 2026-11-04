import test from 'node:test'
import assert from 'node:assert/strict'
import { websiteOrigin } from './website-origin.mjs'
import { activationDelivery } from './activation.mjs'
test('activation uses the Codespaces website origin unless explicitly configured', () => {
  assert.throws(() => websiteOrigin({ NODE_ENV: 'production' }), /APP_ORIGIN/)
  assert.equal(
    websiteOrigin({
      CODESPACE_NAME: 'example',
      GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: 'app.github.dev',
    }),
    'https://example-5173.app.github.dev',
  )
  assert.equal(
    websiteOrigin({ APP_ORIGIN: 'https://plants.example.invalid' }),
    'https://plants.example.invalid',
  )
  for (const APP_ORIGIN of [
    'https://user:secret@example.invalid',
    'https://example.invalid/path',
    'http://example.invalid',
  ])
    assert.throws(() => websiteOrigin({ APP_ORIGIN, NODE_ENV: 'production' }))
})
test('EmailJS adapter sends existing temporary-password variables and reports delivery failure', async () => {
  const env = {
    EMAILJS_SERVICE_ID: 'test-service',
    EMAILJS_PUBLIC_KEY: 'test-public',
    EMAILJS_TEMPLATE_ID: 'test-template',
  }
  let request
  const send = activationDelivery(env, async (_url, options) => {
    request = JSON.parse(options.body)
    return { ok: true }
  })
  await send({
    email: 'test@example.invalid',
    name: 'Test',
    role: 'Botanist',
    temporaryPassword: 'synthetic-temporary-only',
    loginUrl: 'https://example.invalid/',
  })
  assert.equal(request.template_params.login_url, 'https://example.invalid/')
  assert.equal(request.template_params.to_email, 'test@example.invalid')
  assert.equal(request.template_params.temporary_password, 'synthetic-temporary-only')
  assert.equal('activation_link' in request.template_params, false)
  assert.equal(activationDelivery({ ...env, EMAILJS_TEMPLATE_ID: '' }), null)
  await assert.rejects(
    activationDelivery(
      env,
      async () => new Response('Synthetic delivery failure', { status: 400 }),
    )({}),
    /delivery failed/,
  )
})
