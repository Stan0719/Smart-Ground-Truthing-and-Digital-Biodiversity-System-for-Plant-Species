"use strict";
const invalid = () => { throw Object.assign(Error("Invalid Plant registry query."), { status: 400 }); };
const validId = value => typeof value === "string" && /^[1-9][0-9]{0,9}$/.test(value) && Number(value) <= 2147483647;
function options(query) {
  if (Object.keys(query).some(key => !["q", "species", "cursor"].includes(key))) invalid();
  const q = query.q ?? "", species = query.species ?? "";
  if (typeof q !== "string" || q.length > 200 || typeof species !== "string" || (species && !validId(species))) invalid();
  const filters = { q: q.trim(), species };
  let before = null;
  if (query.cursor !== undefined) {
    try {
      if (typeof query.cursor !== "string" || query.cursor.length > 2048) invalid();
      const value = JSON.parse(Buffer.from(query.cursor, "base64url").toString());
      if (value.v !== 1 || !validId(value.before) || JSON.stringify(value.filters) !== JSON.stringify(filters)) invalid();
      before = value.before;
    } catch { invalid(); }
  }
  return { filters, before };
}
function mountOfficerPlants(app, { pool, allow }) {
  // Separate listing contract: no catalogue history/photo enrichment or writes.
  app.get('/api/officer/plants', allow('observations.review'), async (req, res) => {
    const { filters, before } = options(req.query);
    const rows = (await pool.query(`SELECT p.plant_id::text AS id,p.species_id::text AS species_id,
      coalesce(p.scientific_name, s.scientific_name) AS scientific_name,s.scientific_name AS species_scientific_name,s.common_name,p.rbac_status AS status,p.registered_at,
      (SELECT q.qr_id::text FROM plant_app.qr_code q WHERE q.plant_id=p.plant_id AND q.qr_code=p.qr_token LIMIT 1) AS qr_id,
      (SELECT q.status FROM plant_app.qr_code q WHERE q.plant_id=p.plant_id AND q.qr_code=p.qr_token LIMIT 1) AS qr_status,
      initial.id AS registration_id,
      EXISTS(SELECT 1 FROM plant_observation o WHERE o.plant_id=p.plant_id AND o.status='Approved'
        AND jsonb_typeof(o.content->'latitude')='number' AND jsonb_typeof(o.content->'longitude')='number'
        AND CASE WHEN jsonb_typeof(o.content->'latitude')='number' THEN (o.content->>'latitude')::numeric BETWEEN -90 AND 90 ELSE false END
        AND CASE WHEN jsonb_typeof(o.content->'longitude')='number' THEN (o.content->>'longitude')::numeric BETWEEN -180 AND 180 ELSE false END) AS has_location
      FROM plant_record p JOIN species s ON s.species_id=p.species_id
      LEFT JOIN LATERAL (SELECT id FROM plant_observation o WHERE o.plant_id=p.plant_id
        AND o.origin_type='initial_registration' ORDER BY o.created_at,o.id LIMIT 1) initial ON true
      WHERE p.rbac_status='Approved' AND ($1::integer IS NULL OR p.species_id=$1)
        AND ($2::integer IS NULL OR p.plant_id<$2)
        AND ($3::text='' OR lower('PL'||lpad(p.plant_id::text,greatest(3,length(p.plant_id::text)),'0'))=lower($3)
          OR p.plant_id::text=$3 OR strpos(lower(coalesce(p.scientific_name,'')||' '||s.scientific_name||' '||coalesce(s.common_name,'')),lower($3))>0
          OR EXISTS(SELECT 1 FROM plant_app.qr_code q WHERE q.plant_id=p.plant_id
            AND (q.qr_id::text=$3 OR lower('QR-'||lpad(q.qr_id::text,greatest(4,length(q.qr_id::text)),'0'))=lower($3))))
      ORDER BY p.plant_id DESC LIMIT 26`, [filters.species || null, before, filters.q])).rows;
    const hasMore = rows.length > 25, page = rows.slice(0, 25);
    const species = (await pool.query(`SELECT DISTINCT s.species_id::text AS id,s.scientific_name AS name
      FROM species s JOIN plant_record p ON p.species_id=s.species_id AND p.rbac_status='Approved' ORDER BY name,id`)).rows;
    res.json({ plants: page, species, page: { limit: 25, has_more: hasMore,
      next_cursor: hasMore ? Buffer.from(JSON.stringify({ v: 1, before: page.at(-1).id, filters })).toString('base64url') : null } });
  });
}
module.exports = { mountOfficerPlants, options };
