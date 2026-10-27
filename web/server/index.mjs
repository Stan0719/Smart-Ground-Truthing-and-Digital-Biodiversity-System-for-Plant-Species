import { fileURLToPath } from 'node:url'
import { createAuthServer } from './http.mjs'
import { readFileSync } from 'node:fs'
import { recoveryConfig } from './recovery-config.mjs'
import { createRecovery, emailJsDelivery } from './recovery.mjs'
import { createAuth } from './auth.mjs'
import { connectAuth, loadServerEnvironment } from './postgres.mjs'
import { emailSettings } from './activation-configuration.mjs'
import { createStaffInvitations, temporaryPasswordDelivery } from './activation.mjs'
loadServerEnvironment()
const auth = await createAuth(connectAuth())
const resetConfiguration = recoveryConfig(fileURLToPath(new URL('./data/auth', import.meta.url)))
const staff = createStaffInvitations({
  auth,
  deliver: temporaryPasswordDelivery(emailSettings(process.env)),
  origin: process.env.APP_ORIGIN ?? 'http://localhost:5173',
})
const recovery = createRecovery({
  auth,
  deliver: emailJsDelivery(resetConfiguration.settings),
  key: resetConfiguration.key,
})

const server = createAuthServer({
  auth,
  recovery,
  staff,
  key: process.env.FACE_ACCOUNT_SERVICE_KEY_FILE
    ? readFileSync(process.env.FACE_ACCOUNT_SERVICE_KEY_FILE)
    : null,
})
server.requestTimeout = 15000
server.listen(Number(process.env.PORT ?? 3001), process.env.HOST ?? '127.0.0.1', () => {
  console.log('Authentication API running on port ' + server.address().port)
})

for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, () =>
    server.close(async () => {
      await auth.db.close()
      process.exit(0)
    }),
  )
