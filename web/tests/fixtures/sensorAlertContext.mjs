// ISOLATED TEST/PREVIEW DATA. Never imported by production code or sent to a database.
export function sensorAlertFixture() {
  const alert = { id: 'fixture-temperature-alert', device_id: 'fixture-sensor', reading_id: 'fixture-frame',
    camera_id: null, video_path: null, metric: 'temperature', value: 38, status: 'New',
    detected_at: '2026-11-18T06:29:00Z', created_at: '2026-11-18T06:29:00Z' }
  const assignment = { state: 'verified', basis: 'current_device_assignment', device_id: alert.device_id, plant_id: '32' }
  const context = { contract_version: 1,
    alert: { id: alert.id, device_id: alert.device_id, reading_id: alert.reading_id, metric: alert.metric, value: alert.value },
    current_assignment: { ...assignment }, historical_threshold: null,
    reading: { state: 'verified', id: alert.reading_id, device_id: alert.device_id, received_at: alert.created_at,
      values: { temperature: 38, humidity: 72, soilMoisture: 2150, movement: 0, rainfall: 812, sound: 0 } } }
  return { alert, context, assignment }
}
