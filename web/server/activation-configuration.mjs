import { existsSync, readFileSync } from 'node:fs'
const required = ['EMAILJS_SERVICE_ID', 'EMAILJS_PUBLIC_KEY', 'EMAILJS_TEMPLATE_ID']
export function activationConfiguration(env) {
  const missing = required.filter((key) => !env[key]?.trim())
  const invalid = required.filter(
    (key) =>
      env[key]?.trim() &&
      (/\s/.test(env[key]) || /^(?:YOUR[_-]|CHANGE[_-]|template_your|<)/i.test(env[key])),
  )
  return { ready: !missing.length && !invalid.length, missing, invalid }
}

// Same safe public-setting fallback for startup and read-only diagnostics.
// Keep the existing staff temporary-password and OTP templates distinct.
export function emailSettings(
  env,
  source = new URL('../../mobileapp/.env.local', import.meta.url),
  staffSource = new URL('../.env.local', import.meta.url),
) {
  const settings = { ...env }
  if (existsSync(source))
    for (const line of readFileSync(source, 'utf8').split(/\r?\n/)) {
      const match =
        /^EXPO_PUBLIC_(EMAILJS_SERVICE_ID|EMAILJS_OTP_TEMPLATE_ID|EMAILJS_PUBLIC_KEY)=(.*)$/.exec(
          line,
        )
      if (match && !settings[match[1]])
        settings[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '')
    }
  if (existsSync(staffSource))
    for (const line of readFileSync(staffSource, 'utf8').split(/\r?\n/)) {
      const match = /^(?:VITE_)?(EMAILJS_TEMPLATE_ID)=(.*)$/.exec(line)
      if (match && !settings[match[1]])
        settings[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '')
    }
  return settings
}
