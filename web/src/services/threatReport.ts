import { alertSource, alertTypeLabel, sensorUnit } from '../utils/threatAlertDisplay.ts'
import type { OperationalReport } from './operationalReporting'
import type { ReportDocument } from '../utils/reportExport'
export const threatSources = ['Sensor', 'Camera', 'Unknown'] as const
export type ThreatSource = typeof threatSources[number]
export type ThreatStatus = '' | 'New' | 'Reviewing' | 'Resolved'
export interface ThreatRow { readonly id: string | null; readonly deviceId: string | null; readonly cameraId: string | null; readonly triggerValue: number | null; readonly metric: string; readonly source: ThreatSource; readonly status: string; readonly plant: string | null; readonly species: string | null; readonly createdAt: string; readonly instant: number }
export interface ThreatBucket { readonly start: number; readonly end: number; readonly counts: readonly number[] }
export interface ThreatReportView {
  readonly hasTriggerProjection: boolean; readonly generatedAt: string; readonly scope: Readonly<OperationalReport['scope']>; readonly source: '' | ThreatSource; readonly status: ThreatStatus
  readonly rows: readonly ThreatRow[]; readonly sourceCounts: readonly number[]; readonly statistics: readonly { readonly key: string; readonly value: number }[]
  readonly buckets: readonly ThreatBucket[]; readonly interval: 'day' | 'week' | 'month'; readonly step: number
}
const day = 86400000, offset = 8 * 3600000
const calendar = (instant: number) => Math.floor((instant + offset) / day) * day
const invalid = (): never => { throw Error('Invalid threat report evidence.') }
const freeze = <T>(value: T): T => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value) } return value }
export function buildThreatReport(report: OperationalReport, source: '' | ThreatSource = '', status: ThreatStatus = ''): ThreatReportView {
  if (report.category !== 'threats' || report.scope.timezone !== 'Asia/Kuala_Lumpur' || !Number.isFinite(Date.parse(report.generatedAt)) ||
    (source !== '' && !threatSources.includes(source)) || !['', 'New', 'Reviewing', 'Resolved'].includes(status)) return invalid()
  if (!Array.isArray(report.rows) || JSON.stringify(report.columns) !== JSON.stringify(['category', 'severity', 'status', 'devicePlant', 'species', 'createdAt'])) return invalid()
  const reportedTotal = report.statistics.find(s => s.key === 'totalIncidents')
  if (reportedTotal && reportedTotal.value !== report.rows.length) return invalid()
  const start = report.scope.startInclusive === null ? null : Date.parse(report.scope.startInclusive)
  const end = report.scope.endExclusive === null ? null : Date.parse(report.scope.endExclusive)
  if ((start === null) !== (end === null) || (start !== null && (!Number.isFinite(start) || !Number.isFinite(end) || start >= end!))) return invalid()
  let earliest = Infinity, latest = -Infinity
  const rows: ThreatRow[] = []
  const hasTriggerProjection = report.threatDetailsVersion === 1 && Array.isArray(report.alertDetails)
  if ((report.threatDetailsVersion !== undefined || report.alertDetails !== undefined) && (!hasTriggerProjection || report.alertDetails!.length !== report.rows.length)) return invalid()
  const ids = new Set<string>()
  for (const [rowIndex, row] of report.rows.entries()) {
    const [metric, , state, plant, species, createdAt] = row
    if (typeof metric !== 'string' || !metric || typeof state !== 'string' || !['New', 'Reviewing', 'Resolved'].includes(state) ||
      typeof createdAt !== 'string' || !/(Z|[+-]\d\d:\d\d)$/.test(createdAt) || (plant !== null && typeof plant !== 'string') || (species !== null && typeof species !== 'string')) return invalid()
    const datePart = createdAt.slice(0, 10)
    const date = new Date(datePart + 'T00:00:00Z')
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== datePart) return invalid()
    const instant = Date.parse(createdAt)
    if (!Number.isFinite(instant) || (start !== null && (instant < start || instant >= end!))) return invalid()
    earliest = Math.min(earliest, instant); latest = Math.max(latest, instant)
    const classified = alertSource({ metric })
    const detail = hasTriggerProjection ? report.alertDetails![rowIndex] : null
    if (detail && (typeof detail.id !== 'string' || !detail.id.trim() || ids.has(detail.id) || typeof detail.deviceId !== 'string' || !detail.deviceId.trim() ||
      (detail.cameraId !== null && (typeof detail.cameraId !== 'string' || !detail.cameraId.trim())) || detail.metric !== metric || detail.status !== state || detail.createdAt !== createdAt)) return invalid()
    if (hasTriggerProjection && !detail) return invalid()
    if (detail) ids.add(detail.id)
    const value = detail?.triggerValue
    const validReading = classified === 'Sensor' && typeof value === 'number' && Number.isFinite(value) &&
      (metric !== 'temperature' || value >= -273.15) && (metric !== 'humidity' || value >= 0 && value <= 100) &&
      (metric !== 'movement' || value === 0 || value === 1) && (!['soilMoisture', 'rainfall', 'sound'].includes(metric) || value >= 0)
    if ((!source || classified === source) && (!status || state === status)) rows.push({ id: detail?.id ?? null, deviceId: detail?.deviceId ?? null, cameraId: detail?.cameraId ?? null, triggerValue: validReading ? value as number : null, metric, source: classified, status: state, plant: plant as string | null, species: species as string | null, createdAt, instant })
  }
  const from = start === null ? Number.isFinite(earliest) ? calendar(earliest) : null : calendar(start)
  const until = end === null ? Number.isFinite(latest) ? calendar(latest) + day : null : calendar(end - 1) + day
  const days = from === null ? 0 : (until! - from) / day
  const interval = days <= 62 ? 'day' : days <= 730 ? 'week' : 'month'
  let step = 1
  const buckets: { start: number; end: number; counts: number[] }[] = []
  if (from !== null && until !== null) {
    let cursor = from
    if (interval === 'week') cursor -= ((new Date(cursor).getUTCDay() + 6) % 7) * day
    if (interval === 'month') {
      const a = new Date(from), b = new Date(until - 1)
      step = Math.max(1, Math.ceil(((b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth() + 1) / 120))
      cursor = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), 1)
    }
    while (cursor < until) {
      const next = interval === 'month' ? Date.UTC(new Date(cursor).getUTCFullYear(), new Date(cursor).getUTCMonth() + step, 1) : cursor + day * (interval === 'week' ? 7 : 1)
      buckets.push({ start: Math.max(cursor, from) - offset, end: Math.min(next, until) - offset, counts: [0, 0, 0] })
      if (buckets.length > 124) return invalid()
      cursor = next
    }
  }
  const sourceCounts = [0, 0, 0]; let open = 0, resolved = 0
  for (const row of rows) {
    const index = threatSources.indexOf(row.source); sourceCounts[index]!++
    if (row.status === 'Resolved') resolved++; else open++
    let low = 0, high = buckets.length - 1
    while (low <= high) { const mid = (low + high) >>> 1, b = buckets[mid]!; if (row.instant < b.start) high = mid - 1; else if (row.instant >= b.end) low = mid + 1; else { b.counts[index]!++; break } }
  }
  return freeze({ hasTriggerProjection, generatedAt: report.generatedAt, scope: { ...report.scope }, source, status, rows, sourceCounts, buckets, interval, step,
    statistics: [{ key: 'total', value: rows.length }, { key: 'sensorCount', value: sourceCounts[0]! }, { key: 'cameraCount', value: sourceCounts[1]! }, { key: 'openCount', value: open }, { key: 'resolvedCount', value: resolved }] })
}
export function threatReportDate(instant: number | string, locale = 'en', dateOnly = false) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat(locale.startsWith('zh') ? 'zh-CN' : locale === 'ms' ? 'ms-MY' : 'en-GB', {
    timeZone: 'Asia/Kuala_Lumpur', day: '2-digit', month: 'short', year: 'numeric', ...(!dateOnly ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' as const } : {}),
  }).formatToParts(new Date(instant)).map(p => [p.type, p.value]))
  return `${parts.day} ${parts.month} ${parts.year}${dateOnly ? '' : `, ${parts.hour}:${parts.minute}`}`
}
export const threatBucketLabel = (bucket: ThreatBucket, locale: string) => bucket.end - bucket.start <= day ? threatReportDate(bucket.start, locale, true) : `${threatReportDate(bucket.start, locale, true)} â€“ ${threatReportDate(bucket.end - 1, locale, true)}`
export const threatMetricLabel = (metric: string, text: (key: string) => string) => alertSource({ metric }) === 'Unknown' ? metric : text(alertTypeLabel(metric))
export function triggerReading(row: ThreatRow, text: (key: string) => string) {
  if (row.source === 'Camera') return text('notApplicable')
  if (row.source !== 'Sensor' || row.triggerValue === null) return text('unavailableValue')
  return `${row.triggerValue} ${triggerUnit(row.metric, text)}`
}
export function triggerUnit(metric: string, text: (key: string) => string) {
  const unit = sensorUnit(metric)
  return unit === 'raw' ? text('raw') : unit === 'Binary (0/1)' ? text('binary') : unit || text('unavailableValue')
}
export function reportDevice(row: ThreatRow, text: (key: string) => string) {
  return [row.deviceId ? `${text('deviceId')}: ${row.deviceId}` : '', row.cameraId ? `${text('cameraId')}: ${row.cameraId}` : ''].filter(Boolean).join('; ') || text('unavailableValue')
}
export function threatReportDocument(view: ThreatReportView, text: (key: string) => string, locale: string, kind: 'pdf' | 'csv' = 'pdf'): ReportDocument {
  const keys = ['alertId', 'source', 'type', 'triggerReading', ...(kind === 'csv' ? ['triggerUnit'] : []), 'deviceCamera', 'currentPlant', 'currentSpecies', 'status', 'createdAt']
  const rows = view.rows.map(row => [row.id ?? text('unavailableValue'), text(row.source), threatMetricLabel(row.metric, text),
    kind === 'csv' && row.source === 'Sensor' && row.triggerValue !== null ? row.triggerValue : triggerReading(row, text),
    ...(kind === 'csv' ? [row.source === 'Camera' ? text('notApplicable') : row.source === 'Sensor' ? triggerUnit(row.metric, text) : text('unavailableValue')] : []),
    reportDevice(row, text), row.plant, row.species, text(row.status), row.createdAt])
  return { category: 'threats', title: text('title'), period: view.scope.startDate ? `${view.scope.startDate} – ${view.scope.endDate}` : text('allTime'), timezone: text('timezone'), generatedAt: view.generatedAt,
    generatedLabel: `${text('generated')}: ${threatReportDate(view.generatedAt, locale)}`, statistics: view.statistics.map(s => ({ label: text(s.key), value: s.value, display: s.value.toLocaleString(locale) })), columns: keys.map(text), rows,
    displayRows: view.rows.map((row, i) => rows[i]!.map((value, j) => j === keys.length - 1 ? threatReportDate(row.createdAt, locale) : value === null ? '—' : String(value))),
    context: [{ label: text('source'), value: text(view.source || 'allSources') }, { label: text('status'), value: text(view.status || 'allStatuses') }],
    chart: view.buckets.flatMap(b => threatSources.map((source, i) => ({ series: text(source), point: threatBucketLabel(b, locale), value: b.counts[i]!, unit: text('count') }))),
    notes: [{ label: text('interpretation'), value: text('limitations') + (view.sourceCounts[2] ? ` ${text('Unknown')}: ${view.sourceCounts[2]}.` : '') }, { label: text('triggerReading'), value: text('triggerLimit') },
      ...(!view.hasTriggerProjection ? [{ label: text('unavailableValue'), value: text('projectionMissing') }] : [])] }
}
