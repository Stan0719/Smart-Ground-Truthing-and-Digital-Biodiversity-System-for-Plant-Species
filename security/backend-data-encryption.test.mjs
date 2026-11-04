import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createDataEncryption, dataEncryptionFromEnvironment } from '../web/server/data-encryption.mjs'
import { sealDummyRecord } from './dummy-encryption.mjs'

// Existing account field names, synthetic values; no database or application writes.
const account = { name: 'Synthetic Account', email: 'synthetic@example.invalid' }
const context = 'synthetic-account:test-id:profile'
const secret = () => randomBytes(32).toString('base64')
const fixture = () => createDataEncryption({ activeKeyId: 'current', keys: { current: secret() } })

test('version 2 JSON round trip includes a key ID and hides account plaintext', () => {
  const crypto = fixture()
  const envelope = JSON.parse(JSON.stringify(crypto.encrypt(account, context)))
  assert.equal(envelope.version, 2)
  assert.equal(envelope.keyId, 'current')
  assert.equal(envelope.algorithm, 'AES-256-GCM')
  assert.equal(Buffer.from(envelope.iv, 'base64').length, 12)
  assert.equal(Buffer.from(envelope.tag, 'base64').length, 16)
  assert.ok(!JSON.stringify(envelope).includes(account.email))
  assert.deepEqual(crypto.decrypt(envelope, context), account)
})

test('rotation encrypts with the active ID and reads old envelopes using retained keys', () => {
  const keys = { old: secret(), current: secret() }
  const old = createDataEncryption({ activeKeyId: 'old', keys }).encrypt(account, context)
  const rotated = createDataEncryption({ activeKeyId: 'current', keys })
  assert.deepEqual(rotated.decrypt(old, context), account)
  assert.equal(rotated.encrypt(account, context).keyId, 'current')
  assert.throws(() => createDataEncryption({ activeKeyId: 'current', keys: { current: keys.current } }).decrypt(old, context))
})

test('v1 compatibility is explicit; versions and plaintext never silently fall back', () => {
  const key = randomBytes(32)
  const keys = { old: key.toString('base64'), current: secret() }
  const legacy = sealDummyRecord(account, key, context)
  const defaults = createDataEncryption({ activeKeyId: 'current', keys })
  assert.throws(() => defaults.decrypt(legacy, context))
  const compatible = createDataEncryption({ activeKeyId: 'current', keys, legacyKeyId: 'old' })
  assert.deepEqual(compatible.decrypt(legacy, context), account)
  assert.equal(compatible.encrypt(account, context).version, 2)
  for (const invalid of [account, JSON.stringify(account), null, [], {}, { ...legacy, keyId: 'old' }, { ...legacy, version: 3 }])
    assert.throws(() => compatible.decrypt(invalid, context))
})

test('wrong keys and altered key IDs, versions, algorithms and contexts fail closed', () => {
  const key = secret()
  const crypto = createDataEncryption({ activeKeyId: 'current', keys: { current: key, alias: key } })
  const envelope = crypto.encrypt(account, context)
  assert.throws(() => fixture().decrypt(envelope, context))
  for (const changed of [{ keyId: 'unknown' }, { keyId: 'alias' }, { keyId: '' }, { version: 1 }, { version: 99 }, { algorithm: 'AES-128-GCM' }])
    assert.throws(() => crypto.decrypt({ ...envelope, ...changed }, context))
  for (const invalid of ['', null, undefined, {}, 'another-account:test-id:profile']) {
    assert.throws(() => crypto.decrypt(envelope, invalid))
    if (typeof invalid !== 'string' || !invalid) assert.throws(() => crypto.encrypt(account, invalid))
  }
})

test('tampering and malformed nonce/tag/ciphertext are rejected', () => {
  const crypto = fixture(), envelope = crypto.encrypt(account, context)
  for (const field of ['iv', 'tag', 'ciphertext']) {
    const bytes = Buffer.from(envelope[field], 'base64'); bytes[0] ^= 1
    assert.throws(() => crypto.decrypt({ ...envelope, [field]: bytes.toString('base64') }, context))
    for (const invalid of [undefined, null, '', {}, 1, '!!!', envelope[field] + '\n'])
      assert.throws(() => crypto.decrypt({ ...envelope, [field]: invalid }, context))
  }
  for (const length of [4, 8, 12, 15, 17])
    assert.throws(() => crypto.decrypt({ ...envelope, tag: randomBytes(length).toString('base64') }, context))
  for (const length of [11, 13])
    assert.throws(() => crypto.decrypt({ ...envelope, iv: randomBytes(length).toString('base64') }, context))
})

test('fresh encryptions use unique nonces and do not mutate input records', () => {
  const crypto = fixture(), before = JSON.stringify(account)
  const envelopes = Array.from({ length: 64 }, () => crypto.encrypt(account, context))
  assert.equal(new Set(envelopes.map(row => row.iv)).size, envelopes.length)
  assert.equal(new Set(envelopes.map(row => row.ciphertext)).size, envelopes.length)
  assert.equal(JSON.stringify(account), before)
})

test('keyring validation rejects missing keys, wrong lengths/types and invalid IDs', () => {
  for (const config of [undefined, {}, { activeKeyId: 'current', keys: {} },
    { activeKeyId: 'invalid id', keys: { current: secret() } },
    { activeKeyId: 'current', keys: [] },
    { activeKeyId: 'current', keys: { current: secret() }, legacyKeyId: 'missing' }])
    assert.throws(() => createDataEncryption(config), /configuration/)
  for (const key of [null, undefined, {}, randomBytes(32), 'not a key', randomBytes(16).toString('base64'), secret() + '\n'])
    assert.throws(() => createDataEncryption({ activeKeyId: 'current', keys: { current: key } }), /configuration/)
  const keys = { current: secret() }, crypto = createDataEncryption({ activeKeyId: 'current', keys })
  const envelope = crypto.encrypt(account, context)
  keys.current = secret()
  assert.deepEqual(crypto.decrypt(envelope, context), account)
})

test('backend environment configuration fails without keys and rejects public variable prefixes', () => {
  const env = { DATA_ENCRYPTION_KEYS: JSON.stringify({ current: secret() }), DATA_ENCRYPTION_ACTIVE_KEY_ID: 'current' }
  const crypto = dataEncryptionFromEnvironment(env)
  assert.deepEqual(crypto.decrypt(crypto.encrypt(account, context), context), account)
  for (const invalid of [{}, { ...env, DATA_ENCRYPTION_KEYS: '{sensitive malformed configuration' },
    { ...env, DATA_ENCRYPTION_KEYS: 'null' }, { ...env, DATA_ENCRYPTION_ACTIVE_KEY_ID: 'missing' },
    { ...env, VITE_DATA_ENCRYPTION_KEYS: env.DATA_ENCRYPTION_KEYS },
    { ...env, EXPO_PUBLIC_DATA_ENCRYPTION_ACTIVE_KEY_ID: 'current' }]) {
    assert.throws(() => dataEncryptionFromEnvironment(invalid), error =>
      error.message === 'Invalid backend data encryption configuration.')
  }
})

test('encryption/decryption errors do not echo plaintext, keys or underlying exceptions', () => {
  const key = secret(), crypto = createDataEncryption({ activeKeyId: 'current', keys: { current: key } })
  const record = { toJSON() { throw Error(account.email + key) } }
  assert.throws(() => crypto.encrypt(record, context), { message: 'Data could not be encrypted.' })
  assert.throws(() => crypto.decrypt({ version: 2, algorithm: 'AES-256-GCM', keyId: 'current', iv: key }, context),
    { message: 'Encrypted data could not be opened.' })
})
