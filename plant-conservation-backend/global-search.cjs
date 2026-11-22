"use strict";

const { createHash } = require("node:crypto");
const { permitted, catalogueVisibilityFor, canReadScientificCatalogue } = require("../shared/rbac.cjs");

const MODEL = "translategemma:4b";
const MAX_LIMIT = 20;
const MAX_OFFSET = 200;
const digest = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const nonEmpty = (value) => typeof value === "string" ? value.trim() : "";
const excerpt = (value, length = 160) => {
  const clean = nonEmpty(value).replace(/\s+/g, " ");
  return clean.length > length ? `${clean.slice(0, length - 1).trimEnd()}…` : clean;
};

const pageDefinitions = [
  { path: "/", labels: ["Home", "Laman Utama", "首页"], terms: ["home", "welcome", "laman utama", "首页"] },
  { path: "/species", labels: ["Explore Species", "Teroka Spesies", "探索物种"], terms: ["species", "explore", "spesies", "teroka", "物种", "探索"] },
  { path: "/conservation/dashboard", role: "Conservation Officer", labels: ["Conservation Dashboard", "Papan Pemuka Pemuliharaan", "保护工作台"], terms: ["conservation dashboard", "dashboard", "pemuliharaan", "保护工作台"] },
  { path: "/conservation/species", role: "Conservation Officer", labels: ["Plant Species", "Spesies Tumbuhan", "植物物种"], terms: ["plant species", "knowledge base", "spesies tumbuhan", "植物物种"] },
  { path: "/conservation/observations", role: "Conservation Officer", labels: ["Observations", "Pemerhatian", "观察记录"], terms: ["observation", "observations", "pemerhatian", "观察"] },
  { path: "/conservation/reviews", role: "Conservation Officer", labels: ["Review Submissions", "Semakan Penyerahan", "审核提交"], terms: ["review", "submissions", "semakan", "审核", "提交"] },
  { path: "/conservation/map", role: "Conservation Officer", labels: ["Biodiversity Map", "Peta Biodiversiti", "生物多样性地图"], terms: ["biodiversity map", "map", "peta biodiversiti", "地图", "生物多样性"] },
  { path: "/conservation/iot", role: "Conservation Officer", labels: ["IoT Monitoring", "Pemantauan IoT", "物联网监测"], terms: ["iot", "monitoring", "pemantauan", "物联网", "监测"] },
  { path: "/conservation/alerts", role: "Conservation Officer", labels: ["Threat Alerts", "Amaran Ancaman", "威胁警报"], terms: ["threat", "alerts", "amaran", "ancaman", "威胁", "警报"] },
  { path: "/conservation/reports", role: "Conservation Officer", labels: ["Reports", "Laporan", "报告"], terms: ["reports", "report", "laporan", "报告"] },
  { path: "/admin", role: "Administrator", labels: ["Administrator Dashboard", "Papan Pemuka Pentadbir", "管理员工作台"], terms: ["admin", "administrator", "dashboard", "pentadbir", "管理员"] },
  { path: "/admin/users", role: "Administrator", labels: ["User Management", "Pengurusan Pengguna", "用户管理"], terms: ["user", "users", "management", "pengguna", "用户"] },
  { path: "/admin/roles", role: "Administrator", labels: ["Role & Permission", "Peranan & Kebenaran", "角色与权限"], terms: ["role", "permission", "peranan", "kebenaran", "角色", "权限"] },
  { path: "/admin/iot", role: "Administrator", labels: ["IoT Monitoring", "Pemantauan IoT", "物联网监测"], terms: ["iot", "monitoring", "pemantauan", "物联网", "监测"] },
  { path: "/admin/sensors", role: "Administrator", labels: ["Sensor Management", "Pengurusan Sensor", "传感器管理"], terms: ["sensor", "sensors", "management", "sensor", "传感器"] },
  { path: "/admin/activity", role: "Administrator", labels: ["System Activity", "Aktiviti Sistem", "系统活动"], terms: ["system activity", "audit", "activity", "aktiviti", "系统活动"] },
];

function pageResults(query, user, limit, locale = "en") {
  const q = query.toLocaleLowerCase();
  const labelIndex = locale === "ms" ? 1 : locale === "zh-CN" ? 2 : 0;
  return pageDefinitions
    .filter((page) => !page.role || user?.role === page.role)
    .filter((page) => page.terms.some((term) => term.includes(q) || q.includes(term)))
    .slice(0, limit)
    .map((page) => ({ id: page.path, title: page.labels[labelIndex], snippet: "", path: page.path, type: "page" }));
}

function mapSpecies(row, cachedRows, query) {
  const translations = cachedRows.filter((cached) => String(cached.record_id) === String(row.id));
  const sourceByField = {
    commonName: nonEmpty(row.common_name),
    description: nonEmpty(row.description),
    habitat: nonEmpty(row.habitat),
    culturalSignificance: nonEmpty(row.cultural_significance),
  };
  const valid = translations.find((entry) => {
    const source = sourceByField[entry.field_name];
    return source && digest(source) === entry.source_hash && nonEmpty(entry.translated_text);
  });
  const sourceMatch = [row.id, row.scientific_name, row.common_name, row.genus_name, row.family_name,
    row.description, row.habitat, row.cultural_significance, row.conservation_status]
    .some((value) => nonEmpty(value).toLocaleLowerCase().includes(query));
  if (!sourceMatch && !valid) return null;
  const localizedTitle = valid?.field_name === "commonName" ? valid.translated_text : "";
  let snippet = excerpt(row.description || row.habitat || row.cultural_significance);
  if (valid && ["description", "habitat", "culturalSignificance"].includes(valid.field_name))
    snippet = excerpt(valid.translated_text);
  return {
    id: String(row.id),
    title: localizedTitle && row.scientific_name ? `${row.scientific_name} - ${localizedTitle}` : `${row.scientific_name || row.common_name || `Species ${row.id}`}`,
    snippet,
    path: `/species/${encodeURIComponent(row.id)}`,
    type: "species",
  };
}

function mountGlobalSearch(app, { pool, allow }) {
  app.get("/api/global-search", allow("plants.catalogue.read"), async (req, res) => {
    // Website search uses the existing same-origin cookie session. Mobile bearer
    // requests keep their current API contract and cannot use this endpoint.
    if (req.headers.authorization)
      return res.status(403).json({ error: "Website search does not accept bearer credentials." });

    const rawQuery = req.query.q;
    if (typeof rawQuery !== "string") return res.status(400).json({ error: "Search term is required." });
    const query = rawQuery.trim();
    if (query.length > 100) return res.status(400).json({ error: "Search term is too long." });
    const locale = typeof req.query.locale === "string" && ["en", "ms", "zh-CN"].includes(req.query.locale)
      ? req.query.locale : "en";
    const limit = Number.isInteger(Number(req.query.limit)) ? Math.min(MAX_LIMIT, Math.max(1, Number(req.query.limit))) : 5;
    const offset = Number.isInteger(Number(req.query.offset)) ? Math.min(MAX_OFFSET, Math.max(0, Number(req.query.offset))) : 0;
    const shortNumericId = /^[0-9]$/.test(query);
    if (query.length < 2 && !shortNumericId) return res.json({ query, locale, results: { species: [], plants: [], observations: [], alerts: [], pages: [] }, counts: { species: 0, plants: 0, observations: 0, alerts: 0, pages: 0 }, hasMore: { species: false, plants: false, observations: false, alerts: false } });

    const term = query.toLocaleLowerCase();
    const visibility = catalogueVisibilityFor(req.user);
    const scientificRead = canReadScientificCatalogue(req.user);
    const pages = pageResults(query, req.user, limit, locale);
    let translatedSpecies = [];
    if (locale !== "en" && !shortNumericId) {
      const cacheFieldAllowlist = scientificRead ? ["commonName", "description", "habitat", "culturalSignificance"] : ["commonName", "description", "habitat"];
      let cachedRows = [];
      try {
        cachedRows = (await pool.query(`SELECT c.record_id,c.field_name,c.source_hash,c.translated_text
        FROM plant_translation_cache c
        JOIN plant_translation_source_language m ON m.record_type=c.record_type AND m.record_id=c.record_id
          AND m.field_name=c.field_name AND m.source_hash=c.source_hash
        WHERE c.record_type='species' AND c.source_locale='en' AND c.target_locale=$1
          AND c.model_name=$2 AND c.field_name=ANY($3::text[])
          AND strpos(lower(c.translated_text),$4)>0
        ORDER BY c.updated_at DESC LIMIT 100`, [locale, MODEL, cacheFieldAllowlist, term])).rows;
      } catch (error) {
        // Search remains usable before the optional translation-storage migration
        // is present; no source or cache rows are written here.
        if (error?.code !== "42P01") throw error;
      }
      translatedSpecies = cachedRows;
    }

    if (translatedSpecies.length) {
      const candidateIds = [...new Set(translatedSpecies.map((row) => String(row.record_id)).filter((id) => /^[1-9][0-9]{0,18}$/.test(id)))];
      const currentSources = (await pool.query(`SELECT s.species_id::text AS id,s.common_name,s.description,
          s.rbac_data->>'habitat' AS habitat,s.rbac_data->>'culturalSignificance' AS cultural_significance
        FROM species s LEFT JOIN rbac_species_visibility v ON v.species_id=s.species_id
        WHERE s.species_id=ANY($1::bigint[]) AND COALESCE(s.rbac_data->>'approvalStatus','Approved')='Approved'
          AND COALESCE(v.visibility,'protected')=ANY($2::text[])`, [candidateIds, visibility])).rows;
      const byId = new Map(currentSources.map((row) => [String(row.id), row]));
      translatedSpecies = translatedSpecies.filter((entry) => {
        const source = byId.get(String(entry.record_id));
        const field = { commonName: 'common_name', description: 'description', habitat: 'habitat', culturalSignificance: 'cultural_significance' }[entry.field_name];
        return Boolean(source && field && nonEmpty(source[field]) && digest(source[field]) === entry.source_hash);
      });
    }

    const speciesIds = [...new Set(translatedSpecies.map((row) => String(row.record_id)).filter((id) => /^[1-9][0-9]{0,18}$/.test(id)))];
    const speciesRows = (await pool.query(`SELECT s.species_id::text AS id,s.scientific_name,s.common_name,
        s.description,s.rbac_data->>'habitat' AS habitat,
        CASE WHEN $6::boolean THEN s.rbac_data->>'culturalSignificance' END AS cultural_significance,
        g.genus_name,f.family_name,cs.status_name AS conservation_status,COUNT(*) OVER()::int AS total
      FROM species s LEFT JOIN genus g ON g.genus_id=s.genus_id
      LEFT JOIN family f ON f.family_id=g.family_id
      LEFT JOIN conservation_status cs ON cs.status_id=s.status_id
      LEFT JOIN rbac_species_visibility v ON v.species_id=s.species_id
      WHERE COALESCE(s.rbac_data->>'approvalStatus','Approved')='Approved'
        AND COALESCE(v.visibility,'protected')=ANY($1::text[])
        AND (($7::boolean AND s.species_id::text=$2) OR (NOT $7::boolean AND (strpos(lower(concat_ws(' ',s.species_id::text,s.scientific_name,s.common_name,g.genus_name,f.family_name,s.description,s.rbac_data->>'habitat',
          CASE WHEN $6::boolean THEN s.rbac_data->>'culturalSignificance' END,
          CASE WHEN $6::boolean THEN cs.status_name END)),$2)>0
          OR s.species_id=ANY($5::bigint[])))
      ORDER BY (strpos(lower(s.scientific_name),$2)=1) DESC,s.scientific_name
      LIMIT $3 OFFSET $4`, [visibility, term, limit + 1, offset, speciesIds, scientificRead, shortNumericId])).rows;
    const speciesTotal = Number(speciesRows[0]?.total || 0);
    const species = speciesRows.slice(0, limit).map((row) => mapSpecies(row, translatedSpecies, term)).filter(Boolean);

    const translatedPlantSpeciesIds = [...new Set(translatedSpecies.filter((row) => row.field_name === "commonName").map((row) => String(row.record_id)).filter((id) => /^[1-9][0-9]{0,18}$/.test(id)))];
    const plantRows = (await pool.query(`SELECT p.plant_id::text AS id,p.species_id::text AS species_id,p.scientific_name AS plant_scientific_name,
        s.scientific_name,s.common_name,
        latest.content->>'morphology' AS morphology,latest.content->>'zone' AS zone,
        COUNT(*) OVER()::int AS total
      FROM plant_record p JOIN species s ON s.species_id=p.species_id
      LEFT JOIN rbac_species_visibility v ON v.species_id=s.species_id
      LEFT JOIN LATERAL (SELECT o.content FROM plant_observation o WHERE o.plant_id=p.plant_id AND o.status='Approved'
        ORDER BY o.updated_at DESC,o.id DESC LIMIT 1) latest ON TRUE
      WHERE p.rbac_status='Approved' AND COALESCE(s.rbac_data->>'approvalStatus','Approved')='Approved'
        AND COALESCE(v.visibility,'protected')=ANY($1::text[])
        AND (($7::boolean AND p.plant_id::text=$2) OR (NOT $7::boolean AND (strpos(lower(concat_ws(' ',p.plant_id::text,'PL'||lpad(p.plant_id::text,3,'0'),p.scientific_name,s.scientific_name,s.common_name,latest.content->>'morphology',
          CASE WHEN $5::boolean THEN latest.content->>'zone' END)),$2)>0 OR p.species_id=ANY($6::bigint[]))))
      ORDER BY p.plant_id LIMIT $3 OFFSET $4`, [visibility, term, limit + 1, offset, permitted(req.user, "plants.gps.exact.read"), translatedPlantSpeciesIds, shortNumericId])).rows;
    const plantTotal = Number(plantRows[0]?.total || 0);
    const plants = plantRows.slice(0, limit).map((row) => ({
      id: String(row.id), title: `PL${String(row.id).padStart(3, "0")} - ${row.plant_scientific_name || row.scientific_name || row.common_name}${translatedSpecies.find((entry) => String(entry.record_id) === String(row.species_id) && entry.field_name === "commonName")?.translated_text ? ` (${translatedSpecies.find((entry) => String(entry.record_id) === String(row.species_id) && entry.field_name === "commonName").translated_text})` : ""}`,
      snippet: excerpt(row.morphology || row.common_name), path: `/plant/${encodeURIComponent(row.id)}`, type: "plant",
    }));

    let observations = [];
    let observationTotal = 0;
    if (permitted(req.user, "plants.scientific.read")) {
      let translatedObservations = [];
      if (locale !== "en" && !shortNumericId) {
        try {
          translatedObservations = (await pool.query(`SELECT c.record_id,c.field_name,c.source_hash,c.translated_text
            FROM plant_translation_cache c JOIN plant_translation_source_language m
              ON m.record_type=c.record_type AND m.record_id=c.record_id AND m.field_name=c.field_name AND m.source_hash=c.source_hash
            WHERE c.record_type='observation' AND c.source_locale='en' AND c.target_locale=$1
              AND c.model_name=$2 AND c.field_name=ANY($3::text[]) AND strpos(lower(c.translated_text),$4)>0
            ORDER BY c.updated_at DESC LIMIT 100`, [locale, MODEL, ["morphology", "notes"], term])).rows;
        } catch (error) {
          if (error?.code !== "42P01") throw error;
        }
        if (translatedObservations.length) {
          const candidateIds = [...new Set(translatedObservations.map((row) => String(row.record_id)).filter((id) => /^[A-Za-z0-9_-]{1,200}$/.test(id)))];
          const sourceRows = (await pool.query(`SELECT o.id::text AS id,o.content->>'morphology' AS morphology,o.content->>'notes' AS notes
            FROM plant_observation o JOIN plant_record p ON p.plant_id=o.plant_id
            LEFT JOIN rbac_species_visibility v ON v.species_id=p.species_id
            WHERE o.id::text=ANY($1::text[])
              AND ($2::boolean OR o.owner_subject=$3 OR (o.status='Approved' AND COALESCE(v.visibility,'protected')=ANY($4::text[])))`,
          [candidateIds, req.user?.role === "Conservation Officer", req.user ? `${req.user.role === "Visitor" ? "visitor" : "staff"}:${req.user.id}` : "", visibility])).rows;
          const byId = new Map(sourceRows.map((row) => [String(row.id), row]));
          translatedObservations = translatedObservations.filter((entry) => {
            const source = byId.get(String(entry.record_id))?.[entry.field_name];
            return Boolean(nonEmpty(source) && digest(source) === entry.source_hash);
          });
        }
      }
      const translatedObservationIds = [...new Set(translatedObservations.map((row) => String(row.record_id)))];
      const observationRows = (await pool.query(`SELECT o.id::text AS id,o.plant_id::text AS plant_id,
          p.scientific_name AS plant_scientific_name,s.scientific_name,s.common_name,
          o.content->>'morphology' AS morphology,o.content->>'notes' AS notes,
          COUNT(*) OVER()::int AS total
        FROM plant_observation o JOIN plant_record p ON p.plant_id=o.plant_id
        JOIN species s ON s.species_id=p.species_id LEFT JOIN rbac_species_visibility v ON v.species_id=p.species_id
        WHERE ($1::boolean OR o.owner_subject=$2 OR (o.status='Approved' AND COALESCE(v.visibility,'protected')=ANY($3::text[])))
          AND (($8::boolean AND o.id::text=$4) OR (NOT $8::boolean AND (strpos(lower(concat_ws(' ',o.id::text,o.plant_id::text,'PL'||lpad(o.plant_id::text,3,'0'),p.scientific_name,s.scientific_name,s.common_name,o.content->>'morphology',o.content->>'notes')),$4)>0
            OR o.id::text=ANY($7::text[])))
        ORDER BY o.created_at DESC,o.id DESC LIMIT $5 OFFSET $6`, [req.user?.role === "Conservation Officer", req.user ? `${req.user.role === "Visitor" ? "visitor" : "staff"}:${req.user.id}` : "", visibility, term, limit + 1, offset, translatedObservationIds, shortNumericId])).rows;
      observationTotal = Number(observationRows[0]?.total || 0);
      observations = observationRows.slice(0, limit).map((row) => ({
        id: String(row.id), title: `Observation · PL${String(row.plant_id).padStart(3, "0")}`,
        snippet: excerpt(translatedObservations.find((entry) => String(entry.record_id) === String(row.id))?.translated_text || row.morphology || row.notes || row.scientific_name || row.common_name),
        path: `/conservation/observations?observation=${encodeURIComponent(row.id)}`, type: "observation",
      }));
    }

    let alerts = [];
    let alertTotal = 0;
    if (permitted(req.user, "alerts.read")) {
      const alertRows = (await pool.query(`SELECT a.id::text AS id,a.device_id,a.reading_id,a.camera_id,a.metric,a.value,a.status,a.created_at,
          COUNT(*) OVER()::int AS total
        FROM threat_alert_history a
        LEFT JOIN iot_device d ON d.id=a.device_id
        WHERE strpos(lower(concat_ws(' ',a.id,a.device_id,a.reading_id,a.camera_id,a.metric,a.value::text,a.status,d.name)),$1)>0
        ORDER BY a.created_at DESC,a.id DESC LIMIT $2 OFFSET $3`, [term, limit + 1, offset])).rows;
      alertTotal = Number(alertRows[0]?.total || 0);
      alerts = alertRows.slice(0, limit).map((row) => ({
        id: String(row.id), title: `Alert ${row.id} - ${row.metric}`,
        snippet: `${row.status} · ${row.device_id}`,
        path: req.user?.role === "Conservation Officer" ? `/conservation/alerts?alert=${encodeURIComponent(row.id)}` : "/admin/iot",
        type: "alerts",
      }));
    }

    const results = { species, plants, observations, alerts, pages };
    return res.json({ query, locale, results, counts: {
      species: speciesTotal, plants: plantTotal, observations: observationTotal, alerts: alertTotal, pages: pages.length,
    }, hasMore: { species: speciesTotal > offset + species.length, plants: plantTotal > offset + plants.length, observations: observationTotal > offset + observations.length, alerts: alertTotal > offset + alerts.length } });
  });
}

module.exports = { mountGlobalSearch, pageDefinitions, pageResults, excerpt, digest };
