import {sourceFingerprintSql} from './legacy-fingerprint.mjs'
// Explicit, atomic copy from the reviewed legacy public schema. Original tables
// stay intact for rollback; application traffic moves to separate private schemas.
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
const allowed = {
  user: new Set(['active', 'inactive', 'suspended']),
  workflow: new Set([
    'pending',
    'pending review',
    'draft',
    'approved',
    'rejected',
    'flagged',
    'correction required',
  ]),
}
const workflow = (value) =>
  ({
    pending: 'Pending Review',
    'pending review': 'Pending Review',
    draft: 'Draft',
    approved: 'Approved',
    rejected: 'Rejected',
    flagged: 'Flagged',
    'correction required': 'Correction Required',
  })[value.toLowerCase()]
const schemaName = (value) => {
  if (
    !/^[a-z][a-z0-9_]{0,62}$/.test(value) ||
    ['public', 'auth', 'storage', 'extensions', 'information_schema'].includes(value) ||
    value.startsWith('pg_')
  )
    throw Error('Invalid private migration schema.')
  return value
}
export async function migrateLegacyPostgres(
  client,
  {
    plantSchema = 'plant_app',
    authSchema = 'plant_auth',
    faceSchema = 'plant_face',
    expectedSourceFingerprints = null,
  } = {},
) {
  for (const schema of [plantSchema, authSchema, faceSchema]) schemaName(schema)
  if (new Set([plantSchema, authSchema, faceSchema]).size !== 3)
    throw Error('Migration schemas must be distinct.')
  const tables = [
    'users',
    'role',
    'family',
    'genus',
    'conservation_status',
    'species',
    'plant_record',
    'plant_location',
    'plant_observation',
    'verification',
    'sensor_device',
    'sensor_reading',
    'threat_alert',
    'plant_media',
    'species_media',
    'qr_code',
  ]
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE')
  await client.query("SET LOCAL TIME ZONE 'UTC'")
  try {
    await client.query('SELECT pg_advisory_xact_lock(87423902)')
    const sourceTables = expectedSourceFingerprints
      ? Object.keys(expectedSourceFingerprints)
      : tables
    for (const table of sourceTables) {
      if (!/^[a-z_]+$/.test(table)) throw Error('Unexpected source table name.')
      await client.query(`LOCK TABLE public."${table}" IN SHARE MODE`)
    }
    if (expectedSourceFingerprints)
      for (const [table, expected] of Object.entries(expectedSourceFingerprints)) {
        const actual=(await client.query(sourceFingerprintSql(table))).rows[0]
      if (actual.count !== expected.count || actual.digest !== expected.digest)
          throw Error(
            'Source data changed since the verified backup; take a fresh backup before migration.',
          )
      }
    for (const schema of [plantSchema, authSchema, faceSchema]) {
      if (
        (await client.query('SELECT to_regnamespace($1) IS NOT NULL AS present', [schema])).rows[0]
          .present
      )
        throw Error('A migration target already exists; refusing to overwrite or merge it.')
    }
    const counts = {}
    for (const table of tables)
      counts[table] = Number(
        (await client.query(`SELECT count(*) AS n FROM public."${table}"`)).rows[0].n,
      )
    for (const table of [
      'sensor_device',
      'sensor_reading',
      'threat_alert',
      'plant_media',
      'species_media',
      'qr_code',
    ])
      if (counts[table])
        throw Error(
          'Populated legacy media/IoT/QR tables need an additional explicit mapping before cutover.',
        )
    const sourceUsers = (
      await client.query(
        'SELECT u.*,r.role_name FROM public.users u JOIN public.role r ON r.role_id=u.role_id',
      )
    ).rows
    if (sourceUsers.length !== counts.users) throw Error('An account role reference is missing.')
    for (const user of sourceUsers) {
      if (
        !['Admin', 'Administrator', 'Conservation Officer', 'Botanist', 'Visitor'].includes(
          user.role_name,
        ) ||
        !allowed.user.has(user.status.toLowerCase())
      )
        throw Error('Unknown legacy account role/status; no permissions were guessed.')
    }
    const plants = (await client.query('SELECT * FROM public.plant_record ORDER BY plant_id')).rows
    const observations = (
      await client.query('SELECT * FROM public.plant_observation ORDER BY observation_id')
    ).rows
    for (const row of [...plants, ...observations])
      if (!allowed.workflow.has(String(row.current_status ?? row.status).toLowerCase()))
        throw Error('Unknown legacy workflow status; no review decision was guessed.')
    for (const schema of [plantSchema, authSchema, faceSchema]) {
      await client.query(`CREATE SCHEMA "${schema}"`)
      await client.query(`REVOKE ALL ON SCHEMA "${schema}" FROM PUBLIC`)
      for (const role of ['anon', 'authenticated'])
        if ((await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rows.length)
          await client.query(`REVOKE ALL ON SCHEMA "${schema}" FROM "${role}"`)
    }
    await client.query(`SET LOCAL search_path TO "${authSchema}",pg_catalog`)
    await client.query(readFileSync(new URL('./schema.postgres.sql', import.meta.url), 'utf8'))
    for (const user of sourceUsers) {
      const role = user.role_name === 'Admin' ? 'Administrator' : user.role_name,
        status = user.status[0].toUpperCase() + user.status.slice(1).toLowerCase()
      if (role === 'Visitor')
        await client.query(
          'INSERT INTO visitors(id,name,email,status,password_hash,must_change_password,last_login) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [
            String(user.user_id),
            user.full_name,
            user.email.toLowerCase(),
            status,
            user.password_hash,
            Number(user.must_change_password),
            user.last_login_at?.toISOString?.() ?? user.last_login_at,
          ],
        )
      else
        await client.query(
          'INSERT INTO users(id,name,username,email,role,status,password_hash,must_change_password,last_login,postgres_user_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
          [
            String(user.user_id),
            user.full_name,
            user.username,
            user.email.toLowerCase(),
            role,
            status,
            user.password_hash,
            Number(user.must_change_password),
            user.last_login_at?.toISOString?.() ?? user.last_login_at,
            user.user_id,
          ],
        )
    }
    await client.query(`SET LOCAL search_path TO "${faceSchema}",pg_catalog`)
    await client.query(
      readFileSync(
        new URL('../../mobileapp/face_backend/schema.postgres.sql', import.meta.url),
        'utf8',
      ),
    )
    await client.query(`SET LOCAL search_path TO "${plantSchema}",pg_catalog`)
    const plantSql = readFileSync(
      new URL('../../plant-conservation-backend/schema.postgres.sql', import.meta.url),
      'utf8',
    )
      .replace(/INTEGER GENERATED/g, 'BIGINT GENERATED')
      .replace(/INTEGER REFERENCES/g, 'BIGINT REFERENCES')
      .replace(/INTEGER NOT NULL REFERENCES/g, 'BIGINT NOT NULL REFERENCES')
      .replace(/INTEGER PRIMARY KEY REFERENCES/g, 'BIGINT PRIMARY KEY REFERENCES')
    await client.query(plantSql)
    await client.query(
      'CREATE TABLE legacy_records(table_name TEXT NOT NULL,source_id TEXT NOT NULL,payload JSONB NOT NULL,PRIMARY KEY(table_name,source_id));CREATE TABLE legacy_cutover(version INTEGER PRIMARY KEY,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),source_counts JSONB NOT NULL)',
    )
    for (const [table, columns] of Object.entries({
      family: 'family_id,family_name',
      genus: 'genus_id,family_id,genus_name',
      conservation_status: 'status_id,status_name',
      species:
        'species_id,scientific_name,common_name,genus_id,status_id,description,registered_at',
    }))
      await client.query(
        `INSERT INTO "${table}"(${columns}) SELECT ${columns} FROM public."${table}"`,
      )
    // Legacy records have no explicit publication classification: fail closed.
    await client.query(
      "INSERT INTO rbac_species_visibility SELECT species_id,'protected' FROM species",
    )
    for (const plant of plants) {
      const status = workflow(plant.current_status)
      if (status === 'Draft') throw Error('Legacy plant Draft requires explicit review mapping.')
      await client.query(
        'INSERT INTO plant_record(plant_id,species_id,registered_subject,rbac_status,qr_token,registered_at) VALUES($1,$2,$3,$4,$5,$6)',
        [
          plant.plant_id,
          plant.species_id,
          'staff:' + plant.registered_by,
          status,
          randomBytes(24).toString('hex'),
          plant.registered_at,
        ],
      )
    }
    await client.query(
      'INSERT INTO plant_location(location_id,plant_id,latitude,longitude,accuracy_m,recorded_at) SELECT location_id,plant_id,latitude,longitude,accuracy_m,recorded_at FROM public.plant_location',
    )
    for (const row of observations)
      await client.query(
        'INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7)',
        [
          String(row.observation_id),
          row.plant_id,
          'staff:' + row.recorded_by,
          workflow(row.status),
          {
            heightCm: row.height_cm === null ? null : Number(row.height_cm),
            morphology: row.morphology,
            lifeStage: row.life_stage,
            healthStatus: row.health_status,
            notes: row.notes,
          },
          'legacy-observation:' + row.observation_id,
          row.observed_at,
        ],
      )
    const reviews = (await client.query('SELECT * FROM public.verification')).rows
    for (const row of reviews) {
      const decision = workflow(row.verification_status)
      if (!decision) throw Error('Unknown legacy verification decision.')
      // Pending verification is retained below, without inventing an Officer review.
      if (decision !== 'Pending Review' && decision !== 'Draft')
        await client.query(
          'INSERT INTO observation_review(id,observation_id,reviewer_subject,decision,comment,created_at) VALUES($1,$2,$3,$4,$5,$6)',
          [
            String(row.verification_id),
            String(row.observation_id),
            'staff:' + row.verified_by,
            decision,
            row.comments ?? '',
            row.verified_at,
          ],
        )
    }
    for (const [table, id] of Object.entries({
      family: 'family_id',
      genus: 'genus_id',
      conservation_status: 'status_id',
      species: 'species_id',
      plant_record: 'plant_id',
      plant_location: 'location_id',
      plant_observation: 'observation_id',
      verification: 'verification_id',
    }))
      await client.query(
        `INSERT INTO legacy_records SELECT $1,src."${id}"::text,to_jsonb(src) FROM public."${table}" src`,
        [table],
      )
    for (const [table, id] of Object.entries({
      family: 'family_id',
      genus: 'genus_id',
      conservation_status: 'status_id',
      species: 'species_id',
      plant_record: 'plant_id',
      plant_location: 'location_id',
    }))
      await client.query(
        `SELECT setval(pg_get_serial_sequence('${table}','${id}'),COALESCE((SELECT max("${id}") FROM "${table}"),1),(SELECT count(*)>0 FROM "${table}"))`,
      )
    const verified = {}
    for (const table of [
      'family',
      'genus',
      'conservation_status',
      'species',
      'plant_record',
      'plant_location',
      'plant_observation',
    ]) {
      const count = Number((await client.query(`SELECT count(*) AS n FROM "${table}"`)).rows[0].n)
      if (count !== counts[table])
        throw Error('Post-migration row count mismatch; all changes rolled back.')
      verified[table] = count
    }
    const copiedAccounts = Number(
      (
        await client.query(
          `SELECT (SELECT count(*) FROM "${authSchema}".users)+(SELECT count(*) FROM "${authSchema}".visitors) AS n`,
        )
      ).rows[0].n,
    )
    if (copiedAccounts !== counts.users) throw Error('Account count verification failed.')
    const mismatches = Number(
      (
        await client.query(
          `SELECT count(*) AS n FROM public.users src LEFT JOIN (SELECT id,password_hash FROM "${authSchema}".users UNION ALL SELECT id,password_hash FROM "${authSchema}".visitors) dst ON dst.id=src.user_id::text WHERE dst.password_hash IS DISTINCT FROM src.password_hash`,
        )
      ).rows[0].n,
    )
    if (mismatches) throw Error('Password preservation verification failed.')
    for (const schema of [plantSchema, authSchema, faceSchema])
      await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA "${schema}" FROM PUBLIC`)
    await client.query('INSERT INTO legacy_cutover(version,source_counts) VALUES(1,$1)', [counts])
    await client.query('COMMIT')
    return {
      migrated: true,
      originalTablesPreserved: true,
      accounts: copiedAccounts,
      verified,
      plantSchema,
      authSchema,
      faceSchema,
      passwordsReset: false,
    }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}
