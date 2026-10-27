import pg from 'pg'
import { loadServerEnvironment, connectionOptions } from '../server/postgres.mjs'
loadServerEnvironment()
const pool = new pg.Pool(connectionOptions())
try {
  await pool.query('SELECT 1')
  const { rows } = await pool.query(
    'SELECT to_regclass($1) IS NOT NULL AS accounts,to_regclass($2) IS NOT NULL AS face_storage,to_regclass($3) IS NOT NULL AS plant_records',
    [(process.env.AUTH_PG_SCHEMA||'plant_auth')+'.users',(process.env.FACE_PG_SCHEMA||'plant_face')+'.accounts',(process.env.PLANT_PG_SCHEMA||'public')+'.plant_record'],
  )
  console.log(JSON.stringify({ connected: true, schemas: rows[0] }, null, 2))
} catch (error) {
  console.log(
    JSON.stringify(
      {
        connected: false,
        code: error.code ?? error.name,
        message: 'PostgreSQL connection unavailable. No schema or data was changed.',
      },
      null,
      2,
    ),
  )
  process.exitCode = 1
} finally {
  await pool.end()
}
