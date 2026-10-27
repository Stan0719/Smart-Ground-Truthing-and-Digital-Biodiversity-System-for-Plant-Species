CREATE TABLE users_next (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 email TEXT NOT NULL UNIQUE,
 role TEXT NOT NULL CHECK(role IN ('Administrator','Conservation Officer','Botanist')),
 status TEXT NOT NULL DEFAULT 'Pending Activation' CHECK(status IN ('Pending Activation','Active','Inactive','Suspended')),
 password_hash TEXT,
 must_change_password INTEGER NOT NULL DEFAULT 0 CHECK(must_change_password IN (0,1)),
 last_login TEXT,
 CHECK ((status = 'Pending Activation' AND password_hash IS NULL) OR (status != 'Pending Activation' AND password_hash IS NOT NULL))
);
INSERT INTO users_next(id,name,username,email,role,status,password_hash,must_change_password,last_login)
 SELECT id,name,id,email,role,status,password_hash,must_change_password,last_login FROM users;
DROP TABLE users;
ALTER TABLE users_next RENAME TO users;
