// One-time import utility only. Application runtime never opens SQLite.
import { DatabaseSync } from 'node:sqlite'
import { connectAuth, loadServerEnvironment } from '../server/postgres.mjs'
import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
export const accountTables = [
  'users',
  'visitors',
  'sessions',
  'visitor_sessions',
  'auth_events',
  'face_service_nonces',
  'password_resets',
  'activation_tokens',
  'security_settings',
]
export const faceTables = [
  'accounts',
  'sessions',
  'challenges',
  'real_face_templates',
  'face_account_links',
  'legacy_face_replacements',
]
export async function importSqlite(source, db, tables = accountTables) {
  const counts = {}
  await db.transaction(async () => {
    // The whole import is atomic; never merge into or overwrite existing accounts.
    for (const table of tables) {
      const n = (await db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get()).n
      if (n && table !== 'security_settings')
        throw Error('Target schema contains data; use an empty reviewed migration target.')
    }
    for (const table of tables) {
      if (!source.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))
        continue
      const rows = source.prepare(`SELECT * FROM "${table}"`).all()
      const columns = (
        await db
          .prepare(
            'SELECT column_name FROM information_schema.columns WHERE table_schema=? AND table_name=? ORDER BY ordinal_position',
          )
          .all(db.schema, table)
      ).map((r) => r.column_name)
      if (table === 'security_settings') await db.exec('DELETE FROM security_settings')
      for (const original of rows) {
        const row = { ...original }
        if (table === 'users' && !row.username) row.username = row.id
        const fields = columns.filter((c) => Object.hasOwn(row, c))
        const unknown = Object.keys(original).filter((c) => !columns.includes(c))
        if (unknown.length) throw Error('Unknown source columns; review schema before importing.')
        await db
          .prepare(
            `INSERT INTO "${table}"(${fields.map((c) => '"' + c + '"').join(',')}) VALUES(${fields.map(() => '?').join(',')})`,
          )
          .run(...fields.map((c) => row[c]))
        if (tables === faceTables) {
          const key = columns[0]
          const saved = await db.prepare(`SELECT * FROM "${table}" WHERE "${key}"=?`).get(row[key])
          if (!saved || fields.some(field => saved[field] !== row[field]))
            throw Error('Face import content verification failed; transaction rolled back.')
        }
      }
      const after = (await db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get()).n
      if (after !== rows.length) throw Error('Migration record count verification failed.')
      counts[table] = after
    }
    if (tables.includes('auth_events'))
      await db.exec(
        "SELECT setval(pg_get_serial_sequence('auth_events','id'),COALESCE((SELECT MAX(id) FROM auth_events),1),(SELECT COUNT(*)>0 FROM auth_events))",
      )
  })
  return counts
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadServerEnvironment()
  const path = process.argv[2]
  if (!path || !isAbsolute(path) || path.startsWith('--'))
    throw Error('Usage: node scripts/import-sqlite.mjs ABSOLUTE_SQLITE_BACKUP_PATH [--face]')
  const face = process.argv.includes('--face')
  const db = connectAuth(
    face
      ? {
          ...process.env,
          AUTH_DATABASE_URL: process.env.FACE_DATABASE_URL || process.env.DATABASE_URL,
          AUTH_PG_SCHEMA: process.env.FACE_PG_SCHEMA || 'plant_face',
        }
      : process.env,
  )
  let source
  try {
    source = new DatabaseSync(path, { readOnly: true })
    if (face) source.exec('BEGIN') // Consistent read-only snapshot across all face tables.
    const result = await importSqlite(source, db, face ? faceTables : accountTables)
    console.log(JSON.stringify({ imported: true, counts: result, sourcePreserved: true }, null, 2))
  } catch (error) {
    console.error('Import failed; transaction rolled back:', error.code ?? error.name)
    process.exitCode = 1
  } finally {
    source?.close()
    await db.close()
  }
}
