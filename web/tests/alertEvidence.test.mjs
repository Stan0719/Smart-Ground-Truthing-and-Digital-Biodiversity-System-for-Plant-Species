import test from 'node:test'
import assert from 'node:assert/strict'
import { loadAlertContext, loadCurrentAssignments, assignedPlantLabel } from '../src/services/alertEvidence.ts'
import { sensorAlertFixture } from './fixtures/sensorAlertContext.mjs'
const canonical = a => ({ id: a.id, deviceId: a.device_id, readingId: a.reading_id, metric: a.metric, value: a.value })

test('saved Sensor snapshot accepts null raw reference and preserves event Plant and thresholds', async () => {
  const make = () => {
    const { alert, context } = sensorAlertFixture()
    alert.reading_id = null; context.alert.reading_id = null
    context.reading.id = null; context.reading.basis = 'alert_snapshot'; context.reading.captured_at = '2026-11-21T01:00:00Z'
    context.historical_threshold = { min: 20, max: 35, direction: 'high', limit: 35 }
    context.plant_at_detection = { state: 'verified', plant_id: '1' }
    return { alert, context }
  }
  const { alert, context } = make()
  const result = await loadAlertContext(canonical(alert), undefined, async () => Response.json(context))
  assert.equal(result.plant_at_detection.plant_id, '1'); assert.equal(result.current_assignment.plant_id, '32')
  assert.equal(result.historical_threshold.max, 35); assert.equal(result.reading.id, null)
  for (const mutate of [c => c.historical_threshold.limit = 999, c => c.historical_threshold.direction = 'low',
    c => c.plant_at_detection.plant_id = '../private', c => c.reading.values.temperature = -10, c => c.reading.captured_at = 'invalid',
    c => delete c.reading.basis, c => c.historical_threshold.min = 99]) {
    const fixture = make(); mutate(fixture.context)
    await assert.rejects(loadAlertContext(canonical(fixture.alert), undefined, async () => Response.json(fixture.context)), { kind: 'invalid' })
  }
})

test('exact fixture evidence preserves six metrics, zeros and current-only assignment', async () => {
  const { alert, context } = sensorAlertFixture()
  const result = await loadAlertContext(canonical(alert), undefined, async (url, options) => {
    assert.equal(url, `/api/data/alerts/${alert.id}/context`)
    assert.equal(options.method, undefined)
    return Response.json(context)
  })
  assert.deepEqual(result.reading.values, context.reading.values)
  assert.equal(result.historical_threshold, null)
  assert.equal(assignedPlantLabel(result.current_assignment), 'PL032')
  assert.equal(assignedPlantLabel({ state: 'verified', plant_id: '9007199254740993' }), 'PL9007199254740993')
})

test('foreign identities, fabricated thresholds and invalid trigger evidence fail closed', async () => {
  for (const mutate of [c => c.alert.id = 'other', c => c.alert.device_id = 'other', c => c.reading.id = 'other',
    c => c.reading.device_id = 'other', c => c.reading.values.temperature = 39,
    c => c.reading.values.movement = 2, c => c.historical_threshold = 30,
    c => c.current_assignment.plant_id = '32/private']) {
    const { alert, context } = sensorAlertFixture(); mutate(context)
    await assert.rejects(loadAlertContext(canonical(alert), undefined, async () => Response.json(context)), { kind: 'invalid' })
  }
})

test('missing reading and verified null assignment remain distinct from lookup failure', async () => {
  const { alert, context } = sensorAlertFixture()
  context.reading = { state: 'missing', id: alert.reading_id, device_id: null, received_at: null, values: null }
  context.current_assignment = { ...context.current_assignment, state: 'not_linked', plant_id: null }
  const result = await loadAlertContext(canonical(alert), undefined, async () => Response.json(context))
  assert.equal(result.reading.values, null); assert.equal(result.current_assignment.state, 'not_linked')
  await assert.rejects(loadAlertContext(canonical(alert), undefined, async () => Response.json({}, { status: 503 })), { status: 503 })
})

test('500 assignments use ten bounded SELECT requests with at most two concurrent workers', async () => {
  const rows = Array.from({ length: 500 }, (_, i) => ({ id: `alert-${i}`, deviceId: `sensor-${i}` }))
  let active = 0, peak = 0, calls = 0
  const result = await loadCurrentAssignments(rows, undefined, async (url, options) => {
    calls++; peak = Math.max(peak, ++active); assert.equal(options.method, undefined)
    const ids = new URL(url, 'http://fixture').searchParams.get('ids').split(',')
    assert.ok(ids.length <= 50)
    await new Promise(setImmediate); active--
    return Response.json({ contract_version: 1, assignments: ids.map(id => ({ alert_id: id, device_id: rows.find(r => r.id === id).deviceId,
      basis: 'current_device_assignment', state: 'not_linked', plant_id: null })) })
  })
  assert.equal(calls, 10); assert.equal(peak, 2); assert.equal(result.partial, false)
  assert.equal(Object.values(result.assignments).filter(r => r.state === 'not_linked').length, 500)
})

test('assignment failures and foreign responses never become Not linked; auth failures propagate', async () => {
  const rows = [{ id: 'a', deviceId: 'd' }]
  for (const transport of [async () => Response.json({}, { status: 500 }), async () => Response.json({ contract_version: 1, assignments: [{ alert_id: 'foreign' }] })]) {
    const result = await loadCurrentAssignments(rows, undefined, transport)
    assert.equal(result.partial, true); assert.equal(result.assignments.a.state, 'unavailable')
  }
  for (const status of [401, 403]) await assert.rejects(loadCurrentAssignments(rows, undefined, async () => Response.json({}, { status })), { status })
})
