
require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Parse incoming JSON requests
app.use(express.json());

// Connect to your PostgreSQL database
const pool = new Pool({
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
    console.error('Database connection error:', error.message);

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
        console.error('Transaction rollback failed:', rollbackError.message);
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

// Start the server (only once)
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
