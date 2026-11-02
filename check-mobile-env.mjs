import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const env = parseEnv(readFileSync("./mobileapp/.env.local", "utf8"));

for (const key of [
  "EXPO_PUBLIC_API_URL",
  "EXPO_PUBLIC_API_ENV",
  "EXPO_PUBLIC_AUTH_API_URL_DEVELOPMENT"
]) {
  const value = env[key];

  if (!value) {
    console.log(`${key}: NOT SET`);
    continue;
  }

  try {
    const url = new URL(value);
    console.log(`${key}: ${url.protocol}//${url.host}${url.pathname}`);
  } catch {
    console.log(`${key}: configured, but invalid URL`);
  }
}
