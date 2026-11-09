import type { jsPDF } from 'jspdf'
import type { ChartConfiguration } from 'chart.js'
export type ExportCell = string | number | null
export interface ReportDocument {
  category: string; title: string; period: string; timezone: string; generatedAt: string; generatedLabel: string
  statistics: { label: string; value: ExportCell; display: string; unit?: string; background?: string; ink?: string }[]
  columns: string[]; rows: ExportCell[][]; displayRows: string[][]
  chart: { series: string; point: string; value: number | null; unit: string }[]
  context?: { label: string; value: ExportCell }[]
}
export const reportPalette: Record<string, [string, string]> = {
  totalObservations: ['#edf2ee', '#315b49'], 'Pending Review': ['#e8f0f5', '#315d78'], Approved: ['#e7f3e9', '#287347'],
  Rejected: ['#fbe8e5', '#a33f35'], 'Correction Required': ['#fff1db', '#926119'], Flagged: ['#f0eaf8', '#69459a'],
}
// CSV contains only the generated report table. Summary cards, chart series and
// metadata belong to the PDF; category/period remain in the download filename.
export function reportCsv(document: ReportDocument) {
  const rows: ExportCell[][] = [document.columns, ...document.rows]
  const escape = (value: ExportCell) => {
    let text = value === null ? '' : String(value)
    // Numeric values remain numeric, including negative measurements. Only text
    // can be a formula; protect whitespace/control-prefixed formula text too.
    if (typeof value === 'string' && /^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = "'" + text
    return '"' + text.replaceAll('"', '""') + '"'
  }
  return '\uFEFF' + rows.map(row => row.map(escape).join(',')).join('\r\n')
}
export function reportFilename(document: ReportDocument, extension: 'csv' | 'pdf') {
  const safe = (value: string) => value.replace(/[^\p{L}\p{N}._-]+/gu, '-').slice(0, 100)
  return `niah-${safe(document.category)}-${safe(document.period)}-${document.generatedAt.slice(0, 10)}.${extension}`
}
export async function printChart(config: ChartConfiguration) {
  const { Chart } = await import('chart.js')
  await document.fonts?.ready
  const canvas = document.createElement('canvas')
  canvas.width = 1000; canvas.height = 400
  // Chart.js may attach observers to data arrays. Print gets independent arrays
  // and scale objects, preserving the live chart's configuration and data.
  config = { ...config, data: { ...config.data,
    labels: config.data.labels?.map(label => Array.isArray(label) ? [...label] : label),
    datasets: config.data.datasets.map(dataset => ({ ...dataset, data: dataset.data.map(point => Array.isArray(point) ? point.slice() : point && typeof point === 'object' ? { ...point } : point) as typeof dataset.data })),
  }, options: { ...config.options, scales: Object.fromEntries(Object.entries(config.options?.scales || {}).map(([key, scale]) => [key, scale ? { ...scale, ticks: { ...scale.ticks } } : scale])) } }
  config.options = { ...config.options, responsive: false, maintainAspectRatio: false, animation: false, devicePixelRatio: 2, font: { size: 16 } }
  for (const scale of Object.values(config.options.scales || {})) {
    if (scale) { scale.ticks = { ...scale.ticks, font: { size: 16 } } }
  }
  const chart = new Chart(canvas, config)
  try { chart.update('none'); return canvas.toDataURL('image/png') } finally { chart.destroy() }
}

export async function renderReportPdf(model: ReportDocument, chartImage: string | null, pdf: jsPDF, current: () => boolean = () => true) {
  await document.fonts?.ready
  const wide = model.columns.length > 5
  const width = wide ? 2263 : 1600, height = wide ? 1600 : 2263, margin = 70, bottom = height - 90
  const pageWidth = wide ? 297 : 210, pageHeight = wide ? 210 : 297
  const contentWidth = width - margin * 2
  let canvas!: HTMLCanvasElement, pageNumber = 0
  let context!: CanvasRenderingContext2D
  let y = margin
  const finishPage = () => {
    context.fillStyle = '#526e60'; context.font = '19px sans-serif'; context.fillText(model.title, margin, height - 35)
    context.fillText(String(pageNumber), width - margin - 100, height - 35)
    if (pageNumber > 1) pdf.addPage()
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pageWidth, pageHeight)
    // Release each high-resolution bitmap immediately, including very long reports.
    canvas.width = 0; canvas.height = 0
  }
  const page = () => {
    if (pageNumber) finishPage()
    pageNumber++
    canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Canvas unavailable')
    context = ctx; context.fillStyle = '#fff'; context.fillRect(0, 0, width, height); y = margin
  }
  page()
  const wrap = (text: string, available: number) => {
    const lines: string[] = []; let line = ''
    for (const character of Array.from(text)) {
      if (character === '\n') { lines.push(line); line = ''; continue }
      if (line && context.measureText(line + character).width > available) { lines.push(line); line = '' }
      line += character
    }
    lines.push(line); return lines
  }
  const textBlock = (value: string, size: number, bold = false) => {
    context.font = `${bold ? '700 ' : ''}${size}px sans-serif`; context.fillStyle = '#315b49'
    for (const line of wrap(value, contentWidth)) { if (y + size * 1.5 > bottom) page(); context.font = `${bold ? '700 ' : ''}${size}px sans-serif`; context.fillStyle = '#315b49'; context.fillText(line, margin, y + size); y += size * 1.5 }
  }
  textBlock(model.title, 44, true); textBlock(model.period + ' · ' + model.timezone, 25); textBlock(model.generatedLabel, 23)
  for (const item of model.context || []) textBlock(`${item.label}: ${item.value ?? '—'}`, 23)
  y += 22
  // Fixed print grid: independent of browser width, with indivisible card rows.
  const columns = 3, gap = 18, cardWidth = (contentWidth - gap * (columns - 1)) / columns
  for (let start = 0; start < model.statistics.length; start += columns) {
    const cards = model.statistics.slice(start, start + columns).map(stat => {
      context.font = '25px sans-serif'; const label = wrap(stat.label, cardWidth - 36)
      context.font = '700 40px sans-serif'; const value = wrap(stat.display + (stat.unit ? ' ' + stat.unit : ''), cardWidth - 36)
      return { stat, label, value, height: 36 + label.length * 33 + 9 + value.length * 48 }
    })
    const cardHeight = Math.max(...cards.map(card => card.height))
    if (y + cardHeight > bottom) page()
    cards.forEach(({ stat, label, value }, index) => {
      const x = margin + index * (cardWidth + gap)
      context.fillStyle = stat.background || '#f4f7f2'; context.strokeStyle = stat.ink || '#c4d7c9'; context.lineWidth = 2
      context.beginPath(); context.roundRect(x, y, cardWidth, cardHeight, 12); context.fill(); context.stroke()
      context.fillStyle = stat.ink || '#315b49'; context.font = '25px sans-serif'
      label.forEach((line, i) => context.fillText(line, x + 18, y + 40 + i * 33))
      context.font = '700 40px sans-serif'
      value.forEach((line, i) => context.fillText(line, x + 18, y + 49 + label.length * 33 + i * 48))
    })
    y += cardHeight + gap
  }
  if (chartImage) {
    const image = new Image(); image.src = chartImage; await image.decode()
    const chartHeight = contentWidth * (image.naturalHeight / image.naturalWidth)
    if (!Number.isFinite(chartHeight) || chartHeight <= 0 || chartHeight > bottom - margin) throw new Error('Invalid chart dimensions')
    if (y + chartHeight > bottom) page()
    context.drawImage(image, margin, y, contentWidth, chartHeight); y += chartHeight + 28
  }
  const cellWidth = contentWidth / model.columns.length, padding = 12, lineHeight = 33
  const header = () => {
    context.font = '700 24px sans-serif'
    const labels = model.columns.map(label => wrap(label, cellWidth - padding * 2))
    const h = Math.max(...labels.map(lines => lines.length)) * lineHeight + padding * 2
    if (y + h + lineHeight + padding * 2 > bottom) page()
    context.fillStyle = '#245443'; context.fillRect(margin, y, contentWidth, h); context.font = '700 24px sans-serif'; context.fillStyle = '#fff'
    labels.forEach((lines, index) => lines.forEach((line, n) => context.fillText(line, margin + index * cellWidth + padding, y + padding + 26 + n * lineHeight)))
    y += h
  }
  header()
  model.displayRows.forEach((row, rowIndex) => {
    context.font = '24px sans-serif'
    const cells = row.map(value => wrap(value, cellWidth - padding * 2))
    const lines = Math.max(...cells.map(cell => cell.length))
    if (lines * lineHeight + padding * 2 <= bottom - margin - 120 && y + lines * lineHeight + padding * 2 > bottom) { page(); header() }
    let offset = 0
    while (offset < lines) {
      let available = Math.floor((bottom - y - padding * 2) / lineHeight)
      if (available < 1) { page(); header(); available = Math.floor((bottom - y - padding * 2) / lineHeight) }
      const take = Math.min(lines - offset, available), h = take * lineHeight + padding * 2
      context.fillStyle = rowIndex % 2 ? '#f4f7f2' : '#fff'; context.fillRect(margin, y, contentWidth, h)
      context.strokeStyle = '#dce5de'; context.lineWidth = 1; context.strokeRect(margin, y, contentWidth, h)
      context.fillStyle = '#315b49'; context.font = '24px sans-serif'
      cells.forEach((cell, column) => cell.slice(offset, offset + take).forEach((line, index) => context.fillText(line, margin + column * cellWidth + padding, y + padding + 26 + index * lineHeight)))
      y += h; offset += take
      if (offset < lines) { page(); header() }
    }
  })
  if (!current()) return false
  finishPage()
  return true
}
