<script setup lang="ts">
import { useConservationText } from '../../composables/useConservationText'
const { ct, sf, dt, speciesText, observationText, locale } = useConservationText()
import { computed, reactive, ref } from 'vue'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import ReportChart from '../../components/conservation/ReportChart.vue'
import {
  conservationStore,
  speciesForPlant,
  type ConservationStatus,
  type ObservationStatus,
} from '../../data/conservation'

type ReportType =
  | 'Biodiversity Summary'
  | 'Species Report'
  | 'Field Observation Report'
  | 'Conservation Status Report'
  | 'Threat Alert Report'

interface ReportForm {
  type: ReportType
  start: string
  end: string
  species: string
  status: ConservationStatus | ''
  observationStatus: ObservationStatus | ''
}

const reportTypes: ReportType[] = [
  'Biodiversity Summary',
  'Species Report',
  'Field Observation Report',
  'Conservation Status Report',
  'Threat Alert Report',
]
const observationStatuses: ObservationStatus[] = [
  'Draft',
  'Pending Review',
  'Approved',
  'Rejected',
  'Correction Required',
  'Flagged',
]

const form = reactive<ReportForm>({
  type: 'Biodiversity Summary',
  start: '2026-09-01',
  end: '2026-10-03',
  species: '',
  status: '',
  observationStatus: '',
})
const preview = ref(false)
const toast = ref('')
const toastTone = ref<'success' | 'error'>('success')
const validationMessage = ref('')
const reportChart = ref<{ toDataUrl: () => string | null } | null>(null)

const usesDates = computed(() => form.type !== 'Conservation Status Report')
const usesConservationStatus = computed(() =>
  ['Biodiversity Summary', 'Species Report', 'Conservation Status Report'].includes(form.type),
)
const usesObservationStatus = computed(() =>
  ['Biodiversity Summary', 'Field Observation Report'].includes(form.type),
)
const conservationStatuses = computed(() => [
  ...new Set(conservationStore.species.map((species) => species.status)),
])
const selectedSpecies = computed(() =>
  conservationStore.species.find((species) => species.id === form.species),
)

const parseRecordDate = (value: string) => {
  const parsed = Date.parse(value.replace(',', ''))
  return Number.isNaN(parsed) ? null : parsed
}

const isWithinDateRange = (value: string) => {
  if (!usesDates.value) return true
  const timestamp = parseRecordDate(value)
  if (timestamp === null) return false
  const start = form.start ? new Date(`${form.start}T00:00:00`).getTime() : null
  const end = form.end ? new Date(`${form.end}T23:59:59.999`).getTime() : null
  return (start === null || timestamp >= start) && (end === null || timestamp <= end)
}

const filteredSpecies = computed(() =>
  conservationStore.species.filter(
    (species) =>
      (!form.species || species.id === form.species) &&
      (!usesConservationStatus.value || !form.status || species.status === form.status),
  ),
)
const filteredSpeciesIds = computed(
  () => new Set(filteredSpecies.value.map((species) => species.id)),
)
const matchingPlants = computed(() =>
  conservationStore.plants.filter((plant) => filteredSpeciesIds.value.has(plant.speciesId)),
)
const filteredPlants = computed(() =>
  matchingPlants.value.filter((plant) => isWithinDateRange(plant.registeredAt)),
)
const filteredObservations = computed(() =>
  conservationStore.observations.filter((observation) => {
    const species = speciesForPlant(observation.plantId)
    return (
      Boolean(species && filteredSpeciesIds.value.has(species.id)) &&
      isWithinDateRange(observation.observedAt) &&
      (!form.observationStatus || observation.status === form.observationStatus)
    )
  }),
)
const filteredAlerts = computed(() =>
  conservationStore.alerts.filter((alert) => {
    const species = speciesForPlant(alert.plantId)
    return (
      Boolean(species && filteredSpeciesIds.value.has(species.id)) &&
      isWithinDateRange(alert.detectedAt)
    )
  }),
)

const biodiversityMetrics = computed(() => ({
  totalPlants: matchingPlants.value.length,
  uniqueSpecies: new Set(matchingPlants.value.map((plant) => plant.speciesId)).size,
  newPlants: filteredPlants.value.length,
  approvedObservations: filteredObservations.value.filter((item) => item.status === 'Approved')
    .length,
  pendingObservations: filteredObservations.value.filter((item) => item.status === 'Pending Review')
    .length,
}))
const observationMetrics = computed(() => ({
  total: filteredObservations.value.length,
  approved: filteredObservations.value.filter((item) => item.status === 'Approved').length,
  pending: filteredObservations.value.filter((item) => item.status === 'Pending Review').length,
  rejected: filteredObservations.value.filter((item) => item.status === 'Rejected').length,
}))
const alertMetrics = computed(() => ({
  total: filteredAlerts.value.length,
  high: filteredAlerts.value.filter((item) => item.severity === 'High').length,
  active: filteredAlerts.value.filter((item) => item.status !== 'Resolved').length,
  resolved: filteredAlerts.value.filter((item) => item.status === 'Resolved').length,
}))

const chartSpec = computed(() => {
  if (form.type === 'Biodiversity Summary') {
    return {
      title: ct('Observation Status Summary'),
      labels: ['Approved', 'Pending Review'].map((ctValue) => ct(ctValue)),
      values: [
        biodiversityMetrics.value.approvedObservations,
        biodiversityMetrics.value.pendingObservations,
      ],
      colors: ['#3b9671', '#d7a548'],
    }
  }
  if (form.type === 'Field Observation Report') {
    const statuses: ObservationStatus[] = [
      'Approved',
      'Pending Review',
      'Rejected',
      'Correction Required',
      'Flagged',
    ]
    const colors: Record<ObservationStatus, string> = {
      Draft: '#8a9992',
      'Pending Review': '#d7a548',
      Approved: '#3b9671',
      Rejected: '#c35b49',
      'Correction Required': '#d5843f',
      Flagged: '#5f83a3',
    }
    const entries = statuses
      .map((status) => ({
        status,
        count: filteredObservations.value.filter((item) => item.status === status).length,
      }))
      .filter((entry) => entry.count > 0)
    return {
      title: ct('Observation Status Distribution'),
      labels: entries.map((entry) => ct(entry.status)),
      values: entries.map((entry) => entry.count),
      colors: entries.map((entry) => colors[entry.status]),
    }
  }
  if (form.type === 'Conservation Status Report') {
    return {
      title: ct('Species by Conservation Status'),
      labels: conservationRows.value.map((row) => ct(row.status)),
      values: conservationRows.value.map((row) => row.speciesCount),
      colors: conservationRows.value.map((row) =>
        ['Endangered', 'Critically Endangered'].includes(row.status)
          ? '#c35b49'
          : row.status === 'Vulnerable'
            ? '#d7a548'
            : '#3b9671',
      ),
    }
  }
  if (form.type === 'Threat Alert Report') {
    const entries = (['High', 'Medium', 'Low'] as const)
      .map((severity) => ({
        severity,
        count: filteredAlerts.value.filter((alert) => alert.severity === severity).length,
      }))
      .filter((entry) => entry.count > 0)
    const colors = { High: '#c35b49', Medium: '#d7a548', Low: '#5f83a3' }
    return {
      title: ct('Alerts by Severity'),
      labels: entries.map((entry) => ct(entry.severity)),
      values: entries.map((entry) => entry.count),
      colors: entries.map((entry) => colors[entry.severity]),
    }
  }
  return null
})

const speciesRows = computed(() =>
  filteredSpecies.value.map((species) => {
    const registrations = filteredPlants.value
      .filter((plant) => plant.speciesId === species.id)
      .sort(
        (a, b) => (parseRecordDate(a.registeredAt) ?? 0) - (parseRecordDate(b.registeredAt) ?? 0),
      )
    return {
      ...species,
      totalPlants: registrations.length,
      firstRegistered: registrations.at(0)?.registeredAt ?? '—',
      latestRegistered: registrations.at(-1)?.registeredAt ?? '—',
    }
  }),
)
const conservationRows = computed(() =>
  conservationStatuses.value
    .filter((status) => !form.status || status === form.status)
    .map((status) => {
      const statusSpecies = filteredSpecies.value.filter((species) => species.status === status)
      const speciesIds = new Set(statusSpecies.map((species) => species.id))
      return {
        status,
        speciesCount: statusSpecies.length,
        plantCount: conservationStore.plants.filter((plant) => speciesIds.has(plant.speciesId))
          .length,
      }
    }),
)
const reportMeta = computed(() => {
  const details: string[] = []
  if (usesDates.value)
    details.push(
      ct('Reporting period: {start} to {end}', {
        start: form.start ? dt(form.start) : ct('Any'),
        end: form.end ? dt(form.end) : ct('Any'),
      }),
    )
  details.push(
    ct('Species: {name}', {
      name: selectedSpecies.value ? sf(selectedSpecies.value) : ct('All species'),
    }),
  )
  if (usesConservationStatus.value)
    details.push(ct('Conservation status: {status}', { status: ct(form.status || 'All statuses') }))
  if (usesObservationStatus.value)
    details.push(
      ct('Observation status: {status}', { status: ct(form.observationStatus || 'All statuses') }),
    )
  return details
})

const emptyMessage = (subject: string) =>
  ct('No {subject} match the selected filters.', { subject: ct(subject) })

function generate() {
  validationMessage.value = ''
  if (usesDates.value && form.start && form.end && form.start > form.end) {
    preview.value = false
    validationMessage.value = 'Start date must not be after end date.'
    return
  }
  preview.value = true
  requestAnimationFrame(() =>
    document
      .querySelector('.report-preview')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
  )
}

const reportFileSlug = () =>
  form.type
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
const exportFilename = (extension: 'pdf' | 'csv') =>
  `niah-${reportFileSlug()}-${new Date().toISOString().slice(0, 10)}.${extension}`

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

const csvEscape = (value: unknown) => {
  let text = value == null ? '' : String(value)
  if (typeof value === 'string' && /^[=+\-@]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

interface ExportTable {
  headers: string[]
  rows: unknown[][]
}

const rawExportTable = (): ExportTable => {
  if (form.type === 'Biodiversity Summary') {
    return {
      headers: ['Metric', 'Value'],
      rows: [
        ['Total Plant Records', biodiversityMetrics.value.totalPlants],
        ['Unique Species', biodiversityMetrics.value.uniqueSpecies],
        ['New Plant Records', biodiversityMetrics.value.newPlants],
        ['Approved Observations', biodiversityMetrics.value.approvedObservations],
        ['Pending Observations', biodiversityMetrics.value.pendingObservations],
      ],
    }
  }
  if (form.type === 'Species Report') {
    return {
      headers: [
        'Species ID',
        'Scientific Name',
        'Common Name',
        'Family',
        'Conservation Status',
        'Total Plant Records',
        'First Plant Registered',
        'Latest Plant Registered',
      ],
      rows: speciesRows.value.map((species) => [
        species.id,
        species.scientificName,
        species.commonName,
        species.family,
        species.status,
        species.totalPlants,
        species.firstRegistered,
        species.latestRegistered,
      ]),
    }
  }
  if (form.type === 'Field Observation Report') {
    return {
      headers: [
        'Observation ID',
        'Plant ID',
        'Species',
        'Observed At',
        'Life Stage',
        'Health Status',
        'Status',
      ],
      rows: filteredObservations.value.map((observation) => [
        observation.id,
        observation.plantId,
        speciesForPlant(observation.plantId)?.scientificName ?? '',
        observation.observedAt,
        observation.growthStage,
        observation.health,
        observation.status,
      ]),
    }
  }
  if (form.type === 'Conservation Status Report') {
    return {
      headers: ['Conservation Status', 'Species Count', 'Plant Record Count'],
      rows: conservationRows.value.map((row) => [row.status, row.speciesCount, row.plantCount]),
    }
  }
  return {
    headers: [
      'Alert ID',
      'Plant ID',
      'Species',
      'Alert Type',
      'Severity',
      'Confidence',
      'Created At',
      'Status',
      'Resolved At',
    ],
    rows: filteredAlerts.value.map((alert) => {
      const optional = alert as typeof alert & { confidence?: string; resolvedAt?: string }
      return [
        alert.id,
        alert.plantId,
        speciesForPlant(alert.plantId)?.scientificName ?? '',
        alert.type,
        alert.severity,
        optional.confidence ?? '',
        alert.detectedAt,
        alert.status,
        optional.resolvedAt ?? '',
      ]
    }),
  }
}

const buildExportTable = (): ExportTable => {
  const raw = rawExportTable()
  return {
    headers: raw.headers.map((value) => ct(value)),
    rows: raw.rows.map((row) =>
      row.map((value) => {
        if (typeof value !== 'string') return value
        const sp = conservationStore.species.find(
          (s) => s.scientificName === value || s.commonName === value || s.family === value,
        )
        if (sp)
          return sf(
            sp,
            sp.scientificName === value
              ? 'scientific'
              : sp.commonName === value
                ? 'common'
                : 'family',
          )
        return ct(dt(value))
      }),
    ),
  }
}
const exportCsv = () => {
  const table = buildExportTable()
  const rows = [
    [ct('Report Type'), ct(form.type)],
    ...reportMeta.value.map((detail) => [ct('Applied Filter'), detail]),
    [],
    table.headers,
    ...table.rows,
  ]
  const csv = `\uFEFF${rows.map((row) => row.map(csvEscape).join(',')).join('\r\n')}`
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), exportFilename('csv'))
}

// Browser fonts render Chinese glyphs that jsPDF's built-in fonts do not support.
const exportUnicodePdf = () => {
  const table = buildExportTable()
  const landscape = table.headers.length > 5
  const width = landscape ? 2263 : 1600
  const height = landscape ? 1600 : 2263
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm' })
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas unavailable')
  const margin = 72
  const font = 'sans-serif'
  let y = margin
  let pageCount = 0
  const savePage = () => {
    if (pageCount++) doc.addPage()
    doc.addImage(
      canvas.toDataURL('image/png'),
      'PNG',
      0,
      0,
      doc.internal.pageSize.getWidth(),
      doc.internal.pageSize.getHeight(),
    )
  }
  const resetPage = () => {
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, width, height)
    y = margin
  }
  const wrap = (text: string, maxWidth: number) => {
    const lines: string[] = []
    let line = ''
    for (const char of text) {
      if (char === '\n' || (line && ctx.measureText(line + char).width > maxWidth)) {
        lines.push(line)
        line = char === '\n' ? '' : char
      } else line += char
    }
    lines.push(line)
    return lines
  }
  const write = (text: string, size = 26, bold = false) => {
    ctx.font = `${bold ? 'bold ' : ''}${size}px ${font}`
    const lines = wrap(text, width - margin * 2)
    for (const line of lines) {
      if (y + size * 1.6 > height - margin) {
        savePage()
        resetPage()
      }
      ctx.fillStyle = '#204b3c'
      ctx.fillText(line, margin, y + size)
      y += size * 1.5
    }
  }
  resetPage()
  write(ct('NIAH NATIONAL PARK'), 30, true)
  write(ct('Smart Ground-Truthing and Digital Biodiversity System'), 22)
  y += 12
  write(ct(form.type), 42, true)
  reportMeta.value.forEach((detail) => write(detail, 24))
  y += 24
  if (chartSpec.value) {
    write(chartSpec.value.title, 30, true)
    // Draw the chart from its translated values so the exported labels are current.
    const maximum = Math.max(...chartSpec.value.values, 1)
    chartSpec.value.labels.forEach((label, index) => {
      if (y + 92 > height - margin) {
        savePage()
        resetPage()
      }
      write(`${label}: ${chartSpec.value!.values[index]}`, 24)
      ctx.fillStyle = chartSpec.value!.colors[index] || '#32745b'
      ctx.fillRect(
        margin,
        y,
        ((width - margin * 2) * (chartSpec.value!.values[index] || 0)) / maximum,
        22,
      )
      y += 42
    })
    y += 20
  }
  const colWidth = (width - margin * 2) / table.headers.length
  const drawRow = (cells: unknown[], header = false, alternate = false) => {
    ctx.font = `${header ? 'bold ' : ''}22px ${font}`
    const lines = cells.map((cell) => wrap(String(cell ?? ''), colWidth - 24))
    const rowHeight = Math.max(...lines.map((items) => items.length), 1) * 32 + 24
    if (y + rowHeight > height - margin) {
      savePage()
      resetPage()
      if (!header) drawRow(table.headers, true)
    }
    ctx.fillStyle = header ? '#33745d' : alternate ? '#f3f7f3' : '#fff'
    ctx.fillRect(margin, y, width - margin * 2, rowHeight)
    ctx.fillStyle = header ? '#fff' : '#204b3c'
    lines.forEach((items, i) =>
      items.forEach((line, j) => ctx.fillText(line, margin + i * colWidth + 12, y + 30 + j * 32)),
    )
    ctx.strokeStyle = '#dce7df'
    ctx.strokeRect(margin, y, width - margin * 2, rowHeight)
    y += rowHeight
  }
  if (table.rows.length) {
    drawRow(table.headers, true)
    table.rows.forEach((row, i) => drawRow(row, false, i % 2 === 0))
  } else write(ct('No records match the selected filters.'))
  savePage()
  doc.save(exportFilename('pdf'))
}

const exportPdf = () => {
  if (locale.value === 'zh-CN') {
    exportUnicodePdf()
    return
  }
  const table = buildExportTable()
  const landscape = ['Species Report', 'Field Observation Report', 'Threat Alert Report'].includes(
    form.type,
  )
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm' })
  const pageWidth = doc.internal.pageSize.getWidth()
  doc.setTextColor(32, 75, 60)
  doc.setFontSize(10)
  doc.text(ct('NIAH NATIONAL PARK'), 14, 15)
  doc.setFontSize(8)
  doc.text(ct('Smart Ground-Truthing and Digital Biodiversity System'), 14, 21)
  doc.setFontSize(16)
  doc.text(ct(form.type), 14, 30)
  doc.setTextColor(90, 112, 102)
  doc.setFontSize(8)
  let metadataY = 37
  reportMeta.value.forEach((detail) => {
    const lines = doc.splitTextToSize(detail, pageWidth - 28) as string[]
    doc.text(lines, 14, metadataY)
    metadataY += lines.length * 4
  })
  let contentY = metadataY + 3
  if (chartSpec.value) {
    const chartImage = reportChart.value?.toDataUrl()
    doc.setTextColor(49, 87, 73)
    doc.setFontSize(10)
    doc.text(chartSpec.value.title, 14, contentY + 4)
    contentY += 8
    if (chartImage) {
      const imageWidth = landscape ? 150 : 120
      const imageHeight = imageWidth / 2
      if (contentY + imageHeight > doc.internal.pageSize.getHeight() - 14) {
        doc.addPage()
        contentY = 14
      }
      doc.addImage(chartImage, 'PNG', 14, contentY, imageWidth, imageHeight)
      contentY += imageHeight + 7
    } else {
      doc.setTextColor(120, 137, 129)
      doc.setFontSize(8)
      doc.text(ct('No data available for this chart with the selected filters.'), 14, contentY)
      contentY += 7
    }
  }
  if (!table.rows.length) {
    doc.setFontSize(10)
    doc.text(ct('No records match the selected filters.'), 14, contentY + 3)
  } else {
    autoTable(doc, {
      startY: contentY,
      head: [table.headers],
      body: table.rows.map((row) => row.map((value) => (value == null ? '' : String(value)))),
      margin: { left: 10, right: 10 },
      showHead: 'everyPage',
      theme: 'grid',
      styles: { fontSize: landscape ? 6.5 : 8, cellPadding: 2, overflow: 'linebreak' },
      headStyles: { fillColor: [51, 116, 93], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [247, 249, 246] },
    })
  }
  doc.save(exportFilename('pdf'))
}

const showExportToast = (message: string, tone: 'success' | 'error') => {
  toastTone.value = tone
  toast.value = message
  window.setTimeout(() => {
    toast.value = ''
  }, 2500)
}

function exportFile(format: 'PDF' | 'CSV') {
  try {
    if (format === 'PDF') exportPdf()
    else exportCsv()
    showExportToast(ct('{format} report exported successfully.', { format }), 'success')
  } catch (error) {
    console.error(`Unable to export ${format}`, error)
    showExportToast(ct('Unable to export {format}. Please try again.', { format }), 'error')
  }
}
</script>

<template>
  <section class="page-intro">
    <div>
      <p class="page-kicker">{{ ct('ANALYSIS & EXPORT') }}</p>
      <h2>{{ ct('Reports') }}</h2>
      <p>{{ ct('Generate filtered period summaries from biodiversity records.') }}</p>
    </div>
  </section>

  <section class="panel reports-panel">
    <header class="panel-header">
      <div>
        <p class="section-kicker">{{ ct('GENERATE REPORT') }}</p>
        <h2>{{ ct('Report Filters') }}</h2>
      </div>
    </header>
    <form class="form-grid report-filters" @submit.prevent="generate">
      <label class="form-field"
        ><span>{{ ct('Report Type') }}</span
        ><select v-model="form.type">
          <option v-for="type in reportTypes" :key="type" :value="type">{{ ct(type) }}</option>
        </select></label
      >
      <label class="form-field"
        ><span>{{ ct('Species') }}</span
        ><select v-model="form.species">
          <option value="">{{ ct('All species') }}</option>
          <option
            v-for="species in conservationStore.species"
            :key="species.id"
            :value="species.id"
          >
            {{ sf(species, 'scientific') }}
          </option>
        </select></label
      >
      <label v-if="usesDates" class="form-field"
        ><span>{{ ct('Start Date') }}</span
        ><input v-model="form.start" type="date"
      /></label>
      <label v-if="usesDates" class="form-field"
        ><span>{{ ct('End Date') }}</span
        ><input v-model="form.end" type="date"
      /></label>
      <label v-if="usesConservationStatus" class="form-field"
        ><span>{{ ct('Conservation Status') }}</span
        ><select v-model="form.status">
          <option value="">{{ ct('All statuses') }}</option>
          <option v-for="status in conservationStatuses" :key="status" :value="status">
            {{ ct(status) }}
          </option>
        </select></label
      >
      <label v-if="usesObservationStatus" class="form-field"
        ><span>{{ ct('Observation Status') }}</span
        ><select v-model="form.observationStatus">
          <option value="">{{ ct('All statuses') }}</option>
          <option v-for="status in observationStatuses" :key="status" :value="status">
            {{ ct(status) }}
          </option>
        </select></label
      >
      <div class="form-field report-submit">
        <span aria-hidden="true">&nbsp;</span
        ><button type="submit" class="primary-button">{{ ct('Generate Report') }}</button>
      </div>
      <p v-if="validationMessage" class="report-error" role="alert">{{ ct(validationMessage) }}</p>
    </form>

    <article v-if="preview" class="report-preview">
      <header class="report-title">
        <p class="section-kicker">{{ ct('NIAH NATIONAL PARK') }}</p>
        <h2>{{ ct(form.type) }}</h2>
      </header>
      <div class="report-meta" :aria-label="ct('Applied report filters')">
        <span v-for="detail in reportMeta" :key="detail">{{ detail }}</span>
      </div>

      <template v-if="form.type === 'Biodiversity Summary'">
        <div class="metric-grid">
          <div class="metric">
            <span>{{ ct('Total Plant Records') }}</span
            ><strong>{{ biodiversityMetrics.totalPlants }}</strong>
          </div>
          <div class="metric">
            <span>{{ ct('Unique Species') }}</span
            ><strong>{{ biodiversityMetrics.uniqueSpecies }}</strong>
          </div>
          <div class="metric">
            <span>{{ ct('New Plant Records') }}</span
            ><strong>{{ biodiversityMetrics.newPlants }}</strong>
          </div>
          <div class="metric">
            <span>{{ ct('Approved Observations') }}</span
            ><strong>{{ biodiversityMetrics.approvedObservations }}</strong>
          </div>
          <div class="metric">
            <span>{{ ct('Pending Observations') }}</span
            ><strong>{{ biodiversityMetrics.pendingObservations }}</strong>
          </div>
        </div>
        <ReportChart
          v-if="chartSpec"
          ref="reportChart"
          :title="chartSpec.title"
          :labels="chartSpec.labels"
          :values="chartSpec.values"
          :colors="chartSpec.colors"
        />
      </template>

      <div v-else-if="form.type === 'Species Report'" class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{{ ct('Scientific Name') }}</th>
              <th>{{ ct('Common Name') }}</th>
              <th>{{ ct('Family') }}</th>
              <th>{{ ct('Conservation Status') }}</th>
              <th>{{ ct('Total Plant Records') }}</th>
              <th>{{ ct('First Plant Registered') }}</th>
              <th>{{ ct('Latest Plant Registered') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="species in speciesRows" :key="species.id">
              <td>
                <em>{{ sf(species, 'scientific') }}</em>
              </td>
              <td>{{ sf(species, 'common') }}</td>
              <td>{{ sf(species, 'family') }}</td>
              <td>{{ ct(species.status) }}</td>
              <td>{{ species.totalPlants }}</td>
              <td>{{ dt(species.firstRegistered) }}</td>
              <td>{{ dt(species.latestRegistered) }}</td>
            </tr>
            <tr v-if="!speciesRows.length">
              <td colspan="7" class="empty-row">{{ emptyMessage('species') }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <template v-else-if="form.type === 'Field Observation Report'">
        <div class="metric-grid report-metrics">
          <div class="metric">
            <span>{{ ct('Total Observations') }}</span
            ><strong>{{ observationMetrics.total }}</strong>
          </div>
          <div class="metric">
            <span>{{ ct('Approved') }}</span
            ><strong>{{ observationMetrics.approved }}</strong>
          </div>
          <div class="metric">
            <span>{{ ct('Pending') }}</span
            ><strong>{{ observationMetrics.pending }}</strong>
          </div>
          <div class="metric">
            <span>{{ ct('Rejected') }}</span
            ><strong>{{ observationMetrics.rejected }}</strong>
          </div>
        </div>
        <ReportChart
          v-if="chartSpec"
          ref="reportChart"
          :title="chartSpec.title"
          :labels="chartSpec.labels"
          :values="chartSpec.values"
          :colors="chartSpec.colors"
        />
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{{ ct('Observation ID') }}</th>
                <th>{{ ct('Plant ID') }}</th>
                <th>{{ ct('Species') }}</th>
                <th>{{ ct('Observed At') }}</th>
                <th>{{ ct('Life Stage') }}</th>
                <th>{{ ct('Health Status') }}</th>
                <th>{{ ct('Status') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="observation in filteredObservations" :key="observation.id">
                <td>
                  <strong>{{ observation.id }}</strong>
                </td>
                <td>{{ observation.plantId }}</td>
                <td>
                  <em>{{ speciesText(observation.plantId) }}</em>
                </td>
                <td>{{ dt(observation.observedAt) }}</td>
                <td>{{ ct(observation.growthStage) }}</td>
                <td>{{ ct(observation.health) }}</td>
                <td>{{ ct(observation.status) }}</td>
              </tr>
              <tr v-if="!filteredObservations.length">
                <td colspan="7" class="empty-row">{{ emptyMessage('observations') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <template v-else-if="form.type === 'Conservation Status Report'">
        <ReportChart
          v-if="chartSpec"
          ref="reportChart"
          :title="chartSpec.title"
          :labels="chartSpec.labels"
          :values="chartSpec.values"
          :colors="chartSpec.colors"
        />
        <div class="metric-grid">
          <div v-for="row in conservationRows" :key="row.status" class="metric">
            <span>{{ ct(row.status) }}</span
            ><strong>{{ ct('{count} species', { count: row.speciesCount }) }}</strong
            ><small>{{ ct('{count} plant records', { count: row.plantCount }) }}</small>
          </div>
        </div>
      </template>

      <template v-else>
        <div class="metric-grid report-metrics">
          <div class="metric">
            <span>{{ ct('Total Alerts') }}</span
            ><strong>{{ alertMetrics.total }}</strong>
          </div>
          <div class="metric">
            <span>{{ ct('High Severity') }}</span
            ><strong>{{ alertMetrics.high }}</strong>
          </div>
          <div class="metric">
            <span>{{ ct('Open / Active Alerts') }}</span
            ><strong>{{ alertMetrics.active }}</strong>
          </div>
          <div class="metric">
            <span>{{ ct('Resolved Alerts') }}</span
            ><strong>{{ alertMetrics.resolved }}</strong>
          </div>
        </div>
        <ReportChart
          v-if="chartSpec"
          ref="reportChart"
          :title="chartSpec.title"
          :labels="chartSpec.labels"
          :values="chartSpec.values"
          :colors="chartSpec.colors"
        />
        <div class="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{{ ct('Alert ID') }}</th>
                <th>{{ ct('Plant ID') }}</th>
                <th>{{ ct('Species') }}</th>
                <th>{{ ct('Alert Type') }}</th>
                <th>{{ ct('Severity') }}</th>
                <th>{{ ct('Confidence') }}</th>
                <th>{{ ct('Created At') }}</th>
                <th>{{ ct('Status') }}</th>
                <th>{{ ct('Resolved At') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="alert in filteredAlerts" :key="alert.id">
                <td>
                  <strong>{{ alert.id }}</strong>
                </td>
                <td>{{ alert.plantId }}</td>
                <td>
                  <em>{{ speciesText(alert.plantId) }}</em>
                </td>
                <td>{{ ct(alert.type) }}</td>
                <td>{{ ct(alert.severity) }}</td>
                <td>—</td>
                <td>{{ dt(alert.detectedAt) }}</td>
                <td>{{ ct(alert.status) }}</td>
                <td>—</td>
              </tr>
              <tr v-if="!filteredAlerts.length">
                <td colspan="9" class="empty-row">{{ emptyMessage('threat alerts') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <div class="modal-actions report-actions">
        <button type="button" class="secondary-button" @click="exportFile('PDF')">
          {{ ct('Export PDF') }}</button
        ><button type="button" class="secondary-button" @click="exportFile('CSV')">
          {{ ct('Export CSV') }}
        </button>
      </div>
    </article>
  </section>
  <div
    v-if="toast"
    class="toast"
    :class="toastTone"
    :role="toastTone === 'error' ? 'alert' : 'status'"
  >
    {{ toast }}
  </div>
</template>

<style scoped>
.report-filters {
  align-items: end;
}
.report-submit .primary-button {
  width: 100%;
}
.report-error {
  grid-column: 1/-1;
  margin: 0;
  color: #b84d42;
  font-size: 10px;
  font-weight: 700;
}
.report-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 7px 18px;
}
.report-meta span {
  position: relative;
}
.report-meta span + span::before {
  position: absolute;
  left: -11px;
  content: '·';
}
.report-metrics {
  margin-bottom: 18px;
}
.metric small {
  display: block;
  margin-top: 5px;
  color: #87968e;
  font-size: 9px;
}
.report-actions {
  padding-top: 18px;
  border-top: 1px solid #edf0ed;
}
.toast.error {
  background: #8f3128;
}
@media (max-width: 620px) {
  .report-preview {
    padding: 18px;
  }
  .report-meta {
    align-items: flex-start;
    flex-direction: column;
    gap: 5px;
  }
  .report-meta span + span::before {
    content: none;
  }
  .metric-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .report-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 380px) {
  .metric-grid {
    grid-template-columns: 1fr;
  }
}
</style>
