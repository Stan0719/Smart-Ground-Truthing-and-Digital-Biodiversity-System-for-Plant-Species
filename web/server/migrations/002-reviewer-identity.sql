ALTER TABLE users ADD COLUMN postgres_user_id INTEGER
 CHECK(postgres_user_id IS NULL OR (typeof(postgres_user_id)='integer' AND postgres_user_id BETWEEN 1 AND 2147483647));
CREATE UNIQUE INDEX users_postgres_user_id ON users(postgres_user_id);
