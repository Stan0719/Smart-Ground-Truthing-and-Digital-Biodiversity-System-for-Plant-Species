import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { alertSource, alertTypeLabel, alertStatusLabel, sensorUnit, threatAlertDate, threatAlertDay } from '../src/utils/threatAlertDisplay.ts'
import { loadCanonicalAlertQueue } from '../src/services/threatAlerts.ts'
const wire = (id = 'one', extra = {}) => ({ id, device_id: 'device', reading_id: null, camera_id: null, video_path: null, metric: 'temperature', value: 38, status: 'New', created_at: '2026-11-18T06:29:00Z', ...extra })

test('documented metric contracts classify sources without using IDs, names or camera-looking labels', () => {
  const labels = ['Temperature Threshold','Humidity Threshold','Soil Moisture Threshold','Movement Threshold','Rainfall Threshold','Sound Threshold']
  for (const [i, metric] of ['temperature','humidity','soilMoisture','movement','rainfall','sound'].entries()) {
    assert.equal(alertSource({ metric, id: 'camera-event', cameraId: 'camera' }), 'Sensor')
    assert.equal(alertTypeLabel(metric), labels[i])
  }
  for (const metric of ['possible_plant_contact','human_detected','animal_detected','suspicious_movement']) assert.equal(alertSource({ metric }), 'Camera')
  assert.equal(alertTypeLabel('possible_plant_contact'), 'Possible Plant Contact')
  assert.equal(alertSource({ metric: 'future_event', cameraId: 'camera' }), 'Unknown')
  assert.equal(alertTypeLabel('future_event'), 'Future Event')
  assert.equal(alertTypeLabel('constructor'), 'Constructor')
  assert.equal(alertSource({ metric: '__proto__' }), 'Unknown')
  assert.equal(alertStatusLabel('Reviewing'), 'Under Review')
})

test('only verified units are displayed; no threshold or exceeded amount is manufactured', () => {
  assert.equal(sensorUnit('temperature'), '°C'); assert.equal(sensorUnit('humidity'), '%')
  for (const metric of ['soilMoisture','rainfall','sound']) assert.equal(sensorUnit(metric), 'raw')
  assert.equal(sensorUnit('movement'), 'Binary (0/1)'); assert.equal(sensorUnit('future'), null)
})

test('alert dates use full months and Kuching 24-hour instants with localized MS/ZH and safe invalid handling', () => {
  const stamp = '2026-11-18T06:29:00Z'
  assert.equal(threatAlertDate(stamp), '18 November 2026, 14:29')
  assert.equal(threatAlertDate(stamp, 'ms'), '18 November 2026, 14:29')
  assert.equal(threatAlertDate(stamp, 'zh-CN'), new Intl.DateTimeFormat('zh-CN', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Asia/Kuching' }).format(new Date(stamp)))
  assert.equal(threatAlertDay('2026-11-17T20:00:00Z'), '2026-11-18')
  for (const invalid of [null, '', 'invalid', '2026-02-30T00:00:00Z', '2026-11-18T14:29:00']) assert.equal(threatAlertDate(invalid), '—')
  assert.equal(threatAlertDate('2026-11-18'), '18 November 2026')
})

test('authenticated canonical queue retains camera identities, deduplicates exact rows and discloses both caps', async () => {
  const original = globalThis.fetch, calls = []
  try {
    globalThis.fetch = async (url, options) => { calls.push([url, options]); return Response.json({ alerts: [wire(), wire(), wire('camera', { metric: 'possible_plant_contact', camera_id: 'actual-camera' })], responses: [] }) }
    let queue = await loadCanonicalAlertQueue()
    assert.equal(queue.alerts.length, 2); assert.equal(queue.alerts[1].cameraId, 'actual-camera')
    assert.equal(calls[0][0], '/api/data/alerts'); assert.equal(calls[0][1].credentials, 'same-origin')
    assert.equal(queue.alertsCapped, false); assert.equal(queue.historyCapped, false)
    globalThis.fetch = async () => Response.json({ alerts: Array.from({ length: 500 }, (_, i) => wire(String(i))), responses: Array.from({ length: 500 }, (_, i) => ({ id: String(i), alert_id: '0', officer_subject: 'authorized-officer', note: 'Actual response', status: 'Reviewing', created_at: '2026-11-18T06:29:00Z' })) })
    queue = await loadCanonicalAlertQueue()
    assert.equal(queue.alertsCapped, true); assert.equal(queue.historyCapped, true)
    globalThis.fetch = async () => Response.json({ alerts: [wire(), wire('one', { value: 99 })], responses: [] })
    await assert.rejects(loadCanonicalAlertQueue(), /conflicting identities/)
  } finally { globalThis.fetch = original }
})

test('the redesigned inspector is responsive and its fixed labels resolve in EN/MS/ZH', () => {
  const source = readFileSync(new URL('../src/views/conservation/ThreatAlertsView.vue', import.meta.url), 'utf8')
  assert.match(source, /grid-template-columns: minmax\(0, 1\.4fr\) minmax\(290px, 1fr\)/)
  assert.match(source, /@media \(max-width: 820px\).*grid-template-columns: 1fr/)
  assert.match(source, /prefers-reduced-motion: reduce/)
  assert.match(source, /aria-required="true"/)
  const labels = [...source.matchAll(/ct\('([^']+)'/g)].map(match => match[1])
  labels.push('New','Under Review','Resolved','Start Review','Save Response','Resolve Alert','Temperature Threshold','Possible Plant Contact')
  for (const lang of ['en','ms','zh-CN']) {
    const messages = JSON.parse(readFileSync(new URL(`../src/locales/${lang}.json`, import.meta.url), 'utf8'))
    for (const label of labels) {
      const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '')
      const translated = messages.conservationText[key] || messages.conservationPages.observations.values[key] || messages.dashboardValues[key]
      assert.ok(typeof translated === 'string' && translated.trim(), `${lang}: ${label}`)
    }
  }
})
