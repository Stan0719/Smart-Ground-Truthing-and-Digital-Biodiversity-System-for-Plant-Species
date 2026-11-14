import type { IoTDevice, IoTReading } from '../services/iotMonitoring'

export function cameraPlantId(value: string | number | null | undefined): string {
  const raw = String(value ?? '').trim().replace(/^PL/i, '')
  if (!/^[0-9]{1,19}$/.test(raw)) return ''
  const id = BigInt(raw)
  return id > 0n && id <= 9223372036854775807n ? id.toString() : ''
}

// Keep all four measurements from the same latest stored reading for this plant.
export function latestCameraPlantReading(devices: readonly IoTDevice[], plantId: string): IoTReading | null {
  const id = cameraPlantId(plantId)
  if (!id) return null
  let latest: IoTReading | null = null
  for (const device of devices) {
    const reading = device.latest_reading
    if (device.device_type !== 'Sensor' || cameraPlantId(device.plant_id) !== id || !reading ||
        cameraPlantId(reading.plant_id) !== id || !Number.isFinite(Date.parse(reading.recorded_at))) continue
    if (!latest || Date.parse(reading.recorded_at) > Date.parse(latest.recorded_at)) latest = reading
  }
  return latest
}
