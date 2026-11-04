// Historical prototype; not used by npm start.
require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Allow the local Expo web app to access the API
app.use(cors({
  origin: [
    'http://localhost:8081',
    'http://127.0.0.1:8081'
  ]
}));

// Parse incoming JSON requests
app.use(express.json());

// Connect to Supabase when DATABASE_URL is configured.
// Otherwise, continue using existing local PostgreSQL settings.
const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    })
  : new Pool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    });

// Basic test route
app.get('/', (req, res) => {
  res.send('Plant Conservation API is running!');
});

// Test PostgreSQL and PostGIS connection
app.get('/api/db-test', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        current_database() AS database_name,
        current_user AS connected_user,
        PostGIS_Full_Version() AS postgis_version;
    `);

    res.json({
      message: 'Database connection successful!',
      database: result.rows[0],
    });
  } catch (error) {
    console.error('Database connection error:', error);

    res.status(500).json({
      message: 'Database connection failed.',
    });
  }
});

// List existing database tables (read-only)
app.get('/api/tables', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);

    res.json({
      message: 'Tables retrieved successfully!',
      count: result.rows.length,
      tables: result.rows.map(row => row.table_name),
    });
  } catch (error) {
    console.error('Table query error:', error.message);

    res.status(500).json({
      message: 'Unable to retrieve tables.',
    });
  }
});

// Get all IoT devices with each device's latest reading (read-only)
app.get('/api/iot/devices', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        sd.sensor_id,
        sd.device_name,
        sd.device_type,
        sd.serial_number,
        sd.location_description,
        sd.status,
        sd.installed_at,
        latest_reading.reading_id,
        latest_reading.plant_id,
        latest_reading.temperature_c,
        latest_reading.humidity,
        latest_reading.soil_moisture,
        latest_reading.rainfall_mm,
        latest_reading.motion_detected,
        latest_reading.gps_latitude,
        latest_reading.gps_longitude,
        latest_reading.recorded_at
      FROM public.sensor_device AS sd
      LEFT JOIN LATERAL (
        SELECT
          sr.reading_id,
          sr.plant_id,
          sr.temperature_c,
          sr.humidity,
          sr.soil_moisture,
          sr.rainfall_mm,
          sr.motion_detected,
          sr.gps_latitude,
          sr.gps_longitude,
          sr.recorded_at
        FROM public.sensor_reading AS sr
        WHERE sr.sensor_id = sd.sensor_id
        ORDER BY sr.recorded_at DESC
        LIMIT 1
      ) AS latest_reading ON true
      ORDER BY sd.sensor_id ASC;
    `);

    const devices = result.rows.map(row => ({
      sensor_id: row.sensor_id,
      device_name: row.device_name,
      device_type: row.device_type,
      serial_number: row.serial_number,
      location_description: row.location_description,
      status: row.status,
      installed_at: row.installed_at,
      latest_reading: row.reading_id === null
        ? null
        : {
            reading_id: row.reading_id,
            plant_id: row.plant_id,
            temperature_c: row.temperature_c,
            humidity: row.humidity,
            soil_moisture: row.soil_moisture,
            rainfall_mm: row.rainfall_mm,
            motion_detected: row.motion_detected,
            gps_latitude: row.gps_latitude,
            gps_longitude: row.gps_longitude,
            recorded_at: row.recorded_at
          }
    }));

    return res.json({
      message: 'IoT devices retrieved successfully!',
      count: devices.length,
      devices
    });
  } catch (error) {
    console.error('IoT device query error:', error);

    return res.status(500).json({
      message: 'Unable to retrieve IoT devices.'
    });
  }
});

// Get historical readings for one sensor device (read-only)
app.get('/api/iot/sensors/:sensorId/readings', async (req, res) => {
  const sensorId = Number(req.params.sensorId);

  if (!Number.isSafeInteger(sensorId) || sensorId <= 0) {
    return res.status(400).json({
      message: 'Invalid sensor ID.'
    });
  }

  try {
    const sensorResult = await pool.query(`
      SELECT
        sensor_id,
        device_name,
        device_type,
        serial_number,
        location_description,
        status
      FROM public.sensor_device
      WHERE sensor_id = $1
      LIMIT 1;
    `, [sensorId]);

    if (sensorResult.rows.length === 0) {
      return res.status(404).json({
        message: 'Sensor not found.'
      });
    }

    const readingsResult = await pool.query(`
      SELECT
        reading_id,
        plant_id,
        sensor_id,
        temperature_c,
        humidity,
        soil_moisture,
        rainfall_mm,
        motion_detected,
        gps_latitude,
        gps_longitude,
        recorded_at
      FROM public.sensor_reading
      WHERE sensor_id = $1
      ORDER BY recorded_at DESC;
    `, [sensorId]);

    return res.json({
      message: 'Sensor readings retrieved successfully!',
      sensor: sensorResult.rows[0],
      count: readingsResult.rows.length,
      readings: readingsResult.rows
    });
  } catch (error) {
    console.error('Sensor reading history query error:', error);

    return res.status(500).json({
      message: 'Unable to retrieve sensor readings.'
    });
  }
});

// Get all threat alerts with related sensor and plant details (read-only)
app.get('/api/iot/alerts', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        ta.alert_id,
        ta.plant_id,
        ta.reading_id,
        sr.sensor_id,
        sd.device_name,
        ta.alert_type,
        ta.severity,
        ta.confidence,
        ta.description,
        ta.image_path,
        ta.status,
        ta.created_at,
        ta.resolved_by,
        ta.resolved_at,
        s.scientific_name,
        s.common_name
      FROM public.threat_alert AS ta
      LEFT JOIN public.sensor_reading AS sr
        ON ta.reading_id = sr.reading_id
      LEFT JOIN public.sensor_device AS sd
        ON sr.sensor_id = sd.sensor_id
      LEFT JOIN public.plant_record AS pr
        ON ta.plant_id = pr.plant_id
      LEFT JOIN public.species AS s
        ON pr.species_id = s.species_id
      ORDER BY ta.created_at DESC;
    `);

    return res.json({
      message: 'Threat alerts retrieved successfully!',
      count: result.rows.length,
      alerts: result.rows
    });
  } catch (error) {
    console.error('Threat alert query error:', error);

    return res.status(500).json({
      message: 'Unable to retrieve threat alerts.'
    });
  }
});

// Get all plant species (read-only)
app.get('/api/species', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        s.species_id,
        s.scientific_name,
        s.common_name,
        g.genus_name,
        f.family_name,
        cs.status_name AS conservation_status,
        s.description,
        s.registered_at
      FROM public.species AS s
      LEFT JOIN public.genus AS g
        ON s.genus_id = g.genus_id
      LEFT JOIN public.family AS f
        ON g.family_id = f.family_id
      LEFT JOIN public.conservation_status AS cs
        ON s.status_id = cs.status_id
      ORDER BY s.scientific_name ASC;
    `);

    res.json({
      message: 'Species retrieved successfully!',
      count: result.rows.length,
      species: result.rows,
    });
  } catch (error) {
    console.error('Species query error:', error.message);

    res.status(500).json({
      message: 'Unable to retrieve species.',
    });
  }
});

// Get one plant species by ID
app.get('/api/species/:id', async (req, res) => {
  const speciesId = Number(req.params.id);

  if (!Number.isSafeInteger(speciesId) || speciesId <= 0) {
    return res.status(400).json({
      message: 'Invalid species ID.'
    });
  }

  try {
    const result = await pool.query(`
      SELECT
        s.species_id,
        s.scientific_name,
        s.common_name,
        g.genus_name,
        f.family_name,
        cs.status_name AS conservation_status,
        s.description,
        s.registered_at
      FROM public.species AS s
      LEFT JOIN public.genus AS g
        ON s.genus_id = g.genus_id
      LEFT JOIN public.family AS f
        ON g.family_id = f.family_id
      LEFT JOIN public.conservation_status AS cs
        ON s.status_id = cs.status_id
      WHERE s.species_id = $1
      LIMIT 1;
    `, [speciesId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: 'Species not found.'
      });
    }

    return res.json({
      message: 'Species retrieved successfully!',
      species: result.rows[0]
    });

  } catch (error) {
    console.error('Species detail query error:', error.message);

    return res.status(500).json({
      message: 'Unable to retrieve species.'
    });
  }
});

// Get all species requests (read-only)
app.get('/api/species-requests', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        sr.request_id,
        sr.requested_by,
        sr.reviewed_by,
        sr.suggested_common_name,
        sr.genus_id,
        g.genus_name,
        sr.description,
        sr.habitat,
        sr.request_status,
        sr.review_comment,
        sr.submitted_at,
        sr.reviewed_at,
        sr.approved_species_id
      FROM public.species_request AS sr
      LEFT JOIN public.genus AS g
        ON sr.genus_id = g.genus_id
      ORDER BY sr.submitted_at DESC;
    `);

    return res.json({
      message: 'Species requests retrieved successfully!',
      count: result.rows.length,
      species_requests: result.rows
    });
  } catch (error) {
    console.error('Species request list query error:', error);

    return res.status(500).json({
      message: 'Unable to retrieve species requests.'
    });
  }
});

// Get one species request by ID (read-only)
app.get('/api/species-requests/:id', async (req, res) => {
  const requestId = Number(req.params.id);

  if (!Number.isSafeInteger(requestId) || requestId <= 0) {
    return res.status(400).json({
      message: 'Invalid species request ID.'
    });
  }

  try {
    const result = await pool.query(`
      SELECT
        sr.request_id,
        sr.requested_by,
        sr.reviewed_by,
        sr.suggested_common_name,
        sr.genus_id,
        g.genus_name,
        sr.description,
        sr.habitat,
        sr.request_status,
        sr.review_comment,
        sr.submitted_at,
        sr.reviewed_at,
        sr.approved_species_id
      FROM public.species_request AS sr
      LEFT JOIN public.genus AS g
        ON sr.genus_id = g.genus_id
      WHERE sr.request_id = $1
      LIMIT 1;
    `, [requestId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: 'Species request not found.'
      });
    }

    return res.json({
      message: 'Species request retrieved successfully!',
      species_request: result.rows[0]
    });
  } catch (error) {
    console.error('Species request detail query error:', error);

    return res.status(500).json({
      message: 'Unable to retrieve species request.'
    });
  }
});

// Register a plant and its GPS location
app.post('/api/plants', async (req, res) => {
  const {
    species_id,
    registered_by,
    latitude,
    longitude,
    accuracy_m
  } = req.body;

  // Validate required values
  if (
    !Number.isSafeInteger(species_id) ||
    species_id <= 0 ||
    !Number.isSafeInteger(registered_by) ||
    registered_by <= 0 ||
    typeof latitude !== 'number' ||
    typeof longitude !== 'number' ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return res.status(400).json({
      message: 'Please provide valid species_id, registered_by, latitude and longitude.'
    });
  }

  if (
    accuracy_m !== undefined &&
    accuracy_m !== null &&
    (
      typeof accuracy_m !== 'number' ||
      !Number.isFinite(accuracy_m) ||
      accuracy_m < 0
    )
  ) {
    return res.status(400).json({
      message: 'accuracy_m must be a non-negative number.'
    });
  }

  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query('BEGIN');
    transactionStarted = true;

    // Create the plant record
    const plantResult = await client.query(
      `INSERT INTO public.plant_record
        (species_id, registered_by)
       VALUES ($1::bigint, $2::bigint)
       RETURNING plant_id, species_id, registered_by,
                 current_status, registered_at`,
      [species_id, registered_by]
    );

    const plant = plantResult.rows[0];

    // Create its GPS location and PostGIS point
    const locationResult = await client.query(
      `INSERT INTO public.plant_location
         (plant_id, latitude, longitude, accuracy_m, geometry)
       VALUES (
         $1, $2, $3, $4,
         ST_SetSRID(
           ST_MakePoint(
             ($3::numeric)::double precision,
             ($2::numeric)::double precision
           ),
           4326
         )
       )
       RETURNING location_id, plant_id, latitude, longitude,
                 accuracy_m, recorded_at`,
      [
        plant.plant_id,
        latitude,
        longitude,
        accuracy_m ?? null
      ]
    );

    await client.query('COMMIT');
    transactionStarted = false;

    return res.status(201).json({
      message: 'Plant registered successfully!',
      plant,
      location: locationResult.rows[0]
    });
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error(
          'Transaction rollback failed:',
          rollbackError.message
        );
      }
    }

    console.error('Plant registration error:', error.message);

    if (error.code === '23503') {
      return res.status(400).json({
        message: 'The supplied species_id or registered_by does not exist.'
      });
    }

    return res.status(500).json({
      message: 'Unable to register the plant.'
    });
  } finally {
    client.release();
  }
});

// Get all plant records with latest approved observation
app.get('/api/plants', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        pr.plant_id,
        pr.species_id,
        pr.registered_by,
        pr.current_status,
        pr.registered_at,

        s.scientific_name,
        s.common_name,

        g.genus_name,
        f.family_name,

        pl.location_id,
        pl.latitude,
        pl.longitude,
        pl.accuracy_m,
        pl.recorded_at AS location_recorded_at,

        latest_obs.observation_id AS latest_observation_id,
        latest_obs.height_cm,
        latest_obs.life_stage,
        latest_obs.health_status,
        latest_obs.morphology,
        latest_obs.notes,
        latest_obs.observed_at AS last_verified_at

      FROM public.plant_record AS pr

      LEFT JOIN public.species AS s
        ON pr.species_id = s.species_id

      LEFT JOIN public.genus AS g
        ON s.genus_id = g.genus_id

      LEFT JOIN public.family AS f
        ON g.family_id = f.family_id

      LEFT JOIN public.plant_location AS pl
        ON pr.plant_id = pl.plant_id

      LEFT JOIN LATERAL (
        SELECT
          po.observation_id,
          po.height_cm,
          po.life_stage,
          po.health_status,
          po.morphology,
          po.notes,
          po.observed_at
        FROM public.plant_observation AS po
        WHERE po.plant_id = pr.plant_id
          AND LOWER(po.status) = 'approved'
        ORDER BY po.observed_at DESC
        LIMIT 1
      ) AS latest_obs ON true

      ORDER BY pr.registered_at DESC;
    `);

    return res.json({
      message: 'Plants retrieved successfully!',
      count: result.rows.length,
      plants: result.rows
    });

  } catch (error) {
    console.error('Plant list query error:', error);

    return res.status(500).json({
      message: 'Unable to retrieve plants.'
    });
  }
});


// Get one plant record by ID
app.get('/api/plants/:id', async (req, res) => {
  const plantId = Number(req.params.id);

  if (!Number.isSafeInteger(plantId) || plantId <= 0) {
    return res.status(400).json({
      message: 'Invalid plant ID.'
    });
  }

  try {
    const result = await pool.query(`
      SELECT
        pr.plant_id,
        pr.species_id,
        pr.registered_by,
        pr.current_status,
        pr.registered_at,

        s.scientific_name,
        s.common_name,

        g.genus_name,
        f.family_name,

        cs.status_name AS conservation_status,

        pl.location_id,
        pl.latitude,
        pl.longitude,
        pl.accuracy_m,
        pl.recorded_at AS location_recorded_at

      FROM public.plant_record AS pr

      LEFT JOIN public.species AS s
        ON pr.species_id = s.species_id

      LEFT JOIN public.genus AS g
        ON s.genus_id = g.genus_id

      LEFT JOIN public.family AS f
        ON g.family_id = f.family_id

      LEFT JOIN public.conservation_status AS cs
        ON s.status_id = cs.status_id

      LEFT JOIN public.plant_location AS pl
        ON pr.plant_id = pl.plant_id

      WHERE pr.plant_id = $1

      LIMIT 1;
    `, [plantId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: 'Plant not found.'
      });
    }

    return res.json({
      message: 'Plant retrieved successfully!',
      plant: result.rows[0]
    });

  } catch (error) {
    console.error('Plant detail query error:', error);

    return res.status(500).json({
      message: 'Unable to retrieve plant.'
    });
  }
});

// Get all plant observations
app.get('/api/observations', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        po.observation_id,
        po.plant_id,
        po.recorded_by,
        po.height_cm,
        po.morphology,
        po.life_stage,
        po.health_status,
        po.notes,
        po.observed_at,
        po.status,

        pr.species_id,
        s.scientific_name,
        s.common_name,

        v.verification_id,
        v.verified_by,
        v.verification_status,
        v.comments AS verification_comments,
        v.verified_at

      FROM public.plant_observation AS po

      LEFT JOIN public.plant_record AS pr
        ON po.plant_id = pr.plant_id

      LEFT JOIN public.species AS s
        ON pr.species_id = s.species_id

      LEFT JOIN public.verification AS v
        ON po.observation_id = v.observation_id

      ORDER BY po.observed_at DESC;
    `);

    return res.json({
      message: 'Observations retrieved successfully!',
      count: result.rows.length,
      observations: result.rows
    });

  } catch (error) {
    console.error('Observation list query error:', error);

    return res.status(500).json({
      message: 'Unable to retrieve observations.'
    });
  }
});

// Get one observation by ID
app.get('/api/observations/:id', async (req, res) => {
  const observationId = Number(req.params.id);

  if (!Number.isSafeInteger(observationId) || observationId <= 0) {
    return res.status(400).json({
      message: 'Invalid observation ID.'
    });
  }

  try {
    const result = await pool.query(`
      SELECT
        po.observation_id,
        po.plant_id,
        po.recorded_by,
        po.height_cm,
        po.morphology,
        po.life_stage,
        po.health_status,
        po.notes,
        po.observed_at,
        po.status,

        pr.species_id,
        pr.current_status AS plant_status,

        s.scientific_name,
        s.common_name,

        g.genus_name,
        f.family_name,

        v.verification_id,
        v.verified_by,
        v.verification_status,
        v.comments AS verification_comments,
        v.verified_at

      FROM public.plant_observation AS po

      LEFT JOIN public.plant_record AS pr
        ON po.plant_id = pr.plant_id

      LEFT JOIN public.species AS s
        ON pr.species_id = s.species_id

      LEFT JOIN public.genus AS g
        ON s.genus_id = g.genus_id

      LEFT JOIN public.family AS f
        ON g.family_id = f.family_id

      LEFT JOIN public.verification AS v
        ON po.observation_id = v.observation_id

      WHERE po.observation_id = $1

      LIMIT 1;
    `, [observationId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: 'Observation not found.'
      });
    }

    return res.json({
      message: 'Observation retrieved successfully!',
      observation: result.rows[0]
    });

  } catch (error) {
    console.error('Observation detail query error:', error);

    return res.status(500).json({
      message: 'Unable to retrieve observation.'
    });
  }
});

// Review an observation
app.patch('/api/observations/:id/review', async (req, res) => {
  const observationId = Number(req.params.id);
  const { decision, comment, verified_by: verifiedBy } = req.body || {};
  const allowedDecisions = [
    'Approved',
    'Rejected',
    'Correction Required',
    'Flagged'
  ];

  if (!Number.isSafeInteger(observationId) || observationId <= 0) {
    return res.status(400).json({
      message: 'Invalid observation ID.'
    });
  }

  if (typeof decision !== 'string' || !allowedDecisions.includes(decision)) {
    return res.status(400).json({
      message: 'Decision must be Approved, Rejected, Correction Required, or Flagged.'
    });
  }

  if (!Number.isSafeInteger(verifiedBy) || verifiedBy <= 0) {
    return res.status(400).json({
      message: 'verified_by must be a positive integer.'
    });
  }

  if (comment !== undefined && comment !== null && typeof comment !== 'string') {
    return res.status(400).json({
      message: 'Comment must be a string.'
    });
  }

  const trimmedComment = typeof comment === 'string' ? comment.trim() : '';
  if (decision !== 'Approved' && !trimmedComment) {
    return res.status(400).json({
      message: `Comment is required when the decision is ${decision}.`
    });
  }

  const storedComment = trimmedComment || 'Submission verified.';
  const client = await pool.connect();
  let transactionStarted = false;

  try {
    await client.query('BEGIN');
    transactionStarted = true;

    const observationExists = await client.query(`
      SELECT observation_id
      FROM public.plant_observation
      WHERE observation_id = $1
      FOR UPDATE;
    `, [observationId]);

    if (observationExists.rows.length === 0) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(404).json({
        message: 'Observation not found.'
      });
    }

    const verifierExists = await client.query(`
      SELECT user_id
      FROM public.users
      WHERE user_id = $1
      LIMIT 1;
    `, [verifiedBy]);

    if (verifierExists.rows.length === 0) {
      await client.query('ROLLBACK');
      transactionStarted = false;
      return res.status(404).json({
        message: 'Verifier not found.'
      });
    }

    const observationResult = await client.query(`
      UPDATE public.plant_observation
      SET status = $1
      WHERE observation_id = $2
      RETURNING *;
    `, [decision, observationId]);

    const existingVerification = await client.query(`
      SELECT verification_id
      FROM public.verification
      WHERE observation_id = $1
      ORDER BY verified_at DESC, verification_id DESC
      LIMIT 1
      FOR UPDATE;
    `, [observationId]);

    const verificationResult = existingVerification.rows.length
      ? await client.query(`
          UPDATE public.verification
          SET
            verified_by = $1,
            verification_status = $2,
            comments = $3,
            verified_at = NOW()
          WHERE verification_id = $4
          RETURNING *;
        `, [verifiedBy, decision, storedComment, existingVerification.rows[0].verification_id])
      : await client.query(`
          INSERT INTO public.verification (
            observation_id,
            verified_by,
            verification_status,
            comments,
            verified_at
          )
          VALUES ($1, $2, $3, $4, NOW())
          RETURNING *;
        `, [observationId, verifiedBy, decision, storedComment]);

    await client.query('COMMIT');
    transactionStarted = false;

    return res.json({
      message: 'Observation review saved successfully!',
      observation: observationResult.rows[0],
      verification: verificationResult.rows[0]
    });
  } catch (error) {
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Observation review rollback failed:', rollbackError.message);
      }
    }

    console.error('Observation review error:', error);

    return res.status(500).json({
      message: 'Unable to save observation review.'
    });
  } finally {
    client.release();
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
