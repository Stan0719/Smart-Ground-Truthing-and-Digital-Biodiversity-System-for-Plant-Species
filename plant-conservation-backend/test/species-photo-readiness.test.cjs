"use strict";
// Isolated PGlite schema. Never uses environment configuration or live pools.
const test = require("node:test"),
  assert = require("node:assert/strict");
const { readFileSync } = require("node:fs"),
  { join } = require("node:path"),
  { once } = require("node:events");
const { createPlantDatabase } = require("./postgres-fixture.cjs");
const { useVerifiedPhotoKeyTypes } = require("./species-photo-bigint-fixture.cjs");
const { inspectPhotoSchema } = require("../species-photo-readiness.cjs");
const { createPlantApp } = require("../server.js");
const migration = (name) =>
  readFileSync(join(__dirname, "../migrations", name), "utf8");
test("plant_app migration compatibility and fail-closed activation use runtime catalog evidence", async (t) => {
  const pool = await createPlantDatabase();
  t.after(() => pool.end());
  await pool.query(
    "CREATE SCHEMA plant_app; SET search_path TO plant_app,pg_catalog;",
  );
  await pool.query(
    readFileSync(join(__dirname, "../schema.postgres.sql"), "utf8"),
  );
  for (const name of [
    "004-species-requests.sql",
    "006-atomic-plant-submissions.sql",
    "008-record-change-submissions.sql",
    "009-record-version-history.sql",
  ])
    await pool.query(migration(name));
  await useVerifiedPhotoKeyTypes(pool);
  await pool.query(
    "INSERT INTO species(scientific_name) VALUES('Existing'); INSERT INTO rbac_species_visibility VALUES(1,'public'); INSERT INTO plant_asset(id,species_id,owner_subject,client_key,approved,content_type,content) VALUES('a',1,'staff:officer','a',TRUE,'image/jpeg',decode('1234','hex')),('b',1,'staff:officer','b',TRUE,'image/png',decode('5678','hex'))",
  );
  const before = (
    await pool.query("SELECT id,content FROM plant_asset ORDER BY id")
  ).rows;
  await t.test(
    "missing, partially deployed and complete migrations are distinguished",
    async () => {
      const absent = await inspectPhotoSchema(pool);
      assert.equal(absent.migration014, "verified-absent");
      assert.equal(absent.schemaReady, false);
      await pool.query(migration("014-species-image-gallery.sql"));
      const partial = await inspectPhotoSchema(pool);
      assert.equal(
        partial.migration014,
        "verified-applied",
        JSON.stringify(partial),
      );
      assert.equal(partial.migration015, "verified-absent");
      assert.equal(partial.schemaReady, false);
      await pool.query(migration("015-species-photo-roles.sql"));
      const ready = await inspectPhotoSchema(pool);
      assert.equal(ready.schemaReady, true, JSON.stringify(ready));
      assert.deepEqual(
        (await pool.query(`SELECT table_name,data_type FROM information_schema.columns
          WHERE table_schema='plant_app' AND column_name='species_id'
            AND table_name IN ('rbac_species_visibility','record_change_submission')
          ORDER BY table_name`)).rows,
        [
          { table_name: "rbac_species_visibility", data_type: "bigint" },
          { table_name: "record_change_submission", data_type: "integer" },
        ],
      );
      assert.deepEqual(
        (await pool.query("SELECT id,content FROM plant_asset ORDER BY id"))
          .rows,
        before,
      );
    },
  );
  await t.test(
    "nullable BIGINT species taxonomy keys pass; missing or INTEGER keys deny readiness",
    async () => {
      assert.deepEqual(
        (await pool.query(`SELECT column_name,data_type,is_nullable
          FROM information_schema.columns
          WHERE table_schema='plant_app' AND table_name='species'
            AND column_name IN ('genus_id','status_id')
          ORDER BY column_name`)).rows,
        [
          { column_name: "genus_id", data_type: "bigint", is_nullable: "YES" },
          { column_name: "status_id", data_type: "bigint", is_nullable: "YES" },
        ],
      );
      assert.deepEqual(
        (await pool.query("SELECT genus_id,status_id FROM species WHERE species_id=1")).rows,
        [{ genus_id: null, status_id: null }],
      );
      assert.equal((await inspectPhotoSchema(pool)).schemaReady, true);
      // Fixed test identifiers only. Rename simulates a missing required column
      // without removing its data or constraints; finally restores each fixture.
      for (const column of ["genus_id", "status_id"]) {
        for (const [breakSql, repairSql] of [
          [
            `ALTER TABLE species ALTER COLUMN ${column} TYPE INTEGER`,
            `ALTER TABLE species ALTER COLUMN ${column} TYPE BIGINT`,
          ],
          [
            `ALTER TABLE species RENAME COLUMN ${column} TO unavailable_taxonomy_key`,
            `ALTER TABLE species RENAME COLUMN unavailable_taxonomy_key TO ${column}`,
          ],
        ]) {
          await pool.query(breakSql);
          try {
            const result = await inspectPhotoSchema(pool);
            assert.equal(result.schemaReady, false);
            assert.deepEqual(result.issues, [`column:species.${column}`]);
            assert.equal(result.migration014, "verified-applied");
            assert.equal(result.migration015, "verified-applied");
          } finally {
            await pool.query(repairSql);
          }
          assert.equal((await inspectPhotoSchema(pool)).schemaReady, true);
        }
      }
    },
  );
  await t.test(
    "014 and 015 are one-time migrations: re-execution fails without destroying data",
    async () => {
      for (const name of [
        "014-species-image-gallery.sql",
        "015-species-photo-roles.sql",
      ]) {
        await assert.rejects(pool.query(migration(name)));
        await pool.query("ROLLBACK");
        assert.deepEqual(
          (await pool.query("SELECT id,content FROM plant_asset ORDER BY id"))
            .rows,
          before,
        );
      }
      assert.equal((await inspectPhotoSchema(pool)).schemaReady, true);
    },
  );
  await t.test(
    "RLS, trigger, index and runtime schema drift each deny readiness",
    async () => {
      for (const [breakSql, repairSql] of [
        [
          "ALTER TABLE rbac_species_visibility ALTER COLUMN species_id TYPE INTEGER",
          "ALTER TABLE rbac_species_visibility ALTER COLUMN species_id TYPE BIGINT",
        ],
        [
          "ALTER TABLE record_change_submission ALTER COLUMN species_id TYPE BIGINT",
          "ALTER TABLE record_change_submission ALTER COLUMN species_id TYPE INTEGER",
        ],
        [
          "ALTER TABLE species_image_collection ALTER COLUMN species_id TYPE INTEGER",
          "ALTER TABLE species_image_collection ALTER COLUMN species_id TYPE BIGINT",
        ],
        [
          "ALTER TABLE plant_asset_photo_role ALTER COLUMN plant_id TYPE INTEGER",
          "ALTER TABLE plant_asset_photo_role ALTER COLUMN plant_id TYPE BIGINT",
        ],
        [
          "ALTER TABLE species_image_reference DISABLE ROW LEVEL SECURITY",
          "ALTER TABLE species_image_reference ENABLE ROW LEVEL SECURITY",
        ],
        [
          "ALTER TABLE species_image_arrangement_history DISABLE TRIGGER species_image_history_no_mutation",
          "ALTER TABLE species_image_arrangement_history ENABLE TRIGGER species_image_history_no_mutation",
        ],
        [
          "ALTER INDEX species_photo_whole_plant RENAME TO wrong_index",
          "ALTER INDEX wrong_index RENAME TO species_photo_whole_plant",
        ],
        [
          "SET search_path TO public,pg_catalog",
          "SET search_path TO plant_app,pg_catalog",
        ],
      ]) {
        await pool.query(breakSql);
        assert.equal((await inspectPhotoSchema(pool)).schemaReady, false);
        await pool.query(repairSql);
      }
      assert.equal((await inspectPhotoSchema(pool)).schemaReady, true);
    },
  );
  await t.test(
    "runtime role grants and RLS are checked rather than inferred from SQL Editor ownership",
    async () => {
      await pool.query(
        "CREATE ROLE photo_readiness_reader; GRANT USAGE ON SCHEMA plant_app TO photo_readiness_reader; GRANT SELECT ON ALL TABLES IN SCHEMA plant_app TO photo_readiness_reader; SET ROLE photo_readiness_reader",
      );
      try {
        const result = await inspectPhotoSchema(pool);
        assert.equal(result.schemaReady, false);
        assert.ok(
          result.issues.some((issue) =>
            issue.startsWith("rls_requires_review:"),
          ),
        );
      } finally {
        await pool.query("RESET ROLE");
      }
      assert.equal((await inspectPhotoSchema(pool)).schemaReady, true);
    },
  );
  await t.test(
    "manual verification artifact executes only SELECT statements",
    async () => {
      const sql = readFileSync(
        join(__dirname, "../docs/species-photo-schema-verification.sql"),
        "utf8",
      );
      for (const statement of sql
        .replace(/--[^\n]*/g, "")
        .split(";")
        .filter((text) => text.trim()))
        assert.match(statement.trim(), /^SELECT\b/i);
      await pool.query(sql);
    },
  );
  await t.test(
    "registered PUT needs BOTH explicit activation and verified plant_app metadata",
    async () => {
      const officer = {
        id: "officer",
        role: "Conservation Officer",
        status: "Active",
        mustChangePassword: false,
      };
      for (const enabled of [false, true]) {
        const auth = {
          event: async () => {},
          session: async (token) =>
            token === "1".repeat(64)
              ? officer
              : { ...officer, role: "Administrator" },
        };
        const server = createPlantApp({
          pool,
          auth,
          origins: new Set(["http://localhost:5173"]),
          speciesPhotoWritesEnabled: enabled,
        }).listen(0, "127.0.0.1");
        await once(server, "listening");
        try {
          const base = `http://127.0.0.1:${server.address().port}/api`;
          const headers = {
            "Content-Type": "application/json",
            Authorization: `Bearer ${"1".repeat(64)}`,
          };
          const preflight = await fetch(`${base}/species/1/images`, {
            method: "OPTIONS",
            headers: {
              Origin: "http://localhost:5173",
              "Access-Control-Request-Method": "PUT",
            },
          });
          assert.equal(preflight.status, 204);
          assert.match(
            preflight.headers.get("access-control-allow-methods"),
            /\bPUT\b/,
          );
          const cap = await (
            await fetch(`${base}/species/photos/capabilities`, { headers })
          ).json();
          assert.equal(cap.writesEnabled, enabled);
          const put = await fetch(`${base}/species/1/images`, {
            method: "PUT",
            headers,
            body: JSON.stringify({
              expectedRevision: 0,
              orderedAssetIds: ["b", "a"],
              primaryAssetId: "b",
              removedAssetIds: [],
            }),
          });
          assert.equal(put.status, enabled ? 200 : 503);
          if (enabled) {
            const service =
              await import("../../web/src/services/speciesManagement.ts");
            const sharp = require("sharp");
            const png = await sharp({
              create: { width: 3, height: 3, channels: 3, background: "green" },
            })
              .png()
              .toBuffer();
            const files = [
              {
                id: "new-file",
                clientKey: "offline-real-backend-file",
                file: new File([png], "reference.png", { type: "image/png" }),
                url: "blob:offline-only",
                status: "queued",
              },
            ];
            const nativeFetch = globalThis.fetch;
            globalThis.fetch = (url, options = {}) =>
              nativeFetch(
                typeof url === "string" && url.startsWith("/api")
                  ? `http://127.0.0.1:${server.address().port}${url}`
                  : url,
                { ...options, headers: { ...options.headers, ...headers } },
              );
            try {
              const baseline = await service.readSpeciesGallery("1");
              const saved = await service.persistSpeciesPhotoBatch(
                "1",
                baseline,
                files,
                "new-file",
                null,
              );
              assert.equal(saved.complete, true);
              assert.equal(saved.snapshot.primaryAssetId, files[0].assetId);
              const canonical = await service.readSpeciesGallery("1");
              const draft = {
                ...service.createSpeciesGalleryDraft(canonical),
                orderedAssetIds: ["b", "a"],
                primaryAssetId: null,
                removedAssetIds: [files[0].assetId],
              };
              const removed = await service.persistSpeciesPhotoBatch(
                "1",
                canonical,
                [],
                null,
                draft,
              );
              assert.equal(removed.snapshot.primaryAssetId, null);
              assert.equal(
                (await globalThis.fetch(`/api/assets/${files[0].assetId}`))
                  .status,
                404,
              );
              assert.ok(
                (
                  await pool.query(
                    "SELECT octet_length(content) AS n FROM plant_asset WHERE id=$1",
                    [files[0].assetId],
                  )
                ).rows[0].n > 0,
              );
              const retry = await globalThis.fetch("/api/assets", {
                method: "POST",
                body: JSON.stringify({
                  species_id: 1,
                  client_key: files[0].clientKey,
                  content_type: "image/png",
                  base64: png.toString("base64"),
                }),
              });
              assert.equal((await retry.json()).id, files[0].assetId);
              const red = await sharp({
                create: { width: 3, height: 3, channels: 3, background: "red" },
              })
                .png()
                .toBuffer();
              const changed = await globalThis.fetch("/api/assets", {
                method: "POST",
                body: JSON.stringify({
                  species_id: 1,
                  client_key: files[0].clientKey,
                  content_type: "image/png",
                  base64: red.toString("base64"),
                }),
              });
              assert.equal(changed.status, 409);
            } finally {
              globalThis.fetch = nativeFetch;
            }
          }
          const denied = await fetch(`${base}/species/1/images`, {
            method: "PUT",
            headers: { ...headers, Authorization: `Bearer ${"2".repeat(64)}` },
            body: "{}",
          });
          assert.equal(denied.status, 403);
        } finally {
          server.closeAllConnections();
          await new Promise((resolve) => server.close(resolve));
        }
      }
    },
  );
});
