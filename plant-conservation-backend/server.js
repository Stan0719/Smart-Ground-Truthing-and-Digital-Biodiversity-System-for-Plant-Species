
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

// Start the server (only once)
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
