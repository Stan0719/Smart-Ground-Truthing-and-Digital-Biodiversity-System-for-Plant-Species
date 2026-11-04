import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createTestAuth, testPool } from './test-postgres.mjs'
import {
  parameters,
  connectionOptions,
  postgresDatabase,
  loadServerEnvironment,
} from './postgres.mjs'
import { importSqlite } from '../scripts/import-sqlite.mjs'
import { migrateAuth, migrateFace } from './migrate.mjs'

test('PostgreSQL transactions rollback all writes and concurrent work is isolated', async () => {
  const auth = await createTestAuth()
  try {
    await assert.rejects(
      auth.db.transaction(async () => {
        await auth.event(null, 'rollback', 'must_not_survive')
        throw Error('rollback')
      }),
    )
    assert.equal((await auth.db.prepare('SELECT COUNT(*) AS n FROM auth_events').get()).n, 0)
    await Promise.all(Array.from({ length: 5 }, (_, i) => auth.event(null, String(i), 'parallel')))
    assert.equal((await auth.db.prepare('SELECT COUNT(*) AS n FROM auth_events').get()).n, 5)
    await migrateAuth(auth.db)
    assert.equal((await auth.db.prepare('SELECT COUNT(*) AS n FROM auth_events').get()).n, 5)
  } finally {
    await auth.db.close()
  }
})
test('cross-table email uniqueness and permission-change revocation survive PostgreSQL migration', async () => {
  const auth = await createTestAuth()
  try {
    const staff = await auth.createUser({
      name: 'Staff',
      email: 'same@example.invalid',
      role: 'Botanist',
      password: 'existing long password',
      mustChangePassword: false,
    })
    await assert.rejects(
      auth.db
        .prepare('INSERT INTO visitors(id,name,email,password_hash) VALUES(?,?,?,?)')
        .run('visitor', 'Visitor', staff.email, 'not-used'),
      { code: '23505' },
    )
    assert.equal((await auth.db.prepare('SELECT COUNT(*) AS n FROM visitors').get()).n, 0)
    const login = await auth.login(staff.email, 'existing long password', 'test')
    await auth.db.prepare("UPDATE users SET role='Conservation Officer' WHERE id=?").run(staff.id)
    assert.equal(await auth.session(login.token), null)
  } finally {
    await auth.db.close()
  }
})
test('read-only SQLite import preserves IDs, password hashes and sessions, and refuses overwrite', async () => {
  const source = new DatabaseSync(':memory:')
  const auth = await createTestAuth()
  try {
    source.exec(
      'CREATE TABLE users(id TEXT,name TEXT,email TEXT,role TEXT,status TEXT,password_hash TEXT,must_change_password INTEGER,last_login TEXT);CREATE TABLE sessions(token_hash TEXT,user_id TEXT,expires_at INTEGER)',
    )
    source
      .prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?,?)')
      .run(
        'original-id',
        'Original',
        'original@example.invalid',
        'Botanist',
        'Active',
        'preserved:hash',
        0,
        null,
      )
    source
      .prepare('INSERT INTO sessions VALUES(?,?,?)')
      .run('preserved-session', 'original-id', Date.now() + 100000)
    const counts = await importSqlite(source, auth.db)
    assert.equal(counts.users, 1)
    assert.equal((await auth.byId('original-id')).password_hash, 'preserved:hash')
    assert.equal(
      (await auth.db.prepare('SELECT user_id FROM sessions').get()).user_id,
      'original-id',
    )
    await assert.rejects(importSqlite(source, auth.db), /contains data/)
    assert.equal(source.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1)
  } finally {
    source.close()
    await auth.db.close()
  }
})
test('face PostgreSQL schema creates only the separate requested namespace', async () => {
  const auth = { db: postgresDatabase(await testPool(), 'plant_face') }
  try {
    await migrateFace(auth.db)
    const row = await auth.db
      .prepare(
        "SELECT to_regclass('plant_face.real_face_templates') IS NOT NULL AS face,to_regclass('public.real_face_templates') IS NULL AS private",
      )
      .get()
    assert.equal(row.face, true)
    assert.equal(row.private, true)
    await auth.db
      .prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?)')
      .run('face@example.invalid', 'Face', 'botanist', 'salt', 'hash', '[1,0]')
    assert.equal((await auth.db.prepare('SELECT template FROM accounts').get()).template, '[1,0]')
    await auth.db.prepare('INSERT INTO challenges VALUES(?,?)').run('single', 120)
    assert.equal(
      (
        await auth.db
          .prepare('DELETE FROM challenges WHERE token=? RETURNING expires')
          .get('single')
      ).expires,
      120,
    )
    assert.equal(
      await auth.db.prepare('DELETE FROM challenges WHERE token=? RETURNING expires').get('single'),
      undefined,
    )
  } finally {
    await auth.db.close()
  }
})
test('configuration refuses SQLite paths, keeps verified TLS, and preserves quoted SQL literals', () => {
  assert.throws(
    () =>
      connectionOptions({ AUTH_DB: 'old.sqlite', DATABASE_URL: 'postgresql://u:p@localhost/db' }),
    /retired/,
  )
  assert.equal(
    connectionOptions({ DATABASE_URL: 'postgresql://u:p@example.invalid/db' }).ssl
      .rejectUnauthorized,
    true,
  )
  assert.equal(
    parameters("SELECT '?' AS literal, ? AS value, 'it''s?' AS text"),
    "SELECT '?' AS literal, $1 AS value, 'it''s?' AS text",
  )
})

test('private schemas reject managed Supabase and PostgreSQL namespaces', () => {
  for (const schema of ['public', 'auth', 'storage', 'pg_catalog', 'information_schema'])
    assert.throws(() => postgresDatabase({}, schema), /schema name/)
})

test('private environment precedence selects the correct database without borrowing the plant port', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'postgres-env-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const backendFile = join(root, 'backend.env'),
    serverFile = join(root, 'web.env'),
    faceFile = join(root, 'face.env')
  writeFileSync(backendFile, 'DATABASE_URL=postgresql://fixture@localhost/plant\nPORT=3000\n')
  writeFileSync(serverFile, 'AUTH_PG_SCHEMA=private_accounts\n')
  writeFileSync(
    faceFile,
    'FACE_DATABASE_URL=postgresql://fixture@localhost/face\nFACE_PG_SCHEMA=private_faces\nPORT=8000\n',
  )
  const env = { AUTH_PG_SCHEMA: 'process_override' }
  loadServerEnvironment({ backendFile, serverFile, faceFile, env })
  assert.equal(env.PORT, undefined)
  assert.equal(env.AUTH_PG_SCHEMA, 'process_override')
  assert.equal(env.FACE_PG_SCHEMA, 'private_faces')
  assert.equal(env.FACE_DATABASE_URL, 'postgresql://fixture@localhost/face')
})
