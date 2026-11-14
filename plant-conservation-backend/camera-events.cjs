"use strict";
const { resolve, dirname, basename } = require("node:path");
const { realpath, stat, readFile } = require("node:fs/promises");
const { transaction, fail, hash, text } = require("./domain.cjs");

const eventId = /^[a-f0-9]{32}$/;
const states = ["recording", "processing", "failed", "ready"];
const defaultRecordings = resolve(__dirname, "../Ai/AI_human_detection_new/camera/recordings");
const cameraMetric = "possible_plant_contact";

// Additional display metadata stays beside the clip, never in new database columns.
async function clipMetadata(root, row) {
  try {
    const folder = await realpath(root), file = await realpath(resolve(folder, row.id + ".json"));
    if (dirname(file) !== folder || basename(file) !== row.id + ".json" || (await stat(file)).size > 16384) return null;
    const item = JSON.parse(await readFile(file, "utf8"));
    if (!item || item.eventId !== row.id || item.cameraId !== row.camera_id ||
        typeof item.plantId !== "string" || !/^[1-9][0-9]{0,18}$/.test(item.plantId) ||
        item.eventType !== cameraMetric || !states.includes(item.recordingStatus) ||
        typeof item.detectedAt !== "string" || new Date(item.detectedAt).getTime() !== new Date(row.detected_at).getTime() ||
        typeof item.recordingStartedAt !== "string" || new Date(item.recordingStartedAt).getTime() !== new Date(row.detected_at).getTime() ||
        (item.recordingEndedAt != null && (typeof item.recordingEndedAt !== "string" ||
          !Number.isFinite(Date.parse(item.recordingEndedAt)) || Date.parse(item.recordingEndedAt) < Date.parse(item.recordingStartedAt)))) return null;
    return item;
  } catch { return null; }
}

async function clipFile(root, id) {
  try {
    const folder = await realpath(root);
    const file = await realpath(resolve(folder, id + ".mp4"));
    if (dirname(file) !== folder || basename(file) !== id + ".mp4") fail(404, "Recording unavailable.");
    const info = await stat(file);
    if (!info.isFile() || info.size <= 0) fail(404, "Recording unavailable.");
    return { file, size: info.size };
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(error.code)) fail(404, "Recording unavailable on this server.");
    throw error;
  }
}

function payload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some(key => !["eventId", "plantId", "readingId", "eventType", "title", "description", "detectedAt", "recordingStartedAt", "recordingEndedAt", "recordingStatus"].includes(key)))
    fail(400, "Invalid camera event.");
  if (typeof body.eventId !== "string" || !eventId.test(body.eventId) || typeof body.plantId !== "string" || !/^[1-9][0-9]{0,18}$/.test(body.plantId) ||
      BigInt(body.plantId) > 9223372036854775807n || body.eventType !== cameraMetric || !states.includes(body.recordingStatus) ||
      (body.readingId != null && (typeof body.readingId !== "string" || !body.readingId.trim() || body.readingId.length > 100)))
    fail(400, "Invalid camera event.");
  const instant = value => {
    if (typeof value !== "string" || !/(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)))
      fail(400, "Camera timestamps require a timezone.");
    return new Date(value).toISOString();
  };
  const detected = instant(body.detectedAt), started = instant(body.recordingStartedAt);
  const ended = body.recordingEndedAt == null ? null : instant(body.recordingEndedAt);
  if (detected !== started || (ended && ended < started) ||
      (["processing", "ready"].includes(body.recordingStatus) && !ended) ||
      (body.recordingStatus === "recording" && ended)) fail(400, "Invalid recording times.");
  return { ...body, title: text(body.title, 160), description: text(body.description, 2000),
    detectedAt: detected, recordingStartedAt: started, recordingEndedAt: ended };
}

function mountCameraIngestion(app, { pool, recordingsRoot = process.env.CAMERA_RECORDINGS_DIR || defaultRecordings }) {
  app.post("/api/device/camera-events", async (req, res) => {
    const match = /^Device ([a-f0-9]{64})$/.exec(req.headers.authorization || "");
    if (!match) fail(401, "Camera authentication required.");
    const deviceId = text(req.headers["x-camera-id"], 100), body = payload(req.body);
    await transaction(pool, async client => {
      const device = (await client.query(
        "SELECT id,plant_id,device_type,status FROM iot_device WHERE id=$1 AND key_hash=$2 FOR UPDATE",
        [deviceId, hash(match[1])],
      )).rows[0];
      if (!device || device.status !== "Active") fail(401, "Camera authentication failed.");
      if (device.device_type !== "Camera" || String(device.plant_id) !== body.plantId)
        fail(403, "The active camera must be assigned to this plant.");
      let sourceDevice = device.id;
      if (body.readingId != null) {
        const reading = (await client.query(`SELECT r.device_id FROM sensor_reading r JOIN iot_device d ON d.id=r.device_id
          WHERE r.id=$1 AND d.plant_id=$2 AND d.device_type='Sensor'`, [body.readingId, body.plantId])).rows[0];
        if (!reading) fail(403, "The triggering reading must belong to this plant's sensor.");
        sourceDevice = reading.device_id;
      }
      const previous = (await client.query("SELECT * FROM threat_alert_history WHERE id=$1 FOR UPDATE", [body.eventId])).rows[0];
      if (previous && (previous.camera_id !== device.id || previous.device_id !== sourceDevice ||
          previous.reading_id !== (body.readingId ?? null) ||
          new Date(previous.detected_at).toISOString() !== body.detectedAt || previous.metric !== cameraMetric || previous.value !== 1 ||
          (previous.video_path != null && previous.video_path !== body.eventId + ".mp4")))
        fail(409, "Event identifier already belongs to another event.");
      if (body.recordingStatus === "ready") await clipFile(recordingsRoot, body.eventId);
      // value=1 means the contact-plus-movement rule was satisfied; it is not a confidence score.
      // Preserve officer review status, response history, and an already linked clip on retries.
      await client.query(`INSERT INTO threat_alert_history(id,device_id,reading_id,camera_id,metric,value,detected_at,video_path)
        VALUES($1,$2,$3,$4,$5,1,$6,$7)
        ON CONFLICT(id) DO UPDATE SET video_path=COALESCE(threat_alert_history.video_path,EXCLUDED.video_path)`,
      [body.eventId, sourceDevice, body.readingId ?? null, device.id, cameraMetric, body.detectedAt,
        body.recordingStatus === "ready" ? body.eventId + ".mp4" : null]);
    });
    res.status(201).json({ recorded: true });
  });
}

function mountCameraEvents(app, { pool, allow, recordingsRoot = process.env.CAMERA_RECORDINGS_DIR || defaultRecordings }) {
  app.get("/api/camera-events", allow("alerts.read"), async (_req, res) => {
    const rows = (await pool.query(`SELECT a.*,d.plant_id FROM threat_alert_history a JOIN iot_device d ON d.id=a.camera_id
      WHERE a.camera_id IS NOT NULL AND a.metric=$1 AND a.id ~ '^[a-f0-9]{32}$'
      ORDER BY a.detected_at DESC,a.id DESC LIMIT 101`, [cameraMetric])).rows;
    const events = await Promise.all(rows.slice(0, 100).map(async row => {
      const metadata = await clipMetadata(recordingsRoot, row);
      const ready = row.video_path === row.id + ".mp4";
      return {
        eventId: row.id, cameraId: row.camera_id, plantId: metadata?.plantId ?? String(row.plant_id), eventType: cameraMetric,
        title: "Camera contact + MPU6050 movement",
        description: "Camera contact with sensor movement detected. Please review.", confidence: null,
        detectedAt: row.detected_at, recordingStartedAt: row.detected_at,
        recordingEndedAt: metadata?.recordingEndedAt ?? undefined,
        durationSeconds: metadata?.recordingEndedAt
          ? Math.max(0, Math.round((Date.parse(metadata.recordingEndedAt) - Date.parse(metadata.recordingStartedAt)) / 1000)) : undefined,
        recordingStatus: ready ? "ready" : metadata?.recordingStatus === "ready" ? "processing" : metadata?.recordingStatus ?? "unavailable",
        status: row.status,
        videoUrl: ready ? `/api/data/camera-events/${row.id}/video` : undefined,
      };
    }));
    res.json({ events, hasMore: rows.length > 100 });
  });
  app.get("/api/camera-events/:id/video", allow("alerts.read"), async (req, res, next) => {
    const id = req.params.id;
    if (!eventId.test(id)) fail(400, "Invalid event identifier.");
    const row = (await pool.query("SELECT video_path FROM threat_alert_history WHERE id=$1 AND camera_id IS NOT NULL AND metric=$2", [id, cameraMetric])).rows[0];
    if (!row) fail(404, "Camera event not found.");
    if (row.video_path !== id + ".mp4") fail(409, "Recording is not ready.");
    const clip = await clipFile(recordingsRoot, id);
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", `inline; filename="${id}.mp4"`);
    // Express handles HEAD, byte ranges, 206 and 416 without buffering the video.
    res.sendFile(clip.file, { cacheControl: false, lastModified: false, dotfiles: "deny" }, error => {
      if (error && !res.headersSent) next(error);
    });
  });
}
module.exports = { mountCameraIngestion, mountCameraEvents, defaultRecordings };
