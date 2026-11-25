import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  IOT_DEVICES_PATH,
  canonicalHistoryPath,
  loadCanonicalDevices,
  loadCanonicalHistory,
  mapCanonicalDevice,
  mapCanonicalHistory,
} from '../src/services/iotMonitoring.ts'

const page = readFileSync(new URL('../src/views/conservation/IoTMonitoringView.vue', import.meta.url), 'utf8')
const camera = readFileSync(new URL('../src/components/CameraMonitoringSection.vue', import.meta.url), 'utf8')

const reading = (values = {}, overrides = {}) => ({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  device_id: '11111111-1111-4111-8111-111111111111',
  values,
  created_at: '2026-11-03T04:05:06.000Z',
  ...overrides,
})

const device = (overrides = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Canopy Sensor Alpha',
  device_type: 'Sensor',
  plant_id: 7,
  status: 'Active',
  thresholds: {},
  last_seen: '2026-11-03T04:05:06.000Z',
  latest_reading: reading({ temperature: 0, humidity: 0, soilMoisture: 0, rainfall: 0, movement: 0 }),
  ...overrides,
})

test('canonical device mapping preserves UUID, real name and zero JSON values', () => {
  const result = mapCanonicalDevice(device())
  assert.equal(result.sensor_id, '11111111-1111-4111-8111-111111111111')
  assert.equal(result.device_name, 'Canopy Sensor Alpha')
  assert.equal(result.plant_id, '7')
  assert.equal(result.status, 'Active')
  assert.equal(result.latest_reading.temperature_c, 0)
  assert.equal(result.latest_reading.humidity, 0)
  assert.equal(result.latest_reading.soil_moisture, 0)
  assert.equal(result.latest_reading.rainfall_mm, 0)
  assert.equal(result.latest_reading.motion_detected, false)
  assert.equal(result.latest_reading.recorded_at, '2026-11-03T04:05:06.000Z')
})

test('sensor health metadata is mapped for the live monitoring display', () => {
  const result = mapCanonicalDevice(device({ latest_reading: reading({
    temperature: 24, humidity: 60, movement: 0,
    _capture: { mpu_connected: true, dht_status: 'Operational' },
  }) }))
  assert.equal(result.latest_reading.dht_status, 'Operational')
  assert.equal(result.latest_reading.mpu_connected, true)
  assert.match(page, /DHT11 Health/)
  assert.match(page, /MPU6050 Health/)
})

test('kit readings preserve raw values and invalid movement is unavailable without exposing sound', () => {
  for (const [movement, expected] of [[0, false], [1, true], [2, null], [-1, null]]) {
    const result = mapCanonicalDevice(device({ latest_reading: reading({ sound: 0, movement, soilMoisture: 2150, rainfall: 812 }) }))
    assert.equal(Object.hasOwn(result.latest_reading, 'sound_raw'), false)
    assert.equal(result.latest_reading.motion_detected, expected)
    assert.equal(result.latest_reading.soil_moisture, 2150)
    assert.equal(result.latest_reading.rainfall_mm, 812)
  }
  assert.doesNotMatch(page, /sound_raw|hasLatestSound|hasHistorySound|soundChartPoints|ct\('Sound/)
})

test('missing metrics remain unavailable and are not replaced with demo readings', () => {
  const result = mapCanonicalDevice(device({ latest_reading: reading({ sound: 42 }) }))
  assert.equal(result.latest_reading.temperature_c, null)
  assert.equal(result.latest_reading.humidity, null)
  assert.equal(result.latest_reading.soil_moisture, null)
  assert.equal(result.latest_reading.rainfall_mm, null)
  assert.equal(result.latest_reading.motion_detected, null)
})

test('canonical history maps readings and exposes pagination truthfully', () => {
  const result = mapCanonicalHistory({
    readings: [reading({ temperature: 24.5, movement: 1 })],
    page: 1,
    limit: 100,
    hasMore: true,
  }, 7)
  assert.equal(result.readings[0].temperature_c, 24.5)
  assert.equal(result.readings[0].motion_detected, true)
  assert.equal(result.readings[0].plant_id, '7')
  assert.equal(result.hasMore, true)
})

test('device and history requests use only the plant-backend proxy', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  try {
    globalThis.fetch = async (url) => {
      calls.push(url)
      if (url === IOT_DEVICES_PATH) return Response.json({ devices: [device()] })
      return Response.json({ readings: [reading({ humidity: 61 })], page: 1, limit: 100, hasMore: false })
    }
    const devices = await loadCanonicalDevices()
    const history = await loadCanonicalHistory(devices[0])
    assert.equal(history.readings[0].humidity, 61)
    assert.deepEqual(calls, [
      '/api/data/devices',
      '/api/data/devices/11111111-1111-4111-8111-111111111111/readings?page=1&limit=100',
    ])
    assert.equal(canonicalHistoryPath(devices[0].sensor_id), calls[1])
  } finally { globalThis.fetch = originalFetch }
})

test('successful empty canonical device dataset remains a success', async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => Response.json({ devices: [] })
    assert.deepEqual(await loadCanonicalDevices(), [])
  } finally { globalThis.fetch = originalFetch }
})

test('malformed canonical responses are rejected', async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => Response.json({ devices: 'not-an-array' })
    await assert.rejects(loadCanonicalDevices(), { kind: 'invalid' })
    globalThis.fetch = async () => Response.json({ devices: [{ id: 'missing-fields' }] })
    await assert.rejects(loadCanonicalDevices(), { kind: 'invalid' })
  } finally { globalThis.fetch = originalFetch }
})

test('401, 403 and network failures are distinguished', async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () => Response.json({}, { status: 401 })
    await assert.rejects(loadCanonicalDevices(), { status: 401, message: /sign in/i })
    globalThis.fetch = async () => Response.json({}, { status: 403 })
    await assert.rejects(loadCanonicalDevices(), { status: 403, message: /permission/i })
    globalThis.fetch = async () => { throw Error('offline') }
    await assert.rejects(loadCanonicalDevices(), { kind: 'network' })
  } finally { globalThis.fetch = originalFetch }
})

test('page uses canonical adapter without legacy fixtures, writes or visual redesign', () => {
  assert.match(page, /loadCanonicalDevices/)
  assert.match(page, /loadCanonicalHistory/)
  assert.doesNotMatch(page, /\/api\/iot\/devices|\/api\/iot\/sensors/)
  assert.doesNotMatch(page, /fetch\(|devices\.push|Math\.random|POST|PATCH|DELETE/)
  assert.match(page, /<CameraMonitoringSection\s+:devices="readingDevices"/)
  assert.match(page, /class="summary-grid"/)
  assert.match(page, /class="control-bar"/)
  assert.match(page, /class="history-charts"/)
  assert.match(camera, /\/camera-api\/camera-status/)
  assert.match(camera, /\/camera-api\/camera-events/)
  assert.match(camera, /\/camera-api\/video-feed/)
})

test('mobile sensor device cards keep each labeled value on one vertically centered row', () => {
  assert.match(page, /@container \(max-width: 767px\)/)
  assert.match(page, /\.officer-layout \.iot-device-scroll \.iot-device-table td \{ display: flex; flex-wrap: nowrap; align-items: center; gap: 4px;/)
  assert.match(page, /\.iot-device-cell-label::after \{ content: ':'; \}/)
  assert.match(page, /\.iot-device-scroll \.iot-device-table \{ display: block; box-sizing: border-box; width: 100%; max-width: 100%; min-width: 0;/)
})
