export const REPORT_API_PATH = '/api/data/reports'

export interface ApprovedPlantReportRow {
  speciesId?: string
  scientificName: string
  commonName: string
  approvedPlants: number
}

export type ReportPeriod = 'all-time' | 'this-month' | 'last-month' | 'custom'
export interface ReportFilters { period: ReportPeriod; start?: string; end?: string }
export interface ReportScope {
  period: ReportPeriod
  timezone: string
  startDate: string | null
  endDate: string | null
  startInclusive: string | null
  endExclusive: string | null
}
export const allTimeScope: ReportScope = { period: 'all-time', timezone: 'Asia/Kuala_Lumpur', startDate: null, endDate: null, startInclusive: null, endExclusive: null }
export function reportRequestUrl(filters: ReportFilters = { period: 'all-time' }): string {
  if (!['all-time', 'this-month', 'last-month', 'custom'].includes(filters.period)) throw new Error('Invalid reporting period.')
  if (filters.period === 'all-time') return REPORT_API_PATH
  const query = new URLSearchParams({ period: filters.period })
  if (filters.period === 'custom') {
    const valid = (value?: string) => typeof value === 'string' && /^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$/.test(value) &&
      !value.startsWith('9999') && Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value
    if (!valid(filters.start) || !valid(filters.end) || filters.start! > filters.end! || Date.parse(filters.end!) > Date.UTC(Number(filters.start!.slice(0, 4)) + 100, Number(filters.start!.slice(5, 7)) - 1, Number(filters.start!.slice(8, 10))))
      throw new Error('Select valid start and end dates in order (maximum 100 years).')
    query.set('start', filters.start!); query.set('end', filters.end!)
  }
  return `${REPORT_API_PATH}?${query}`
}
export const reportScopeText = (report: ApprovedPlantReport) => {
  const scope = report.scope || allTimeScope
  return `${scope.startDate ? `${scope.startDate} to ${scope.endDate}` : 'All time'} | ${scope.timezone}`
}

export interface ApprovedPlantReport {
  generatedAt: string
  scope?: ReportScope
  rows: ApprovedPlantReportRow[]
}

export type ReportSort = 'scientific-asc' | 'approved-desc' | 'approved-asc'

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
const text = (value: unknown) => typeof value === 'string' ? value : ''

export const mapApprovedPlantRow = (value: unknown): ApprovedPlantReportRow | null => {
  const item = record(value)
  if (!item) return null
  const scientificName = text(item.scientific_name).trim()
  const commonName = text(item.common_name).trim()
  const parsedCount = typeof item.approved_plants === 'number'
    ? item.approved_plants
    : typeof item.approved_plants === 'string' && /^\d+$/.test(item.approved_plants)
      ? Number(item.approved_plants)
      : Number.NaN
  if (!scientificName || !Number.isSafeInteger(parsedCount) || parsedCount < 0) return null
  return { scientificName, commonName, approvedPlants: parsedCount, ...(item.species_id !== undefined ? {speciesId: String(item.species_id)} : {}) }
}

export const mapApprovedPlantReport = (value: unknown): ApprovedPlantReport | null => {
  const item = record(value)
  const generatedAt = text(item?.generatedAt)
  if (!item || !generatedAt || Number.isNaN(Date.parse(generatedAt)) || !Array.isArray(item.rows))
    return null
  const rows = item.rows.map(mapApprovedPlantRow)
  if (rows.some((row) => row === null)) return null
  const scope = record(item.scope)
  if (scope && (!['all-time', 'this-month', 'last-month', 'custom'].includes(String(scope.period)) || scope.timezone !== 'Asia/Kuala_Lumpur' ||
    (scope.period !== 'all-time' && ['startDate', 'endDate', 'startInclusive', 'endExclusive'].some(key => typeof scope[key] !== 'string' || !Number.isFinite(Date.parse(String(scope[key]))))))) return null
  if (item.scope !== undefined && !scope) return null
  return { generatedAt, rows: rows as ApprovedPlantReportRow[], ...(scope ? { scope: scope as unknown as ReportScope } : {}) }
}

export const filterAndSortReportRows = (
  rows: readonly ApprovedPlantReportRow[],
  search: string,
  sort: ReportSort,
) => {
  const query = search.trim().toLowerCase()
  const filtered = rows.filter((row) =>
    !query || `${row.scientificName} ${row.commonName}`.toLowerCase().includes(query))
  return [...filtered].sort((a, b) => {
    if (sort === 'approved-desc')
      return b.approvedPlants - a.approvedPlants || a.scientificName.localeCompare(b.scientificName)
    if (sort === 'approved-asc')
      return a.approvedPlants - b.approvedPlants || a.scientificName.localeCompare(b.scientificName)
    return a.scientificName.localeCompare(b.scientificName)
  })
}

const csvEscape = (value: unknown) => {
  let output = value == null ? '' : String(value)
  if (/^[=+\-@]/.test(output)) output = `'${output}`
  return /[",\r\n]/.test(output) ? `"${output.replace(/"/g, '""')}"` : output
}

export const buildReportCsv = (
  _report: ApprovedPlantReport,
  rows: readonly ApprovedPlantReportRow[],
  _search = '',
) => {
  const table = buildReportTable(rows)
  return `\uFEFF${[table.headers, ...table.rows].map(row => row.map(csvEscape).join(',')).join('\r\n')}`
}

export const buildReportTable = (rows: readonly ApprovedPlantReportRow[]) => ({
  headers: ['Scientific Name', 'Common Name', 'Approved Plants'],
  rows: rows.map((row) => [row.scientificName, row.commonName, row.approvedPlants] as [string, string, number]),
})

export class ReportApiError extends Error {
  readonly status: number
  readonly kind: 'network' | 'invalid' | 'http'

  constructor(message: string, status = 0, kind: 'network' | 'invalid' | 'http' = 'http') {
    super(message)
    this.status = status
    this.kind = kind
  }
}

export async function requestReport(filters: ReportFilters = { period: 'all-time' }): Promise<ApprovedPlantReport> {
  const url = reportRequestUrl(filters)
  let response: Response
  try {
    response = await fetch(url, {
      credentials: 'same-origin',
      signal: AbortSignal.timeout(15000),
    })
  } catch {
    throw new ReportApiError('The reporting service could not be reached. Please try again.', 0, 'network')
  }
  let result: unknown
  try { result = await response.json() }
  catch { throw new ReportApiError('The reporting service returned an invalid response.', response.status, 'invalid') }
  if (!response.ok) {
    const item = record(result)
    const backendMessage = [item?.message, item?.error].find(
      (value): value is string => typeof value === 'string' && Boolean(value.trim()),
    )
    const fallback = response.status === 401
      ? 'Your session has expired. Please sign in again.'
      : response.status === 403
        ? 'You do not have permission to read reports.'
        : response.status === 404
          ? 'The report endpoint is unavailable.'
          : `Report request failed (${response.status}).`
    throw new ReportApiError(backendMessage || fallback, response.status)
  }
  const report = mapApprovedPlantReport(result)
  if (!report || (report.scope && report.scope.period !== filters.period) ||
    (filters.period !== 'all-time' && !report.scope) ||
    (filters.period === 'custom' && (report.scope?.startDate !== filters.start || report.scope?.endDate !== filters.end))) throw new ReportApiError('The reporting service returned an invalid response.', response.status, 'invalid')
  return report
}
