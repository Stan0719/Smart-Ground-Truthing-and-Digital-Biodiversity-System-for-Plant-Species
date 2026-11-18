import { ThreatAlertApiError, type CanonicalThreatAlert } from './threatAlerts.ts'
export const SENSOR_METRICS = ['temperature', 'humidity', 'soilMoisture', 'movement', 'rainfall', 'sound'] as const
export type SensorMetric = typeof SENSOR_METRICS[number]
export interface CurrentAssignment {
  state: 'verified' | 'not_linked' | 'unavailable'
  basis: 'current_device_assignment'; device_id: string; plant_id: string | null
}
export interface AlertContext {
  alert: { id: string; device_id: string; reading_id: string | null; metric: string; value: number }
  current_assignment: CurrentAssignment
  reading: { state: 'verified' | 'missing' | 'missing_device' | 'mismatched_device' | 'invalid_values' | 'trigger_mismatch'; id: string | null; device_id: string | null; received_at: string | null; values: Partial<Record<SensorMetric, number>> | null }
  historical_threshold: null
}
const object = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
const validId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(v)
const validPlant = (v: unknown): v is string => typeof v === 'string' && /^[1-9][0-9]{0,18}$/.test(v) && BigInt(v) <= 9223372036854775807n
function invalid(): never { throw new ThreatAlertApiError('Alert evidence could not be verified.', 200, 'invalid') }
export const unavailableAssignment = (deviceId: string): CurrentAssignment => ({ state: 'unavailable', basis: 'current_device_assignment', device_id: deviceId, plant_id: null })
export const assignedPlantLabel = (value: CurrentAssignment | undefined) => value?.state === 'verified' && value.plant_id ? `PL${value.plant_id.padStart(3, '0')}` : null
function assignment(value: unknown, deviceId: string): CurrentAssignment {
  const row = object(value)
  if (!row || row.device_id !== deviceId || row.basis !== 'current_device_assignment' ||
    typeof row.state !== 'string' || !['verified', 'not_linked', 'unavailable'].includes(row.state) ||
    (row.state === 'verified' ? !validPlant(row.plant_id) : row.plant_id !== null)) return invalid()
  return { state: row.state as CurrentAssignment['state'], basis: 'current_device_assignment', device_id: deviceId, plant_id: row.plant_id as string | null }
}
async function request(url: string, signal?: AbortSignal, transport = fetch) {
  let response: Response
  try { response = await transport(url, { credentials: 'same-origin', cache: 'no-store', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) }) }
  catch { throw new ThreatAlertApiError('Alert evidence could not be reached.', 0, 'network') }
  if (!response.ok) throw new ThreatAlertApiError('Alert evidence is unavailable.', response.status)
  try { return object(await response.json()) } catch { return invalid() }
}
export async function loadAlertContext(alert: CanonicalThreatAlert, signal?: AbortSignal, transport = fetch): Promise<AlertContext> {
  if (!validId(alert.id)) return invalid()
  const result = await request(`/api/data/alerts/${encodeURIComponent(alert.id)}/context`, signal, transport)
  const identity = object(result?.alert), reading = object(result?.reading)
  if (!result || result.contract_version !== 1 || result.historical_threshold !== null || !identity || !reading ||
    identity.id !== alert.id || identity.device_id !== alert.deviceId || identity.reading_id !== alert.readingId || identity.metric !== alert.metric || identity.value !== alert.value ||
    reading.id !== alert.readingId || typeof reading.state !== 'string' || !['verified', 'missing', 'missing_device', 'mismatched_device', 'invalid_values', 'trigger_mismatch'].includes(reading.state)) return invalid()
  if (reading.state === 'verified') {
    const values = object(reading.values)
    if (!values || reading.device_id !== alert.deviceId || !validId(reading.id) || typeof reading.received_at !== 'string' || !Number.isFinite(Date.parse(reading.received_at)) ||
      Object.entries(values).some(([key, value]) => !SENSOR_METRICS.includes(key as SensorMetric) || typeof value !== 'number' || !Number.isFinite(value) ||
        (key === 'movement' && value !== 0 && value !== 1) || (key === 'humidity' && (value < 0 || value > 100)) ||
        (key === 'temperature' && value < -273.15) || (['soilMoisture','rainfall','sound'].includes(key) && value < 0)) ||
      (SENSOR_METRICS.includes(alert.metric as SensorMetric) && values[alert.metric] !== alert.value)) return invalid()
  } else if (reading.device_id !== null || reading.received_at !== null || reading.values !== null) return invalid()
  return { alert: identity as unknown as AlertContext['alert'], reading: reading as unknown as AlertContext['reading'],
    current_assignment: assignment(result.current_assignment, alert.deviceId), historical_threshold: null }
}

export async function loadCurrentAssignments(alerts: CanonicalThreatAlert[], signal?: AbortSignal, transport = fetch) {
  const assignments: Record<string, CurrentAssignment> = Object.create(null)
  for (const alert of alerts) assignments[alert.id] = unavailableAssignment(alert.deviceId)
  let partial = alerts.length > 500
  const targets = new Map(alerts.slice(0, 500).map(alert => [alert.id, alert]))
  const chunks: string[][] = []; let chunk: string[] = []
  for (const id of targets.keys()) {
    if (!validId(id)) { partial = true; continue }
    if (chunk.length === 50 || encodeURIComponent([...chunk, id].join(',')).length > 5000) { chunks.push(chunk); chunk = [] }
    chunk.push(id)
  }
  if (chunk.length) chunks.push(chunk)
  let next = 0
  async function worker() {
    while (next < chunks.length) {
      if (signal?.aborted) return
      const ids = chunks[next++]!
      try {
        const result = await request('/api/data/alerts/current-assignments?ids=' + encodeURIComponent(ids.join(',')), signal, transport)
        if (!result || result.contract_version !== 1 || !Array.isArray(result.assignments) || result.assignments.length > ids.length) return invalid()
        const staged: Record<string, CurrentAssignment> = Object.create(null)
        for (const value of result.assignments) {
          const row = object(value)
          if (!row || typeof row.alert_id !== 'string' || !ids.includes(row.alert_id) || Object.hasOwn(staged, row.alert_id)) return invalid()
          staged[row.alert_id] = assignment(row, targets.get(row.alert_id)!.deviceId)
        }
        if (Object.keys(staged).length !== ids.length) partial = true
        Object.assign(assignments, staged)
      } catch (error) {
        if (error instanceof ThreatAlertApiError && [401,403].includes(error.status)) throw error
        partial = true
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(2, chunks.length) }, worker))
  return { assignments, partial }
}
