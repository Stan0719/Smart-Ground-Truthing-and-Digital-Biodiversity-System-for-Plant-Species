"use strict";
// Isolated, read-only workload after synthetic records are seeded in memory.
const { performance } = require("node:perf_hooks");
const { cpus, totalmem, platform } = require("node:os");
const { createMobileTestDatabase } = require("../test/mobile-postgres-fixture.cjs");
const { readPlantSpeciesCounts } = require("../plant-list-page.cjs");

const percentile = (values, fraction) => values[Math.ceil(values.length * fraction) - 1];
async function main() {
  const db = await createMobileTestDatabase();
  try {
    await db.query("INSERT INTO species(species_id,scientific_name) VALUES (1,'Synthetic public species')");
    await db.query("INSERT INTO rbac_species_visibility(species_id,visibility) VALUES (1,'public')");
    await db.query(`INSERT INTO plant_record(species_id,registered_subject,rbac_status,qr_token)
      SELECT 1,'staff:synthetic','Approved','benchmark-' || n::text FROM generate_series(1,500) AS n`);
    for (let i = 0; i < 5; i++) await readPlantSpeciesCounts(db, ["public"], false);
    const durations = [];
    const count = 30;
    const started = performance.now();
    for (let i = 0; i < count; i++) {
      const requestStarted = performance.now();
      const rows = await readPlantSpeciesCounts(db, ["public"], false);
      if (rows.length !== 1 || rows[0].count !== 500) throw Error("Unexpected benchmark result");
      durations.push(performance.now() - requestStarted);
    }
    const totalMs = performance.now() - started;
    durations.sort((a, b) => a - b);
    const round = (value) => Math.round(value * 100) / 100;
    console.log(JSON.stringify({
      scope: "in-process isolated Plant count query, not mobile API or device latency",
      environment: { platform: platform(), cpuLogical: cpus().length, totalMemoryBytes: totalmem() },
      dataset: { syntheticPlants: 500, species: 1 },
      workload: { requests: count, concurrency: 1, warmup: 5 },
      result: { meanMs: round(durations.reduce((sum, value) => sum + value, 0) / count),
        medianMs: round(percentile(durations, 0.5)), p95Ms: round(percentile(durations, 0.95)),
        throughputPerSecond: round(count * 1000 / totalMs), errors: 0 },
    }));
  } finally {
    await db.close();
  }
}
main().catch((error) => { console.error("Isolated benchmark failed:", error.code || error.name); process.exitCode = 1; });
