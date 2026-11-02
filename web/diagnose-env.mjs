import { loadServerEnvironment, connectionOptions } from './server/postgres.mjs';

console.log('Before loading .env:', {
    databaseUrl: Boolean(process.env.DATABASE_URL),
    authDatabaseUrl: Boolean(process.env.AUTH_DATABASE_URL)
});

loadServerEnvironment();

console.log('After loading .env:', {
    databaseUrl: Boolean(process.env.DATABASE_URL),
    authDatabaseUrl: Boolean(process.env.AUTH_DATABASE_URL),
    faceDatabaseUrl: Boolean(process.env.FACE_DATABASE_URL)
});

const config = connectionOptions();

console.log('Connection destination:', {
    host: config.connectionString
        ? new URL(config.connectionString).hostname
        : config.host,
    database: config.connectionString
        ? new URL(config.connectionString).pathname
        : config.database,
    user: config.connectionString
        ? new URL(config.connectionString).username
        : config.user,
    sslEnabled: Boolean(config.ssl)
});
