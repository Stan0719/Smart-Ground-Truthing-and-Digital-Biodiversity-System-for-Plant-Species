"use strict";
const {rolesAvailable,validateRoles,recordRole}=require("./species-photo-library.cjs");
const {setPointer}=require("./species-photo-provenance.cjs");
const { randomUUID, createHash } = require("node:crypto");
const sharp = require("sharp");
const { originColumnAvailable } = require("./observation-origin.cjs");
const { transaction, audit, subject, fail, text, id, fieldContent, assertNewSpecies, speciesRow } = require("./domain.cjs");
const speciesFields = ["scientific_name", "common_name", "genus_name", "family_name", "conservation_status", "description", "habitat"];
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
async function preparePhoto(photo) {
  if (!photo || !["image/jpeg", "image/png"].includes(photo.content_type) || typeof photo.base64 !== "string" ||
    !photo.base64.length || photo.base64.length > 5592408 || !/^[A-Za-z0-9+/]+={0,2}$/.test(photo.base64))
    fail(400, "Use JPEG or PNG photos up to 4 MB each.");
  const bytes = Buffer.from(photo.base64, "base64");
  if (!bytes.length || bytes.length > 4194304) fail(413, "One of the photos exceeds 4 MB.");
  try {
    const image=sharp(bytes, { limitInputPixels: 24000000, failOn: "warning" });
    const metadata=await image.metadata();
    if(!['jpeg','png'].includes(metadata.format)||(metadata.pages||1)>1)throw Error('Unsupported image');
    return await image.rotate()
      .resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  } catch { fail(400, "Invalid or oversized photo. Choose a different image and retry."); }
}
async function createSpecies(c, data, user) {
  await assertNewSpecies(c, data.scientific_name);
  if ((await c.query("SELECT request_id FROM species_request_submission WHERE lower(btrim(scientific_name))=lower(btrim($1)) AND request_status='Pending Review'", [data.scientific_name])).rows.length)
    fail(409, "A request for this scientific name is already pending review.");
  const family = (await c.query("SELECT family_id FROM family WHERE lower(btrim(family_name))=lower(btrim($1)) ORDER BY family_id LIMIT 1", [data.family_name])).rows[0]
    || (await c.query("INSERT INTO family(family_name) VALUES($1) RETURNING family_id", [data.family_name])).rows[0];
  const genus = (await c.query("SELECT genus_id FROM genus WHERE lower(btrim(genus_name))=lower(btrim($1)) AND family_id=$2 ORDER BY genus_id LIMIT 1", [data.genus_name, family.family_id])).rows[0]
    || (await c.query("INSERT INTO genus(genus_name,family_id) VALUES($1,$2) RETURNING genus_id", [data.genus_name, family.family_id])).rows[0];
  const status = (await c.query("SELECT status_id FROM conservation_status WHERE lower(status_name)=lower($1) ORDER BY status_id LIMIT 1", [data.conservation_status])).rows[0]
    || (await c.query("INSERT INTO conservation_status(status_name) VALUES($1) RETURNING status_id", [data.conservation_status])).rows[0];
  const row = (await c.query("INSERT INTO species(scientific_name,common_name,genus_id,status_id,description,rbac_data) VALUES($1,$2,$3,$4,$5,$6) RETURNING species_id",
    [data.scientific_name, data.common_name, genus.genus_id, status.status_id, data.description,
      { habitat: data.habitat, approvalStatus: "Pending Review", submittedBy: subject(user) }])).rows[0];
  // Pending species are never made public or selectable before explicit review.
  await c.query("INSERT INTO rbac_species_visibility(species_id,visibility) VALUES($1,'protected')", [row.species_id]);
  return row.species_id;
}
function mountPlantSubmissions(app, { pool, allow, officerNotifications = null }) {
  app.get("/api/plant-submissions/capabilities",allow("plants.create"),async(_req,res)=>res.json({semantic_photo_roles_available:await rolesAvailable(pool),photo_roles:["whole_plant","leaf_close_up","stem_bark","flower_fruit","additional"]}));
  app.post("/api/plant-submissions", allow("plants.create"), async (req, res) => {
    const b = req.body;
    if (!b || typeof b !== "object" || Array.isArray(b) || Object.keys(b).some((key) =>
      !["species_id", "new_species", "scientific_name", "content", "latitude", "longitude", "accuracy_m", "qr_id", "client_key", "photos"].includes(key)))
      fail(400, "Invalid plant submission fields.");
    if ((b.species_id !== undefined) === (b.new_species !== undefined)) fail(400, "Select an existing species or provide new species details.");
    const clientKey = text(b.client_key, 100), name = text(b.scientific_name, 200);
    id(String(b.qr_id));
    const content = fieldContent({ ...b.content, latitude: b.latitude, longitude: b.longitude,
      ...(b.accuracy_m === undefined ? {} : { accuracy_m: b.accuracy_m }) });
    if (!Number.isFinite(b.latitude) || !Number.isFinite(b.longitude)) fail(400, "Plant GPS coordinates are required.");
    if (!Array.isArray(b.photos) || b.photos.length < 3) fail(400, "The three required plant photos must be supplied.");
    let speciesData;
    if (b.new_species !== undefined) {
      if (!b.new_species || typeof b.new_species !== "object" || Array.isArray(b.new_species) ||
        Object.keys(b.new_species).some((key) => ![...speciesFields, "photo"].includes(key))) fail(400, "Invalid new species fields.");
      speciesData = Object.fromEntries(speciesFields.map((key) => [key, text(b.new_species[key], ["description", "habitat"].includes(key) ? 4000 : 200)]));
    } else id(String(b.species_id));
    const payloadHash = createHash("sha256").update(JSON.stringify(canonical(b))).digest("hex");
    const semanticRoles = validateRoles(b.photos);
    const photos = [];
    for (const photo of b.photos) photos.push(await preparePhoto(photo));
    const speciesPhoto = speciesData ? await preparePhoto(b.new_species.photo) : null;
    const result = await transaction(pool, async (c) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`plant-submission:${subject(req.user)}:${clientKey}`]);
      const previous = (await c.query("SELECT payload_hash,result FROM plant_submission_receipt WHERE owner_subject=$1 AND client_key=$2", [subject(req.user), clientKey])).rows[0];
      if (previous) {
        if (previous.payload_hash !== payloadHash) fail(409, "This submission was already saved with different information. Reload the form before creating another plant.");
        return previous.result;
      }
      if (semanticRoles.some(Boolean) && !await rolesAvailable(c)) fail(503,"Semantic photo roles require migration 015.");
      let speciesId;
      if (speciesData) speciesId = await createSpecies(c, speciesData, req.user);
      else { await speciesRow(c, b.species_id, req.user); speciesId = b.species_id; }
      // Same inventory lock and assignment contract as existing plant registration.
      const qr = (await c.query("SELECT qr_id,qr_code FROM public.qr_code WHERE qr_id=$1 AND plant_id IS NULL AND status='generated' FOR UPDATE", [b.qr_id])).rows[0];
      if (!qr) fail(409, "The selected QR code is no longer available.");
      const plant = (await c.query("INSERT INTO plant_record(species_id,registered_subject,qr_token,scientific_name) VALUES($1,$2,$3,$4) RETURNING plant_id", [speciesId, subject(req.user), qr.qr_code, name])).rows[0];
      await c.query("UPDATE public.qr_code SET plant_id=$1,status='assigned',assigned_at=CURRENT_TIMESTAMP WHERE qr_id=$2 AND plant_id IS NULL", [plant.plant_id, qr.qr_id]);
      await c.query("INSERT INTO plant_location(plant_id,latitude,longitude,accuracy_m) VALUES($1,$2,$3,$4)", [plant.plant_id, b.latitude, b.longitude, b.accuracy_m ?? null]);
      const observationId = randomUUID();
      const withOrigin = await originColumnAvailable(c);
      await c.query(`INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key${withOrigin ? ",origin_type" : ""}) VALUES($1,$2,$3,'Pending Review',$4,$5${withOrigin ? ",'initial_registration'" : ""})`, [observationId, plant.plant_id, subject(req.user), content, clientKey]);
      let wholePlantAsset = null;
      for (const [index, bytes] of photos.entries()) {
        const assetId=randomUUID();
        await c.query("INSERT INTO plant_asset(id,plant_id,owner_subject,client_key,observation_id,approved,content_type,content) VALUES($1,$2,$3,$4,$5,FALSE,'image/jpeg',$6)", [assetId, plant.plant_id, subject(req.user), `${clientKey}:photo:${index}`, observationId, bytes]);
        await recordRole(c,{assetId,plantId:plant.plant_id,observationId,role:semanticRoles[index],owner:subject(req.user)});
        if(semanticRoles[index]==='whole_plant')wholePlantAsset=assetId;
      }
      let requestId = null;
      if (speciesData) {
        const request = (await c.query(`INSERT INTO species_request_submission(owner_subject,client_key,payload_hash,${speciesFields.join(",")},photo,proposed_species_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING request_id`, [subject(req.user), clientKey, payloadHash, ...speciesFields.map((key) => speciesData[key]), speciesPhoto, speciesId])).rows[0];
        requestId = request.request_id;
        const photoId=randomUUID();
        await c.query("INSERT INTO plant_asset(id,species_id,owner_subject,client_key,approved,content_type,content) VALUES($1,$2,$3,$4,FALSE,'image/jpeg',$5)", [photoId, speciesId, subject(req.user), `${clientKey}:species-photo`, speciesPhoto]);
        await setPointer(c,requestId,photoId);
        if(wholePlantAsset)await c.query("INSERT INTO species_request_proposed_image(request_id,asset_id) VALUES($1,$2)",[requestId,wholePlantAsset]);
        await audit(c, req.user, "species_requested", requestId);
      }
      await audit(c, req.user, "plant_submitted", plant.plant_id);
      const response = { plant_id: plant.plant_id, id: observationId, species_id: speciesId, qr_token: qr.qr_code,
        status: "Pending Review", species_request_id: requestId };
      await c.query("INSERT INTO plant_submission_receipt(owner_subject,client_key,payload_hash,result) VALUES($1,$2,$3,$4)", [subject(req.user), clientKey, payloadHash, response]);
      if (officerNotifications) await officerNotifications.enqueue(c, observationId, requestId !== null);
      return response;
    });
    res.status(201).json(result);
  });
}
module.exports = { mountPlantSubmissions };
