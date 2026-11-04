import pg from 'pg'
import { AsyncLocalStorage } from 'node:async_hooks'
import { readFileSync, existsSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { dataEncryptionFromEnvironment } from './data-encryption.mjs'
import { createAccountNameStorage } from './account-name-storage.mjs'

// Backend settings first, then authentication-specific overrides. Existing process
// variables always win. Database credentials never enter a Vite/public variable.
export function loadServerEnvironment({
  backendFile = new URL('../../plant-conservation-backend/.env', import.meta.url),
  serverFile = new URL('../.env.server', import.meta.url),
  faceFile = new URL('../../mobileapp/.env.face', import.meta.url),
  env = process.env,
} = {}) {
  const read = (path) => (existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {})
  const backend = read(backendFile)
  delete backend.PORT // Authentication defaults to 3001; plant defaults to 3000.
  const face = Object.fromEntries(
    Object.entries(read(faceFile)).filter(([key]) =>
      [
        'FACE_DATABASE_URL',
        'FACE_PG_SCHEMA',
        'FACE_ACCOUNT_SERVICE_URL',
        'FACE_ACCOUNT_SERVICE_KEY_FILE',
      ].includes(key),
    ),
  )
  const configured = { ...backend, ...read(serverFile), ...face }
  for (const [key, value] of Object.entries(configured))
    if (env[key] === undefined) env[key] = value
  return env
}

export function connectionOptions(env = process.env) {
  let connectionString = env.AUTH_DATABASE_URL || env.DATABASE_URL
  if (!connectionString && !(env.DB_HOST && env.DB_NAME && env.DB_USER))
    throw new Error('Configure AUTH_DATABASE_URL or DATABASE_URL for PostgreSQL authentication.')
  if (env.AUTH_DB)
    throw new Error('AUTH_DB is a retired SQLite setting. Use AUTH_DATABASE_URL instead.')
  const url = connectionString ? new URL(connectionString) : null
  if (
    url &&
    (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      url.searchParams.has('host') ||
      url.searchParams.has('hostaddr'))
  )
    throw Error('Use a PostgreSQL URL with an explicit database hostname.')
  const remote = !['localhost', '127.0.0.1', '[::1]', '::1'].includes(url?.hostname || env.DB_HOST)
  if (url && remote) {
    url.searchParams.set('sslmode', 'verify-full')
    if (env.PGSSLROOTCERT) url.searchParams.set('sslrootcert', env.PGSSLROOTCERT)
    connectionString = url.toString()
  }
  const ssl = env.PGSSLROOTCERT
    ? { rejectUnauthorized: true, ca: readFileSync(env.PGSSLROOTCERT, 'utf8') }
    : remote
      ? { rejectUnauthorized: true }
      : undefined
  return {
    ...(connectionString
      ? { connectionString }
      : {
          host: env.DB_HOST,
          port: Number(env.DB_PORT || 5432),
          database: env.DB_NAME,
          user: env.DB_USER,
          password: env.DB_PASSWORD,
        }),
    ...(ssl ? { ssl } : {}),
    connectionTimeoutMillis: 10000,
    max: 5,
  }
}

// Preserve the existing parameterized statement interface while moving execution
// to async PostgreSQL. Question marks inside SQL string literals are not binds.
export function parameters(sql) {
  let quoted = false,
    count = 0,
    output = ''
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i]
    if (char === "'") {
      output += char
      if (quoted && sql[i + 1] === "'") {
        output += sql[++i]
        continue
      }
      quoted = !quoted
    } else output += char === '?' && !quoted ? `$${++count}` : char
  }
  return output
}

export function postgresDatabase(pool, schema = 'plant_auth', { accountNames } = {}) {
  if (
    !/^[a-z][a-z0-9_]{0,62}$/.test(schema) ||
    ['public', 'auth', 'storage', 'extensions', 'information_schema'].includes(schema) ||
    schema.startsWith('pg_')
  )
    throw new Error('Invalid authentication schema name.')
  const context = new AsyncLocalStorage()
  const db = {
    dialect: 'postgresql',
    schema,
    async transaction(work) {
      if (context.getStore()) return work()
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query(`SET LOCAL search_path TO "${schema}", pg_catalog`)
        const result = await context.run(client, work)
        await client.query('COMMIT')
        return result
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      } finally {
        client.release()
      }
    },
    async query(sql, values = []) {
      if (!context.getStore()) return db.transaction(() => db.query(sql, values))
      const statement = parameters(sql)
      const bound = accountNames ? accountNames.write(statement, values) : values
      const result = await context.getStore().query(statement, bound)
      if (/\b(?:FROM|JOIN|UPDATE|INTO)\s+(?:["a-z0-9_]+\.)?"?(users|visitors)\b/i.test(statement))
        accountNames?.read(result.rows)
      for (const row of result.rows ?? [])
        for (const key of ['n', 'count', 'created_at', 'expires_at'])
          if (
            typeof row[key] === 'string' &&
            /^\d+$/.test(row[key]) &&
            Number.isSafeInteger(Number(row[key]))
          )
            row[key] = Number(row[key])
      return result
    },
    prepare(sql) {
      return {
        async get(...values) {
          return (await db.query(sql, values)).rows[0]
        },
        async all(...values) {
          return (await db.query(sql, values)).rows
        },
        async run(...values) {
          const result = await db.query(sql, values)
          return { changes: result.rowCount }
        },
      }
    },
    async exec(sql) {
      return db.query(sql)
    },
    async close() {
      await pool.end()
    },
  }
  return db
}

export function connectAuth(env = process.env) {
  const pool = new pg.Pool(connectionOptions(env))
  pool.on('error', (error) =>
    console.error('Authentication database connection failed:', error.code ?? error.name),
  )
  const accountNames = createAccountNameStorage(() => dataEncryptionFromEnvironment(env))
  return postgresDatabase(pool, env.AUTH_PG_SCHEMA || 'plant_auth', { accountNames })
}
