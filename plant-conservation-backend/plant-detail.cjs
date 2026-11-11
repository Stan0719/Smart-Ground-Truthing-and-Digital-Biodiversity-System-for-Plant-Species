"use strict";
const { permitted } = require('../shared/rbac.cjs');
const { classifyObservations } = require('./observation-origin.cjs');
const fail = (status, message) => { throw Object.assign(Error(message), { status }); };
function plantId(value) {
  if (!/^[1-9][0-9]{0,9}$/.test(value) || Number(value) > 2147483647) fail(400, 'Invalid plant identifier.');
  return value;
}
// Only this page's read permission grants the full sensitivity projection.
// It does not change visibilityFor(), review eligibility, or general asset access.
async function detailParent(c, value, user) {
  const id = plantId(value), staff = permitted(user, 'plants.detail.read');
  const row = (await c.query(`SELECT p.plant_id,p.species_id,p.scientific_name,p.rbac_status,p.registered_subject,p.registered_at,
      s.scientific_name AS species_name,s.common_name,s.description,g.genus_name,f.family_name,
      cs.status_name AS conservation_status,s.rbac_data
    FROM plant_record p JOIN species s ON s.species_id=p.species_id
    LEFT JOIN genus g ON g.genus_id=s.genus_id LEFT JOIN family f ON f.family_id=g.family_id
    LEFT JOIN conservation_status cs ON cs.status_id=s.status_id
    LEFT JOIN rbac_species_visibility v ON v.species_id=s.species_id
    WHERE p.plant_id=$1 AND ($2 OR (p.rbac_status='Approved'
      AND COALESCE(s.rbac_data->>'approvalStatus','Approved')='Approved' AND COALESCE(v.visibility,'protected')='public'))`, [id, staff])).rows[0];
  if (!row) fail(404, 'Plant unavailable.');
  return row;
}
const string = value => typeof value === 'string' ? value : null;
const number = (value, min = -Infinity, max = Infinity) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;
function location(content = {}) {
  const latitude = number(content.latitude, -90, 90), longitude = number(content.longitude, -180, 180);
  return { latitude: latitude !== null && longitude !== null ? latitude : null,
    longitude: latitude !== null && longitude !== null ? longitude : null,
    accuracy_m: number(content.accuracy_m, 0), altitude_m: number(content.altitudeM ?? content.altitude_m), zone: string(content.zone) };
}
function observationContent(content = {}) {
  return { heightCm: number(content.heightCm, 0), healthStatus: string(content.healthStatus), lifeStage: string(content.lifeStage),
    morphology: string(content.morphology), notes: string(content.notes), ...location(content) };
}
async function snapshot(pool, work) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await c.query("SET LOCAL statement_timeout='5000ms'");
    const result = await work(c);
    await c.query('COMMIT');
    return result;
  } catch (error) { await c.query('ROLLBACK').catch(() => {}); throw error; }
  finally { c.release(); }
}
function historyOptions(query, id) {
  if (Object.keys(query).some(key => !['limit', 'cursor'].includes(key))) fail(400, 'Invalid history pagination.');
  const limit = query.limit === undefined ? 20 : Number(query.limit);
  if ((query.limit !== undefined && (typeof query.limit !== 'string' || !/^\d+$/.test(query.limit))) || !Number.isInteger(limit) || limit < 1 || limit > 100) fail(400, 'Invalid history pagination.');
  let cursor = null;
  if (query.cursor !== undefined) {
    try {
      if (typeof query.cursor !== 'string' || !/^[A-Za-z0-9_-]{1,2000}$/.test(query.cursor)) throw Error();
      cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString());
      if (cursor.v !== 1 || cursor.plant !== id || typeof cursor.id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(cursor.id) ||
        typeof cursor.at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(cursor.at) || !Number.isFinite(Date.parse(cursor.at))) throw Error();
    } catch { fail(400, 'Invalid history pagination.'); }
  }
  return { limit, cursor };
}
function mountPlantDetail(app, { pool, allow, auth }) {
  app.get('/api/plants/:plantId/detail', allow('plants.detail.public.read'), async (req, res) => {
    const result = await snapshot(pool, async c => {
      const p = await detailParent(c, req.params.plantId, req.user);
      const information = { plant_id: String(p.plant_id), scientific_name: p.scientific_name || p.species_name,
        common_name: p.common_name, genus_name: p.genus_name, family_name: p.family_name, description: p.description };
      if (!permitted(req.user, 'plants.detail.read')) return { information, staff: null };
      const approved = (await c.query(`SELECT content FROM plant_observation WHERE plant_id=$1 AND status='Approved'
        AND jsonb_typeof(content->'latitude')='number' AND jsonb_typeof(content->'longitude')='number'
        AND (CASE WHEN jsonb_typeof(content->'latitude')='number' THEN (content->>'latitude')::numeric END) BETWEEN -90 AND 90
        AND (CASE WHEN jsonb_typeof(content->'longitude')='number' THEN (content->>'longitude')::numeric END) BETWEEN -180 AND 180
        ORDER BY updated_at DESC,id DESC LIMIT 1`, [p.plant_id])).rows[0];
      return { information, staff: { status: p.rbac_status, registered_at: p.registered_at,
        conservation_status: p.conservation_status, habitat: string(p.rbac_data?.habitat),
        approved_location: approved ? location(approved.content) : null } };
    });
    res.json(result);
  });
  app.get('/api/plants/:plantId/detail/history', allow('plants.detail.read'), async (req, res) => {
    const id = plantId(req.params.plantId), { limit, cursor } = historyOptions(req.query, id);
    const result = await snapshot(pool, async c => {
      await detailParent(c, id, req.user);
      const rows = (await c.query(`SELECT o.*,to_char(o.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'content_type',a.content_type) ORDER BY
          CASE WHEN a.client_key ~ ':photo:[0-9]+$' THEN substring(a.client_key from ':photo:([0-9]+)$')::numeric END ASC NULLS LAST,a.id)
          FROM plant_asset a WHERE a.plant_id=o.plant_id AND a.observation_id=o.id AND a.species_id IS NULL
            AND a.content_type IN ('image/jpeg','image/png')), '[]') AS assets,
        (SELECT jsonb_build_object('decision',r.decision,'comment',r.comment,'created_at',r.created_at)
          FROM observation_review r WHERE r.observation_id=o.id ORDER BY r.created_at DESC,r.id DESC LIMIT 1) AS review
        FROM plant_observation o WHERE o.plant_id=$1
          AND ($2::timestamptz IS NULL OR (o.created_at,o.id)<($2::timestamptz,$3::text))
        ORDER BY o.created_at DESC,o.id DESC LIMIT $4`, [id, cursor?.at ?? null, cursor?.id ?? '', limit + 1])).rows;
      const page = rows.slice(0, limit), classified = await classifyObservations(c, page), last = page.at(-1);
      const more = rows.length > limit;
      return { plant_id: id, observations: classified.map(o => ({ id: o.id, plant_id: id, origin: o.origin_type,
        date: o.created_at, status: o.status, recorded_by: null, content: observationContent(o.content),
        assets: o.assets, review: o.review, _owner: o.owner_subject })),
        page: { limit, has_more: more, next_cursor: more ? Buffer.from(JSON.stringify({ v: 1, plant: id, at: last.cursor_at, id: last.id })).toString('base64url') : null } };
    });
    // Resolve the observation owner from the account store, never from an asset.
    // Missing/deleted accounts have an honest unavailable name; subjects stay private.
    const names = new Map();
    for (const observation of result.observations) {
      const owner = observation._owner;
      if (!names.has(owner)) {
        let name = null;
        if (owner?.startsWith('staff:') && auth.db?.prepare) {
          // id and role are required by the existing encrypted-name read adapter.
          const account = await auth.db.prepare('SELECT id,name,role FROM users WHERE id=?').get(owner.slice(6));
          if (account?.role === 'Botanist') name = string(account.name);
        }
        names.set(owner, name);
      }
      observation.recorded_by = names.get(owner);
      delete observation._owner;
    }
    res.json(result);
  });
  app.get('/api/plants/:plantId/detail/assets/:assetId', allow('plants.detail.read'), async (req, res) => {
    const asset = await snapshot(pool, async c => {
      await detailParent(c, req.params.plantId, req.user);
      const row = (await c.query(`SELECT a.content_type,a.content FROM plant_asset a
        JOIN plant_observation o ON o.id=a.observation_id AND o.plant_id=a.plant_id
        WHERE a.id=$1 AND a.plant_id=$2 AND a.species_id IS NULL AND a.content_type IN ('image/jpeg','image/png')`,
      [req.params.assetId, req.params.plantId])).rows[0];
      if (!row) fail(404, 'Photo unavailable.');
      return row;
    });
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.type(asset.content_type).end(asset.content);
  });
}
module.exports = { mountPlantDetail, detailParent };
