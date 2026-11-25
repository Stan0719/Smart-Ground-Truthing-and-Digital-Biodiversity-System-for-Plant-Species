import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { newestReadingsByDevice, relativeReadingAge } from '../src/utils/adminIotDisplay.ts'

const now = Date.parse('2026-11-25T12:00:00Z')
const age = minutes => relativeReadingAge(new Date(now - minutes * 60_000).toISOString(), now)

test('relative reading age covers minute, hour, day and future boundaries', () => {
  assert.deepEqual(relativeReadingAge('invalid', now), null)
  assert.deepEqual(relativeReadingAge(undefined, now), null)
  assert.deepEqual(age(0), { key: 'justNow' })
  assert.deepEqual(age(1), { key: 'minutesAgo', params: { count: 1 } })
  assert.deepEqual(age(25), { key: 'minutesAgo', params: { count: 25 } })
  assert.deepEqual(age(60), { key: 'hoursAgo', params: { count: 1 } })
  assert.deepEqual(age(90), { key: 'hoursMinutesAgo', params: { hours: 1, minutes: 30 } })
  assert.deepEqual(age(125), { key: 'hoursMinutesAgo', params: { hours: 2, minutes: 5 } })
  assert.deepEqual(age(1440), { key: 'daysAgo', params: { count: 1 } })
  assert.deepEqual(age(7428), { key: 'daysHoursMinutesAgo', params: { days: 5, hours: 3, minutes: 48 } })
  assert.deepEqual(relativeReadingAge('2026-11-25T13:00:00Z', now), { key: 'justNow' })
})

test('per-device readings use the newest timestamp rather than response ordering', () => {
  const newest = newestReadingsByDevice([
    { id: 'older', device_id: 'a', created_at: '2026-11-25T10:00:00Z' },
    { id: 'newest', device_id: 'a', created_at: '2026-11-25T11:00:00Z' },
    { id: 'other', device_id: 'b', created_at: '2026-11-25T09:00:00Z' },
  ])
  assert.equal(newest.get('a').id, 'newest')
  assert.equal(newest.get('b').id, 'other')
})

test('Admin IoT keeps real device fallback, preserves all table fields, and refreshes without resetting filters', () => {
  const view = readFileSync(new URL('../src/views/AdminModuleView.vue', import.meta.url), 'utf8')
  assert.match(view, /device\.latest_reading/)
  assert.match(view, /newestReadingsByDevice\(liveReadings\.value\)/)
  assert.match(view, /const candidate = device\.latest_reading/)
  assert.match(view, /Date\.parse\(candidate\.created_at\) > Date\.parse\(current\.created_at\)/)
  assert.match(view, /devicesWithReadingsCount = computed\(\(\) => sensorRows\.value\.filter/)
  assert.match(view, /setInterval\(\(\) => \{ if \(!document\.hidden\) void loadAdminIoTData\(\) \}, 60_000\)/)
  assert.match(view, /iotRequestInFlight/)
  assert.match(view, /if \(iotDisposed \|\| props\.section !== 'iot'\) return/)
  assert.match(view, /document\.removeEventListener\('visibilitychange'/)
  assert.match(view, /v-model="search"/)
  assert.match(view, /v-model="filter"/)
  assert.match(view, /@click="openSensorDetails\(s\)"/)
  const tableStart = view.indexOf('<table class="admin-data-table admin-device-table sensor-device-table">')
  assert.notEqual(tableStart, -1)
  const table = view.slice(tableStart, view.indexOf('</table>', tableStart))
  assert.equal((table.match(/<th>\{\{ t\('adminModules\.columns\./g) || []).length, 11)
  assert.match(view, /class="admin-data-table admin-device-table sensor-device-table"/)
  assert.doesNotMatch(view, /PostgreSQL API data/)
  const tableStyles = readFileSync(new URL('../src/styles/admin-tables.css', import.meta.url), 'utf8')
  assert.match(tableStyles, /\.iot-monitoring-container \.sensor-device-table \{ display: block; min-width: 0; width: 100%; \}/)
})

test('EN, MS and ZH provide localized relative-time and IoT table labels', () => {
  for (const language of ['en', 'ms', 'zh-CN']) {
    const locale = JSON.parse(readFileSync(new URL(`../src/locales/${language}.json`, import.meta.url), 'utf8'))
    for (const key of ['justNow', 'minutesAgo', 'hoursAgo', 'hoursMinutesAgo', 'daysAgo', 'daysHoursAgo', 'daysMinutesAgo', 'daysHoursMinutesAgo']) {
      assert.ok(locale.adminModules.iot.relativeTime[key], `${language} missing relativeTime.${key}`)
    }
    for (const key of ['sensorId', 'deviceName', 'plantId', 'temperature', 'humidity', 'soilMoisture', 'rainfall', 'motion', 'status', 'lastReading', 'actions']) {
      assert.ok(locale.adminModules.columns[key], `${language} missing columns.${key}`)
    }
  }
})
