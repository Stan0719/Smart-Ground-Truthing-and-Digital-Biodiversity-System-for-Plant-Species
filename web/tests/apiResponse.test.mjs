import assert from 'node:assert/strict'
import test from 'node:test'
import { readApiResponse } from '../src/services/apiResponse.ts'

const unavailable = 'Service unavailable.'
test('empty and HTML gateway errors report service availability instead of JSON syntax errors', async () => {
  for (const body of ['', '<html>Bad gateway</html>']) {
    await assert.rejects(readApiResponse(new Response(body, { status: 502 }), unavailable), {
      message: unavailable,
    })
  }
})
test('valid API errors retain actionable messages and successful JSON is returned', async () => {
  await assert.rejects(
    readApiResponse(
      Response.json({ error: 'Database unavailable.' }, { status: 503 }),
      unavailable,
    ),
    { message: 'Database unavailable.' },
  )
  assert.deepEqual(await readApiResponse(Response.json({ species: [] }), unavailable), {
    species: [],
  })
})
test('malformed successful responses and unstructured errors fail clearly', async () => {
  await assert.rejects(readApiResponse(new Response(''), unavailable), {
    message: 'The server returned an invalid response. Please try again.',
  })
  await assert.rejects(readApiResponse(Response.json(null, { status: 403 }), unavailable), {
    message: 'Request failed (403).',
  })
})
