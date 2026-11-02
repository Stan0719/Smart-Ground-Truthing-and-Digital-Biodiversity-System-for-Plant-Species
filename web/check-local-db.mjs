import pg from 'pg';
import { connectionOptions } from './server/postgres.mjs';

const pool = new pg.Pool(connectionOptions());

try {
    const result = await pool.query(`
        SELECT
            current_database() AS db,
            current_user AS db_user,
            inet_server_addr()::text AS server,
            current_setting('search_path') AS search_path,
            to_regclass('plant_auth.users')::text AS auth_users,
            to_regclass('plant_face.accounts')::text AS face_accounts,
            to_regclass('public.plant_record')::text AS plant_records
    `);

    console.log(result.rows[0]);
} catch (error) {
    console.error('Connection check failed:', error.message);
    process.exitCode = 1;
} finally {
    await pool.end();
}
