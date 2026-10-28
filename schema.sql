-- Create the database
CREATE DATABASE IF NOT EXISTS biodiversity_db;
USE biodiversity_db;

-- Create the users table supporting multiple roles for authentication
CREATE TABLE IF NOT EXISTS users (
    user_id INT AUTO_INCREMENT PRIMARY KEY, 
    username VARCHAR(100) NOT NULL UNIQUE,
    email VARCHAR(150) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL, -- Stores secure cryptographic password hashes
    role VARCHAR(50) NOT NULL CHECK (role IN ('Botanist', 'Conservation Officer', 'Visitor'))
);