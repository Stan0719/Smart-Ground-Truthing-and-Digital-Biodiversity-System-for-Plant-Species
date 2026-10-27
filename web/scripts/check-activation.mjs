// Read-only diagnostic: does not open databases, generate tokens or send email.
import {loadServerEnvironment} from '../server/postgres.mjs'
import { activationConfiguration, emailSettings } from '../server/activation-configuration.mjs'
import { websiteOrigin } from '../server/website-origin.mjs'
loadServerEnvironment()
const result = activationConfiguration(emailSettings(process.env))
let originReady = true
try {
  websiteOrigin()
} catch {
  originReady = false
}
console.log(
  JSON.stringify(
    {
      workflow: 'administrator-created temporary-password accounts',
      staffEmail: result,
      websiteOriginReady: originReady,
      deliveryTest: 'NOT SENT',
    },
    null,
    2,
  ),
)
if (!result.ready || !originReady) process.exitCode = 1
