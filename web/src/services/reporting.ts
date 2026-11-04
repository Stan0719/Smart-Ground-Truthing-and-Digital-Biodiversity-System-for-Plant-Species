export const REPORT_API_PATH = '/api/data/reports'

export interface ApprovedPlantReportRow {
  scientificName: string
  commonName: string
  approvedPlants: number
}

export interface ApprovedPlantReport {
  generatedAt: string
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
  return { scientificName, commonName, approvedPlants: parsedCount }
}

export const mapApprovedPlantReport = (value: unknown): ApprovedPlantReport | null => {
  const item = record(value)
  const generatedAt = text(item?.generatedAt)
  if (!item || !generatedAt || Number.isNaN(Date.parse(generatedAt)) || !Array.isArray(item.rows))
    return null
  const rows = item.rows.map(mapApprovedPlantRow)
  if (rows.some((row) => row === null)) return null
  return { generatedAt, rows: rows as ApprovedPlantReportRow[] }
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
  report: ApprovedPlantReport,
  rows: readonly ApprovedPlantReportRow[],
) => {
  const totalApproved = report.rows.reduce((sum, row) => sum + row.approvedPlants, 0)
  const data: unknown[][] = [
    ['Report', 'Species & Approved Plants Summary'],
    ['Generated At', report.generatedAt],
    ['Total Species', report.rows.length],
    ['Total Approved Plants', totalApproved],
    [],
    ['Scientific Name', 'Common Name', 'Approved Plant Count'],
    ...rows.map((row) => [row.scientificName, row.commonName, row.approvedPlants]),
  ]
  return `\uFEFF${data.map((row) => row.map(csvEscape).join(',')).join('\r\n')}`
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

export async function requestReport(): Promise<ApprovedPlantReport> {
  let response: Response
  try {
    response = await fetch(REPORT_API_PATH, {
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
  if (!report) throw new ReportApiError('The reporting service returned an invalid response.', response.status, 'invalid')
  return report
}
