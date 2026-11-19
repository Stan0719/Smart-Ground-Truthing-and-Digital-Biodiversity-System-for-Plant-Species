"use strict";
const { randomBytes, randomUUID } = require("node:crypto");
const {
  transaction,
  audit,
  subject,
  fail,
  text,
  hash,
} = require("./domain.cjs");
const { projectGps } = require("../shared/rbac.cjs");
const {
  CHECKPOINT_INTERVAL_MS,
  addReading,
  bucketStart,
  cloneAccumulator,
  metrics,
  newAccumulator,
  normalizedValues,
  payloadHash,
  restoreAccumulator,
  runtimeFor,
  summarize,
  withDeviceLock,
} = require("./iot-reading-cache.cjs");
const dhtHealthStatuses = new Set([
  "Operational",
  "Waiting for valid reading",
  "WARNING - No valid readings",
  "ERROR - Reading is stale",
  "WARNING - Repeated failures",
]);
function thresholds(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !metrics.includes(k))
  )
    fail(400, "Invalid thresholds.");
  for (const v of Object.values(value))
    if (typeof v !== "number" || !Number.isFinite(v))
      fail(400, "Thresholds must be finite numbers.");
  return value;
}
const MAX_BIGINT = 9223372036854775807n;
function positiveBigint(value) {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value))
    return false;
  try {
    return BigInt(value) <= MAX_BIGINT;
  } catch {
    return false;
  }
}
function mountDeviceIngestion(app, { pool }) {
  const runtime = runtimeFor(pool);
  // A sensor key can read only its own movement, bound to its assigned plant.
  // This route is mounted before browser-session authentication, like ingestion.
  app.get("/api/device/movement", async (req, res) => {
    const match = /^Device ([a-f0-9]{64})$/.exec(req.headers.authorization || "");
    if (!match) fail(401, "Device authentication required.");
    const deviceId = text(req.query.device_id, 100);
    if (!positiveBigint(req.query.plant_id)) fail(400, "A valid plant ID is required.");
    const device = (await pool.query(
      "SELECT id,device_type,plant_id,status FROM iot_device WHERE id=$1 AND key_hash=$2",
      [deviceId, hash(match[1])],
    )).rows[0];
    if (!device || device.status !== "Active") fail(401, "Device authentication failed.");
    if (device.device_type !== "Sensor" || String(device.plant_id) !== req.query.plant_id)
      fail(403, "The active sensor must be assigned to this plant.");
    const reading = runtime.latest.get(device.id);
    const capture = reading?.values?._capture;
    const movement = reading?.values?.movement;
    const observed = typeof capture?.observed_at === "string" ? Date.parse(capture.observed_at) : NaN;
    const capturedAge = Date.now() - observed;
    const receivedAge = reading ? Date.now() - new Date(reading.created_at).getTime() : NaN;
    let status = "unavailable";
    if (capture?.mpu_connected === true && [0, 1].includes(movement) && Number.isFinite(observed)) {
      status = capturedAge < -1000 || capturedAge > 5000 || receivedAge < -1000 || receivedAge > 5000
        ? "stale" : movement === 1 ? "moving" : "stationary";
    }
    res.json({ deviceId: device.id, plantId: String(device.plant_id), status,
      movement: ["moving", "stationary"].includes(status) ? movement : null,
      observedAt: Number.isFinite(observed) ? capture.observed_at : null,
      readingId: null, maxAgeSeconds: 5 });
  });

  app.post("/api/device/readings", async (req, res) => {
    const match = /^Device ([a-f0-9]{64})$/.exec(
      req.headers.authorization || "",
    );
    if (!match) fail(401, "Device authentication required.");
    const b = req.body;
    thresholds(b.values);
    let capture;
    if (b.capture !== undefined) {
      const c = b.capture;
      if (!c || typeof c !== "object" || Array.isArray(c) ||
          Object.keys(c).some((key) => !["observed_at", "mpu_connected", "dht_status"].includes(key)) ||
          typeof c.observed_at !== "string" || !Number.isFinite(Date.parse(c.observed_at)) ||
          ![true, false, null].includes(c.mpu_connected) ||
          (c.dht_status !== undefined && c.dht_status !== null &&
            (typeof c.dht_status !== "string" || !dhtHealthStatuses.has(c.dht_status))))
        fail(400, "Invalid sensor capture metadata.");
      capture = {
        observed_at: c.observed_at,
        mpu_connected: c.mpu_connected,
        ...(c.dht_status === undefined ? {} : { dht_status: c.dht_status }),
      };
    }
    if (b.client_key !== undefined) text(b.client_key, 100);
    const targetDeviceId = text(b.device_id, 100);
    for (const [metric, value] of Object.entries(b.values)) {
      if (metric === "humidity" && (value < 0 || value > 100))
        fail(400, "Humidity must be a percentage from 0 to 100.");
      if (metric === "temperature" && value < -273.15)
        fail(400, "Temperature must be degrees Celsius above absolute zero.");
      if (["soilMoisture", "rainfall", "sound"].includes(metric) && value < 0)
        fail(400, "Raw sensor readings must be nonnegative.");
      if (metric === "movement" && ![0, 1].includes(value))
        fail(400, "Movement must be 0 or 1.");
    }
    if (!Object.keys(b.values).length)
      fail(400, "At least one reading is required.");
    const acceptedValues = normalizedValues(b.values, capture);
    const acceptedHash = payloadHash(acceptedValues);
    const outcome = await withDeviceLock(runtime, targetDeviceId, async () => {
      const observedAt = capture ? Date.parse(capture.observed_at) : Date.now();
      const result = await transaction(pool, async c => {
        const device = (await c.query(
          "SELECT * FROM iot_device WHERE id=$1 AND key_hash=$2 AND status='Active' FOR UPDATE",
          [targetDeviceId, hash(match[1])],
        )).rows[0];
        if (!device) fail(401, "Device authentication failed.");
        if (device.device_type !== "Sensor") fail(403, "Camera devices cannot submit sensor readings.");

        // Retain idempotency for receipts created before the aggregate cutover.
        if (b.client_key) {
          const previous = (await c.query(
            'SELECT r."values" FROM iot_ingestion_receipt i JOIN sensor_reading r ON r.id=i.reading_id WHERE i.device_id=$1 AND i.client_key=$2',
            [device.id, b.client_key],
          )).rows[0];
          if (previous) {
            if (metrics.some(metric => previous.values[metric] !== b.values[metric]))
              fail(409, "Reading key already belongs to a different payload.");
            return { duplicate: true, accumulator: runtime.accumulators.get(device.id) || null };
          }
        }

        let accumulator = runtime.accumulators.get(device.id) || null;
        if (!accumulator) {
          const checkpoint = (await c.query(
            "SELECT bucket_start,last_observed_at,sample_count,metrics,active_thresholds,last_payload_hash,updated_at FROM iot_reading_checkpoint WHERE device_id=$1 FOR UPDATE",
            [device.id],
          )).rows[0];
          accumulator = restoreAccumulator(checkpoint);
          if (!accumulator) {
            // Cut over without re-aggregating the device's latest legacy row.
            const legacy = (await c.query(
              'SELECT "values",created_at FROM sensor_reading WHERE device_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',
              [device.id],
            )).rows[0];
            if (legacy) {
              const capturedAt = legacy.values?._capture?.observed_at;
              const legacyObservedAt = typeof capturedAt === "string" && Number.isFinite(Date.parse(capturedAt))
                ? Date.parse(capturedAt) : new Date(legacy.created_at).getTime();
              accumulator = newAccumulator(legacyObservedAt);
              accumulator.lastObservedAt = legacyObservedAt;
              accumulator.lastPayloadHash = payloadHash(legacy.values);
            }
          }
        }
        if (accumulator && observedAt < accumulator.lastObservedAt)
          return { duplicate: true, accumulator };
        if (accumulator && observedAt === accumulator.lastObservedAt) {
          if (accumulator.lastPayloadHash && acceptedHash !== accumulator.lastPayloadHash)
            fail(409, "Reading timestamp already belongs to a different payload.");
          return { duplicate: true, accumulator };
        }

        const hadAccumulator = Boolean(accumulator);
        let candidate = accumulator ? cloneAccumulator(accumulator) : newAccumulator(observedAt);
        const incomingBucket = bucketStart(observedAt);
        let crossedWindow = false;
        let completed = null;
        if (incomingBucket > candidate.bucketStart) {
          if (candidate.sampleCount > 0) completed = summarize(candidate);
          candidate = newAccumulator(observedAt, candidate.activeThresholds);
          crossedWindow = true;
        }
        addReading(candidate, b.values);
        candidate.lastObservedAt = observedAt;
        candidate.lastPayloadHash = acceptedHash;

        let thresholdStateChanged = false;
        for (const metric of metrics) {
          const threshold = device.thresholds[metric];
          const wasActive = candidate.activeThresholds[metric] === true;
          if (threshold === undefined) {
            if (wasActive) {
              candidate.activeThresholds[metric] = false;
              thresholdStateChanged = true;
            }
            continue;
          }
          const value = b.values[metric];
          if (value === undefined) continue;
          const isActive = value > threshold;
          if (isActive !== wasActive) {
            candidate.activeThresholds[metric] = isActive;
            thresholdStateChanged = true;
            if (isActive) await c.query(
              "INSERT INTO threat_alert_history(id,device_id,reading_id,metric,value) VALUES($1,$2,NULL,$3,$4)",
              [randomUUID(), device.id, metric, value],
            );
          }
        }

        if (completed) await c.query(
          "INSERT INTO iot_reading_aggregate(device_id,bucket_start,bucket_end,sample_count,metrics) " +
          "VALUES($1,$2,$3,$4,$5) ON CONFLICT(device_id,bucket_start) DO UPDATE SET " +
          "bucket_end=EXCLUDED.bucket_end,sample_count=EXCLUDED.sample_count,metrics=EXCLUDED.metrics",
          [device.id, completed.bucketStart, completed.bucketEnd, completed.sampleCount, completed.metrics],
        );

        const now = Date.now();
        const shouldCheckpoint = !hadAccumulator || !candidate.persistedAt ||
          now - candidate.persistedAt >= CHECKPOINT_INTERVAL_MS || crossedWindow || thresholdStateChanged;
        if (shouldCheckpoint) {
          await c.query(
            "INSERT INTO iot_reading_checkpoint(device_id,bucket_start,last_observed_at,sample_count,metrics,active_thresholds,last_payload_hash,updated_at) " +
            "VALUES($1,$2,$3,$4,$5,$6,$7,CURRENT_TIMESTAMP) ON CONFLICT(device_id) DO UPDATE SET " +
            "bucket_start=EXCLUDED.bucket_start,last_observed_at=EXCLUDED.last_observed_at," +
            "sample_count=EXCLUDED.sample_count,metrics=EXCLUDED.metrics," +
            "active_thresholds=EXCLUDED.active_thresholds,last_payload_hash=EXCLUDED.last_payload_hash,updated_at=CURRENT_TIMESTAMP",
            [device.id, new Date(candidate.bucketStart).toISOString(), new Date(candidate.lastObservedAt).toISOString(),
              candidate.sampleCount, candidate.metrics, candidate.activeThresholds, candidate.lastPayloadHash],
          );
          candidate.persistedAt = now;
          await c.query("UPDATE iot_device SET last_seen=CURRENT_TIMESTAMP WHERE id=$1", [device.id]);
        }
        return { duplicate: false, accumulator: candidate };
      });
      if (result.accumulator) runtime.accumulators.set(targetDeviceId, result.accumulator);
      if (!result.duplicate) runtime.latest.set(targetDeviceId, {
        id: randomUUID(), device_id: targetDeviceId,
        values: acceptedValues, created_at: new Date().toISOString(),
      });
      return result;
    });
    res.status(201).json({ recorded: !outcome.duplicate, live: true });
  });
}
function mountIoT(app, { pool, allow }) {
  const runtime = runtimeFor(pool);
  require("./iot-alert-context.cjs").mountAlertContext(app, { pool, allow });
  app.get("/api/iot/devices", allow("devices.read"), async (req, res) => {
    const rows = (
      await pool.query(
        `SELECT d.sensor_id,d.device_name,d.device_type,d.serial_number,
          d.location_description,d.status,d.installed_at,
          CASE WHEN latest.reading_id IS NULL THEN NULL
            ELSE row_to_json(latest) END AS latest_reading
        FROM public.sensor_device AS d
        LEFT JOIN LATERAL (
          SELECT r.reading_id,r.plant_id,r.temperature_c,r.humidity,
            r.soil_moisture,r.rainfall_mm,r.motion_detected,
            r.gps_latitude,r.gps_longitude,r.recorded_at
          FROM public.sensor_reading AS r
          WHERE r.sensor_id=d.sensor_id
          ORDER BY r.recorded_at DESC,r.reading_id DESC
          LIMIT 1
        ) AS latest ON TRUE
        ORDER BY d.sensor_id`,
      )
    ).rows;
    res.json({
      message: "IoT devices retrieved.",
      count: rows.length,
      devices: projectGps(rows, req.user),
    });
  });
  app.get(
    "/api/iot/sensors/:sensorId/readings",
    allow("readings.read"),
    async (req, res) => {
      const { sensorId } = req.params;
      if (!positiveBigint(sensorId))
        return res.status(400).json({ message: "Invalid sensor ID." });

      const sensor = (
        await pool.query(
          `SELECT sensor_id,device_name,device_type,serial_number,
            location_description,status
          FROM public.sensor_device
          WHERE sensor_id=$1`,
          [sensorId],
        )
      ).rows[0];
      if (!sensor)
        return res.status(404).json({ message: "Sensor not found." });

      const readings = (
        await pool.query(
          `SELECT reading_id,plant_id,temperature_c,humidity,soil_moisture,
            rainfall_mm,motion_detected,gps_latitude,gps_longitude,recorded_at
          FROM public.sensor_reading
          WHERE sensor_id=$1
          ORDER BY recorded_at DESC,reading_id DESC`,
          [sensorId],
        )
      ).rows;
      return res.json({
        message: "Sensor readings retrieved.",
        sensor,
        count: readings.length,
        readings: projectGps(readings, req.user),
      });
    },
  );
  app.get("/api/iot/alerts", allow("alerts.read"), async (_req, res) => {
    const rows = (
      await pool.query(
        `SELECT a.alert_id,a.plant_id,a.reading_id,r.sensor_id,
          d.device_name,a.alert_type,a.severity,a.confidence,a.description,
          a.image_path,a.status,a.created_at,a.resolved_by,a.resolved_at,
          s.scientific_name,s.common_name
        FROM public.threat_alert AS a
        JOIN public.plant_record AS p ON p.plant_id=a.plant_id
        JOIN public.species AS s ON s.species_id=p.species_id
        LEFT JOIN public.sensor_reading AS r ON r.reading_id=a.reading_id
        LEFT JOIN public.sensor_device AS d ON d.sensor_id=r.sensor_id
        ORDER BY a.created_at DESC,a.alert_id DESC`,
      )
    ).rows;
    res.json({
      message: "Threat alerts retrieved.",
      count: rows.length,
      alerts: rows,
    });
  });
  app.get("/api/devices", allow("devices.read"), async (_req, res) => {
    const devices = (await pool.query(
      "SELECT d.id,d.name,d.device_type,d.plant_id,d.status,d.thresholds,d.last_seen," +
      "CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object('id',r.id,'device_id',r.device_id,'values',r.\"values\",'created_at',r.created_at) END AS latest_reading " +
      "FROM iot_device d LEFT JOIN LATERAL (SELECT id,device_id,\"values\",created_at FROM sensor_reading " +
      "WHERE device_id=d.id ORDER BY created_at DESC,id DESC LIMIT 1) r ON true ORDER BY d.name,d.id",
    )).rows;
    for (const device of devices) {
      const live = runtime.latest.get(device.id);
      if (live) device.latest_reading = live;
    }
    res.json({ devices });
  });
  app.get(
    "/api/devices/:id/readings",
    allow("readings.read"),
    async (req, res) => {
      if (
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
          req.params.id,
        )
      )
        fail(400, "Invalid device identifier.");
      const pageNumber = (value, fallback, max) => {
        if (value === undefined) return fallback;
        if (
          typeof value !== "string" ||
          !/^[1-9][0-9]{0,5}$/.test(value) ||
          Number(value) > max
        )
          fail(400, "Invalid pagination.");
        return Number(value);
      };
      const limit = pageNumber(req.query.limit, 50, 100);
      const page = pageNumber(req.query.page, 1, 10000);
      const device = (
        await pool.query("SELECT id FROM iot_device WHERE id=$1", [
          req.params.id,
        ])
      ).rows[0];
      if (!device) fail(404, "Device not found.");
      const isLiveLatestRequest = page === 1 && limit === 1;
      const live = isLiveLatestRequest ? runtime.latest.get(req.params.id) : null;
      const rows = (
        await pool.query(
          'SELECT id,device_id,"values",created_at FROM sensor_reading WHERE device_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3',
          [req.params.id, limit + 1, (page - 1) * limit],
        )
      ).rows;
      res.json({
        readings: isLiveLatestRequest ? (live ? [live] : []) : rows.slice(0, limit),
        page,
        limit,
        hasMore: isLiveLatestRequest ? rows.length > 0 : rows.length > limit,
      });
    },
  );
  app.post("/api/devices", allow("devices.manage"), async (req, res) => {
    const key = randomBytes(32).toString("hex"),
      deviceId = randomUUID();

    text(req.body.name, 100);

    const deviceType = req.body.device_type ?? "Sensor";

    if (!["Sensor", "Camera"].includes(deviceType)) {
      fail(400, "Invalid device type. Use Sensor or Camera.");
    }

    await transaction(pool, async (c) => {
      await c.query(
        "INSERT INTO iot_device(id,name,plant_id,key_hash,device_type) VALUES($1,$2,$3,$4,$5)",
        [
          deviceId,
          req.body.name,
          req.body.plant_id || null,
          hash(key),
          deviceType,
        ],
      );

      await audit(c, req.user, "device_registered", deviceId);
    });

    res.status(201).json({
      id: deviceId,
      provisioningKey: key,
      message: "Store this key on the device. It cannot be read again.",
    });
  });
  app.patch("/api/devices/:id", allow("devices.manage"), async (req, res) => {
    text(req.body.name, 100);
    if (!["Active", "Inactive"].includes(req.body.status))
      fail(400, "Invalid device status.");
    await transaction(pool, async (c) => {
      const result = await c.query(
        "UPDATE iot_device SET name=$1,status=$2 WHERE id=$3 RETURNING id",
        [req.body.name, req.body.status, req.params.id],
      );
      if (!result.rows.length) fail(404, "Device not found.");
      await audit(c, req.user, "device_updated", req.params.id);
    });
    res.json({ updated: true });
  });
  app.patch(
    "/api/devices/:id/thresholds",
    allow("thresholds.manage"),
    async (req, res) => {
      thresholds(req.body.thresholds);
      await transaction(pool, async (c) => {
        const result = await c.query(
          "UPDATE iot_device SET thresholds=$1 WHERE id=$2 RETURNING id",
          [req.body.thresholds, req.params.id],
        );
        if (!result.rows.length) fail(404, "Device not found.");
        await audit(c, req.user, "thresholds_updated", req.params.id);
      });
      res.json({ updated: true });
    },
  );
  app.get("/api/readings", allow("readings.read"), async (_req, res) => {
    const persisted = (await pool.query(
      "SELECT * FROM sensor_reading ORDER BY created_at DESC LIMIT 500",
    )).rows;
    const rows = new Map(persisted.map(row => [row.id, row]));
    for (const live of runtime.latest.values()) rows.set(live.id, live);
    res.json({
      readings: [...rows.values()]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at) || String(b.id).localeCompare(String(a.id)))
        .slice(0, 500),
    });
  });
  app.get("/api/alerts", allow("alerts.read"), async (req, res) =>
    res.json({
      alerts: (
        await pool.query(
          "SELECT * FROM threat_alert_history ORDER BY created_at DESC LIMIT 500",
        )
      ).rows,
      responses: (
        await pool.query(
          "SELECT * FROM threat_response ORDER BY created_at DESC LIMIT 500",
        )
      ).rows,
    }),
  );
  app.post(
    "/api/alerts/:id/responses",
    allow("responses.manage"),
    async (req, res) => {
      const note = text(req.body.note);
      if (!["Reviewing", "Resolved"].includes(req.body.status))
        fail(400, "Invalid response status.");
      await transaction(pool, async (c) => {
        const row = (
          await c.query(
            "SELECT status FROM threat_alert_history WHERE id=$1 FOR UPDATE",
            [req.params.id],
          )
        ).rows[0];
        if (!row) fail(404, "Alert not found.");
        if (row.status === "Resolved") fail(409, "Alert is already resolved.");
        await c.query(
          "INSERT INTO threat_response(id,alert_id,officer_subject,note,status) VALUES($1,$2,$3,$4,$5)",
          [
            randomUUID(),
            req.params.id,
            subject(req.user),
            note,
            req.body.status,
          ],
        );
        await c.query("UPDATE threat_alert_history SET status=$1 WHERE id=$2", [
          req.body.status,
          req.params.id,
        ]);
        await audit(c, req.user, "alert_response", req.params.id);
      });
      res.json({ updated: true });
    },
  );
}
module.exports = { mountIoT, mountDeviceIngestion, thresholds };
