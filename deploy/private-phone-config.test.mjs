import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const config = readFileSync(
  new URL("./private-phone.Caddyfile", import.meta.url),
  "utf8",
);
test("gateway declarative routing is loopback-only, distinguishes auth and blocks private files", () => {
  assert.match(config, /http:\/\/127\.0\.0\.1:8080/);
  assert.match(config, /bind 127\.0\.0\.1/);
  assert.match(config, /@auth path \/api\/auth\/\* \/api\/admin\/\*/);
  assert.ok(config.indexOf("handle @auth") < config.indexOf("handle /api/*"));
  assert.match(config, /handle @auth\s*\{\s*reverse_proxy 127\.0\.0\.1:3001/);
  assert.match(config, /handle_path \/face\/\*/);
  assert.match(
    config,
    /@blocked path \/internal \/internal\/\* \/face\/internal/,
  );
  assert.equal((config.match(/@redirect status 3xx/g) || []).length, 5);
  assert.doesNotMatch(config, /file_server|tls internal|0\.0\.0\.0|log\s*\{/);
});
