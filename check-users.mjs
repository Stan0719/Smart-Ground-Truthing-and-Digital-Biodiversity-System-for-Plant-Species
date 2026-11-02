import { loadServerEnvironment, connectAuth } from "./web/server/postgres.mjs";

const env = loadServerEnvironment();
const db = await connectAuth(env);

try {
    const result = await db.query(
        "SELECT COUNT(*)::int AS total_users FROM plant_auth.users"
    );

    console.log("Total users:", result.rows[0].total_users);
} finally {
    await db.close?.();
}
