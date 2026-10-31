import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { testPool } from './test-postgres.mjs'
import { postgresDatabase } from './postgres.mjs'
import { migrateFace } from './migrate.mjs'
import { importSqlite, faceTables } from '../scripts/import-sqlite.mjs'

test('face migration preserves two account IDs, template bytes and provenance without altering source', async () => {
  const source = new DatabaseSync(':memory:')
  const db = postgresDatabase(await testPool(), 'plant_face')
  try {
    source.exec(readFileSync(new URL('../../mobileapp/face_backend/schema.postgres.sql', import.meta.url), 'utf8'))
    const templates = [JSON.stringify([1, ...Array(127).fill(0)]), JSON.stringify([0, 1, ...Array(126).fill(0)])]
    const pipeline = JSON.stringify({ model: 'SFace', dimensions: 128, antiSpoofing: true })
    for (let i = 0; i < 2; i++)
      source.prepare('INSERT INTO real_face_templates VALUES(?,?,?,?)').run(`fixture-account-${i}`, templates[i], pipeline, 1000 + i)
    await migrateFace(db)
    const counts = await importSqlite(source, db, faceTables)
    assert.equal(counts.real_face_templates, 2)
    const rows = await db.prepare('SELECT * FROM real_face_templates ORDER BY user_id').all()
    assert.deepEqual(rows.map(row => row.user_id), ['fixture-account-0', 'fixture-account-1'])
    assert.deepEqual(rows.map(row => row.template), templates)
    assert.ok(rows.every(row => row.pipeline === pipeline))
    assert.equal(source.prepare('SELECT COUNT(*) AS n FROM real_face_templates').get().n, 2)
    await assert.rejects(importSqlite(source, db, faceTables), /Target schema contains data/)
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM real_face_templates').get()).n, 2)
  } finally {
    source.close()
    await db.close()
  }
})

test('face content verification failure rolls back the entire import', async () => {
  const source = new DatabaseSync(':memory:')
  const db = postgresDatabase(await testPool(), 'plant_face')
  try {
    source.exec(readFileSync(new URL('../../mobileapp/face_backend/schema.postgres.sql', import.meta.url), 'utf8'))
    source.prepare('INSERT INTO real_face_templates VALUES(?,?,?,?)').run('fixture-account', '[1,0]', '{}', 1)
    await migrateFace(db)
    const original = db.prepare.bind(db)
    db.prepare = sql => {
      const statement = original(sql)
      if (sql.startsWith('SELECT * FROM "real_face_templates"'))
        return { ...statement, get: async (...args) => ({ ...await statement.get(...args), template: 'unexpected-content' }) }
      return statement
    }
    await assert.rejects(importSqlite(source, db, faceTables), /content verification failed/)
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM real_face_templates').get()).n, 0)
    assert.equal(source.prepare('SELECT COUNT(*) AS n FROM real_face_templates').get().n, 1)
  } finally {
    source.close()
    await db.close()
  }
})
