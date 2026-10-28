-- Select the database
USE biodiversity_db;

-- Inserting sample records for testing the login system
INSERT INTO users (username, email, password_hash, role) VALUES 
('dr_harrison', 'harrison@sarawakforestry.gov.my', '$2b$12$eXampleHashedPassword1', 'Botanist'),
('officer_siti', 'siti@sarawakforestry.gov.my', '$2b$12$eXampleHashedPassword2', 'Conservation Officer'),
('public_user1', 'visitor@gmail.com', '$2b$12$eXampleHashedPassword3', 'Visitor');