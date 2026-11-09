"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { once } = require("node:events"),
  sharp = require("sharp");
const { createPlantDatabase } = require("./postgres-fixture.cjs"),
  { createPlantApp } = require("../server.js");
const content = {
  heightCm: 12,
  healthStatus: "Healthy",
  lifeStage: "Young",
  morphology: "Isolated fixture",
};
async function fixture(t) {
  const pool = await createPlantDatabase();
  t.after(() => pool.end());
  const users = {
    owner: {
      id: "owner",
      role: "Botanist",
      status: "Active",
      mustChangePassword: false,
    },
    other: {
      id: "other",
      role: "Botanist",
      status: "Active",
      mustChangePassword: false,
    },
    officer: {
      id: "officer",
      role: "Conservation Officer",
      status: "Active",
      mustChangePassword: false,
    },
  };
  const tokens = {
    owner: "a".repeat(64),
    other: "b".repeat(64),
    officer: "c".repeat(64),
  };
  const auth = {
    session: (token) =>
      users[Object.keys(tokens).find((k) => tokens[k] === token)] || null,
    event() {},
  };
  await pool.query(
    "INSERT INTO species(scientific_name,common_name,description) VALUES('Synthetic security fixture','Fixture','Isolated test only')",
  );
  await pool.query("INSERT INTO rbac_species_visibility VALUES(1,'public')");
  await pool.query(
    "INSERT INTO plant_record(species_id,registered_subject,rbac_status,qr_token) VALUES(1,'staff:owner','Approved','fixture-qr')",
  );
  await pool.query(
    "INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key) VALUES('observation-a',1,'staff:other','Draft',$1,'fixture-a')",
    [content],
  );
  const server = createPlantApp({
    pool,
    auth,
    origins: new Set(["http://localhost:5173"]),
  }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (path, role, method = "GET", body) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(role !== "owner" && role !== "other"
          ? { Origin: "http://localhost:5173" }
          : {}),
        "Content-Type": "application/json",
        ...(role ? { Authorization: `Bearer ${tokens[role]}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: response.status,
      data: response.headers.get("content-type")?.includes("application/json")
        ? await response.json()
        : await response.arrayBuffer(),
    };
  };
  const png = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "#00ff00" },
  })
    .png()
    .toBuffer();
  const upload = {
    plant_id: "1",
    observation_id: "observation-a",
    client_key: "photo-key",
    content_type: "image/png",
    base64: png.toString("base64"),
  };
  return { pool, call, upload, base, tokens };
}
test("private observation photo belongs to its submitting Botanist, not the parent plant owner", async (t) => {
  const { call, upload } = await fixture(t);
  const asset = await call("/assets", "other", "POST", upload);
  assert.equal(asset.status, 201, JSON.stringify(asset.data));
  assert.equal(
    (await call("/assets/" + asset.data.id, "other")).status,
    200,
    "photo owner must be able to read their own private photo",
  );
  assert.equal(
    (await call("/assets/" + asset.data.id, "owner")).status,
    404,
    "parent owner must not read another Botanist private observation photo",
  );
  assert.equal((await call("/assets/" + asset.data.id, "officer")).status, 200);
  assert.equal((await call("/assets/" + asset.data.id)).status, 404);
});
test("species reclassification to protected blocks owner QR and submission retries", async (t) => {
  const { call, pool } = await fixture(t);
  const created = await call("/plants/1/observations", "owner", "POST", {
    content,
    client_key: "owner-draft",
  });
  assert.equal(created.status, 201);
  assert.equal(
    (await call(`/observations/${created.data.id}/submit`, "owner", "POST", {}))
      .status,
    200,
  );
  await pool.query(
    "UPDATE rbac_species_visibility SET visibility='protected' WHERE species_id=1",
  );
  assert.equal((await call("/plants/1/qr", "owner")).status, 404);
  assert.equal(
    (await call(`/observations/${created.data.id}/submit`, "owner", "POST", {}))
      .status,
    404,
  );
});
test("upload retries cannot rebind an image or bypass later protected classification", async (t) => {
  const { call, pool, upload } = await fixture(t);
  const first = await call("/assets", "other", "POST", upload);
  assert.equal(first.status, 201, JSON.stringify(first.data));
  assert.equal(
    (await call("/assets", "other", "POST", upload)).data.id,
    first.data.id,
  );
  await pool.query(
    "INSERT INTO plant_observation(id,plant_id,owner_subject,status,content,client_key) VALUES('observation-b',1,'staff:other','Draft',$1,'fixture-b')",
    [content],
  );
  assert.equal(
    (
      await call("/assets", "other", "POST", {
        ...upload,
        observation_id: "observation-b",
      })
    ).status,
    409,
  );
  await pool.query(
    "UPDATE rbac_species_visibility SET visibility='protected' WHERE species_id=1",
  );
  assert.equal((await call("/assets", "other", "POST", upload)).status, 404);
});
test("invalid upload bodies are rejected as client errors rather than service failures", async (t) => {
  const { call, base, tokens } = await fixture(t);
  assert.equal((await call("/assets", "other", "POST")).status, 400);
  assert.equal((await call("/assets", "other", "POST", [])).status, 400);
  const response = await fetch(base + "/assets", {
    method: "POST",
    headers: {
      Origin: "http://localhost:5173",
      Authorization: `Bearer ${tokens.other}`,
      "Content-Type": "text/plain",
    },
    body: "invalid",
  });
  assert.equal(response.status, 415);
});
function offlineStartupFailureScript() {
  const { readFileSync } = require("node:fs"),
    { join } = require("node:path");
  const source = readFileSync(join(__dirname, "../server.js"), "utf8");
  const marker = "start().catch(";
  assert.ok(source.lastIndexOf(marker) >= 0);
  const callback = source.slice(source.lastIndexOf(marker) + marker.length, source.lastIndexOf("module.exports"))
    .replace(/\);\s*$/, "");
  const begin = source.indexOf("  const auth = await createAuth(),", source.indexOf("async function start()"));
  const end = source.indexOf("  const officerNotifications =", begin);
  assert.ok(begin >= 0 && end > begin);
  // Actual bootstrap/preflight/cleanup code and rejection handler, with inert
  // factories. No environment loaders, real pools, sockets or database traffic.
  return `let authClosed=false, poolClosed=false, queryCalls=0;
    const createAuth=async()=>({db:{close:async()=>{authClosed=true;}}});
    const poolFromEnvironment=()=>({
      query:async()=>{queryCalls++; const error=Object.assign(Error('SIMULATED_PRIVATE_DRIVER_DETAILS'),{code:'ECONNREFUSED'});
        error.stack='SIMULATED_PRIVATE_STACK'; throw error;},
      end:async()=>{poolClosed=true;}
    });
    const speciesPhotoWritesRequested=()=>false;
    async function simulatedStart() { ${source.slice(begin,end)} }
    simulatedStart().then(()=>{throw Error('EXPECTED_OFFLINE_FAILURE');},error=>{
      if(!authClosed || !poolClosed || queryCalls!==1 || error.code!=='ECONNREFUSED')
        throw Error('BOOTSTRAP_CLEANUP_NOT_VERIFIED');
      (${callback})(error);
      console.log('OFFLINE_QUERY_REJECTED_RESOURCES_CLOSED');
    });`;
}

test("offline database failure closes startup resources and uses the real sanitized rejection handler", async () => {
  const logs = [], state = { argv: [], exitCode: 0 };
  await require("node:vm").runInNewContext(offlineStartupFailureScript(), {
    process: state,
    console: { log: (...args) => logs.push(args.join(" ")), error: (...args) => logs.push(args.join(" ")) },
  });
  assert.equal(state.exitCode, 1);
  const output = logs.join("\n");
  assert.match(output, /OFFLINE_QUERY_REJECTED_RESOURCES_CLOSED/);
  assert.match(output, /Startup error code: ECONNREFUSED/);
  assert.doesNotMatch(output, /SIMULATED_PRIVATE_DRIVER_DETAILS|SIMULATED_PRIVATE_STACK|listening on port/);
});

test("simulated database startup rejection exits cleanly without private details (offline subprocess)", async (t) => {
  const { spawn } = require("node:child_process");
  const script = offlineStartupFailureScript();
  const blocked = (error) => {
    if (!["EPERM", "EACCES"].includes(error.code)) return false;
    t.skip(`Node subprocess launch denied (${error.code}); process-level result NOT VERIFIED`);
    return true;
  };
  let child;
  try {
    child = spawn(process.execPath, ["-e", script], {
      // Do not inherit credentials, activation settings or NODE_OPTIONS preloads.
      env: process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {},
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (error) {
    if (blocked(error)) return;
    throw error;
  }
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  let code;
  try {
    [code] = await once(child, "close");
  } catch (error) {
    if (blocked(error)) return;
    throw error;
  }
  assert.equal(code, 1);
  assert.match(output, /Plant API startup failed; verify configuration/);
  assert.match(output, /Startup error code: ECONNREFUSED/);
  assert.match(output, /OFFLINE_QUERY_REJECTED_RESOURCES_CLOSED/);
  assert.doesNotMatch(output, /SIMULATED_PRIVATE_DRIVER_DETAILS|SIMULATED_PRIVATE_STACK/);
  assert.doesNotMatch(output, /TypeError|server\.address|listening on port/);
});


test("startup rejection diagnostics retain safe codes without raw messages, stacks or credentials", () => {
  const { readFileSync } = require("node:fs");
  const { join } = require("node:path");
  const vm = require("node:vm");
  const source = readFileSync(join(__dirname, "../server.js"), "utf8");
  // Execute the actual startup rejection callback without starting services or
  // loading environment variables; subprocess behavior is tested separately.
  const marker = "start().catch(";
  const callback = source.slice(source.lastIndexOf(marker) + marker.length, source.lastIndexOf("module.exports"))
    .replace(/\);\s*$/, "");
  for (const code of ["ECONNREFUSED", "28P01", "postgresql://secret:password@host/db", undefined]) {
    const logs = [], state = {};
    const reject = vm.runInNewContext(`(${callback})`, {
      console: { error: (...args) => logs.push(args.join(" ")) }, process: state,
    });
    const error = Object.assign(Error("postgresql://secret:password@host/db driver details"), {code});
    error.stack = "sensitive startup stack";
    reject(error);
    assert.equal(state.exitCode, 1);
    const output = logs.join("\n");
    assert.match(output, /Plant API startup failed; verify configuration/);
    assert.match(output, new RegExp(`Startup error code: ${["ECONNREFUSED", "28P01"].includes(code) ? code : "STARTUP_FAILURE"}`));
    assert.doesNotMatch(output, /secret|password|postgresql|driver details|sensitive startup stack/);
  }
});
