// Local-only supervisor/diagnostic. Never installs, enrolls, enables Serve or Funnel.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { createConnection } from "node:net";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const runtimeSocket = `/tmp/niah-tailscale-${process.getuid?.() ?? "local"}/tailscaled.sock`;
if (!process.env.TAILSCALE_SOCKET && existsSync(runtimeSocket))
  process.env.TAILSCALE_SOCKET = runtimeSocket;
const localBin = resolve(root, ".local-tools/bin");
if (existsSync(localBin)) process.env.PATH = localBin + ":" + process.env.PATH;
const available = (name) =>
  spawnSync("which", [name], { encoding: "utf8" }).status === 0;
const envFile = resolve(root, "web/.env.server");
const settings = {
  ...(existsSync(envFile) ? parseEnv(readFileSync(envFile, "utf8")) : {}),
  ...process.env,
};
const existingKey = resolve(
  root,
  "mobileapp/face_backend/data/account-service.key",
);
const key =
  settings.FACE_ACCOUNT_SERVICE_KEY_FILE ||
  (existsSync(existingKey) ? existingKey : undefined);
const children = [];
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function probe(url) {
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(3000),
    });
    let body;
    try {
      body = await response.json();
    } catch {}
    return { status: response.status, body };
  } catch {
    return { status: 0 };
  }
}
async function occupied(port) {
  return new Promise((r) => {
    const s = createConnection({ host: "127.0.0.1", port });
    s.setTimeout(1000);
    s.once("connect", () => {
      s.destroy();
      r(true);
    });
    s.once("error", () => r(false));
    s.once("timeout", () => {
      s.destroy();
      r(false);
    });
  });
}
const services = [
  {
    name: "authentication",
    port: 3001,
    path: "/health",
    service: "Niah Authentication API",
    command: process.execPath,
    args: ["server/index.mjs"],
    cwd: "web",
    environment: {
      HOST: "127.0.0.1",
      PORT: "3001",
      ...(key ? { FACE_ACCOUNT_SERVICE_KEY_FILE: key } : {}),
    },
  },
  {
    name: "plant",
    port: 3000,
    path: "/health",
    service: "Plant Conservation API",
    command: process.execPath,
    args: ["server.js"],
    cwd: "plant-conservation-backend",
    environment: { HOST: "127.0.0.1", PORT: "3000" },
  },

];
async function report() {
  for (const s of services) {
    const r = await probe(`http://127.0.0.1:${s.port}${s.path}`);
    console.log(
      `${s.name}: ${r.status === 200 && r.body?.service === s.service && r.body?.ready === true ? "ready" : "unavailable or wrong service"}${s.name === "face" ? " (authoritative=" + String(r.body?.accountService === "authoritative") + ")" : ""}`,
    );
  }
  const gateway = await probe("http://127.0.0.1:8080/health");
  console.log(
    "gateway:",
    gateway.status === 200 && gateway.body?.service === "Plant Conservation API"
      ? "plant health routed"
      : "not verified",
  );
  const auth = await probe("http://127.0.0.1:8080/api/auth/me");
  console.log(
    "gateway authentication rejection:",
    auth.status === 401 ? "verified" : "not verified",
  );
  const vpn = available("tailscale");
  let running = false;
  if (vpn) {
    const result = spawnSync(
      "tailscale",
      [
        ...(process.env.TAILSCALE_SOCKET
          ? ["--socket=" + process.env.TAILSCALE_SOCKET]
          : []),
        "status",
        "--json",
      ],
      { encoding: "utf8", timeout: 5000 },
    );
    try {
      running = JSON.parse(result.stdout).BackendState === "Running";
    } catch {}
  }
  console.log(
    "VPN client installed:",
    vpn,
    "authenticated:",
    running,
    "Caddy installed:",
    available("caddy"),
  );
  console.log(
    "Status:",
    running && gateway.status === 200 && auth.status === 401
      ? "VPN CONNECTED — PHONE TEST REQUIRED"
      : "EXTERNAL APPROVAL REQUIRED",
  );
  console.log("Physical phone and private HTTPS certificate: NOT VERIFIED");
}
if (!process.argv.includes("--start")) {
  await report();
} else {
  let stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    for (const child of children) child.kill("SIGTERM");
    await Promise.all(
      children.map(
        (c) =>
          new Promise((r) => {
            if (c.exitCode !== null) return r();
            const timer = setTimeout(() => {
              c.kill("SIGKILL");
              r();
            }, 8000);
            c.once("exit", () => {
              clearTimeout(timer);
              r();
            });
          }),
      ),
    );
  }
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
  try {
    for (const s of services) {
      if (await occupied(s.port)) {
        const r = await probe(`http://127.0.0.1:${s.port}${s.path}`);
        if (r.body?.service !== s.service || r.body?.ready !== true)
          throw Error(
            `${s.name} port ${s.port} belongs to an unverified service; no process was stopped.`,
          );
        if (s.name === "face" && r.body.accountService !== "authoritative")
          throw Error(
            "Existing face server is not authoritative. Stop its owning terminal first.",
          );
        console.log(`Reusing ${s.name} on loopback port ${s.port}.`);
        continue;
      }
      if (s.name === "face" && !key) {
        console.log(
          "Face not started: existing private account-service key is missing.",
        );
        continue;
      }
      const child = spawn(s.command, s.args, {
        cwd: resolve(root, s.cwd),
        env: { ...settings, ...s.environment },
        stdio: "inherit",
      });
      children.push(child);
      let ready = false;
      for (let n = 0; n < (s.name === "face" ? 360 : 60); n++) {
        if (child.exitCode !== null) break;
        const r = await probe(`http://127.0.0.1:${s.port}${s.path}`);
        if (
          r.status === 200 &&
          r.body?.service === s.service &&
          r.body?.ready === true
        ) {
          ready = true;
          break;
        }
        await delay(500);
      }
      if (!ready)
        console.error(
          `${s.name} did not become ready; independent services remain available. Inspect its startup message.`,
        );
    }
    if (available("caddy")) {
      if (await occupied(8080)) {
        const plant = await probe("http://127.0.0.1:8080/health");
        const auth = await probe("http://127.0.0.1:8080/auth-health");
        const face = await probe("http://127.0.0.1:8080/face/health");
        const denial = await probe("http://127.0.0.1:8080/api/auth/me");
        const blocked = await probe(
          "http://127.0.0.1:8080/internal/face/issue",
        );
        if (
          plant.body?.service !== "Plant Conservation API" ||
          auth.body?.service !== "Niah Authentication API" ||
          denial.status !== 401 ||
          blocked.status !== 404
        )
          throw Error(
            "Port 8080 belongs to an unverified gateway; no process was stopped.",
          );
        console.log("Reusing verified private loopback gateway on port 8080.");
      } else {
        const config = resolve(root, "deploy/private-phone.Caddyfile");
        if (
          spawnSync(
            "caddy",
            ["validate", "--config", config, "--adapter", "caddyfile"],
            { stdio: "inherit" },
          ).status !== 0
        )
          throw Error("Gateway configuration validation failed.");
        const child = spawn(
          "caddy",
          ["run", "--config", config, "--adapter", "caddyfile"],
          { stdio: "inherit" },
        );
        children.push(child);
        await delay(1000);
      }
    } else
      console.log(
        "Gateway NOT started: Caddy is absent. Installation requires your approval.",
      );
    await report();
    console.log(
      "Foreground services retained. Ctrl+C stops only services started by this command. No VPN or public endpoint was created.",
    );
    await new Promise((r) => {
      for (const c of children) c.once("exit", r);
      if (!children.length) r();
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await stop();
  }
}
