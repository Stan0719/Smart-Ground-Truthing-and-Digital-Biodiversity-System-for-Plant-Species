export const CANONICAL_ALERTS_PATH = '/api/data/alerts'
export const CANONICAL_ALERT_CAP = 500

export type AlertResponseStatus = 'Reviewing' | 'Resolved'

export interface CanonicalAlertResponse {
  id: string
  alertId: string
  officerSubject: string
  note: string
  status: AlertResponseStatus
  createdAt: string
}

export interface CanonicalThreatAlert {
  id: string
  deviceId: string
  readingId: string | null
  cameraId: string | null
  metric: string
  value: number
  status: string
  detectedAt: string
  createdAt: string
  videoPath: string | null
  responses: CanonicalAlertResponse[]
}

type RecordValue = Record<string, unknown>
const record = (value: unknown): RecordValue | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordValue
    : null
const requiredText = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value : null
const optionalText = (value: unknown) => value === null ? null : requiredText(value)

const mapResponse = (value: unknown): CanonicalAlertResponse | null => {
  const item = record(value)
  const id = requiredText(item?.id)
  const alertId = requiredText(item?.alert_id)
  const officerSubject = requiredText(item?.officer_subject)
  const note = requiredText(item?.note)
  const status = requiredText(item?.status)
  const createdAt = requiredText(item?.created_at)
  if (!id || !alertId || !officerSubject || !note || !createdAt || !['Reviewing', 'Resolved'].includes(status || '')) return null
  return { id, alertId, officerSubject, note, status: status as AlertResponseStatus, createdAt }
}

const mapAlert = (value: unknown, responses: CanonicalAlertResponse[]): CanonicalThreatAlert | null => {
  const item = record(value)
  const id = requiredText(item?.id)
  const deviceId = requiredText(item?.device_id)
  const metric = requiredText(item?.metric)
  const status = requiredText(item?.status)
  const createdAt = requiredText(item?.created_at)
  if (!id || !deviceId || !metric || !status || !createdAt || typeof item?.value !== 'number' || !Number.isFinite(item.value)) return null
  const detectedAt = optionalText(item.detected_at) || createdAt
  const readingId = optionalText(item.reading_id)
  const cameraId = optionalText(item.camera_id)
  const videoPath = optionalText(item.video_path)
  if ((item.reading_id !== null && readingId === null) || (item.camera_id !== null && cameraId === null) || (item.video_path !== null && videoPath === null)) return null
  return {
    id, deviceId, readingId, cameraId, metric, value: item.value, status,
    detectedAt, createdAt, videoPath,
    responses: responses.filter((response) => response.alertId === id),
  }
}

export class ThreatAlertApiError extends Error {
  readonly status: number
  readonly kind: 'network' | 'invalid' | 'http'
  constructor(message: string, status = 0, kind: 'network' | 'invalid' | 'http' = 'http') {
    super(message); this.status = status; this.kind = kind
  }
}

const fallbackMessage = (status: number) => status === 401
  ? 'Your session has expired. Please sign in again.'
  : status === 403
    ? 'You do not have permission to manage threat alerts.'
    : status === 404
      ? 'The threat alert is no longer available.'
      : status === 409
        ? 'The alert response conflicts with the latest saved status.'
        : `Threat alert request failed (${status}).`

async function request(path: string, options: RequestInit = {}): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(path, {
      credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15000),
      ...options,
    })
  } catch {
    throw new ThreatAlertApiError('The threat alert service could not be reached. Please try again.', 0, 'network')
  }
  let result: unknown
  try { result = await response.json() }
  catch { throw new ThreatAlertApiError('The threat alert service returned an invalid response.', response.status, 'invalid') }
  if (!response.ok) {
    const body = record(result)
    const message = [body?.message, body?.error].find((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()))
    throw new ThreatAlertApiError(message || fallbackMessage(response.status), response.status)
  }
  return result
}

export async function loadCanonicalAlerts(signal?: AbortSignal): Promise<CanonicalThreatAlert[]> {
  const result = record(await request(CANONICAL_ALERTS_PATH, signal ? {
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
  } : {}))
  if (!result || !Array.isArray(result.alerts) || !Array.isArray(result.responses))
    throw new ThreatAlertApiError('The threat alert service returned an invalid response.', 200, 'invalid')
  const responses = result.responses.map(mapResponse)
  if (responses.some((entry) => entry === null))
    throw new ThreatAlertApiError('The threat alert service returned invalid response history.', 200, 'invalid')
  const alerts = result.alerts.map((entry) => mapAlert(entry, responses as CanonicalAlertResponse[]))
  if (alerts.some((entry) => entry === null))
    throw new ThreatAlertApiError('The threat alert service returned invalid alert data.', 200, 'invalid')
  return alerts as CanonicalThreatAlert[]
}

export const alertResponsePath = (id: string) =>
  `/api/data/alerts/${encodeURIComponent(id)}/responses`

export async function saveAlertResponse(id: string, note: string, status: AlertResponseStatus) {
  const result = record(await request(alertResponsePath(id), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note: note.trim(), status }),
  }))
  if (!result || result.updated !== true)
    throw new ThreatAlertApiError('The threat alert service returned an invalid save response.', 200, 'invalid')
}
