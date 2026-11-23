export interface SensorLimits { min?: number; max?: number }
export type SensorThresholds = Record<string, number | SensorLimits>
export const DEFAULT_SENSOR_THRESHOLDS: Record<string, SensorLimits> = {
  temperature: { min: 26, max: 40 },
  humidity: { min: 40, max: 80 },
  soilMoisture: { min: 2300, max: 2700 },
  // Lower raw readings indicate a wet surface; dry readings need no upper limit.
  rainfall: { min: 2200 },
}
export function sensorLimits(value: unknown): SensorLimits | null {
  if (typeof value === 'number' && Number.isFinite(value)) return { max: value }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const limits = value as Record<string, unknown>
  if (!Object.keys(limits).length || Object.keys(limits).some(key => key !== 'min' && key !== 'max') ||
    Object.values(limits).some(value => typeof value !== 'number' || !Number.isFinite(value))) return null
  const result = limits as SensorLimits
  return result.min !== undefined && result.max !== undefined && result.min > result.max ? null : { ...result }
}
export function thresholdState(value: number | null | undefined, configured: unknown) {
  if (value == null || !Number.isFinite(value)) return 'Reading unavailable'
  const limits = sensorLimits(configured)
  if (!limits) return 'Not configured'
  if (limits.min !== undefined && value < limits.min) return 'Below minimum'
  if (limits.max !== undefined && value > limits.max) return 'Above maximum'
  return 'Within range'
}
export function thresholdLabel(configured: unknown) {
  const limits = sensorLimits(configured)
  if (!limits) return ''
  return [limits.min === undefined ? '' : `≥ ${limits.min}`, limits.max === undefined ? '' : `≤ ${limits.max}`].filter(Boolean).join(' · ')
}
export function thresholdRangeLabel(configured: unknown, unit = '') {
  const limits = sensorLimits(configured)
  if (!limits) return ''
  const range = limits.min !== undefined && limits.max !== undefined
    ? `${limits.min}–${limits.max}`
    : limits.min !== undefined ? `≥ ${limits.min}` : `≤ ${limits.max}`
  return unit ? `${range} ${unit}` : range
}
