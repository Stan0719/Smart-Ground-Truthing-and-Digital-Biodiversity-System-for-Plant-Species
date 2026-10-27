// Local configuration test only: synthetic upstreams, no accounts or external listener.
import { createServer } from "node:http";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import assert from "node:assert/strict";
const binary = process.env.CADDY_TEST_BINARY;
if (!binary)
  throw Error("Set CADDY_TEST_BINARY to a verified local Caddy binary.");
const servers = [];
let proxy;
const folder = mkdtempSync(join(tmpdir(), "niah-private-gateway-"));
async function stub(service) {
  const server = createServer(async (req, res) => {
    if (req.url.endsWith("/redirect")) {
      res.writeHead(302, { Location: "https://example.invalid/never-follow" });
      res.end();
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        service,
        path: req.url,
        authorization: req.headers.authorization || null,
        method: req.method,
        body,
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  servers.push(server);
  return server.address().port;
}
try {
  const plant = await stub("synthetic-plant"),
    face = await stub("synthetic-face"),
    auth = await stub("synthetic-auth");
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((r) => reservation.close(r));
  let config = readFileSync(
    new URL("./private-phone.Caddyfile", import.meta.url),
    "utf8",
  )
    .replaceAll(":8080", ":" + port)
    .replaceAll(":3000", ":" + plant)
    .replaceAll(":8000", ":" + face)
    .replaceAll(":3001", ":" + auth);
  const file = join(folder, "Caddyfile");
  writeFileSync(file, config);
  proxy = spawn(binary, ["run", "--config", file, "--adapter", "caddyfile"], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  let diagnostics = "";
  proxy.stderr.on("data", (chunk) => {
    diagnostics += chunk;
  });
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`);
      if (r.ok) break;
    } catch {}
    if (proxy.exitCode !== null) throw Error(diagnostics);
    await new Promise((r) => setTimeout(r, 50));
  }
  for (const [path, service, forwarded] of [
    ["/health", "synthetic-plant", "/health"],
    ["/api/plants", "synthetic-plant", "/api/plants"],
    ["/api/auth/me", "synthetic-auth", "/api/auth/me"],
    ["/api/admin/users", "synthetic-auth", "/api/admin/users"],
    ["/auth-health", "synthetic-auth", "/health"],
    ["/api/assets/example", "synthetic-plant", "/api/assets/example"],
    ["/api/readings", "synthetic-plant", "/api/readings"],
    ["/face/health", "synthetic-face", "/health"],
    ["/face/me", "synthetic-face", "/me"],
  ]) {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, {
      headers: {
        Authorization: "Bearer synthetic-test-only",
        Host: "codespaces-83ea7d.tailb9ff43.ts.net",
      },
    });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.service, service);
    assert.equal(body.path, forwarded);
    assert.equal(body.authorization, "Bearer synthetic-test-only");
  }
  const upload = await fetch(`http://127.0.0.1:${port}/api/device/readings`, {
    method: "POST",
    headers: {
      Authorization: "Device synthetic-device-key",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ values: { temperature: 25 } }),
  });
  const uploaded = await upload.json();
  assert.equal(uploaded.authorization, "Device synthetic-device-key");
  assert.equal(uploaded.method, "POST");
  assert.deepEqual(JSON.parse(uploaded.body), { values: { temperature: 25 } });
  for (const path of [
    "/api/redirect",
    "/api/auth/redirect",
    "/face/redirect",
  ]) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      redirect: "manual",
      headers: {
        Authorization: "Bearer synthetic-test-only",
        Host: "codespaces-83ea7d.tailb9ff43.ts.net",
      },
    });
    assert.equal(response.status, 502);
    assert.equal(response.headers.get("location"), null);
  }
  for (const path of [
    "/internal",
    "/face/internal",
    "/internal/face/issue",
    "/face/internal/face/issue",
    "/data/plants.sqlite",
    "/.env",
    "/auth.sqlite",
    "/unknown",
  ])
    assert.equal((await fetch(`http://127.0.0.1:${port}${path}`)).status, 404);
  console.log(
    "PASS: private gateway routing, path prefix, credential preservation POST/device auth, three rejected redirects and eight blocked paths (synthetic loopback only).",
  );
} finally {
  if (proxy && proxy.exitCode === null) {
    proxy.kill("SIGTERM");
    await once(proxy, "exit");
  }
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
  rmSync(folder, { recursive: true, force: true });
}
