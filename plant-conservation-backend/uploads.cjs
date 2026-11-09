"use strict";
const { randomUUID } = require("node:crypto");
const sharp = require("sharp");
const { permitted, visibilityFor } = require("../shared/rbac.cjs");
const { transaction, audit, subject, fail, id } = require("./domain.cjs");
const {available: galleryAvailable,membershipSql,appendAsset}=require('./species-gallery.cjs');
const { requireSpeciesPhotoWrites } = require("./species-photo-activation.cjs");
function mountUploads(app, { pool, allow, speciesPhotoWritesEnabled = false }) {
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
          const image = sharp(bytes, {
            limitInputPixels: 24000000,
            failOn: "warning",
          });
          const metadata = await image.metadata();
          if (!['jpeg','png'].includes(metadata.format) || (metadata.pages || 1) > 1) throw Error('Unsupported image format.');
          bytes = await image.rotate()
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
      // Parent exclusivity and decoded content were validated above. Gate every
      // direct species image, not plant evidence or official PDF documents.
      if (b.species_id !== undefined && type === "image/jpeg")
        await requireSpeciesPhotoWrites(pool, speciesPhotoWritesEnabled);
      const assetId = await transaction(pool, async (c) => {
        if (b.species_id) {
          if (b.observation_id) fail(400,'Species images cannot be observation evidence.');
          const parent=(await c.query('SELECT species_id FROM species WHERE species_id=$1 FOR UPDATE',[id(String(b.species_id))])).rows[0];
          if (!parent) fail(404,'Species unavailable.');
        }
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
              "SELECT id,plant_id,species_id,observation_id,content_type,content FROM plant_asset WHERE owner_subject=$1 AND client_key=$2",
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
            if (previous.content_type !== type || !Buffer.from(previous.content).equals(bytes)) fail(409,'Upload key belongs to different image content.');
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
        const inserted=await c.query(
          "INSERT INTO plant_asset(id,species_id,plant_id,owner_subject,client_key,observation_id,approved,content_type,content) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(owner_subject,client_key) DO NOTHING RETURNING id",
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
        if (!inserted.rows.length) {
          const previous=(await c.query('SELECT * FROM plant_asset WHERE owner_subject=$1 AND client_key=$2',[subject(req.user),b.client_key])).rows[0];
          if (!previous || String(previous.species_id||'')!==String(b.species_id||'') || String(previous.plant_id||'')!==String(b.plant_id||'') || String(previous.observation_id||'')!==String(b.observation_id||'')) fail(409,'Upload key belongs to another record.');
          if (previous.content_type !== type || !Buffer.from(previous.content).equals(bytes)) fail(409,'Upload key belongs to different image content.');
          return previous.id;
        }
        if (b.species_id && type==='image/jpeg') await appendAsset(c,b.species_id,asset,subject(req.user));
        await audit(c, req.user, "asset_uploaded", asset);
        return asset;
      });
      res.status(201).json({ id: assetId });
    },
  );
  app.get("/api/assets", allow("plants.public.read"), async (req, res) => {
    if (req.query.plant_id !== undefined) {
      const plantId = id(String(req.query.plant_id));
      const rows = (await pool.query(
        `SELECT a.id,a.content_type FROM plant_asset a
         JOIN plant_record p ON p.plant_id=a.plant_id
         JOIN species s ON s.species_id=p.species_id
         LEFT JOIN rbac_species_visibility v ON v.species_id=p.species_id
         WHERE a.plant_id=$1 AND p.rbac_status='Approved'
           AND COALESCE(s.rbac_data->>'approvalStatus','Approved')='Approved'
           AND a.content_type IN ('image/jpeg','image/png')
           AND ((a.observation_id IS NULL AND a.approved=TRUE) OR EXISTS (
             SELECT 1 FROM plant_observation o
             WHERE o.id=a.observation_id AND o.plant_id=a.plant_id AND o.status='Approved'
           ))
           AND COALESCE(v.visibility,'protected') = ANY($2::text[])
         ORDER BY a.created_at,a.id`,
        [plantId, visibilityFor(req.user)],
      )).rows;
      return res.json({ assets: rows });
    }
    const speciesId = id(String(req.query.species_id || ""));
    const managed=await galleryAvailable(pool);
    // Default reference order matches direct portrait priority: newest time, then ascending ID.
    const rows = (
      await pool.query(
        `SELECT a.id,a.content_type FROM plant_asset a JOIN species s ON s.species_id=a.species_id JOIN rbac_species_visibility v ON v.species_id=a.species_id
        ${managed ? 'LEFT JOIN species_image_reference r ON r.species_id=a.species_id AND r.asset_id=a.id' : ''}
        WHERE a.species_id=$1 AND v.visibility = ANY($2::text[])
        AND ${managed ? `(a.content_type NOT IN ('image/jpeg','image/png') OR ${membershipSql()})` : 'TRUE'}
        AND (a.content_type IN ('image/jpeg','image/png') OR $3) AND ((a.approved AND COALESCE(s.rbac_data->>'approvalStatus','Approved')='Approved') OR $4 OR ($3 AND a.owner_subject=$5))
        ORDER BY ${managed ? 'COALESCE(r.is_primary,FALSE) DESC,r.position ASC NULLS LAST,' : ''}a.created_at DESC,a.id ASC`,
        [
          speciesId,
          visibilityFor(req.user),
          permitted(req.user, "plants.scientific.read"),
          permitted(req.user, "species.manage"),
          req.user ? subject(req.user) : "",
        ],
      )
    ).rows;
    res.json({ assets: rows });
  });
  app.get("/api/assets/:id", allow("plants.public.read"), async (req, res) => {
    const row = (
      await pool.query(
        `SELECT a.*,p.species_id AS plant_species,p.registered_subject,p.rbac_status,
          o.status AS observation_status,o.plant_id AS observation_plant_id
         FROM plant_asset a
         LEFT JOIN plant_record p ON p.plant_id=a.plant_id
         LEFT JOIN plant_observation o ON o.id=a.observation_id AND o.plant_id=a.plant_id
         WHERE a.id=$1`,
        [req.params.id],
      )
    ).rows[0];
    if (!row) fail(404, "Asset unavailable.");
    if (row.species_id && ['image/jpeg','image/png'].includes(row.content_type) && await galleryAvailable(pool)) {
      const visible=(await pool.query(`SELECT ${membershipSql()} AS visible FROM plant_asset a WHERE a.id=$1`,[row.id])).rows[0]?.visible;
      if (!visible) fail(404,'Asset unavailable.');
    }
    const speciesId = row.species_id || row.plant_species;
    const classification = (await pool.query(
      "SELECT v.visibility,s.rbac_data FROM species s LEFT JOIN rbac_species_visibility v ON v.species_id=s.species_id WHERE s.species_id=$1", [speciesId],
    )).rows[0];
    const visibility = classification?.visibility || "protected";
    const owner = req.user ? subject(req.user) : "";
    const ownProposalPhoto = Boolean(row.plant_id && row.owner_subject === owner && row.registered_subject === owner &&
      row.rbac_status !== "Approved" && classification?.rbac_data?.submittedBy === owner &&
      ["Pending Review", "Rejected", "Correction Required"].includes(classification?.rbac_data?.approvalStatus));
    const ownSubmissionPhoto = req.query.scope === "mine" && permitted(req.user, "plants.create") &&
      row.plant_id && row.observation_id && row.observation_plant_id != null &&
      row.owner_subject === owner && row.registered_subject === owner;
    const approvedPlantPhoto = row.plant_id
      ? row.rbac_status === "Approved" && (row.observation_id
        ? row.observation_plant_id != null && row.observation_status === "Approved"
        : row.approved)
      : row.approved;
    if (!visibilityFor(req.user).includes(visibility) && !ownProposalPhoto && !ownSubmissionPhoto)
      fail(404, "Asset unavailable.");
    if (!classification) fail(404, "Asset unavailable.");
    if (row.species_id && (!row.approved || (classification.rbac_data?.approvalStatus || "Approved") !== "Approved") &&
        !permitted(req.user, "species.manage") &&
        !(permitted(req.user, "plants.scientific.read") && row.owner_subject === owner))
      fail(404, "Asset unavailable.");
    if (!permitted(req.user, "plants.scientific.read") &&
        (classification.rbac_data?.approvalStatus || "Approved") !== "Approved")
      fail(404, "Asset unavailable.");
    if (
      row.plant_id &&
      !approvedPlantPhoto &&
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
module.exports = {
  mountUploads,
  speciesImageReader: Object.freeze({ version: 1, membershipSql }),
};
