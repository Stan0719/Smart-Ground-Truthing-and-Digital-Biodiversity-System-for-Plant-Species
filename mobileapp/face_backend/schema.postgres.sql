-- Private face schema, distinct from the authoritative account tables.
CREATE TABLE IF NOT EXISTS accounts(email TEXT PRIMARY KEY,name TEXT,role TEXT,salt TEXT,password TEXT,template TEXT);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,email TEXT REFERENCES accounts(email),expires DOUBLE PRECISION);
CREATE TABLE IF NOT EXISTS challenges(token TEXT PRIMARY KEY,expires DOUBLE PRECISION);
CREATE TABLE IF NOT EXISTS real_face_templates(user_id TEXT PRIMARY KEY,template TEXT NOT NULL,pipeline TEXT NOT NULL,created DOUBLE PRECISION NOT NULL);
CREATE TABLE IF NOT EXISTS face_account_links(prototype_email TEXT PRIMARY KEY REFERENCES accounts(email),real_user_id TEXT UNIQUE NOT NULL,created DOUBLE PRECISION NOT NULL);
CREATE TABLE IF NOT EXISTS legacy_face_replacements(prototype_email TEXT PRIMARY KEY REFERENCES accounts(email),real_user_id TEXT NOT NULL,created DOUBLE PRECISION NOT NULL);
