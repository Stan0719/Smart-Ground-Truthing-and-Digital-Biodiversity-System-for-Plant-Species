import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
for (const name of [".env.local", ".env"]) {
  const path = new URL("../" + name, import.meta.url);
  if (existsSync(path)) loadEnvFile(path);
}
const { mobileApiConfiguration, mobileApiUrl, checkApiConnectivity } =
  await import("../utils/apiConfiguration.js");
console.log("API environment:", mobileApiConfiguration.environment);
for (const service of ["plant", "face"]) {
  try {
    await checkApiConnectivity(service, mobileApiUrl(service));
    console.log(service + ": ready (unauthenticated JSON health check)");
  } catch (error) {
    console.error(
      service +
        ": " +
        (error.code || "API_CONFIGURATION") +
        " — " +
        error.message,
    );
    process.exitCode = 1;
  }
}
