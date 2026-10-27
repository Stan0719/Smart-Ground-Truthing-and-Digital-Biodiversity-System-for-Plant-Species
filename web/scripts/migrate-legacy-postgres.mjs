import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import pg from 'pg'
import { loadServerEnvironment, connectionOptions } from '../server/postgres.mjs'
import { migrateLegacyPostgres } from '../server/legacy-postgres.mjs'
loadServerEnvironment()
const manifestPath = process.argv[2]
if (!manifestPath) throw Error('Provide the private pre-migration backup manifest path.')
const backup = JSON.parse(readFileSync(manifestPath, 'utf8'))
if (
  !backup.archiveValidated ||
  !backup.restorationTested ||
  !backup.sourceFingerprints ||
  createHash('sha256').update(readFileSync(backup.file)).digest('hex') !== backup.sha256
)
  throw Error('Pre-migration backup validation failed.')
// This migration is atomic only when all three schemas use the same database.
for (const key of ['AUTH_DATABASE_URL', 'FACE_DATABASE_URL'])
  if (process.env[key] && process.env[key] !== process.env.DATABASE_URL)
    throw Error('Separate database URLs require a separately reviewed multi-database migration.')
const pool = new pg.Pool(connectionOptions()),
  client = await pool.connect()
try {
  const result = await migrateLegacyPostgres(client, {
    plantSchema: process.env.PLANT_PG_SCHEMA || 'plant_app',
    authSchema: process.env.AUTH_PG_SCHEMA || 'plant_auth',
    faceSchema: process.env.FACE_PG_SCHEMA || 'plant_face',
    expectedSourceFingerprints: backup.sourceFingerprints,
  })
  backup.cutover={...result,completedAt:new Date().toISOString()}
  writeFileSync(manifestPath,JSON.stringify(backup,null,2))
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  console.error('Legacy migration stopped:', error.code ?? error.message)
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
