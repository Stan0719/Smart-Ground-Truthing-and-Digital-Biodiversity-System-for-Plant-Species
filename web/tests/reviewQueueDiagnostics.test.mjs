import test from 'node:test'
import assert from 'node:assert/strict'
import { createReviewRequest, readReviewQueueSource, reviewQueueFailureDiagnostic } from '../src/services/observationReview.ts'

const message = key => key
for (const source of ['observations', 'changes', 'species']) {
  test(`${source}: HTTP 409 remains a failed source with sanitized diagnostics`, async () => {
    const request = createReviewRequest(message, async () => Response.json({ error: 'private evidence and identity', code: 'PRIVATE_SERVER_CODE' }, { status: 409 }))
    await assert.rejects(readReviewQueueSource(source, () => request('/private-url?token=secret')), failure => {
      assert.equal(failure.status, 409)
      assert.equal(failure.message, 'feedback.requestFailed'); assert.ok(!failure.message.includes('private'))
      assert.equal(failure.code, 'PRIVATE_SERVER_CODE')
      assert.deepEqual(reviewQueueFailureDiagnostic(failure), { source, status: 409, category: 'http' })
      assert.ok(!JSON.stringify(reviewQueueFailureDiagnostic(failure)).includes('private'))
      return true
    })
  })
}

test('transport failure is distinct from HTTP conflict and invalid response', async () => {
  for (const [transport, status, category] of [
    [async () => { throw Error('secret transport details') }, null, 'network'],
    [async () => new Response('private non-JSON evidence', { status: 409 }), 409, 'invalid_response'],
    [async () => Response.json(null), 200, 'invalid_response'],
  ]) {
    const request = createReviewRequest(message, transport)
    await assert.rejects(readReviewQueueSource('observations', () => request('/private')), failure => {
      assert.deepEqual(reviewQueueFailureDiagnostic(failure), { source: 'observations', status, category })
      return true
    })
  }
})

test('timeout, cancellation and network interruption retain their cause before headers and during body reads', async () => {
  for (const [name, category] of [['TimeoutError', 'timeout'], ['AbortError', 'cancelled'], ['TypeError', 'network']]) {
    for (const bodyFailure of [false, true]) {
      const cause = Object.assign(Error('private transport details'), { name })
      const request = createReviewRequest(message, async () => {
        if (!bodyFailure) throw cause
        return { status: 200, ok: true, json: async () => { throw cause } }
      })
      await assert.rejects(readReviewQueueSource('observations', () => request('/private')), failure => {
        assert.deepEqual(reviewQueueFailureDiagnostic(failure), { source: 'observations', status: bodyFailure ? 200 : null, category: bodyFailure && category === 'network' ? 'body_read' : category })
        assert.equal(failure.message, 'feedback.network')
        assert.ok(!JSON.stringify(reviewQueueFailureDiagnostic(failure)).includes('private'))
        return true
      })
    }
  }
})

test('HTTP failure statuses including authentication and rate limiting remain distinct from transport', async () => {
  for (const status of [401, 403, 409, 429, 500, 503]) {
    const request = createReviewRequest(message, async () => Response.json({ error: 'fixture rejection', code: 'REVIEW_TRANSPORT_ERROR' }, { status }))
    await assert.rejects(readReviewQueueSource('species', () => request('/fixture')), failure => {
      assert.deepEqual(reviewQueueFailureDiagnostic(failure), { source: 'species', status, category: 'http' })
      assert.equal(failure.status, status)
      return true
    })
  }
})

test('verified queues including empty results pass unchanged; failed page never becomes success; retry can recover', async () => {
  for (const rows of [[], [{ id: 'verified' }]]) {
    assert.equal(await readReviewQueueSource('changes', async () => rows), rows)
  }
  const error = Error('private malformed evidence')
  await assert.rejects(readReviewQueueSource('changes', async () => { throw error }), failure => {
    assert.equal(failure, error)
    assert.deepEqual(reviewQueueFailureDiagnostic(failure), { source: 'changes', status: null, category: 'verification' })
    return true
  })
  assert.deepEqual(await readReviewQueueSource('changes', async () => []), [])
  assert.deepEqual(reviewQueueFailureDiagnostic({ queueSource: 'secret identity', status: 9999, message: 'private' }), { source: 'unknown', status: null, category: 'verification' })
  assert.deepEqual(reviewQueueFailureDiagnostic({ queueSource: 'changes', status: 409, code: 'REVIEW_TRANSPORT_ERROR' }), { source: 'changes', status: 409, category: 'http' })
})


test('only opted-in safe GETs retry once, preserving authentication/conflict/malformed-response failures', async () => {
  for (const failure of ['network', 'timeout', 'body', 502, 503, 504]) {
    let calls = 0
    const request = createReviewRequest(message, async () => {
      calls++
      if (calls > 1) return Response.json({ observations: [] })
      if (failure === 'network') throw new TypeError('synthetic interruption')
      if (failure === 'timeout') throw Object.assign(Error('synthetic timeout'), { name: 'TimeoutError' })
      if (failure === 'body') return { status: 200, ok: true, json: async () => { throw new TypeError('synthetic truncated body') } }
      return Response.json({ error: 'temporary' }, { status: failure })
    })
    await request('/queue', undefined, { retry: true }); assert.equal(calls, 2)
  }
  for (const status of [400, 401, 403, 409, 429]) {
    let calls = 0; const request = createReviewRequest(message, async () => { calls++; return Response.json({ error: 'rejected' }, { status }) })
    await assert.rejects(request('/queue', undefined, { retry: true })); assert.equal(calls, 1)
  }
  for (const status of [401, 403, 409]) {
    let calls = 0; const request = createReviewRequest(message, async () => { calls++; return { status, ok:false, json:async()=>{throw new TypeError('interrupted error body')} } })
    await assert.rejects(request('/queue', undefined, {retry:true})); assert.equal(calls,1)
  }
  let calls = 0; const request = createReviewRequest(message, async () => { calls++; return Response.json({ error: 'temporary' }, { status: 503 }) })
  await assert.rejects(request('/queue', undefined, { retry: true })); assert.equal(calls, 2)
  calls = 0; await assert.rejects(request('/detail')); assert.equal(calls, 1)
  calls = 0; const invalid = createReviewRequest(message, async () => { calls++; return new Response('invalid JSON') })
  await assert.rejects(invalid('/queue', undefined, { retry: true })); assert.equal(calls, 1)
})

test('Approve, Reject, Flag and Correction POSTs never retry even when retry is requested', async () => {
  for (const decision of ['Approved', 'Rejected', 'Flagged', 'Correction Required']) {
    let calls = 0; const request = createReviewRequest(message, async (_url, options) => { calls++; assert.equal(options.method, 'POST'); return Response.json({ error: 'temporary' }, { status: 503 }) })
    await assert.rejects(request('/review', { decision, comment: 'draft', revision: 1 }, { retry: true })); assert.equal(calls, 1)
  }
})

test('aborting an attempt cancels transport and retry backoff without issuing another GET', async () => {
  for (const phase of ['before', 'transport', 'backoff']) {
    const controller = new AbortController(); let calls = 0, started
    const request = createReviewRequest(message, async (_url, options) => {
      calls++
      if (phase === 'transport') return new Promise((_resolve, reject) => { started = true; options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }) })
      started = true; throw new TypeError('synthetic offline')
    })
    if (phase === 'before') controller.abort()
    const work = request('/queue', undefined, { retry: true, signal: controller.signal }), rejected = assert.rejects(work, failure => failure.failureKind === 'cancelled')
    if (phase !== 'before') { while (!started) await Promise.resolve(); await new Promise(setImmediate); controller.abort() }
    await rejected; assert.equal(calls, phase === 'before' ? 0 : 1)
  }
})
