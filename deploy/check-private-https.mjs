// Read-only: TLS verification enabled; no bearer/cookie, redirects never followed.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);
const request = process.argv.includes("--socks")
  ? async (url) => {
      const { stdout } = await run(
        "curl",
        [
          "--silent",
          "--show-error",
          "--max-time",
          "10",
          "--proto",
          "=https",
          "--proxy",
          "socks5h://127.0.0.1:1055",
          "--noproxy",
          "",
          "--write-out",
          "\n%{http_code}\n%{content_type}",
          url,
        ],
        { maxBuffer: 1048576 },
      ).catch((error) => {
        const codes = {
          6: "ENOTFOUND",
          28: "UND_ERR_CONNECT_TIMEOUT",
          60: "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
        };
        throw Object.assign(Error("Private HTTPS connection failed."), {
          cause: { code: codes[error.code] || "PRIVATE_CONNECTION_FAILED" },
        });
      });
      const lines = stdout.split("\n"),
        type = lines.pop(),
        status = Number(lines.pop());
      return new Response(lines.join("\n"), {
        status,
        headers: { "content-type": type || "" },
      });
    }
  : fetch;
import {
  validatedApiUrl,
  checkApiConnectivity,
} from "../mobileapp/utils/apiConfiguration.js";
const input = process.argv[2];
if (!input) {
  console.error(
    "Usage: node deploy/check-private-https.mjs https://ACTUAL-APPROVED-PRIVATE-HOST",
  );
  process.exit(1);
}
const origin = validatedApiUrl(input, "production", "plant");
if (!new URL(origin).hostname.endsWith(".ts.net"))
  throw Error("Expected the approved Tailscale Serve HTTPS hostname.");
let failed = false;
for (const [service, base] of [
  ["plant", origin],
  ["face", origin + "/face"],
]) {
  try {
    await checkApiConnectivity(service, base, request);
    console.log(
      `${service}: HTTPS verified, expected ready service, no redirect`,
    );
  } catch (error) {
    failed = true;
    console.log(
      `${service}: ${error.code || "API_CONFIGURATION"} — ${error.message}`,
    );
  }
}
try {
  const response = await request(origin + "/auth-health", {
    redirect: "manual",
    credentials: "omit",
    signal: AbortSignal.timeout(5000),
  });
  const body = await response.json();
  if (
    response.status !== 200 ||
    body.service !== "Niah Authentication API" ||
    body.ready !== true ||
    body.accountAdapter !== true
  )
    throw Error("wrong auth adapter");
  console.log("auth: ready authoritative adapter, correct gateway route");
} catch {
  failed = true;
  console.log("auth: gateway route or authoritative adapter not verified");
}
for (const [path, status] of [
  ["/api/auth/me", 401],
  ["/api/observations", 401],
  ["/api/reports", 401],
  ["/api/devices", 401],
  ["/api/alerts", 401],
  ["/internal/face/issue", 404],
  ["/face/internal/face/issue", 404],
  ["/data/auth.sqlite", 404],
]) {
  try {
    const r = await request(origin + path, {
      redirect: "manual",
      credentials: "omit",
      signal: AbortSignal.timeout(5000),
    });
    const ok = r.status === status;
    console.log(`${path}: ${ok ? "PASS" : "FAIL"} HTTP ${r.status}`);
    if (!ok) failed = true;
  } catch {
    failed = true;
    console.log(`${path}: connection failed`);
  }
}
console.log(
  "Physical phone verification: not performed by this host-side command.",
);
if (failed) process.exitCode = 1;
