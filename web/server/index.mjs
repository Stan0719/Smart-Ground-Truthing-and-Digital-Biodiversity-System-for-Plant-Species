import { fileURLToPath } from 'node:url'
import { createAuthServer } from './http.mjs'
import { readFileSync } from 'node:fs'
import { recoveryConfig } from './recovery-config.mjs'
import { createRecovery, emailJsDelivery } from './recovery.mjs'
import { createAuth } from './auth.mjs'
import { connectAuth, loadServerEnvironment, connectionOptions } from './postgres.mjs'
import { createAuthDiagnostics, authStoreFingerprint } from './auth-diagnostics.mjs'
import { createAuthLifecycle } from './auth-lifecycle.mjs'
import { emailSettings } from './activation-configuration.mjs'
import { createStaffInvitations, temporaryPasswordDelivery } from './activation.mjs'
import { emailRuntimeConfiguration } from './email-diagnostics.mjs'
const inheritedEmailEnvironment = { ...process.env }
loadServerEnvironment()
const staffEmailSettings = emailSettings(process.env)
console.info(JSON.stringify({ event: 'staff_email_runtime', ...emailRuntimeConfiguration(inheritedEmailEnvironment, staffEmailSettings) }))
const database = connectAuth()
const diagnostics = createAuthDiagnostics({
  directory: fileURLToPath(new URL('./data/', import.meta.url)),
  storeFingerprint: authStoreFingerprint(connectionOptions(process.env), database.schema),
})
const lifecycle = createAuthLifecycle({ diagnostics })
const auth = await createAuth(database, { diagnostic: diagnostics.record })
const resetConfiguration = recoveryConfig(fileURLToPath(new URL('./data/auth', import.meta.url)))
const staff = createStaffInvitations({
  auth,
  deliver: temporaryPasswordDelivery(staffEmailSettings),
  origin: process.env.APP_ORIGIN ?? 'http://localhost:5173',
})
const recovery = createRecovery({
  auth,
  deliver: emailJsDelivery(resetConfiguration.settings),
  key: resetConfiguration.key,
})

const server = createAuthServer({
  auth,
  diagnostics,
  recovery,
  staff,
  key: process.env.FACE_ACCOUNT_SERVICE_KEY_FILE
    ? readFileSync(process.env.FACE_ACCOUNT_SERVICE_KEY_FILE)
    : null,
})
lifecycle.attach(server, () => auth.db.close())
server.requestTimeout = 15000
server.listen(Number(process.env.PORT ?? 3001), process.env.HOST ?? '127.0.0.1', () => {
  diagnostics.runtime()
  console.log('Authentication API running on port ' + server.address().port)
})
