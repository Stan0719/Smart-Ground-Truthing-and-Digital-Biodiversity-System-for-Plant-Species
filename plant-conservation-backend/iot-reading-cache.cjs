"use strict";

const { createHash } = require("node:crypto");
const WINDOW_MS = 10 * 60 * 1000;
const CHECKPOINT_INTERVAL_MS = 60 * 1000;
const metrics = ["temperature", "humidity", "soilMoisture", "movement", "rainfall", "sound"];
const runtimes = new WeakMap();

function runtimeFor(pool) {
  let runtime = runtimes.get(pool);
  if (!runtime) {
    runtime = { latest: new Map(), accumulators: new Map(), locks: new Map() };
    runtimes.set(pool, runtime);
  }
  return runtime;
}

async function withDeviceLock(runtime, deviceId, operation) {
  const previous = runtime.locks.get(deviceId) || Promise.resolve();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const tail = previous.then(() => gate);
  runtime.locks.set(deviceId, tail);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (runtime.locks.get(deviceId) === tail) runtime.locks.delete(deviceId);
  }
}

function bucketStart(timestamp) {
  return Math.floor(timestamp / WINDOW_MS) * WINDOW_MS;
}

function copyJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return value;
}

function restoreAccumulator(row) {
  if (!row) return null;
  return {
    bucketStart: new Date(row.bucket_start).getTime(),
    sampleCount: Number(row.sample_count) || 0,
    metrics: copyJson(row.metrics, {}),
    activeThresholds: copyJson(row.active_thresholds, {}),
    lastObservedAt: new Date(row.last_observed_at).getTime(),
    lastPayloadHash: row.last_payload_hash || "",
    persistedAt: new Date(row.updated_at).getTime(),
  };
}

function cloneAccumulator(state) {
  return {
    ...state,
    metrics: structuredClone(state.metrics),
    activeThresholds: structuredClone(state.activeThresholds),
    lastPayloadHash: state.lastPayloadHash,
  };
}

function addReading(state, values) {
  state.sampleCount += 1;
  for (const metric of metrics) {
    const value = values[metric];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const item = state.metrics[metric] || { sum: 0, count: 0, min: value, max: value };
    item.sum += value;
    item.count += 1;
    item.min = Math.min(item.min, value);
    item.max = Math.max(item.max, value);
    state.metrics[metric] = item;
  }
}

function newAccumulator(timestamp, activeThresholds = {}) {
  return {
    bucketStart: bucketStart(timestamp), sampleCount: 0, metrics: {},
    activeThresholds: { ...activeThresholds }, lastObservedAt: 0,
    lastPayloadHash: "", persistedAt: 0,
  };
}

function normalizedValues(values, capture) {
  return capture ? { ...values, _capture: capture } : { ...values };
}

function canonical(value) {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

function payloadHash(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function summarize(state) {
  return {
    bucketStart: new Date(state.bucketStart).toISOString(),
    bucketEnd: new Date(state.bucketStart + WINDOW_MS).toISOString(),
    sampleCount: state.sampleCount,
    metrics: state.metrics,
  };
}

module.exports = {
  CHECKPOINT_INTERVAL_MS,
  WINDOW_MS,
  addReading,
  bucketStart,
  cloneAccumulator,
  metrics,
  newAccumulator,
  normalizedValues,
  payloadHash,
  restoreAccumulator,
  runtimeFor,
  summarize,
  withDeviceLock,
};
