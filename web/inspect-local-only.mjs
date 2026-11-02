import { connectionOptions } from './server/postgres.mjs';

const config = connectionOptions();

const url = config.connectionString
    ? new URL(config.connectionString)
    : null;

console.log({
    host: url?.hostname ?? config.host,
    database: url?.pathname?.replace(/^\//, '') ?? config.database,
    user: url?.username ?? config.user,
    port: url?.port || config.port || 5432,
    sslEnabled: Boolean(config.ssl),
    usesConnectionString: Boolean(url)
});
