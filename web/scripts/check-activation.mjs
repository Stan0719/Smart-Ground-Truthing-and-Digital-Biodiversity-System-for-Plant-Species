import {loadServerEnvironment} from '../server/postgres.mjs'
import { activationConfiguration, emailSettings } from '../server/activation-configuration.mjs'
import { emailRuntimeConfiguration } from '../server/email-diagnostics.mjs'
import { websiteOrigin } from '../server/website-origin.mjs'
// Capture inherited variables before loading files so provenance remains accurate.
const inherited = { ...process.env }
loadServerEnvironment()
const effective = emailSettings(process.env)
const result = activationConfiguration(effective)
let originReady = true
try { websiteOrigin() } catch { originReady = false }
console.log(JSON.stringify({
  workflow: 'administrator-created temporary-password accounts',
  staffEmail: result,
  runtime: emailRuntimeConfiguration(inherited, effective),
  websiteOriginReady: originReady,
  scope: 'fresh diagnostic process; restart backend to load file changes',
  deliveryTest: 'NOT SENT',
}, null, 2))
if (!result.ready || !originReady) process.exitCode = 1
