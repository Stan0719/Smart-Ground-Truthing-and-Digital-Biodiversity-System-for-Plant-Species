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

// Get all plant records
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
        pl.recorded_at AS location_recorded_at

      FROM public.plant_record AS pr

      LEFT JOIN public.species AS s
        ON pr.species_id = s.species_id

      LEFT JOIN public.genus AS g
        ON s.genus_id = g.genus_id

      LEFT JOIN public.family AS f
        ON g.family_id = f.family_id

      LEFT JOIN public.plant_location AS pl
        ON pr.plant_id = pl.plant_id

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

// Start the server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});