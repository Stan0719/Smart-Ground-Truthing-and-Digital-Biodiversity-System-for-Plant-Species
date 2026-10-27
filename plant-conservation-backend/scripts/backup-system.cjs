"use strict";
const { resolve } = require("node:path");
const {
  mkdirSync,
  writeFileSync,
  copyFileSync,
  existsSync,
  chmodSync,
} = require("node:fs");
const { backupPostgres } = require("./postgres-backup.cjs");
async function main() {
  const { loadServerEnvironment } =
    await import("../../web/server/postgres.mjs");
  loadServerEnvironment();
  const args = process.argv.slice(2),
    includeFace = args.includes("--include-biometrics");
  if (
    args.some(
      (a) =>
        a.startsWith("--") &&
        !["--include-biometrics", "--without-biometrics"].includes(a),
    )
  )
    throw Error("Unknown backup option.");
  const destination = resolve(
    args.find((a) => !a.startsWith("--")) ||
      resolve(__dirname, "../backups", "system-" + Date.now()),
  );
  if (existsSync(destination))
    throw Error("Refusing to overwrite an existing backup directory.");
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  const manifest = {
    storage: "postgresql",
    biometricsExcluded: !includeFace,
    restorationTested: false,
    databases: {},
    privateKeys: [],
  };
  manifest.databases.plant = backupPostgres(
    resolve(destination, "plants.dump"),
  );
  manifest.databases.authentication = backupPostgres(
    resolve(destination, "accounts.dump"),
    {
      connection: process.env.AUTH_DATABASE_URL || process.env.DATABASE_URL,
      schemas: [process.env.AUTH_PG_SCHEMA || "plant_auth"],
    },
  );
  if (includeFace)
    manifest.databases.face = backupPostgres(
      resolve(destination, "face.dump"),
      {
        connection: process.env.FACE_DATABASE_URL || process.env.DATABASE_URL,
        schemas: [process.env.FACE_PG_SCHEMA || "plant_face"],
      },
    );
  for (const [name, path] of [
    [
      "recovery.key",
      process.env.AUTH_RESET_KEY_FILE ||
        resolve(__dirname, "../../web/server/data/recovery.key"),
    ],
    ...(includeFace
      ? [
          [
            "account-service.key",
            process.env.FACE_ACCOUNT_SERVICE_KEY_FILE ||
              resolve(
                __dirname,
                "../../mobileapp/face_backend/data/account-service.key",
              ),
          ],
        ]
      : []),
  ]) {
    if (!existsSync(path)) continue;
    const target = resolve(destination, name);
    copyFileSync(path, target);
    chmodSync(target, 0o600);
    manifest.privateKeys.push(name);
  }
  writeFileSync(
    resolve(destination, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    { mode: 0o600 },
  );
  console.log(
    "PostgreSQL backup archives validated. An isolated restore test and independent backup retention are still required.",
  );
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
