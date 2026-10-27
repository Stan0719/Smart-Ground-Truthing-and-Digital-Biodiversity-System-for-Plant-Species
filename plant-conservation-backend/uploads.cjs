"use strict";
const { randomUUID } = require("node:crypto");
const sharp = require("sharp");
const { permitted, visibilityFor } = require("../shared/rbac.cjs");
const { transaction, audit, subject, fail, id } = require("./domain.cjs");
function mountUploads(app, { pool, allow }) {
  app.post(
    "/api/assets",
    async (req, res, next) => {
      const permission = req.body.species_id
        ? "species.manage"
        : "plants.create";
      return allow(permission)(req, res, next);
    },
    async (req, res) => {
      const b = req.body;
      if ((b.species_id === undefined) === (b.plant_id === undefined))
        fail(400, "Select exactly one parent record.");
      if (
        typeof b.base64 !== "string" ||
        b.base64.length > 5592408 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(b.base64)
      )
        fail(400, "Invalid upload.");
      let bytes = Buffer.from(b.base64, "base64"),
        type = b.content_type;
      if (!bytes.length || bytes.length > 4194304)
        fail(413, "Upload exceeds 4 MB.");
      if (["image/jpeg", "image/png"].includes(type)) {
        try {
          bytes = await sharp(bytes, {
            limitInputPixels: 24000000,
            failOn: "warning",
          })
            .rotate()
            .resize({
              width: 2400,
              height: 2400,
              fit: "inside",
              withoutEnlargement: true,
            })
            .jpeg({ quality: 85 })
            .toBuffer();
          type = "image/jpeg";
        } catch {
          fail(400, "Invalid or oversized image.");
        }
      } else if (!(
        type === "application/pdf" &&
        b.species_id &&
        bytes.subarray(0, 5).toString() === "%PDF-"
      ))
        fail(400, "Use JPEG/PNG photos or an official PDF document.");
      const assetId = await transaction(pool, async (c) => {
        if (b.plant_id) {
          const plant = (
            await c.query(
              "SELECT p.plant_id FROM plant_record p LEFT JOIN rbac_species_visibility v ON v.species_id=p.species_id WHERE p.plant_id=$1 AND COALESCE(v.visibility,'protected') = ANY($2::text[])",
              [id(String(b.plant_id)), visibilityFor(req.user)],
            )
          ).rows[0];
          if (!plant) fail(404, "Owned plant not found.");
        }
        if (b.client_key) {
          const previous = (
            await c.query(
              "SELECT id,plant_id,species_id,observation_id FROM plant_asset WHERE owner_subject=$1 AND client_key=$2",
              [subject(req.user), b.client_key],
            )
          ).rows[0];
          if (previous) {
            if (
              String(previous.plant_id || "") !== String(b.plant_id || "") ||
              String(previous.species_id || "") !==
                String(b.species_id || "") ||
              String(previous.observation_id || "") !==
                String(b.observation_id || "")
            )
              fail(409, "Upload key belongs to another record.");
            return previous.id;
          }
        }
        if (b.plant_id) {
          const observation = (
            await c.query(
              "SELECT id FROM plant_observation WHERE id=$1 AND plant_id=$2 AND owner_subject=$3 AND status IN ('Draft','Correction Required','Rejected')",
              [b.observation_id, b.plant_id, subject(req.user)],
            )
          ).rows[0];
          if (!observation)
            fail(
              409,
              "An owned unapproved observation is required for field photos.",
            );
        }
        const asset = randomUUID();
        await c.query(
          "INSERT INTO plant_asset(id,species_id,plant_id,owner_subject,client_key,observation_id,approved,content_type,content) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(owner_subject,client_key) DO NOTHING",
          [
            asset,
            b.species_id ? id(String(b.species_id)) : null,
            b.plant_id ? id(String(b.plant_id)) : null,
            subject(req.user),
            b.client_key || asset,
            b.observation_id || null,
            Boolean(b.species_id),
            type,
            bytes,
          ],
        );
        await audit(c, req.user, "asset_uploaded", asset);
        return asset;
      });
      res.status(201).json({ id: assetId });
    },
  );
  app.get("/api/assets", allow("plants.public.read"), async (req, res) => {
    const speciesId = id(String(req.query.species_id || ""));
    const rows = (
      await pool.query(
        "SELECT a.id,a.content_type FROM plant_asset a JOIN rbac_species_visibility v ON v.species_id=a.species_id WHERE a.species_id=$1 AND v.visibility = ANY($2::text[]) AND (a.content_type='image/jpeg' OR $3)",
        [
          speciesId,
          visibilityFor(req.user),
          permitted(req.user, "plants.scientific.read"),
        ],
      )
    ).rows;
    res.json({ assets: rows });
  });
  app.get("/api/assets/:id", allow("plants.public.read"), async (req, res) => {
    const row = (
      await pool.query(
        "SELECT a.*,p.species_id AS plant_species,p.registered_subject,p.rbac_status FROM plant_asset a LEFT JOIN plant_record p ON p.plant_id=a.plant_id WHERE a.id=$1",
        [req.params.id],
      )
    ).rows[0];
    if (!row) fail(404, "Asset unavailable.");
    const speciesId = row.species_id || row.plant_species;
    const visibility =
      (
        await pool.query(
          "SELECT visibility FROM rbac_species_visibility WHERE species_id=$1",
          [speciesId],
        )
      ).rows[0]?.visibility || "protected";
    if (!visibilityFor(req.user).includes(visibility))
      fail(404, "Asset unavailable.");
    if (
      row.plant_id &&
      (!row.approved || row.rbac_status !== "Approved") &&
      row.owner_subject !== (req.user ? subject(req.user) : "") &&
      req.user?.role !== "Conservation Officer"
    )
      fail(404, "Asset unavailable.");
    if (
      row.content_type === "application/pdf" &&
      !permitted(req.user, "plants.scientific.read")
    )
      fail(403, "Scientific access required.");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.setHeader("Content-Type", row.content_type);
    res.setHeader(
      "Content-Disposition",
      `${row.content_type === "application/pdf" ? "attachment" : "inline"}; filename="plant-asset.${row.content_type === "application/pdf" ? "pdf" : "jpg"}"`,
    );
    res.end(row.content);
  });
}
module.exports = { mountUploads };
