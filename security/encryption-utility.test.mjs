import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { sealDummyRecord, openDummyRecord } from './dummy-encryption.mjs'

// Synthetic, non-plant records only. No persistence or application imports.
const record = { id: 'synthetic-1', name: 'Synthetic Person', message: 'Private test text — 保留标点' }
const context = 'synthetic-record:synthetic-1'

test('AES-256-GCM round trip survives envelope JSON serialization', () => {
  const key = randomBytes(32)
  const envelope = JSON.parse(JSON.stringify(sealDummyRecord(record, key, context)))
  assert.deepEqual(openDummyRecord(envelope, key, context), record)
  assert.equal(envelope.algorithm, 'AES-256-GCM')
  assert.equal(envelope.version, 1)
  assert.equal(Buffer.from(envelope.iv, 'base64').length, 12)
  assert.equal(Buffer.from(envelope.tag, 'base64').length, 16)
  assert.ok(!JSON.stringify(envelope).includes(record.name))
})

test('repeated encryption uses fresh nonces and ciphertext', () => {
  const key = randomBytes(32)
  const envelopes = Array.from({ length: 32 }, () => sealDummyRecord(record, key, context))
  assert.equal(new Set(envelopes.map(e => e.iv)).size, envelopes.length)
  assert.equal(new Set(envelopes.map(e => e.ciphertext)).size, envelopes.length)
  for (const envelope of envelopes) assert.deepEqual(openDummyRecord(envelope, key, context), record)
})

test('missing, wrong-type and non-256-bit keys fail closed', () => {
  const envelope = sealDummyRecord(record, randomBytes(32), context)
  for (const key of [undefined, null, 'secret', new Uint8Array(32), Buffer.alloc(0), randomBytes(16), randomBytes(24), randomBytes(31), randomBytes(33)]) {
    assert.throws(() => sealDummyRecord(record, key, context), /32-byte/)
    assert.throws(() => openDummyRecord(envelope, key, context), /32-byte/)
  }
  assert.throws(() => openDummyRecord(envelope, randomBytes(32), context))
})

test('record context is required and authenticated', () => {
  const key = randomBytes(32)
  const envelope = sealDummyRecord(record, key, context)
  for (const invalid of [undefined, null, '', 1, {}]) {
    assert.throws(() => sealDummyRecord(record, key, invalid), /context/)
    assert.throws(() => openDummyRecord(envelope, key, invalid), /context/)
  }
  assert.throws(() => openDummyRecord(envelope, key, 'synthetic-record:different'))
})

test('tampering with nonce, tag or ciphertext is rejected', () => {
  const key = randomBytes(32)
  const envelope = sealDummyRecord(record, key, context)
  for (const field of ['iv', 'tag', 'ciphertext']) {
    const bytes = Buffer.from(envelope[field], 'base64')
    bytes[0] ^= 1
    assert.throws(() => openDummyRecord({ ...envelope, [field]: bytes.toString('base64') }, key, context))
  }
})

test('malformed envelopes, truncated tags and noncanonical base64 are rejected', () => {
  const key = randomBytes(32)
  const envelope = sealDummyRecord(record, key, context)
  for (const invalid of [null, undefined, [], {}, { ...envelope, version: 2 }, { ...envelope, algorithm: 'AES-128-GCM' }]) {
    assert.throws(() => openDummyRecord(invalid, key, context))
  }
  for (const field of ['iv', 'tag', 'ciphertext']) {
    for (const invalid of [undefined, null, 1, {}, '!!!', envelope[field] + '\n']) {
      assert.throws(() => openDummyRecord({ ...envelope, [field]: invalid }, key, context))
    }
  }
  for (const length of [0, 4, 8, 12, 15, 17]) {
    assert.throws(() => openDummyRecord({ ...envelope, tag: randomBytes(length).toString('base64') }, key, context))
  }
  for (const length of [0, 11, 13]) {
    assert.throws(() => openDummyRecord({ ...envelope, iv: randomBytes(length).toString('base64') }, key, context))
  }
  assert.throws(() => openDummyRecord({ ...envelope, ciphertext: '' }, key, context))
  assert.throws(() => openDummyRecord({ ...envelope, ciphertext: Buffer.from(envelope.ciphertext, 'base64').subarray(1).toString('base64') }, key, context))
})

test('unsupported serialization fails without returning a partial envelope', () => {
  const key = randomBytes(32)
  const cyclic = {}; cyclic.self = cyclic
  for (const invalid of [undefined, cyclic, { value: 1n }]) {
    assert.throws(() => sealDummyRecord(invalid, key, context))
  }
})
