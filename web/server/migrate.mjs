import { readFileSync } from 'node:fs'
import { connectAuth, loadServerEnvironment } from './postgres.mjs'
import { pathToFileURL } from 'node:url'

export async function migrateAuth(db) {
  await db.transaction(async () => {
    await db
      .prepare('SELECT pg_advisory_xact_lock(hashtext(?))')
      .get('schema-migration:' + db.schema)
    await db.exec(`CREATE SCHEMA IF NOT EXISTS "${db.schema}"`)
    await db.exec(`REVOKE ALL ON SCHEMA "${db.schema}" FROM PUBLIC`)
    // Supabase API roles must not read credential/session tables.
    for (const role of ['anon', 'authenticated']) {
      if (await db.prepare('SELECT 1 FROM pg_roles WHERE rolname=?').get(role))
        await db.exec(`REVOKE ALL ON SCHEMA "${db.schema}" FROM "${role}"`)
    }
    await db.exec(readFileSync(new URL('./schema.postgres.sql', import.meta.url), 'utf8'))
    await db.exec('REVOKE ALL ON ALL TABLES IN SCHEMA "' + db.schema + '" FROM PUBLIC')
  })
}
// Kept for old callers; reviewer identity is part of the PostgreSQL schema.
export async function migrateReviewerIdentity() {}
export async function migrateFace(db) {
  await db.transaction(async () => {
    await db
      .prepare('SELECT pg_advisory_xact_lock(hashtext(?))')
      .get('schema-migration:' + db.schema)
    await db.exec(`CREATE SCHEMA IF NOT EXISTS "${db.schema}"`)
    await db.exec(`REVOKE ALL ON SCHEMA "${db.schema}" FROM PUBLIC`)
    await db.exec(
      readFileSync(
        new URL('../../mobileapp/face_backend/schema.postgres.sql', import.meta.url),
        'utf8',
      ),
    )
    await db.exec(`REVOKE ALL ON ALL TABLES IN SCHEMA "${db.schema}" FROM PUBLIC`)
    for (const role of ['anon', 'authenticated'])
      if (await db.prepare('SELECT 1 FROM pg_roles WHERE rolname=?').get(role))
        await db.exec(`REVOKE ALL ON SCHEMA "${db.schema}" FROM "${role}"`)
  })
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadServerEnvironment()
  const face = process.argv.includes('--face')
  if ((process.env.FACE_PG_SCHEMA || 'plant_face') === (process.env.AUTH_PG_SCHEMA || 'plant_auth'))
    throw Error('Face and account schemas must be distinct.')
  const db = connectAuth(
    face
      ? {
          ...process.env,
          AUTH_DATABASE_URL: process.env.FACE_DATABASE_URL || process.env.DATABASE_URL,
          AUTH_PG_SCHEMA: process.env.FACE_PG_SCHEMA || 'plant_face',
        }
      : process.env,
  )
  try {
    await (face ? migrateFace(db) : migrateAuth(db))
    console.log(
      'Private PostgreSQL ' +
        (face ? 'face' : 'authentication') +
        ' schema ready. Existing accounts were not reset.',
    )
  } catch (error) {
    console.error('Authentication migration failed:', error.code ?? error.name)
    process.exitCode = 1
  } finally {
    await db.close()
  }
}
