"use strict";
// Disposable in-memory PGlite only. No environment loading or production SQL.
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { once } = require("node:events");
const { createPlantDatabase } = require("./postgres-fixture.cjs");
const { createReadySpeciesPhotoDatabase } = require("./species-photo-bigint-fixture.cjs");
const { createPlantApp } = require("../server.js");
const { readGallery, saveGallery } = require("../species-gallery.cjs");
const {
  replaceRequestPhoto,
  approveRequestPhoto,
} = require("../species-photo-provenance.cjs");
const officer = {
  id: "officer",
  role: "Conservation Officer",
  status: "Active",
  mustChangePassword: false,
};
const user = (role) => ({ ...officer, role });
const migrate = async (pool) => {
  for (const name of [
    "004-species-requests.sql",
    "006-atomic-plant-submissions.sql",
    "008-record-change-submissions.sql",
    "009-record-version-history.sql",
    "014-species-image-gallery.sql",
  ])
    await pool.query(
      readFileSync(join(__dirname, "../migrations", name), "utf8"),
    );
};
const body = (revision, ids, primary = null, removed = []) => ({
  expectedRevision: revision,
  orderedAssetIds: ids,
  primaryAssetId: primary,
  removedAssetIds: removed,
});

test("species gallery foundation: migration, service, public readers and evidence safety", async (t) => {
  const pool = await createPlantDatabase();
  t.after(() => pool.end());
  await pool.query(
    "INSERT INTO species(scientific_name) VALUES('First'),('Second'),('Protected'),('Pending'); INSERT INTO rbac_species_visibility VALUES(1,'public'),(2,'public'),(3,'protected'),(4,'public'); UPDATE species SET rbac_data='{\"approvalStatus\":\"Pending Review\"}' WHERE species_id=4",
  );
  const asset = async (
    id,
    species,
    approved = true,
    key = id,
    owner = "staff:bot",
  ) =>
    pool.query(
      "INSERT INTO plant_asset(id,species_id,owner_subject,client_key,approved,content_type,content,created_at) VALUES($1,$2,$3,$4,$5,'image/jpeg',$6,'2026-11-01')",
      [id, species, owner, key, approved, Buffer.from(id)],
    );
  await asset("a", 1);
  await asset("b", 1);
  await asset("other", 2);
  await asset("protected", 3);
  await asset("pending", 4);
  await migrate(pool);
  const server = createPlantApp({
    pool,
    auth: {
      event: async () => {},
      session: async (token) =>
        token === "1".repeat(64)
          ? officer
          : token === "2".repeat(64)
            ? user("Administrator")
            : null,
    },
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const call = async (path, method = "GET", token) => {
    const r = await fetch(
      `http://127.0.0.1:${server.address().port}/api${path}`,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(method === "PUT" ? { body: "{}" } : {}),
      },
    );
    return {
      status: r.status,
      data: r.headers.get("content-type")?.includes("json")
        ? await r.json()
        : await r.arrayBuffer(),
    };
  };
  await t.test(
    "additive migration leaves legacy bytes and automatic portrait unchanged; GET never initializes",
    async () => {
      const gallery = await readGallery(pool, 1, officer);
      assert.deepEqual(
        gallery.images.map((x) => x.assetId),
        ["a", "b"],
      );
      assert.equal(gallery.primaryAssetId, null);
      assert.equal(
        (await pool.query("SELECT count(*) AS n FROM species_image_collection"))
          .rows[0].n,
        0,
      );
      assert.equal((await call("/species/1")).data.species.image_asset_id, "a");
      assert.equal(
        Buffer.from(
          (await pool.query("SELECT content FROM plant_asset WHERE id='a'"))
            .rows[0].content,
        ).toString(),
        "a",
      );
    },
  );
  await t.test(
    "Officer-only canonical reads; HTTP management writes remain disabled",
    async () => {
      for (const role of ["Administrator", "Botanist", "Visitor"]) {
        await assert.rejects(readGallery(pool, 1, user(role)), { status: 403 });
        await assert.rejects(
          saveGallery(pool, 1, user(role), body(0, ["a", "b"])),
          { status: 403 },
        );
      }
      for (const method of ["GET", "PUT"])
        assert.equal(
          (await call("/species/1/images", method, "1".repeat(64))).status,
          method === 'GET' ? 200 : 503,
        );
      await assert.rejects(
        saveGallery(pool, 4, officer, body(0, ["pending"])),
        { status: 409 },
      );
    },
  );
  await t.test(
    "strict order, membership and no implicit removals; failures are atomic",
    async () => {
      for (const invalid of [
        body(0, ["a"]),
        body(0, ["a", "other"]),
        body(0, ["a", "b"], null, ["other"]),
      ])
        await assert.rejects(saveGallery(pool, 1, officer, invalid), {
          status: 409,
        });
      await assert.rejects(saveGallery(pool, 1, officer, body(0, ["a", "a"])), {
        status: 400,
      });
      await assert.rejects(
        saveGallery(pool, 1, officer, { ...body(0, ["a", "b"]), url: "evil" }),
        { status: 400 },
      );
      assert.equal(
        (await pool.query("SELECT count(*) AS n FROM species_image_collection"))
          .rows[0].n,
        0,
      );
    },
  );
  await t.test(
    "atomic primary and order, history, stale writer and database constraints",
    async () => {
      const saved = await saveGallery(
        pool,
        1,
        officer,
        body(0, ["b", "a"], "b"),
      );
      assert.equal(saved.revision, 1);
      assert.equal(saved.primaryAssetId, "b");
      assert.equal((await call("/species/1")).data.species.image_asset_id, "b");
      assert.deepEqual(
        (await call("/assets?species_id=1")).data.assets.map((x) => x.id),
        ["b", "a"],
      );
      await assert.rejects(saveGallery(pool, 1, officer, body(0, ["a", "b"])), {
        status: 409,
      });
      await assert.rejects(
        pool.query(
          "UPDATE species_image_reference SET is_primary=TRUE WHERE asset_id='a'",
        ),
        { code: "23505" },
      );
      await assert.rejects(
        pool.query(
          "UPDATE species_image_reference SET position=0 WHERE asset_id='a'",
        ),
        { code: "23505" },
      );
      await assert.rejects(
        pool.query(
          "INSERT INTO species_image_reference(species_id,asset_id,position,added_by) VALUES(1,'other',3,'staff:officer')",
        ),
        { code: "23503" },
      );
      await assert.rejects(
        pool.query(
          "UPDATE species_image_reference SET removed_at=CURRENT_TIMESTAMP WHERE asset_id='a'",
        ),
        { code: "23514" },
      );
      await assert.rejects(
        pool.query(
          "UPDATE species_image_arrangement_history SET actor='other'",
        ),
        /append-only/,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*) AS n FROM species_image_arrangement_history",
          )
        ).rows[0].n,
        1,
      );
      await pool.query("UPDATE plant_asset SET approved=FALSE WHERE id='a'");
      await assert.rejects(saveGallery(pool, 1, officer, body(1, ["b", "a"], "b")), { status: 409 });
      await assert.rejects(
        saveGallery(pool, 1, officer, body(1, ["b", "a"], "a")),
        { status: 409 },
      );
      await pool.query("UPDATE plant_asset SET approved=TRUE WHERE id='a'");
    },
  );
  await t.test(
    "removal blocks portrait, gallery and stale binaries; plant fallback and evidence survive",
    async () => {
      await pool.query(
        "INSERT INTO plant_record(species_id,registered_subject,rbac_status,qr_token) VALUES(1,'staff:bot','Approved','evidence'); INSERT INTO plant_observation(id,plant_id,owner_subject,status,client_key,content) VALUES('observation',1,'staff:bot','Approved','obs','{}'); INSERT INTO plant_asset(id,plant_id,observation_id,owner_subject,client_key,approved,content_type,content) VALUES('evidence',1,'observation','staff:bot','evidence',TRUE,'image/png',decode('1234','hex'))",
      );
      const before = (
        await pool.query("SELECT * FROM plant_asset WHERE id='evidence'")
      ).rows[0];
      await saveGallery(pool, 1, officer, body(1, ["a"], null, ["b"]));
      assert.equal((await call("/assets/b")).status, 404);
      assert.equal((await call("/species/1")).data.species.image_asset_id, "a");
      await saveGallery(pool, 1, officer, body(2, [], null, ["a"]));
      assert.deepEqual((await call("/assets?species_id=1")).data.assets, []);
      assert.equal(
        (await call("/species/1")).data.species.image_asset_id,
        "evidence",
      );
      assert.deepEqual(
        (await pool.query("SELECT * FROM plant_asset WHERE id='evidence'"))
          .rows[0],
        before,
      );
      assert.equal(
        (
          await pool.query(
            "SELECT count(*) AS n FROM species_image_reference WHERE removed_at IS NOT NULL",
          )
        ).rows[0].n,
        2,
      );
      assert.equal((await call("/assets/protected")).status, 404);
      assert.equal((await call("/assets/pending")).status, 404);
      assert.equal(
        (await call("/assets/a", "GET", "2".repeat(64))).status,
        403,
      );
    },
  );
  await t.test(
    "competing revisions serialize and exactly one save succeeds",
    async () => {
      const results = await Promise.allSettled([
        saveGallery(pool, 2, officer, body(0, ["other"], "other")),
        saveGallery(pool, 2, officer, body(0, ["other"])),
      ]);
      assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
      assert.equal(
        results.find((x) => x.status === "rejected").reason.status,
        409,
      );
    },
  );
  await t.test("history failure rolls the whole arrangement back", async () => {
    const before = await readGallery(pool, 2, officer);
    const broken = {
      connect: async () => {
        const c = await pool.connect();
        return {
          release: () => c.release(),
          query: (sql, args) => {
            if (sql.startsWith("INSERT INTO species_image_arrangement_history"))
              throw Error("Injected history failure");
            return c.query(sql, args);
          },
        };
      },
    };
    await assert.rejects(
      saveGallery(broken, 2, officer, body(before.revision, ["other"], null)),
      /Injected/,
    );
    assert.deepEqual(await readGallery(pool, 2, officer), before);
  });
  await t.test(
    "targeted request replacements retain old bytes and unrelated references; ambiguous legacy fails safely",
    async () => {
      await asset("request-old", 2, false, "submission:species-photo");
      const request = (
        await pool.query(
          `INSERT INTO species_request_submission(owner_subject,client_key,payload_hash,scientific_name,common_name,genus_name,family_name,conservation_status,description,habitat,photo,proposed_species_id)
      VALUES('staff:bot','submission','hash','Second','Common','Genus','Family','Least Concern','Description','Habitat',$1,2) RETURNING *`,
          [Buffer.from("request-old")],
        )
      ).rows[0];
      const c = await pool.connect();
      let replacement;
      try {
        await c.query("BEGIN");
        await c.query(
          "SELECT species_id FROM species WHERE species_id=2 FOR UPDATE",
        );
        await approveRequestPhoto(c, request, 2, "staff:officer");
        replacement = await replaceRequestPhoto(
          c,
          { ...request, photo_asset_id: "request-old" },
          2,
          Buffer.from("new"),
          true,
          "staff:officer",
        );
        await c.query("COMMIT");
      } finally {
        c.release();
      }
      const gallery = await readGallery(pool, 2, officer);
      assert.equal(gallery.primaryAssetId, "other");
      assert.ok(gallery.images.some((x) => x.assetId === replacement));
      const old = (
        await pool.query("SELECT * FROM plant_asset WHERE id='request-old'")
      ).rows[0];
      assert.equal(Buffer.from(old.content).toString(), "request-old");
      assert.equal(old.approved, false);
      assert.equal(
        (await pool.query("SELECT approved FROM plant_asset WHERE id='other'"))
          .rows[0].approved,
        true,
      );
      await assert.rejects(
        replaceRequestPhoto(
          pool,
          { ...request, client_key: "unknown" },
          2,
          Buffer.from("bad"),
          false,
          "staff:bot",
        ),
        { status: 409 },
      );
      await asset(
        "ambiguous",
        2,
        false,
        `species-request:${request.request_id}`,
      );
      await pool.query(
        "UPDATE plant_asset SET content=$1 WHERE id='ambiguous'",
        [Buffer.from("request-old")],
      );
      await assert.rejects(
        replaceRequestPhoto(
          pool,
          request,
          2,
          Buffer.from("bad"),
          false,
          "staff:bot",
        ),
        { status: 409 },
      );
      assert.equal(
        Buffer.from(
          (
            await pool.query(
              "SELECT content FROM plant_asset WHERE id='ambiguous'",
            )
          ).rows[0].content,
        ).toString(),
        "request-old",
      );
    },
  );
});

test("HTTP review paths preserve Officer images, request-photo history and retry safety", async (t) => {
  const pool = await createReadySpeciesPhotoDatabase();
  t.after(() => pool.end());
  const sharp = require("sharp");
  const photo = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "green" },
  })
    .jpeg()
    .toBuffer();
  const replacement = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "red" },
  })
    .jpeg()
    .toBuffer();
  await pool.query(
    "INSERT INTO species(scientific_name,rbac_data) VALUES('Pending original','{\"approvalStatus\":\"Pending Review\"}'); INSERT INTO rbac_species_visibility VALUES(1,'public')",
  );
  const fields = {
    scientific_name: "Pending original",
    common_name: "Common",
    genus_name: "Genus",
    family_name: "Family",
    conservation_status: "Least Concern",
    description: "Description",
    habitat: "Forest",
  };
  const request = (
    await pool.query(
      `INSERT INTO species_request_submission(owner_subject,client_key,payload_hash,scientific_name,common_name,genus_name,family_name,conservation_status,description,habitat,photo,proposed_species_id)
    VALUES('staff:bot','origin','hash',$1,$2,$3,$4,$5,$6,$7,$8,1) RETURNING *`,
      [...Object.values(fields), photo],
    )
  ).rows[0];
  for (const [id, owner, key, approved] of [
    ["origin", "staff:bot", "origin:species-photo", false],
    ["unrelated-pending", "staff:bot", "unrelated-pending", false],
    ["officer-image", "staff:officer", "officer-image", true],
  ])
    await pool.query(
      "INSERT INTO plant_asset(id,species_id,owner_subject,client_key,approved,content_type,content) VALUES($1,1,$2,$3,$4,'image/jpeg',$5)",
      [id, owner, key, approved, photo],
    );
  await pool.query(
    "INSERT INTO species_image_collection(species_id,updated_by) VALUES(1,'staff:officer'); INSERT INTO species_image_reference(species_id,asset_id,position,is_primary,added_by) VALUES(1,'officer-image',0,TRUE,'staff:officer')",
  );
  const tokens = {
    bot: "1".repeat(64),
    officer: "2".repeat(64),
    admin: "3".repeat(64),
  };
  const auth = {
    event: async () => {},
    session: async (token) =>
      token === tokens.bot
        ? { ...officer, id: "bot", role: "Botanist" }
        : token === tokens.officer
          ? officer
          : token === tokens.admin
            ? user("Administrator")
            : null,
  };
  const server = createPlantApp({ pool, auth, speciesPhotoWritesEnabled: true }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const call = async (path, role, method, data) => {
    const r = await fetch(
      `http://127.0.0.1:${server.address().port}/api${path}`,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(role ? { Authorization: `Bearer ${tokens[role]}` } : {}),
        },
        body: JSON.stringify(data),
      },
    );
    return { status: r.status, data: await r.json() };
  };
  const patch = {
    ...fields,
    photo: {
      content_type: "image/jpeg",
      base64: replacement.toString("base64"),
    },
  };
  const corrected = await call(
    `/my-species-requests/${request.request_id}`,
    "bot",
    "PATCH",
    patch,
  );
  assert.equal(corrected.status, 200, JSON.stringify(corrected.data));
  assert.equal(
    Buffer.from(
      (await pool.query("SELECT content FROM plant_asset WHERE id='origin'"))
        .rows[0].content,
    ).equals(photo),
    true,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT approved FROM plant_asset WHERE id='unrelated-pending'",
      )
    ).rows[0].approved,
    false,
  );
  assert.equal(
    (
      await pool.query(
        "SELECT approved FROM plant_asset WHERE id='officer-image'",
      )
    ).rows[0].approved,
    true,
  );
  const review = await call(
    `/species-requests/${request.request_id}/review`,
    "officer",
    "POST",
    { decision: "Approved", visibility: "public" },
  );
  assert.equal(review.status, 200, JSON.stringify(review.data));
  assert.equal(
    (
      await pool.query(
        "SELECT approved FROM plant_asset WHERE id='unrelated-pending'",
      )
    ).rows[0].approved,
    false,
  );
  assert.equal(
    (await readGallery(pool, 1, officer)).primaryAssetId,
    "officer-image",
  );
  const proposed = await call("/record-changes", "bot", "POST", {
    kind: "species",
    target_id: request.request_id,
    client_key: "change-photo",
    proposed: {
      ...fields,
      photo: { content_type: "image/jpeg", base64: photo.toString("base64") },
    },
  });
  assert.equal(proposed.status, 201, JSON.stringify(proposed.data));
  const approved = await call(
    `/record-changes/${proposed.data.change.id}/review`,
    "officer",
    "POST",
    { decision: "Approved", comment: "Verified" },
  );
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  assert.equal(
    (await readGallery(pool, 1, officer)).primaryAssetId,
    "officer-image",
  );
  assert.equal(
    (
      await pool.query(
        "SELECT approved FROM plant_asset WHERE id='officer-image'",
      )
    ).rows[0].approved,
    true,
  );
  assert.ok(
    (
      await pool.query(
        "SELECT species_photo FROM record_version_history WHERE species_photo IS NOT NULL",
      )
    ).rows.length >= 2,
  );
  const upload = {
    species_id: 1,
    client_key: "retry-image",
    content_type: "image/jpeg",
    base64: photo.toString("base64"),
  };
  for (const role of [null, "bot", "admin"])
    assert.ok(
      [401, 403].includes((await call("/assets", role, "POST", upload)).status),
    );
  assert.equal(
    (
      await call("/assets", "officer", "POST", {
        ...upload,
        observation_id: "invalid",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call("/assets", "officer", "POST", {
        ...upload,
        base64: Buffer.alloc(4194305).toString("base64"),
      })
    ).status,
    413,
  );
  assert.equal(
    (
      await call("/assets", "officer", "POST", {
        ...upload,
        content_type: "image/gif",
      })
    ).status,
    400,
  );
  const uploaded = await call("/assets", "officer", "POST", upload);
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.data));
  assert.deepEqual(
    (await call("/assets", "officer", "POST", upload)).data,
    uploaded.data,
  );
  assert.ok(
    (await readGallery(pool, 1, officer)).images.some(
      (x) => x.assetId === uploaded.data.id,
    ),
  );
  const retried = await Promise.all([
    call("/assets", "officer", "POST", {
      ...upload,
      client_key: "concurrent-retry",
    }),
    call("/assets", "officer", "POST", {
      ...upload,
      client_key: "concurrent-retry",
    }),
  ]);
  assert.equal(retried[0].status, 201);
  assert.deepEqual(retried[0].data, retried[1].data);
  await pool.query(
    "INSERT INTO species(scientific_name) VALUES('Other species')",
  );
  assert.equal(
    (await call("/assets", "officer", "POST", { ...upload, species_id: 2 }))
      .status,
    409,
  );
});
