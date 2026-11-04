// Run only after approved VPN enrollment/Serve. Validates before touching env.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validatedApiUrl } from "../mobileapp/utils/apiConfiguration.js";
const root = fileURLToPath(new URL("..", import.meta.url));
const runtimeSocket = `/tmp/niah-tailscale-${process.getuid()}/tailscaled.sock`;
if (!process.env.TAILSCALE_SOCKET && existsSync(runtimeSocket))
  process.env.TAILSCALE_SOCKET = runtimeSocket;
const localBin = resolve(root, ".local-tools/bin");
if (existsSync(localBin)) process.env.PATH = localBin + ":" + process.env.PATH;
const input = process.argv[2];
if (!input) throw Error("Supply the actual approved HTTPS Serve origin.");
const origin = validatedApiUrl(input, "development", "plant");
if (!new URL(origin).hostname.endsWith(".ts.net"))
  throw Error("Expected the approved private Tailscale hostname.");
const args = process.env.TAILSCALE_SOCKET
  ? ["--socket=" + process.env.TAILSCALE_SOCKET]
  : [];
const result = spawnSync("tailscale", [...args, "status", "--json"], {
  encoding: "utf8",
  timeout: 5000,
});
let state;
try {
  state = JSON.parse(result.stdout);
} catch {
  throw Error(
    "Tailscale status unavailable. Complete approved enrollment first.",
  );
}
if (
  state.BackendState !== "Running" ||
  state.Self?.DNSName?.replace(/\.$/, "") !== new URL(origin).hostname
)
  throw Error("Hostname does not match this enrolled Tailscale node.");
const check = spawnSync(
  process.execPath,
  [
    resolve(root, "deploy/check-private-https.mjs"),
    origin,
    ...(process.argv.includes("--socks") ? ["--socks"] : []),
  ],
  { stdio: "inherit" },
);
if (check.status !== 0)
  throw Error("HTTPS/routing checks failed. Mobile settings were not changed.");
const path = resolve(root, "mobileapp/.env.local");
let content = existsSync(path) ? readFileSync(path, "utf8") : "";
const backup = resolve(root, ".local-tools/config-backups");
mkdirSync(backup, { recursive: true, mode: 0o700 });
writeFileSync(resolve(backup, `mobile-env-${Date.now()}.txt`), content, {
  mode: 0o600,
});
for (const [key, value] of [
  ["EXPO_PUBLIC_API_ENV", "development"],
  ["EXPO_PUBLIC_PRIVATE_GATEWAY_URL", origin],
]) {
  const re = new RegExp("^" + key + "=.*$", "m");
  content = re.test(content)
    ? content.replace(re, key + "=" + value)
    : content.trimEnd() + "\n" + key + "=" + value + "\n";
}
writeFileSync(path, content, { mode: 0o600 });
chmodSync(path, 0o600);
console.log(
  "Mobile private gateway configured. Restart Expo; saved sessions bound to the old hosts will be rejected.",
);
