import {sourceFingerprintSql} from '../server/legacy-fingerprint.mjs'
// Restores the real private archive into an ephemeral loopback-only PostgreSQL
// engine and rehearses the migration there. Never writes to the live database.
import { PGlite } from '@electric-sql/pglite'
import { postgis } from '@electric-sql/pglite-postgis'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import pg from 'pg'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { loadServerEnvironment, connectionOptions } from '../server/postgres.mjs'
import { migrateLegacyPostgres } from '../server/legacy-postgres.mjs'
loadServerEnvironment()
const manifestPath = resolve('.local-tools/latest-legacy-backup.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const engine = await PGlite.create({ extensions: { postgis } })
await engine.exec(
  'DROP SCHEMA public CASCADE;CREATE SCHEMA extensions;CREATE EXTENSION postgis WITH SCHEMA extensions;',
)
const server = new PGLiteSocketServer({ db: engine, host: '127.0.0.1', port: 0 })
let pool, live
try {
  await server.start()
  const url = 'postgresql://postgres:postgres@' + server.getServerConn() + '/postgres'
  const processResult = await new Promise((done, fail) => {
    const child = spawn(
      resolve('.local-tools/postgresql/psql.exe'),
      [
        '-X',
        '--no-password',
        '--set',
        'ON_ERROR_STOP=1',
        '--dbname',
        url,
        '--file',
        join(dirname(manifest.file), 'restore-source.sql'),
      ],
      {
        env: { ...process.env, PGSSLMODE: 'disable', PGSSLROOTCERT: '' },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk))
    child.stderr.on('data', (chunk) => (output += chunk))
    child.on('error', fail)
    child.on('exit', (code) => done({ code, output }))
  })
  writeFileSync(join(dirname(manifest.file), 'isolated-restore.log'), processResult.output)
  if (processResult.code !== 0)
    throw Error('Isolated restore failed; private log retained for inspection.')
  pool = new pg.Pool({ connectionString: url, max: 1 })
  live = new pg.Pool({...connectionOptions(),max:1})
  await live.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
  await live.query("SET LOCAL TIME ZONE 'UTC'")
  await pool.query('BEGIN READ ONLY')
  await pool.query("SET LOCAL TIME ZONE 'UTC'")
  const tables = (
    await live.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name",
    )
  ).rows.map((r) => r.table_name)
  const fingerprints = {}
  for (const table of tables) {
    if (!/^[a-z_]+$/.test(table)) throw Error('Unexpected source table name.')
    const sql=sourceFingerprintSql(table)
    const original = (await live.query(sql)).rows[0],
      restored = (await pool.query(sql)).rows[0]
    if (original.count !== restored.count || original.digest !== restored.digest){
      const columns=(await live.query('SELECT column_name FROM information_schema.columns WHERE table_schema=\'public\' AND table_name=$1 ORDER BY ordinal_position',[table])).rows
      const mismatched=[]
      for(const {column_name:column}of columns){
        if(!/^[a-z_]+$/.test(column))continue
        const check=`SELECT md5(coalesce(string_agg(coalesce("${column}"::text,'<NULL>'),chr(10) ORDER BY coalesce("${column}"::text,'<NULL>')),'')) AS digest FROM public."${table}"`
        const a=(await live.query(check)).rows[0],b=(await pool.query(check)).rows[0]
        if(a.digest!==b.digest)mismatched.push(column)
      }
      console.log(JSON.stringify({restoreMismatchTable:table,mismatchedColumns:mismatched}))
      throw Error('Isolated restore data comparison failed for ' + table)
    }
    fingerprints[table] = original
  }
  await live.query('COMMIT')
  await pool.query('COMMIT')
  const client = await pool.connect()
  let rehearsal
  try {
    rehearsal = await migrateLegacyPostgres(client)
  } finally {
    client.release()
  }
  const report = {
    restorationTested: true,
    restoredTables: tables.length,
    sourceFingerprints: fingerprints,
    rehearsal,
    restoreEngine: 'PGlite/PostGIS isolated PostgreSQL wire server',
    restoredAt: new Date().toISOString(),
  }
  Object.assign(manifest, report)
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  writeFileSync(join(dirname(manifest.file), 'manifest.json'), JSON.stringify(manifest, null, 2))
  console.log(
    JSON.stringify(
      {
        restorationTested: true,
        restoredTables: tables.length,
        allSourceDataMatched: true,
        rehearsal,
      },
      null,
      2,
    ),
  )
} catch (error) {
  console.error('Isolated backup rehearsal failed:', error.code ?? error.message)
  process.exitCode = 1
} finally {
  await live?.end()
  await pool?.end()
  await server.stop()
  await engine.close()
}
