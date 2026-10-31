import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { testPool } from '../web/server/test-postgres.mjs'
import { postgresDatabase, connectionOptions } from '../web/server/postgres.mjs'
import { migrateAuth } from '../web/server/migrate.mjs'

test('isolated account migration revokes API-role schema access and PUBLIC table access', async () => {
  const pool = await testPool()
  const db = postgresDatabase(pool)
  try {
    // These roles exist only in the in-memory test engine, never live Supabase.
    await pool.query('CREATE ROLE anon; CREATE ROLE authenticated;')
    await migrateAuth(db)
    const access = await pool.query("SELECT rolname, has_schema_privilege(rolname, 'plant_auth', 'USAGE') AS exposed FROM pg_roles WHERE rolname IN ('anon','authenticated')")
    assert.equal(access.rows.length, 2)
    assert.ok(access.rows.every(row => row.exposed === false))
    const publicGrants = await pool.query("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE n.nspname='plant_auth' AND c.relkind='r' AND a.grantee=0")
    assert.deepEqual(publicGrants.rows, [])
    const sql = readFileSync(new URL('./account-security-readonly.sql', import.meta.url), 'utf8')
    // Validate the supplied inspection SQL against synthetic account metadata.
    await pool.query(sql)
    const definitions = await pool.query("SELECT prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='plant_auth' AND p.proname IN ('maintain_account_email','restrict_account_sessions')")
    assert.equal(definitions.rows.length, 2)
    assert.ok(definitions.rows.every(row => row.prosecdef === false))
  } finally {
    await db.close()
  }
})

test('existing remote account connections override disabled TLS with certificate verification', () => {
  const options = connectionOptions({ AUTH_DATABASE_URL: 'postgresql://synthetic:unused@db.example.invalid/postgres?sslmode=disable' })
  assert.equal(options.ssl.rejectUnauthorized, true)
  assert.equal(new URL(options.connectionString).searchParams.get('sslmode'), 'verify-full')
  assert.equal(connectionOptions({ AUTH_DATABASE_URL: 'postgresql://synthetic:unused@127.0.0.1/postgres' }).ssl, undefined)
})
