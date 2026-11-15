require("./environment.cjs");

const env = process.env;
const u = env.DATABASE_URL ? new URL(env.DATABASE_URL) : null;

const details = {
  database: u
    ? decodeURIComponent(u.pathname.slice(1))
    : env.DB_NAME || env.PGDATABASE,
  host: u?.hostname || env.PGHOST || "localhost/default",
  port: u?.port || env.PGPORT || "5432",
  user: u?.username || env.PGUSER || "not shown"
};

console.log(details);
