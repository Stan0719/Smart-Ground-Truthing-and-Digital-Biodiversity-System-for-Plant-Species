import { loadServerEnvironment, connectionOptions } from './server/postgres.mjs';

loadServerEnvironment();

const config = connectionOptions();

console.log({
    host: config.host ?? '[URL connection]',
    database: config.database ?? '[URL connection]',
    user: config.user ?? '[URL connection]',
    hasConnectionString: Boolean(config.connectionString),
    port: config.port,
    sslEnabled: Boolean(config.ssl)
});
