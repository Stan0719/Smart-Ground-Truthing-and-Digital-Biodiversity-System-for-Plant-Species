// Read-only release gate; queries PostgreSQL metadata. No migration, delivery or deployment.
import { readFileSync } from "node:fs";
import { inspectStorage, verifyStorage } from "./storage-readiness.mjs";
import { fileURLToPath } from "node:url";
import {loadServerEnvironment} from "../web/server/postgres.mjs";
import {
  activationConfiguration,
  emailSettings,
} from "../web/server/activation-configuration.mjs";
import { websiteOrigin } from "../web/server/website-origin.mjs";
import { validatedApiUrl } from "../mobileapp/utils/apiConfiguration.js";
loadServerEnvironment();
const checks = {};
const storageRoot = fileURLToPath(new URL("..", import.meta.url));
checks.staffTemporaryPasswordEmail = activationConfiguration(
  emailSettings(process.env),
).ready;
try {
  websiteOrigin({ ...process.env, NODE_ENV: "production" });
  checks.productionWebsiteOrigin = true;
} catch {
  checks.productionWebsiteOrigin = false;
}
for (const [service, key] of [
  ["plant", "EXPO_PUBLIC_PLANT_API_URL_PRODUCTION"],
  ["face", "EXPO_PUBLIC_FACE_API_URL_PRODUCTION"],
]) {
  try {
    validatedApiUrl(process.env[key], "production", service);
    checks[service + "ProductionHttps"] = true;
  } catch {
    checks[service + "ProductionHttps"] = false;
  }
}
Object.assign(
  checks,
  inspectStorage({ root: fileURLToPath(new URL("..", import.meta.url)) }),
);
Object.assign(checks, await verifyStorage({ root: storageRoot }));
const audit = JSON.parse(
  readFileSync(
    new URL("../docs/final-dependency-audit.json", import.meta.url),
    "utf8",
  ),
);
checks.dependencyHighCritical = Object.values(audit).every(
  (x) => x.counts.high === 0 && x.counts.critical === 0,
);
console.log(
  JSON.stringify(
    {
      checks,
      manualEvidenceRequired: [
        "phone networking/camera/GPS/storage",
        "consented positive recognition and liveness",
        "physical sensor calibration and reconnect",
        "controlled temporary-password email receipt",
        "independent backup retention",
      ],
      deploymentPerformed: false,
    },
    null,
    2,
  ),
);
if (Object.values(checks).some((value) => !value)) process.exitCode = 1;
