"use strict";
// Metadata only. Reuses the supplied pool/client; never loads configuration or DDL.
const groups = {
  migration014: {
    species_image_collection: {
      species_id: "bigint",
      revision: "bigint",
      updated_at: "timestamp with time zone",
      updated_by: "text",
    },
    species_image_reference: {
      species_id: "bigint",
      asset_id: "text",
      position: "integer",
      is_primary: "boolean",
      added_at: "timestamp with time zone",
      added_by: "text",
      removed_at: "timestamp with time zone",
      removed_by: "text",
    },
    species_image_arrangement_history: {
      id: "bigint",
      species_id: "bigint",
      previous_revision: "bigint",
      new_revision: "bigint",
      previous_arrangement: "jsonb",
      new_arrangement: "jsonb",
      operation: "text",
      actor: "text",
      created_at: "timestamp with time zone",
    },
  },
  migration015: {
    plant_asset_photo_role: {
      asset_id: "text",
      plant_id: "bigint",
      observation_id: "text",
      role: "text",
      recorded_by: "text",
      created_at: "timestamp with time zone",
    },
    species_request_proposed_image: {
      request_id: "integer",
      asset_id: "text",
      role: "text",
    },
  },
};
const prerequisites = {
  species: {
    species_id: "bigint",
    rbac_data: "jsonb",
    scientific_name: "text",
    common_name: "text",
    genus_id: "bigint",
    status_id: "bigint",
    description: "text",
  },
  plant_asset: {
    id: "text",
    species_id: "bigint",
    plant_id: "bigint",
    observation_id: "text",
    owner_subject: "text",
    client_key: "text",
    approved: "boolean",
    content_type: "text",
    content: "bytea",
    created_at: "timestamp with time zone",
  },
  plant_observation: {
    id: "text",
    plant_id: "bigint",
    status: "text",
    owner_subject: "text",
    content: "jsonb",
    revision: "integer",
    updated_at: "timestamp with time zone",
  },
  plant_record: {
    plant_id: "bigint",
    species_id: "bigint",
    rbac_status: "text",
    registered_subject: "text",
  },
  species_request_submission: {
    request_id: "integer",
    proposed_species_id: "bigint",
    approved_species_id: "integer",
    photo: "bytea",
    photo_asset_id: "text",
    owner_subject: "text",
    client_key: "text",
    request_status: "text",
    scientific_name: "text",
    common_name: "text",
    genus_name: "text",
    family_name: "text",
    conservation_status: "text",
    description: "text",
    habitat: "text",
  },
  plant_submission_receipt: {
    owner_subject: "text",
    client_key: "text",
    result: "jsonb",
  },
  record_change_submission: { id: "text", species_id: "integer" },
  record_version_history: {
    id: "text",
    request_id: "integer",
    snapshot: "jsonb",
    species_photo: "bytea",
  },
  rbac_species_visibility: { species_id: "bigint", visibility: "text" },
};
const constraintRules = [
  ["migration014", "plant_asset", "unique (species_id, id)"],
  [
    "migration014",
    "species_request_submission",
    "foreign key (photo_asset_id) references plant_asset(id)",
  ],
  ["migration014", "species_image_collection", "primary key (species_id)"],
  [
    "migration014",
    "species_image_collection",
    "foreign key (species_id) references species(species_id)",
  ],
  ["migration014", "species_image_collection", "revision >= 0"],
  [
    "migration014",
    "species_image_reference",
    "primary key (species_id, asset_id)",
  ],
  [
    "migration014",
    "species_image_reference",
    "foreign key (species_id) references species_image_collection(species_id)",
  ],
  [
    "migration014",
    "species_image_reference",
    "foreign key (species_id, asset_id) references plant_asset(species_id, id)",
  ],
  [
    "migration014",
    "species_image_reference",
    'unique (species_id, "position") deferrable initially deferred',
  ],
  [
    "migration014",
    "species_image_reference",
    "removed_at is null",
    "removed_by is null",
    "position is not null",
    "position >= 0",
    "removed_at is not null",
    "removed_by is not null",
    "position is null",
    "not is_primary",
  ],
  ["migration014", "species_image_arrangement_history", "primary key (id)"],
  [
    "migration014",
    "species_image_arrangement_history",
    "foreign key (species_id) references species_image_collection(species_id)",
  ],
  [
    "migration014",
    "species_image_arrangement_history",
    "unique (species_id, new_revision)",
  ],
  [
    "migration014",
    "species_image_arrangement_history",
    "new_revision = (previous_revision + 1)",
  ],
  [
    "migration014",
    "species_image_arrangement_history",
    "request-photo",
    "upload",
    "save",
  ],
  ["migration015", "plant_asset", "unique (id, plant_id)"],
  ["migration015", "plant_observation", "unique (id, plant_id)"],
  ["migration015", "plant_asset_photo_role", "primary key (asset_id)"],
  [
    "migration015",
    "plant_asset_photo_role",
    "foreign key (asset_id, plant_id) references plant_asset(id, plant_id)",
  ],
  [
    "migration015",
    "plant_asset_photo_role",
    "foreign key (observation_id, plant_id) references plant_observation(id, plant_id)",
  ],
  ["migration015", "plant_asset_photo_role", "unique (asset_id, role)"],
  [
    "migration015",
    "plant_asset_photo_role",
    "whole_plant",
    "leaf_close_up",
    "stem_bark",
    "flower_fruit",
    "additional",
  ],
  [
    "migration015",
    "species_request_proposed_image",
    "primary key (request_id)",
  ],
  [
    "migration015",
    "species_request_proposed_image",
    "foreign key (request_id) references species_request_submission(request_id)",
  ],
  [
    "migration015",
    "species_request_proposed_image",
    "foreign key (asset_id, role) references plant_asset_photo_role(asset_id, role)",
  ],
  ["migration015", "species_request_proposed_image", "role = 'whole_plant'"],
];
const indexRules = {
  species_image_primary: [
    "migration014",
    "unique",
    "(species_id)",
    "where is_primary",
  ],
  species_photo_plant_source: [
    "migration015",
    "(species_id, plant_id)",
    "'approved'",
  ],
  species_photo_approved_observation: [
    "migration015",
    "(plant_id, id)",
    "'approved'",
  ],
  species_photo_direct_order: [
    "migration015",
    "(species_id, created_at desc, id)",
    "approved",
    "image/jpeg",
    "image/png",
  ],
  species_photo_evidence_order: [
    "migration015",
    "(plant_id, observation_id, created_at desc, id)",
  ],
  species_photo_whole_plant: [
    "migration015",
    "(plant_id, observation_id, asset_id)",
    "'whole_plant'",
  ],
};
const normalize = (text) =>
  String(text)
    .toLowerCase()
    .replace(/plant_app\./g, "")
    .replaceAll('"', "")
    .replace(/\s*=\s*/g, "=")
    .replace(/\s+/g, " ")
    .trim();
function assess(catalog) {
  const issues = [],
    failed = { migration014: [], migration015: [] };
  const tables = new Map(catalog.tables.map((row) => [row.name, row]));
  const columns = new Map(
    catalog.columns.map((row) => [`${row.table}.${row.name}`, row]),
  );
  for (const [group, entries] of Object.entries({ prerequisites, ...groups }))
    for (const [table, fields] of Object.entries(entries))
      for (const [name, type] of Object.entries(fields)) {
        if (columns.get(`${table}.${name}`)?.type !== type)
          (failed[group] || issues).push(`column:${table}.${name}`);
        if (
          group !== "prerequisites" &&
          !["position", "removed_at", "removed_by"].includes(name) &&
          !columns.get(`${table}.${name}`)?.required
        )
          failed[group].push(`not_null:${table}.${name}`);
      }
  for (const [table, ...fragments] of [
    ["plant_asset", "unique (owner_subject, client_key)"],
    ["plant_asset", "primary key (id)"],
    ["plant_asset", "species_id is null", "<>", "plant_id is null"],
    ["plant_asset", "octet_length(content) <= 4194304"],
    ["plant_asset", "foreign key (species_id) references species(species_id)"],
    ["plant_asset", "foreign key (plant_id) references plant_record(plant_id)"],
    [
      "plant_asset",
      "foreign key (observation_id) references plant_observation(id)",
    ],
    ["species", "primary key (species_id)"],
    ["plant_observation", "primary key (id)"],
    [
      "plant_observation",
      "foreign key (plant_id) references plant_record(plant_id)",
    ],
    ["plant_record", "foreign key (species_id) references species(species_id)"],
    [
      "species_request_submission",
      "foreign key (proposed_species_id) references species(species_id)",
    ],
    [
      "species_request_submission",
      "foreign key (approved_species_id) references species(species_id)",
    ],
    ["plant_submission_receipt", "primary key (owner_subject, client_key)"],
  ])
    if (
      !catalog.constraints.some(
        (row) =>
          row.table === table &&
          row.valid &&
          fragments.every((fragment) =>
            normalize(row.definition).includes(normalize(fragment)),
          ),
      )
    )
      issues.push(`prerequisite_constraint:${table}:${fragments[0]}`);
  for (const [group, table, ...fragments] of constraintRules)
    if (
      !catalog.constraints.some(
        (row) =>
          row.table === table &&
          row.valid &&
          fragments.every((fragment) =>
            normalize(row.definition).includes(normalize(fragment)),
          ),
      )
    )
      failed[group].push(`constraint:${table}:${fragments[0]}`);
  for (const [name, [group, ...fragments]] of Object.entries(indexRules))
    if (
      !catalog.indexes.some(
        (row) =>
          row.name === name &&
          row.valid &&
          row.ready &&
          fragments.every((fragment) =>
            normalize(row.definition).includes(normalize(fragment)),
          ),
      )
    )
      failed[group].push(`index:${name}`);
  const history = catalog.triggers.find(
    (row) =>
      row.name === "species_image_history_no_mutation" &&
      row.table === "species_image_arrangement_history",
  );
  if (
    !history ||
    !["O", "A"].includes(history.enabled) ||
    !normalize(history.definition).includes("before delete or update") ||
    !normalize(history.body).includes(
      "raise exception 'species image arrangement history is append-only'",
    )
  )
    failed.migration014.push("trigger:history");
  const role = catalog.triggers.find(
    (row) =>
      row.name === "photo_role_origin" &&
      row.table === "plant_asset_photo_role",
  );
  if (
    !role ||
    !["O", "A"].includes(role.enabled) ||
    !["insert", "update", "delete"].every((event) =>
      normalize(role.definition).includes(event),
    ) ||
    ![
      "immutable",
      "a.observation_id = new.observation_id",
      "a.owner_subject = new.recorded_by",
      "a.species_id is null",
    ].every((fragment) => normalize(role.body).includes(normalize(fragment)))
  )
    failed.migration015.push("trigger:role");
  for (const [group, entries] of Object.entries(groups))
    for (const table of Object.keys(entries))
      if (!tables.get(table)?.rls) failed[group].push(`rls:${table}`);
  for (const row of catalog.tables) {
    if (!row.can_select) issues.push(`select:${row.name}`);
    if (row.rls && !row.bypass && !(row.owned && !row.force_rls))
      issues.push(`rls_requires_review:${row.name}`);
  }
  for (const table of [
    "species",
    "plant_asset",
    "species_request_submission",
    "species_image_collection",
    "species_image_reference",
  ])
    if (!tables.get(table)?.can_update) issues.push(`update:${table}`);
  for (const table of [
    "plant_asset",
    "species_image_collection",
    "species_image_reference",
    "species_image_arrangement_history",
    "plant_asset_photo_role",
    "species_request_proposed_image",
  ])
    if (!tables.get(table)?.can_insert) issues.push(`insert:${table}`);
  if (!catalog.session.schema_usage) issues.push("schema_usage");
  if (catalog.session.schema !== "plant_app")
    issues.push("wrong_runtime_schema");
  if (!catalog.sequence?.can_use) issues.push("history_sequence_usage");
  const status = {};
  for (const group of Object.keys(groups)) {
    const present =
      Object.keys(groups[group]).some((table) => tables.has(table)) ||
      Object.entries(indexRules).some(
        ([name, rule]) =>
          rule[0] === group && catalog.indexes.some((row) => row.name === name),
      ) ||
      (group === "migration014" &&
        columns.has("species_request_submission.photo_asset_id")) ||
      catalog.constraints.some(
        (row) =>
          row.table === "plant_asset" &&
          normalize(row.definition).includes(
            group === "migration014"
              ? "unique (species_id, id)"
              : "unique (id, plant_id)",
          ),
      );
    status[group] = !present
      ? "verified-absent"
      : failed[group].length
        ? "partially-present"
        : "verified-applied";
    issues.push(...failed[group]);
  }
  return {
    schemaReady: issues.length === 0,
    migration014: status.migration014,
    migration015: status.migration015,
    issues,
  };
}
async function inspectPhotoSchema(pool) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const names = Object.keys({
      ...prerequisites,
      ...groups.migration014,
      ...groups.migration015,
    });
    const session = (
      await c.query(
        "SELECT current_schema() AS schema,CASE WHEN to_regnamespace('plant_app') IS NOT NULL THEN has_schema_privilege('plant_app','USAGE') ELSE FALSE END AS schema_usage",
      )
    ).rows[0];
    const tables = (
      await c.query(
        `SELECT c.relname AS name,c.relrowsecurity AS rls,c.relforcerowsecurity AS force_rls,c.relowner=r.oid AS owned,r.rolsuper OR r.rolbypassrls AS bypass,
      has_table_privilege(c.oid,'SELECT') AS can_select,has_table_privilege(c.oid,'INSERT') AS can_insert,has_table_privilege(c.oid,'UPDATE') AS can_update
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN pg_roles r WHERE n.nspname='plant_app' AND c.relkind='r' AND r.rolname=current_user AND c.relname=ANY($1::text[])`,
        [names],
      )
    ).rows;
    const columns = (
      await c.query(
        `SELECT c.relname AS table,a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS required
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='plant_app' AND a.attnum>0 AND NOT a.attisdropped AND c.relname=ANY($1::text[])`,
        [names],
      )
    ).rows;
    const constraints = (
      await c.query(
        `SELECT c.relname AS table,k.convalidated AS valid,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='plant_app'`,
      )
    ).rows;
    const indexes = (
      await c.query(
        `SELECT ci.relname AS name,i.indisvalid AS valid,i.indisready AS ready,pg_get_indexdef(i.indexrelid) AS definition FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_class ci ON ci.oid=i.indexrelid WHERE n.nspname='plant_app'`,
      )
    ).rows;
    const triggers = (
      await c.query(
        `SELECT c.relname AS table,t.tgname AS name,t.tgenabled AS enabled,pg_get_triggerdef(t.oid) AS definition,pg_get_functiondef(t.tgfoid) AS body FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='plant_app' AND NOT t.tgisinternal`,
      )
    ).rows;
    const sequence = (
      await c.query(
        `SELECT has_sequence_privilege(pg_get_serial_sequence('plant_app.species_image_arrangement_history','id'),'USAGE') AS can_use FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='plant_app' AND c.relname='species_image_arrangement_history'`,
      )
    ).rows[0];
    const result = assess({
      session,
      tables,
      columns,
      constraints,
      indexes,
      triggers,
      sequence,
    });
    await c.query("COMMIT");
    return result;
  } catch (error) {
    await c.query("ROLLBACK").catch(() => {});
    return {
      schemaReady: false,
      migration014: "not-verified",
      migration015: "not-verified",
      issues: ["metadata_unavailable"],
    };
  } finally {
    c.release();
  }
}
module.exports = { inspectPhotoSchema, assess };
