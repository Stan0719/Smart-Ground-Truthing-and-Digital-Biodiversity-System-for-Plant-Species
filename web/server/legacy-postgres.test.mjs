import { pbkdf2Sync } from 'node:crypto'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { testPool } from './test-postgres.mjs'
import { migrateLegacyPostgres } from './legacy-postgres.mjs'
import { postgresDatabase } from './postgres.mjs'
import { createAuth } from './auth.mjs'
async function fixture() {
  const pool = await testPool()
  // Exact relevant legacy column shapes. Geometry is archival data here; the
  // migration never writes to or changes the source PostGIS column.
  await pool.query(`
 CREATE TABLE public.role(role_id BIGINT PRIMARY KEY,role_name TEXT);
 CREATE TABLE public.users(user_id BIGINT PRIMARY KEY,username TEXT,full_name TEXT,email TEXT,password_hash TEXT,role_id BIGINT,status TEXT,must_change_password BOOLEAN,last_login_at TIMESTAMPTZ);
 CREATE TABLE public.family(family_id BIGINT PRIMARY KEY,family_name TEXT);
 CREATE TABLE public.genus(genus_id BIGINT PRIMARY KEY,genus_name TEXT,family_id BIGINT);
 CREATE TABLE public.conservation_status(status_id BIGINT PRIMARY KEY,status_name TEXT);
 CREATE TABLE public.species(species_id BIGINT PRIMARY KEY,scientific_name TEXT,common_name TEXT,genus_id BIGINT,status_id BIGINT,description TEXT,registered_at TIMESTAMPTZ);
 CREATE TABLE public.plant_record(plant_id BIGINT PRIMARY KEY,species_id BIGINT,registered_by BIGINT,current_status TEXT,registered_at TIMESTAMPTZ);
 CREATE TABLE public.plant_location(location_id BIGINT PRIMARY KEY,plant_id BIGINT,latitude NUMERIC,longitude NUMERIC,accuracy_m NUMERIC,recorded_at TIMESTAMPTZ,geometry TEXT);
 CREATE TABLE public.plant_observation(observation_id BIGINT PRIMARY KEY,plant_id BIGINT,recorded_by BIGINT,height_cm NUMERIC,morphology TEXT,life_stage TEXT,health_status TEXT,notes TEXT,observed_at TIMESTAMPTZ,status TEXT);
 CREATE TABLE public.verification(verification_id BIGINT PRIMARY KEY,observation_id BIGINT,verified_by BIGINT,verification_status TEXT,comments TEXT,verified_at TIMESTAMPTZ);
 INSERT INTO public.role VALUES(1,'Admin');
 INSERT INTO public.users VALUES(42,'fixture.admin','Fixture','fixture@example.invalid','unsupported-preserved-hash',1,'active',false,NULL);
 INSERT INTO public.family VALUES(4,'Fixture family');INSERT INTO public.genus VALUES(8,'Fixture genus',4);
 INSERT INTO public.conservation_status VALUES(2,'Fixture status');
 INSERT INTO public.species VALUES(6,'Fixture species','Fixture',8,2,'Private fixture',now());
 INSERT INTO public.plant_record VALUES(12,6,42,'pending',now());
 INSERT INTO public.plant_location VALUES(13,12,0,0,5,now(),'original-geometry');
 INSERT INTO public.plant_observation VALUES(17,12,42,20,'Fixture','Young','Healthy','Notes',now(),'pending');
 INSERT INTO public.verification VALUES(9,17,42,'pending','Retained pending review',now());
 `)
  for (const table of [
    'sensor_device',
    'sensor_reading',
    'threat_alert',
    'plant_media',
    'species_media',
    'qr_code',
  ])
    await pool.query(`CREATE TABLE public.${table}(id INTEGER)`)
  return pool
}
test('legacy migration preserves source records, hashes, IDs, pending state and resets no passwords', async () => {
  const pool = await fixture(),
    client = await pool.connect()
  try {
    const result = await migrateLegacyPostgres(client)
    assert.equal(result.accounts, 1)
    assert.equal(result.passwordsReset, false)
    assert.equal(
      (await client.query('SELECT password_hash FROM public.users')).rows[0].password_hash,
      'unsupported-preserved-hash',
    )
    assert.equal(
      (await client.query('SELECT geometry FROM public.plant_location')).rows[0].geometry,
      'original-geometry',
    )
    const db = postgresDatabase(
      { connect: async () => ({ ...client, release() {} }), end: async () => {} },
      'plant_auth',
    )
    const auth = await createAuth(db)
    assert.equal((await auth.byId('42')).role, 'Administrator')
    assert.equal((await auth.login('fixture@example.invalid', 'wrong', 'fixture')).status, 401)
    assert.equal(
      (await client.query('SELECT registered_subject,rbac_status FROM plant_app.plant_record'))
        .rows[0].registered_subject,
      'staff:42',
    )
    assert.equal(
      (await client.query('SELECT status FROM plant_app.plant_observation')).rows[0].status,
      'Pending Review',
    )
    assert.equal(
      (await client.query('SELECT count(*)::int AS n FROM plant_app.observation_review')).rows[0].n,
      0,
    )
    assert.equal(
      (
        await client.query(
          "SELECT payload->>'comments' AS note FROM plant_app.legacy_records WHERE table_name='verification'",
        )
      ).rows[0].note,
      'Retained pending review',
    )
    assert.equal(
      (await client.query('SELECT visibility FROM plant_app.rbac_species_visibility')).rows[0]
        .visibility,
      'protected',
    )
    assert.equal(
      (
        await client.query(
          "INSERT INTO plant_app.species(scientific_name) VALUES('Next fixture') RETURNING species_id",
        )
      ).rows[0].species_id,
      7,
    )
    await assert.rejects(migrateLegacyPostgres(client), /already exists/)
  } finally {
    client.release()
    await pool.end()
  }
})
test('unsupported legacy data rolls back every newly created schema', async () => {
  const pool = await fixture(),
    client = await pool.connect()
  try {
    await client.query("UPDATE public.plant_record SET current_status='unknown'")
    await assert.rejects(migrateLegacyPostgres(client), /Unknown legacy workflow/)
    assert.equal(
      (await client.query("SELECT to_regnamespace('plant_app') IS NULL AS absent")).rows[0].absent,
      true,
    )
    assert.equal((await client.query('SELECT count(*)::int AS n FROM public.users')).rows[0].n, 1)
  } finally {
    client.release()
    await pool.end()
  }
})

test('private plant schema remains selected for each explicit transaction and standalone query', async () => {
  const pool = await testPool()
  const { scopedPool } = await import('../../plant-conservation-backend/database.cjs')
  await pool.query(
    "CREATE SCHEMA private_plants;CREATE TABLE private_plants.marker(value TEXT);INSERT INTO private_plants.marker VALUES('correct')",
  )
  const scoped = scopedPool(pool, 'private_plants')
  try {
    assert.equal((await scoped.query('SELECT value FROM marker')).rows[0].value, 'correct')
    const client = await scoped.connect()
    try {
      await client.query('BEGIN')
      assert.equal((await client.query('SELECT value FROM marker')).rows[0].value, 'correct')
      await client.query('ROLLBACK')
    } finally {
      client.release()
    }
  } finally {
    await scoped.end()
  }
})

test('legacy PBKDF2 passwords authenticate without rewriting hashes or bypassing status', async () => {
  const { createTestAuth } = await import('./test-postgres.mjs')
  const auth = await createTestAuth()
  try {
    const user = await auth.createUser({
      name: 'Legacy fixture',
      email: 'legacy@example.invalid',
      role: 'Botanist',
      password: 'initial-fixture-password',
      mustChangePassword: false,
    })
    const salt = '01'.repeat(16),
      password = 'original-fixture-password'
    const hash =
      'pbkdf2_sha256$600000$' +
      salt +
      '$' +
      pbkdf2Sync(password, Buffer.from(salt, 'hex'), 600000, 32, 'sha256').toString('hex')
    await auth.db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, user.id)
    assert.equal((await auth.login(user.email, password, 'legacy')).user.id, user.id)
    assert.equal((await auth.byId(user.id)).password_hash, hash)
    assert.equal((await auth.login(user.email, 'wrong', 'legacy')).status, 401)
    await auth.setStatus(user.id, 'Suspended', 'test', 'legacy')
    assert.equal((await auth.login(user.email, password, 'legacy')).status, 401)
  } finally {
    await auth.db.close()
  }
})
