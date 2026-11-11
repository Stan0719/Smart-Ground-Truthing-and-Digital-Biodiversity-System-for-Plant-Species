import { reportRequestUrl, type ReportFilters, type ReportScope } from './reporting'
export type OperationalCategory = 'observations' | 'threats' | 'iot'
export type Cell = string | number | null
export interface OperationalReport {
  category: OperationalCategory
  generatedAt: string
  scope: ReportScope
  basis: string
  bucket?: string
  columns: string[]
  rows: Cell[][]
  statistics: { key: string; value: Cell }[]
  chart: { kind: 'stacked' | 'horizontal' | 'line'; labels: string[]; unit: string; series: { key: string; values: (number | null)[] }[] }
  devices?: { id: string; name: string }[]
  device?: string | null
  measurement?: string
  measurements?: string[]
}
const categories = ['observations', 'threats', 'iot']
const columns = {
  observations: ['period', 'totalObservations', 'Pending Review', 'Approved', 'Rejected', 'Correction Required', 'Flagged'],
  threats: ['category', 'severity', 'status', 'devicePlant', 'species', 'createdAt'],
  iot: ['recordedAt', 'device', 'measurement', 'value', 'unit'],
}
const isCell = (value: unknown): value is Cell => value === null || typeof value === 'string' || typeof value === 'number' && Number.isFinite(value)
export function validOperationalReport(value: unknown, category: OperationalCategory, filters: ReportFilters): value is OperationalReport {
  if (!value || typeof value !== 'object') return false
  const r = value as OperationalReport
  return r.category === category && Number.isFinite(Date.parse(r.generatedAt)) && r.scope?.period === filters.period && r.scope.timezone === 'Asia/Kuala_Lumpur' &&
    (filters.period !== 'custom' || r.scope.startDate === filters.start && r.scope.endDate === filters.end) &&
    typeof r.basis === 'string' && JSON.stringify(r.columns) === JSON.stringify(columns[category]) &&
    Array.isArray(r.rows) && r.rows.every(row => Array.isArray(row) && row.length === r.columns.length && row.every(isCell)) &&
    Array.isArray(r.statistics) && r.statistics.every(stat => stat && typeof stat.key === 'string' && isCell(stat.value)) &&
    r.chart?.kind === ({ observations: 'stacked', threats: 'horizontal', iot: 'line' } as const)[category] && typeof r.chart.unit === 'string' &&
    Array.isArray(r.chart.labels) && r.chart.labels.every(label => typeof label === 'string') && Array.isArray(r.chart.series) &&
    r.chart.series.every(series => series && typeof series.key === 'string' && Array.isArray(series.values) && series.values.length === r.chart.labels.length && series.values.every(v => v === null || typeof v === 'number' && Number.isFinite(v))) &&
    (category !== 'iot' || r.chart.labels.every(value => Number.isFinite(Date.parse(value))) && Array.isArray(r.devices) && r.devices.every(device => device && typeof device.id === 'string' && typeof device.name === 'string') && typeof r.measurement === 'string' && Array.isArray(r.measurements) && r.measurements.every(m => typeof m === 'string'))
}
export async function requestOperationalReport(category: OperationalCategory, filters: ReportFilters, device = '', measurement = 'temperature'): Promise<OperationalReport> {
  if (!categories.includes(category)) throw new Error('Unsupported report category.')
  const periodUrl = reportRequestUrl(filters)
  const query = new URLSearchParams(periodUrl.split('?')[1] || '')
  if (category === 'iot') { if (device) query.set('device', device); query.set('measurement', measurement) }
  const response = await fetch(`/api/data/reports/${category}${query.size ? '?' + query : ''}`, { credentials: 'same-origin', signal: AbortSignal.timeout(30000) })
  const result: unknown = await response.json()
  if (!response.ok) throw new Error(`Report unavailable (${response.status}).`)
  if (!validOperationalReport(result, category, filters)) throw new Error('Invalid report response.')
  return result
}
export function operationalCsv(rows: Cell[][]) {
  return '\uFEFF' + rows.map(row => row.map(value => {
    let text = value === null ? '' : String(value)
    if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = "'" + text
    return '"' + text.replaceAll('"', '""') + '"'
  }).join(',')).join('\r\n')
}
