export const IOT_DEVICES_PATH = '/api/data/devices'
export const IOT_HISTORY_LIMIT = 100
import type { SensorThresholds } from './sensorThresholds'

export interface IoTReading {
  reading_id: string
  plant_id: string | number | null
  temperature_c: number | null
  humidity: number | null
  soil_moisture: number | null
  rainfall_mm: number | null
  // Legacy field names above do not imply calibration; soil/rain remain raw.
  motion_detected: boolean | null
  dht_status: string | null
  mpu_connected: boolean | null
  gps_latitude: number | null
  gps_longitude: number | null
  recorded_at: string
}

export interface IoTDevice {
  sensor_id: string
  plant_id: string | number | null
  device_name: string
  device_type: string
  serial_number: null
  location_description: null
  status: string
  installed_at: null
  latest_reading: IoTReading | null
  thresholds: SensorThresholds
}

export interface IoTHistory {
  readings: IoTReading[]
  page: number
  limit: number
  hasMore: boolean
}

type ApiRecord = Record<string, unknown>

const record = (value: unknown): ApiRecord | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as ApiRecord)
    : null

const requiredText = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value : null

const optionalText = (value: unknown) =>
  typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
    ? String(value)
    : null

const metric = (values: ApiRecord, key: string) => {
  const value = values[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

const mapReading = (value: unknown, plantId: unknown): IoTReading | null => {
  const item = record(value)
  const values = record(item?.values)
  const id = requiredText(item?.id)
  const recordedAt = requiredText(item?.created_at)
  if (!item || !values || !id || !recordedAt) return null
  const movement = metric(values, 'movement')
  const capture = record(values._capture)
  return {
    reading_id: id,
    plant_id: optionalText(plantId),
    temperature_c: metric(values, 'temperature'),
    humidity: metric(values, 'humidity'),
    soil_moisture: metric(values, 'soilMoisture'),
    rainfall_mm: metric(values, 'rainfall'),
    motion_detected: movement === 1 ? true : movement === 0 ? false : null,
    dht_status: typeof capture?.dht_status === 'string' ? capture.dht_status : null,
    mpu_connected: typeof capture?.mpu_connected === 'boolean' ? capture.mpu_connected : null,
    gps_latitude: null,
    gps_longitude: null,
    recorded_at: recordedAt,
  }
}

export const mapCanonicalDevice = (value: unknown): IoTDevice | null => {
  const item = record(value)
  const id = requiredText(item?.id)
  const name = requiredText(item?.name)
  const deviceType = requiredText(item?.device_type)
  const status = requiredText(item?.status)
  if (!item || !id || !name || !deviceType || !status) return null
  const latest = item.latest_reading === null ? null : mapReading(item.latest_reading, item.plant_id)
  if (item.latest_reading !== null && latest === null) return null
  return {
    sensor_id: id,
    plant_id: optionalText(item.plant_id),
    device_name: name,
    device_type: deviceType,
    serial_number: null,
    location_description: null,
    status,
    installed_at: null,
    latest_reading: latest,
    thresholds: record(item.thresholds) as SensorThresholds || {},
  }
}

export const mapCanonicalHistory = (value: unknown, plantId: unknown): IoTHistory | null => {
  const result = record(value)
  if (!result || !Array.isArray(result.readings)) return null
  const readings = result.readings.map((entry) => mapReading(entry, plantId))
  if (readings.some((entry) => entry === null)) return null
  if (
    typeof result.page !== 'number' ||
    typeof result.limit !== 'number' ||
    typeof result.hasMore !== 'boolean'
  ) return null
  return { readings: readings as IoTReading[], page: result.page, limit: result.limit, hasMore: result.hasMore }
}

export class IoTApiError extends Error {
  readonly status: number
  readonly kind: 'network' | 'invalid' | 'http'

  constructor(message: string, status = 0, kind: 'network' | 'invalid' | 'http' = 'http') {
    super(message)
    this.status = status
    this.kind = kind
  }
}

const errorMessage = (status: number, backendMessage = '') =>
  backendMessage || (status === 401
    ? 'Your session has expired. Please sign in again.'
    : status === 403
      ? 'You do not have permission to view IoT data.'
      : `Unable to retrieve IoT data (${status}).`)

async function request(path: string, signal?: AbortSignal): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    })
  } catch {
    throw new IoTApiError('The IoT service could not be reached. Please try again.', 0, 'network')
  }
  let result: unknown
  try {
    result = await response.json()
  } catch {
    throw new IoTApiError('The IoT service returned an invalid response.', response.status, 'invalid')
  }
  if (!response.ok) {
    const body = record(result)
    const backend = [body?.message, body?.error].find(
      (entry): entry is string => typeof entry === 'string' && Boolean(entry.trim()),
    )
    throw new IoTApiError(errorMessage(response.status, backend), response.status)
  }
  return result
}

export async function loadCanonicalDevices(signal?: AbortSignal): Promise<IoTDevice[]> {
  const result = record(await request(IOT_DEVICES_PATH, signal))
  if (!result || !Array.isArray(result.devices))
    throw new IoTApiError('The IoT service returned an invalid device response.', 200, 'invalid')
  const devices = result.devices.map(mapCanonicalDevice)
  if (devices.some((device) => device === null))
    throw new IoTApiError('The IoT service returned an invalid device response.', 200, 'invalid')
  return devices as IoTDevice[]
}

export const canonicalHistoryPath = (deviceId: string, page = 1) =>
  `/api/data/devices/${encodeURIComponent(deviceId)}/readings?page=${page}&limit=${IOT_HISTORY_LIMIT}`

export async function loadCanonicalHistory(device: IoTDevice): Promise<IoTHistory> {
  const result = mapCanonicalHistory(
    await request(canonicalHistoryPath(device.sensor_id)),
    device.plant_id,
  )
  if (!result)
    throw new IoTApiError('The IoT service returned an invalid reading response.', 200, 'invalid')
  return result
}

export async function loadCanonicalHistoryPage(device: IoTDevice, page: number, signal?: AbortSignal): Promise<IoTHistory> {
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000)
    throw new IoTApiError('The IoT history page is invalid.', 400, 'invalid')
  const result = mapCanonicalHistory(await request(canonicalHistoryPath(device.sensor_id, page), signal), device.plant_id)
  if (!result || result.page !== page || result.readings.length > IOT_HISTORY_LIMIT)
    throw new IoTApiError('The IoT service returned an invalid reading response.', 200, 'invalid')
  return result
}

// Reuse the authorized endpoint for the transient latest reading and current thresholds.
// Four workers bound concurrent traffic. Inventory and camera state are never updated.
export async function loadLatestReadings(devices: IoTDevice[], signal: AbortSignal): Promise<IoTDevice[]> {
  const result: IoTDevice[] = new Array(devices.length)
  let next = 0
  const worker = async () => {
    while (next < devices.length) {
      signal.throwIfAborted()
      const index = next++, device = devices[index]!
      const response = await request(
        `/api/data/devices/${encodeURIComponent(device.sensor_id)}/readings?page=1&limit=1`, signal,
      )
      const history = mapCanonicalHistory(response, device.plant_id)
      if (!history || history.readings.length > 1)
        throw new IoTApiError('The IoT service returned an invalid reading response.', 200, 'invalid')
      result[index] = { ...device, latest_reading: history.readings[0] ?? null,
        thresholds: record(record(response)?.thresholds) as SensorThresholds || device.thresholds }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, devices.length) }, worker))
  return result
}
