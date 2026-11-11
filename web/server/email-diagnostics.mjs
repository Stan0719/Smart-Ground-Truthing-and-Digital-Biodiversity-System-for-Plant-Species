import { existsSync, readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { emailSettings } from './activation-configuration.mjs'

const files = [
  ['backend', new URL('../../plant-conservation-backend/.env', import.meta.url)],
  ['server', new URL('../.env.server', import.meta.url)],
  ['mobilePublicFallback', new URL('../../mobileapp/.env.local', import.meta.url)],
  ['staffTemplateFallback', new URL('../.env.local', import.meta.url)],
]
const keys = ['EMAILJS_SERVICE_ID', 'EMAILJS_TEMPLATE_ID', 'EMAILJS_PUBLIC_KEY', 'EMAILJS_PRIVATE_KEY']

// No values or credential hashes: safe to share with a teammate.
export function emailRuntimeConfiguration(inherited = process.env, effective = emailSettings(inherited)) {
  const parsed = Object.fromEntries(files.map(([name, url]) => [name,
    existsSync(url) ? parseEnv(readFileSync(url, 'utf8')) : {}]))
  const source = (key) => {
    if (inherited[key] !== undefined) return 'processEnvironment'
    if (parsed.server[key] !== undefined) return 'server'
    if (parsed.backend[key] !== undefined) return 'backend'
    if (key !== 'EMAILJS_PRIVATE_KEY' && parsed.mobilePublicFallback['EXPO_PUBLIC_' + key]) return 'mobilePublicFallback'
    if (key === 'EMAILJS_TEMPLATE_ID' && (parsed.staffTemplateFallback[key] || parsed.staffTemplateFallback['VITE_' + key])) return 'staffTemplateFallback'
    return 'absent'
  }
  return {
    processId: process.pid,
    loadedAt: new Date().toISOString(),
    senderRevision: createHash('sha256').update(readFileSync(new URL('./activation.mjs', import.meta.url))).digest('hex').slice(0, 16),
    files: files.map(([name, url]) => ({ name, path: fileURLToPath(url), exists: existsSync(url) })),
    credentials: Object.fromEntries(keys.map(key => [key, { present: Boolean(effective[key]?.trim()), source: source(key) }])),
  }
}

// Arbitrary provider text can echo credentials or template parameters. Retain only
// recognized phrases, never raw response bodies, even after generic redaction.
export function sanitizedEmailResponse(text) {
  const phrases = [
    /API requests are disabled for non-browser applications/i,
    /The public key is invalid/i,
    /The private key is invalid/i,
    /Public key is required/i,
    /Private key is required/i,
    /Access token is required/i,
    /Invalid access token/i,
  ]
  return phrases.find(pattern => pattern.test(text))?.source.replaceAll('\\', '') || '[provider response withheld: unrecognized text]'
}
