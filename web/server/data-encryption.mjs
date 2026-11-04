// Backend-only utility. No application/database consumer is enabled by this module.
// Reuse the existing authenticated crypto primitive; leave its v1 format unchanged.
import { sealDummyRecord, openDummyRecord } from '../../security/dummy-encryption.mjs'

const algorithm = 'AES-256-GCM'
const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)
const invalidConfiguration = () => Object.assign(new Error('Invalid backend data encryption configuration.'), { code: 'DATA_ENCRYPTION_CONFIGURATION' })

export function createDataEncryption({ activeKeyId, keys, legacyKeyId } = {}) {
  if (!validId(activeKeyId) || !keys || typeof keys !== 'object' || Array.isArray(keys))
    throw invalidConfiguration()
  const keyring = new Map()
  for (const [id, encoded] of Object.entries(keys)) {
    if (!validId(id) || typeof encoded !== 'string') throw invalidConfiguration()
    const key = Buffer.from(encoded, 'base64')
    if (key.length !== 32 || key.toString('base64') !== encoded) throw invalidConfiguration()
    keyring.set(id, key)
  }
  if (!keyring.has(activeKeyId) ||
      (legacyKeyId !== undefined && (!validId(legacyKeyId) || !keyring.has(legacyKeyId))))
    throw invalidConfiguration()

  const boundContext = (keyId, context) => {
    if (typeof context !== 'string' || !context) throw Error('Record context required.')
    // Bind the format and key identifier, even if two IDs happen to share a key.
    return JSON.stringify(['account-data-encryption', 2, algorithm, keyId, context])
  }
  return Object.freeze({
    encrypt(record, context) {
      try {
        const sealed = sealDummyRecord(record, keyring.get(activeKeyId), boundContext(activeKeyId, context))
        return { ...sealed, version: 2, keyId: activeKeyId }
      } catch {
        throw Error('Data could not be encrypted.')
      }
    },
    decrypt(envelope, context) {
      try {
        if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw Error()
        if (envelope.version === 1 && legacyKeyId !== undefined && !Object.hasOwn(envelope, 'keyId')) {
          // Explicit opt-in for old standalone envelopes; never guess keys or accept plaintext.
          return openDummyRecord(envelope, keyring.get(legacyKeyId), context)
        }
        if (envelope.version !== 2 || envelope.algorithm !== algorithm ||
            !validId(envelope.keyId) || !keyring.has(envelope.keyId)) throw Error()
        return openDummyRecord(
          { ...envelope, version: 1 }, keyring.get(envelope.keyId), boundContext(envelope.keyId, context),
        )
      } catch {
        throw Error('Encrypted data could not be opened.')
      }
    },
  })
}

// Call only in an explicitly approved backend consumer. Not called at app startup.
// Keys: JSON object mapping non-secret IDs to canonical base64 32-byte secret keys.
export function dataEncryptionFromEnvironment(env = process.env) {
  try {
    if (Object.keys(env).some(name => /^(VITE_|EXPO_PUBLIC_)DATA_ENCRYPTION_/.test(name)))
      throw invalidConfiguration()
    if (typeof env.DATA_ENCRYPTION_KEYS !== 'string') throw invalidConfiguration()
    return createDataEncryption({
      keys: JSON.parse(env.DATA_ENCRYPTION_KEYS),
      activeKeyId: env.DATA_ENCRYPTION_ACTIVE_KEY_ID,
      legacyKeyId: env.DATA_ENCRYPTION_LEGACY_KEY_ID,
    })
  } catch {
    // Never echo environment contents, JSON parse diagnostics or key material.
    throw invalidConfiguration()
  }
}
