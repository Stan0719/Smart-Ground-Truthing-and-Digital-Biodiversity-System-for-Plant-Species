"use strict";
const { fail } = require('./domain.cjs');
const { metrics } = require('./iot-reading-cache.cjs');
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
function range(value) {
  if (finite(value)) return { max: value }; // Existing numbers remain upper limits.
  if (!record(value) || Object.keys(value).some(key => !['min', 'max'].includes(key)) ||
      !Object.keys(value).length || Object.values(value).some(value => !finite(value)) ||
      (value.min !== undefined && value.max !== undefined && value.min > value.max)) return null;
  return { ...value };
}
function validateThresholds(value) {
  if (!record(value) || Object.keys(value).some(key => !metrics.includes(key)) ||
      Object.values(value).some(value => value !== null && !range(value)))
    fail(400, 'Use finite minimum/maximum thresholds with minimum no greater than maximum.');
  return value;
}
function violation(value, limits) {
  if (!finite(value) || !limits) return null;
  if (limits.min !== undefined && value < limits.min) return 'low';
  if (limits.max !== undefined && value > limits.max) return 'high';
  return null;
}
async function evidenceReady(client) {
  return !!(await client.query(`SELECT EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_schema='plant_app' AND table_name='threat_alert_history' AND column_name='sensor_evidence') AS ready`)).rows[0]?.ready;
}
module.exports = { range, validateThresholds, violation, evidenceReady };
