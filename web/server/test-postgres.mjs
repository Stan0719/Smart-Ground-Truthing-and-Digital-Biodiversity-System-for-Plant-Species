// Isolated PostgreSQL engine; never reads .env or connects to Supabase.
import { PGlite } from '@electric-sql/pglite'
import { postgresDatabase } from './postgres.mjs'
import { migrateAuth } from './migrate.mjs'
import { createAuth } from './auth.mjs'
export async function testPool() {
  const engine = new PGlite()
  await engine.waitReady
  let tail = Promise.resolve()
  const pool = {
    async connect() {
      const before = tail
      let release
      tail = new Promise((resolve) => (release = resolve))
      await before
      return {
        async query(sql, params = []) {
          const result =
            params.length || !sql.includes(';')
              ? await engine.query(sql, params)
              : (await engine.exec(sql)).at(-1)
          return { ...result, rowCount: result.affectedRows ?? 0 }
        },
        release,
      }
    },
    async end() {
      await tail
      await engine.close()
    },
  }
  pool.query = async (sql, params = []) => {
    const client = await pool.connect()
    try {
      return await client.query(sql, params)
    } finally {
      client.release()
    }
  }
  return pool
}
export async function createTestAuth() {
  return createAuth(await testDatabase())
}

export async function testDatabase() {
  const db = postgresDatabase(await testPool())
  await migrateAuth(db)
  return db
}
