<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { plantApi } from '../../services/plantApi'

type ReportRow = { scientific_name: string; common_name: string; approved_plants: string }
const rows = ref<ReportRow[]>([]), error = ref(''), generatedAt = ref(''), species = ref(''), preview = ref(false)
const filtered = computed(() => rows.value.filter(row => !species.value || row.scientific_name === species.value))
const approvedTotal = computed(() => filtered.value.reduce((total, row) => total + Number(row.approved_plants || 0), 0))
onMounted(async () => { try { const data = await plantApi<{ rows: ReportRow[]; generatedAt: string }>('/reports'); rows.value = data.rows; generatedAt.value = data.generatedAt; preview.value = true } catch (e) { error.value = e instanceof Error ? e.message : 'Report unavailable.' } })
const cell = (value: unknown) => { let text = String(value ?? ''); if (/^[=+@\-\t\r]/.test(text)) text = "'" + text; return '"' + text.replaceAll('"', '""') + '"' }
function csv() { const content = [['Scientific name', 'Common name', 'Approved plants'], ...filtered.value.map(row => [row.scientific_name, row.common_name, row.approved_plants])].map(row => row.map(cell).join(',')).join('\r\n'); const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = 'biodiversity.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
function pdf() { const doc = new jsPDF(); doc.text('Biodiversity report', 14, 15); autoTable(doc, { startY: 22, head: [['Scientific name', 'Common name', 'Approved plants']], body: filtered.value.map(row => [row.scientific_name, row.common_name, row.approved_plants]) }); doc.save('biodiversity.pdf') }
</script>

<template>
  <section class="page-intro"><div><p class="page-kicker">ANALYSIS &amp; EXPORT</p><h2>Reports</h2><p>Generate summaries from approved biodiversity records.</p></div></section>
  <p v-if="error" class="report-error" role="alert">{{ error }}</p>
  <section class="panel reports-panel"><header class="panel-header"><div><p class="section-kicker">GENERATE REPORT</p><h2>Report Filters</h2></div></header>
    <form class="form-grid report-filters" @submit.prevent="preview = true"><label class="form-field"><span>Report Type</span><select aria-label="Report Type"><option>Biodiversity Summary</option></select></label><label class="form-field"><span>Species</span><select v-model="species"><option value="">All species</option><option v-for="row in rows" :key="row.scientific_name" :value="row.scientific_name">{{ row.scientific_name }}</option></select></label><div class="form-field report-submit"><span aria-hidden="true">&nbsp;</span><button type="submit" class="primary-button" :disabled="!generatedAt">Generate Report</button></div></form>
    <article v-if="preview" class="report-preview"><header class="report-title"><p class="section-kicker">NIAH NATIONAL PARK</p><h2>Biodiversity Summary</h2></header><div class="report-meta"><span>{{ species || 'All species' }}</span><span>Generated {{ generatedAt }}</span></div><div class="metric-grid report-metrics"><div class="metric"><span>Unique Species</span><strong>{{ filtered.length }}</strong></div><div class="metric"><span>Approved Plants</span><strong>{{ approvedTotal }}</strong></div></div><div class="table-scroll"><table><thead><tr><th>Scientific Name</th><th>Common Name</th><th>Approved Plants</th></tr></thead><tbody><tr v-for="row in filtered" :key="row.scientific_name"><td><em>{{ row.scientific_name }}</em></td><td>{{ row.common_name }}</td><td>{{ row.approved_plants }}</td></tr><tr v-if="!filtered.length"><td colspan="3" class="empty-row">No species records available for this report.</td></tr></tbody></table></div><div class="report-actions"><button class="secondary-button" @click="csv">Download biodiversity CSV</button><button class="secondary-button" @click="pdf">Download biodiversity PDF</button></div></article>
  </section>
</template>

<style scoped>
.report-filters{align-items:end}.report-submit .primary-button{width:100%}.report-error{margin:0 0 16px;padding:11px 14px;border-radius:9px;background:#fff0ec;color:#b84d42;font-size:11px}.report-meta{display:flex;flex-wrap:wrap;gap:7px 18px}.report-meta span+span::before{content:'·';margin-right:12px}.report-metrics{margin-bottom:18px}.report-actions{padding-top:18px;border-top:1px solid #edf0ed;display:flex;gap:9px;flex-wrap:wrap}@media(max-width:620px){.report-preview{padding:18px}.report-meta{flex-direction:column;gap:5px}.report-meta span+span::before{content:none}.report-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>
