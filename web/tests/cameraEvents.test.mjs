import test from 'node:test'
import assert from 'node:assert/strict'
import { loadCameraEvents, CAMERA_EVENTS_PATH } from '../src/services/cameraEvents.ts'

const event = () => ({ eventId: 'a'.repeat(32), cameraId: 'registered-camera', plantId: '42', eventType: 'possible_plant_contact',
  title: 'Possible contact', description: 'Camera contact plus MPU', confidence: null, detectedAt: '2026-11-13T00:00:00Z',
  recordingStartedAt: '2026-11-13T00:00:00Z', recordingEndedAt: '2026-11-13T00:00:10Z', durationSeconds: 10,
  recordingStatus: 'ready', status: 'New', videoUrl: 'https://untrusted.invalid/clip.mp4' })

test('camera list uses the authenticated proxy and constructs only protected playback URLs', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, CAMERA_EVENTS_PATH)
      assert.equal(options.credentials, 'same-origin'); assert.equal(options.cache, 'no-store')
      return Response.json({ events: [event()], hasMore: false })
    }
    const result = await loadCameraEvents()
    assert.equal(result.events[0].videoUrl, `/api/data/camera-events/${'a'.repeat(32)}/video`)
    assert.equal(result.events[0].plantId, '42')
    for (const state of ['recording', 'processing', 'failed', 'unavailable']) {
      globalThis.fetch = async () => Response.json({ events: [{ ...event(), recordingStatus: state }], hasMore: false })
      assert.equal((await loadCameraEvents()).events[0].videoUrl, undefined)
    }
    globalThis.fetch = async () => Response.json({ events: [{ ...event(), recordingEndedAt: undefined, durationSeconds: undefined }], hasMore: false })
    assert.equal((await loadCameraEvents()).events[0].videoUrl, `/api/data/camera-events/${'a'.repeat(32)}/video`)
    globalThis.fetch = async () => Response.json({ events: [], hasMore: false })
    assert.deepEqual(await loadCameraEvents(), { events: [], hasMore: false })
  } finally { globalThis.fetch = original }
})

test('camera list distinguishes access failures and malformed metadata from an empty list', async () => {
  const original = globalThis.fetch
  try {
    for (const status of [401, 403, 503]) {
      globalThis.fetch = async () => Response.json({}, { status })
      await assert.rejects(loadCameraEvents(), /sign in|permission|unavailable/)
    }
    for (const bad of [{ eventId: '../secret' }, { plantId: null }, { confidence: 0.9 }, { recordingStatus: 'unknown' }, { durationSeconds: -1 }, { recordingEndedAt: 'bad' }, { detectedAt: 'bad' }]) {
      globalThis.fetch = async () => Response.json({ events: [{ ...event(), ...bad }], hasMore: false })
      await assert.rejects(loadCameraEvents(), /invalid|incomplete/)
    }
    globalThis.fetch = async () => Response.json({ events: 'bad', hasMore: false })
    await assert.rejects(loadCameraEvents(), /invalid/)
    globalThis.fetch = async () => { throw Error('offline') }
    await assert.rejects(loadCameraEvents(), /Unable to reach/)
  } finally { globalThis.fetch = original }
})
