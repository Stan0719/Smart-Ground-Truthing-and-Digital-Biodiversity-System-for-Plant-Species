import { reportRequestUrl, type ReportFilters, type ReportScope } from './reporting'

export const measurementUnits = { temperature: '°C', humidity: '%', soilMoisture: 'raw', rainfall: 'raw', sound: 'raw', movement: '0/1' } as const
export type Measurement = keyof typeof measurementUnits
export interface SummaryStatistics {
  receivedRows: number; validMeasurements: number; missingMeasurements: number
  absentOrNullMeasurements: number; invalidMeasurements: number
  average: number | null; minimum: number | null; maximum: number | null
  detectedSampleCount?: number; noMovementSampleCount?: number
}
export interface SummaryBucket extends SummaryStatistics { startInclusive: string; endExclusive: string }
export interface IoTSummary {
  contractVersion: 1; category: 'iot'; generatedAt: string; complete: true
  device: { id: string; name: string }; measurement: { key: Measurement; unit: string }
  temperatureThreshold: number | null; latestReading: { recordedAt: string; value: number } | null
  scope: ReportScope & { timestampBasis: 'sensor_reading.created_at'; asOf: string; effectiveStartInclusive: string | null; effectiveEndExclusive: string | null }
  aggregation: { interval: 'minute' | 'hour' | 'day' | 'week'; step: number; maximumBuckets: 520; bucketCount: number; emptyBucketsIncluded: true }
  summary: SummaryStatistics
  observedSpan: { firstReceivedAt: string | null; lastReceivedAt: string | null; firstValidAt: string | null; lastValidAt: string | null }
  buckets: SummaryBucket[]; limitations: string[]
}
export class IoTReportError extends Error {
  code: string
  constructor(code: string) { super(code); this.code = code }
}
export interface IoTExactRange { startAt: string; endAt: string }
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\dT.*Z$/.test(v) && Number.isFinite(Date.parse(v))
const nullableDate = (v: unknown) => v === null || date(v)
const count = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0
function movementCounts(s: SummaryStatistics): boolean {
  return count(s.detectedSampleCount) && count(s.noMovementSampleCount) && s.validMeasurements === s.detectedSampleCount + s.noMovementSampleCount
}
function statistics(v: unknown): v is SummaryStatistics {
  if (!record(v) || !['receivedRows', 'validMeasurements', 'missingMeasurements', 'absentOrNullMeasurements', 'invalidMeasurements'].every(k => count(v[k]))) return false
  const s = v as unknown as SummaryStatistics
  if (s.receivedRows !== s.validMeasurements + s.missingMeasurements || s.missingMeasurements !== s.absentOrNullMeasurements + s.invalidMeasurements) return false
  if (![s.average, s.minimum, s.maximum].every(n => n === null || typeof n === 'number' && Number.isFinite(n))) return false
  return s.validMeasurements === 0 ? s.average === null && s.minimum === null && s.maximum === null
    : s.minimum !== null && s.maximum !== null && s.average !== null && s.minimum <= s.average && s.average <= s.maximum
}
export function validIoTSummary(value: unknown, filters: ReportFilters, device: string, measurement: Measurement, range?: IoTExactRange): value is IoTSummary {
  if (!record(value)) return false
  const r = value as unknown as IoTSummary
  if (r.contractVersion !== 1 || r.category !== 'iot' || r.complete !== true || !date(r.generatedAt) || !record(r.device) || r.device.id !== device || typeof r.device.name !== 'string' || !record(r.measurement) || r.measurement.key !== measurement || r.measurement.unit !== measurementUnits[measurement]) return false
  if (!(r.temperatureThreshold === null || typeof r.temperatureThreshold === 'number' && Number.isFinite(r.temperatureThreshold)) || !(r.latestReading === null || record(r.latestReading) && date(r.latestReading.recordedAt) && typeof r.latestReading.value === 'number' && Number.isFinite(r.latestReading.value))) return false
  const s = r.scope, a = r.aggregation
  if (!record(s) || s.period !== filters.period || s.timezone !== 'Asia/Kuala_Lumpur' || s.timestampBasis !== 'sensor_reading.created_at' || !date(s.asOf) || ![s.startInclusive, s.endExclusive, s.effectiveStartInclusive, s.effectiveEndExclusive].every(nullableDate)) return false
  if (filters.period === 'custom' && (s.startDate !== filters.start || s.endDate !== filters.end)) return false
  if (filters.period === 'all-time' ? [s.startDate, s.endDate, s.startInclusive, s.endExclusive].some(v => v !== null) : !date(s.startInclusive) || !date(s.endExclusive) || Date.parse(s.startInclusive) >= Date.parse(s.endExclusive)) return false
  if (!record(a) || !['minute', 'hour', 'day', 'week'].includes(a.interval) || !count(a.step) || a.step < 1 || a.maximumBuckets !== 520 || a.emptyBucketsIncluded !== true || !Array.isArray(r.buckets) || r.buckets.length > 520 || a.bucketCount !== r.buckets.length || !statistics(r.summary)) return false
  if (!record(r.observedSpan) || !['firstReceivedAt', 'lastReceivedAt', 'firstValidAt', 'lastValidAt'].every(k => nullableDate(r.observedSpan[k as keyof IoTSummary['observedSpan']]))) return false
  if (!Array.isArray(r.limitations) || !r.limitations.every(v => typeof v === 'string' && v.length <= 200) || r.limitations.length > 30) return false
  let previous: string | null = null
  for (const b of r.buckets) {
    if (!record(b) || !date(b.startInclusive) || !date(b.endExclusive) || Date.parse(b.startInclusive) >= Date.parse(b.endExclusive) || !statistics(b) || previous !== null && b.startInclusive !== previous) return false
    previous = b.endExclusive
  }
  if (r.buckets.length && (r.buckets[0]!.startInclusive !== s.effectiveStartInclusive || previous !== s.effectiveEndExclusive)) return false
  if (range && (s.effectiveStartInclusive !== range.startAt || s.effectiveEndExclusive !== range.endAt)) return false
  if (measurement !== 'temperature' && r.temperatureThreshold !== null) return false
  if (measurement === 'movement' && (!movementCounts(r.summary) || !r.buckets.every(movementCounts) || !(['detectedSampleCount', 'noMovementSampleCount'] as const).every(k => r.buckets.reduce((n, b) => n + b[k]!, 0) === r.summary[k]))) return false
  return (['receivedRows', 'validMeasurements', 'missingMeasurements', 'absentOrNullMeasurements', 'invalidMeasurements'] as const).every(k => r.buckets.reduce((n, b) => n + b[k], 0) === r.summary[k])
}
export async function requestIoTSummary(filters: ReportFilters, device: string, measurement: Measurement, signal?: AbortSignal, range?: IoTExactRange): Promise<IoTSummary> {
  const query = new URLSearchParams(reportRequestUrl(filters).split('?')[1] || '')
  query.set('contractVersion', '1'); query.set('device', device); query.set('measurement', measurement); query.set('interval', 'auto')
  if (range) { query.set('startAt', range.startAt); query.set('endAt', range.endAt) }
  let response: Response
  try { response = await fetch(`/api/data/reports/iot-summary?${query}`, { credentials: 'same-origin', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000) }) }
  catch { throw new IoTReportError('unavailable') }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new IoTReportError('unauthorized')
    throw new IoTReportError(response.status === 422 ? 'limit' : response.status === 400 ? 'invalidRequest' : 'unavailable')
  }
  let result: unknown
  try { const body = await response.text(); if (body.length > 1048576) throw Error(); result = JSON.parse(body) } catch { throw new IoTReportError('invalidResponse') }
  if (!validIoTSummary(result, filters, device, measurement, range)) throw new IoTReportError('invalidResponse')
  return result
}
