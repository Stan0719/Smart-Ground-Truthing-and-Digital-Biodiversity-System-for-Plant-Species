import type { CameraEvent } from '../types/cameraMonitoring'

export const CAMERA_EVENTS_PATH = '/api/data/camera-events'
const states = ['recording', 'processing', 'ready', 'failed', 'unavailable']
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const instant = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value))

export async function loadCameraEvents(signal?: AbortSignal): Promise<{ events: CameraEvent[]; hasMore: boolean }> {
  let response: Response
  try {
    response = await fetch(CAMERA_EVENTS_PATH, {
      credentials: 'same-origin', cache: 'no-store',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    })
  } catch {
    throw new Error('Unable to reach the camera event service. Please try again.')
  }
  if (!response.ok) {
    throw new Error(response.status === 401 ? 'Please sign in again to view camera events.'
      : response.status === 403 ? 'You do not have permission to view camera events.'
        : response.status === 503 ? 'Camera event storage is unavailable. Check the backend connection.'
          : 'Unable to retrieve camera events. Please try again.')
  }
  const result: unknown = await response.json()
  if (!isRecord(result) || !Array.isArray(result.events) || result.events.length > 100 || typeof result.hasMore !== 'boolean')
    throw new Error('The camera event service returned an invalid response.')
  const events = result.events.map((value: unknown): CameraEvent => {
    if (!isRecord(value) || typeof value.eventId !== 'string' || !/^[a-f0-9]{32}$/.test(value.eventId) ||
        typeof value.cameraId !== 'string' || !value.cameraId || typeof value.plantId !== 'string' || !/^[1-9][0-9]*$/.test(value.plantId) ||
        value.eventType !== 'possible_plant_contact' || typeof value.title !== 'string' || typeof value.description !== 'string' ||
        value.confidence !== null || !instant(value.detectedAt) || !instant(value.recordingStartedAt) ||
        typeof value.recordingStatus !== 'string' || !states.includes(value.recordingStatus) ||
        !['New', 'Reviewing', 'Resolved'].includes(String(value.status)) ||
        (value.recordingEndedAt !== undefined && !instant(value.recordingEndedAt)) ||
        (value.durationSeconds !== undefined && (typeof value.durationSeconds !== 'number' || !Number.isInteger(value.durationSeconds) || value.durationSeconds < 0)))
      throw new Error('The camera event service returned an invalid event.')
    // Construct only our authorized same-origin playback route; never accept a file path or external URL.
    return { ...value, videoUrl: value.recordingStatus === 'ready' ? `${CAMERA_EVENTS_PATH}/${value.eventId}/video` : undefined } as unknown as CameraEvent
  })
  return { events, hasMore: result.hasMore }
}
