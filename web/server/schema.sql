PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 email TEXT NOT NULL UNIQUE,
 role TEXT NOT NULL CHECK(role IN ('Administrator','Conservation Officer','Botanist')),
 status TEXT NOT NULL DEFAULT 'Active' CHECK(status IN ('Active','Inactive','Suspended')),
 password_hash TEXT NOT NULL,
 must_change_password INTEGER NOT NULL DEFAULT 1 CHECK(must_change_password IN (0,1)),
 last_login TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id),
 expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS auth_events (
 id INTEGER PRIMARY KEY,
 created_at INTEGER NOT NULL,
 user_id TEXT,
 ip TEXT NOT NULL,
 reason TEXT NOT NULL,
 actor_id TEXT
);
CREATE INDEX IF NOT EXISTS auth_events_ip_time ON auth_events(ip, created_at);
CREATE TRIGGER IF NOT EXISTS revoke_blocked_sessions AFTER UPDATE OF status ON users
WHEN NEW.status != 'Active'
BEGIN DELETE FROM sessions WHERE user_id = NEW.id; END;

CREATE TABLE IF NOT EXISTS face_service_nonces(nonce TEXT PRIMARY KEY,expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS visitors (
 id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL UNIQUE,
 role TEXT NOT NULL DEFAULT 'Visitor' CHECK(role='Visitor'),
 status TEXT NOT NULL DEFAULT 'Active' CHECK(status IN ('Active','Inactive','Suspended')),
 password_hash TEXT NOT NULL,must_change_password INTEGER NOT NULL DEFAULT 0,last_login TEXT
);
CREATE TABLE IF NOT EXISTS visitor_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES visitors(id),expires_at INTEGER NOT NULL);
CREATE TRIGGER IF NOT EXISTS revoke_blocked_visitor_sessions AFTER UPDATE OF status ON visitors WHEN NEW.status!='Active'
BEGIN DELETE FROM visitor_sessions WHERE user_id=NEW.id; END;
CREATE TABLE IF NOT EXISTS password_resets(id TEXT PRIMARY KEY,user_id TEXT,kind TEXT,code_hash TEXT,expires_at INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,used INTEGER NOT NULL DEFAULT 0);
CREATE TRIGGER IF NOT EXISTS invalidate_user_recovery AFTER UPDATE OF email,password_hash,status ON users
BEGIN UPDATE password_resets SET used=1 WHERE user_id=NEW.id; END;
CREATE TRIGGER IF NOT EXISTS invalidate_visitor_recovery AFTER UPDATE OF email,password_hash,status ON visitors
BEGIN UPDATE password_resets SET used=1 WHERE user_id=NEW.id; END;
CREATE TRIGGER IF NOT EXISTS prevent_visitor_email_collision BEFORE INSERT ON visitors WHEN EXISTS(SELECT 1 FROM users WHERE email=NEW.email)
BEGIN SELECT RAISE(ABORT,'UNIQUE account email'); END;
CREATE TRIGGER IF NOT EXISTS prevent_user_email_collision BEFORE INSERT ON users WHEN EXISTS(SELECT 1 FROM visitors WHERE email=NEW.email)
BEGIN SELECT RAISE(ABORT,'UNIQUE account email'); END;
CREATE TRIGGER IF NOT EXISTS prevent_user_email_update_collision BEFORE UPDATE OF email ON users WHEN EXISTS(SELECT 1 FROM visitors WHERE email=NEW.email)
BEGIN SELECT RAISE(ABORT,'UNIQUE account email'); END;
