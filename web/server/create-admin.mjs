import { createAuth } from './auth.mjs'
import { mkdirSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
mkdirSync(new URL('./data/', import.meta.url), { recursive: true, mode: 0o700 })
const cli = createInterface({ input: process.stdin, output: process.stdout })
try {
  const email = await cli.question('Admin email: ')
  const name = await cli.question('Admin name: ')
  // Use a generated password so secrets are never typed into shell history.
  const { randomBytes } = await import('node:crypto')
  const password = randomBytes(18).toString('base64url')
  const databasePath =
    process.env.AUTH_DB ??
    fileURLToPath(new URL('./data/auth.sqlite', import.meta.url))

  console.log('Using database:', databasePath)

  const auth = await createAuth(databasePath)
  await auth.createUser({ name, email, role: 'Administrator', password })
  console.log('Temporary password (save privately):', password)
  auth.db.close()
} finally {
  cli.close()
}
