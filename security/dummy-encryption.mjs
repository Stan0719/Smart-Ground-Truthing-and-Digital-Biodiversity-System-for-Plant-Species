import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
// Isolated preparation only: not imported by application persistence or authentication.
function validateInputs(key, context) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw Error('A 32-byte external key is required');
  if (typeof context !== 'string' || !context) throw Error('Record context required');
}
function decodeField(value, length) {
  if (typeof value !== 'string') throw Error('Invalid encrypted envelope');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value || (length !== undefined && bytes.length !== length))
    throw Error('Invalid encrypted envelope');
  return bytes;
}
export function sealDummyRecord(record, key, context) {
  validateInputs(key, context);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(record), 'utf8'), cipher.final()]);
  return { version: 1, algorithm: 'AES-256-GCM', iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
}
export function openDummyRecord(envelope, key, context) {
  validateInputs(key, context);
  if (!envelope || envelope.version !== 1 || envelope.algorithm !== 'AES-256-GCM') throw Error('Unsupported envelope');
  const iv = decodeField(envelope.iv, 12);
  const tag = decodeField(envelope.tag, 16);
  const ciphertext = decodeField(envelope.ciphertext);
  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'));
}
