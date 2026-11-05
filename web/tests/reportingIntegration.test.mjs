import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as vue from 'vue'
import * as integration from '../src/services/reporting.ts'

const filename = new URL('../src/views/conservation/ReportsView.vue', import.meta.url)
const source = readFileSync(filename, 'utf8')
const viteSource = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const script = compileScript(descriptor, { id: 'reporting-integration' })
const template = compileTemplate({
  source: descriptor.template.content,
  filename: filename.pathname,
  id: 'reporting-integration',
  compilerOptions: { bindingMetadata: script.bindings },
})
const transpile = (value) => ts.transpileModule(value, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const messages = JSON.parse(readFileSync(new URL('../src/locales/en.json', import.meta.url), 'utf8'))
const reportFixture = (overrides = {}) => ({
  generatedAt: '2026-11-03T12:00:00.000Z',
  rows: [
    { scientific_name: 'Shorea alpha', common_name: 'Alpha meranti', approved_plants: '3' },
    { scientific_name: 'Hopea beta', common_name: 'Beta hopea', approved_plants: '1' },
  ],
  ...overrides,
})
function harness(fetchHandler) {
  const scope = vue.effectScope()
  const calls = []
  const pdfs = []
  const tables = []
  const drawn = []
  const blobs = []
  const locale = vue.ref('en')
  const t = (key, params = {}) => {
    const found = key.split('.').reduce((entry, part) => entry?.[part], messages)
    const value = typeof found === 'string' ? found : key
    return Object.entries(params).reduce((text, [name, replacement]) =>
      text.replaceAll(`{${name}}`, String(replacement)), value)
  }
  class PdfMock {
    constructor() {
      this.saved = ''
      this.internal = { pageSize: { getWidth: () => 210 } }
      pdfs.push(this)
    }
    setTextColor() {}
    setFontSize() {}
    text(value) { drawn.push(value) }
    addPage() {}
    addImage() {}
    save(name) { this.saved = name }
  }
  const exports = {}
  const context = {
    exports,
    AbortSignal,
    Blob,
    console,
    document: { createElement: () => ({ click() {}, remove() {}, toDataURL: () => 'data:chart', getContext: () => ({fillRect() {}, fillText: value => drawn.push(value)}) }), body: { appendChild() {} } },
    window: { setTimeout },
    URL: { createObjectURL: blob => { blobs.push(blob); return 'blob:test' }, revokeObjectURL() {} },
    fetch: async (url, options) => {
      calls.push({ url, options })
      return fetchHandler(url, options)
    },
    require(name) {
      if (name === 'vue') return {
        ...vue,
        onMounted() {},
        onBeforeUnmount() {},
        resolveComponent: (component) => component,
        withDirectives: (node) => node,
      }
      if (name === 'vue-i18n') return { useI18n: () => ({ t, locale }) }
      if (name === 'jspdf') return { jsPDF: PdfMock }
      if (name === 'jspdf-autotable') return {
        __esModule: true,
        default: (doc, options) => tables.push({ doc, options }),
      }
      if (name.endsWith('reporting')) return {
        ...integration,
        requestReport: async (filters) => {
          const response = await context.fetch(integration.reportRequestUrl(filters), { credentials: 'same-origin' })
          let value
          try { value = await response.json() }
          catch { throw Error('The reporting service returned an invalid response.') }
          if (!response.ok) throw Error(value?.message || value?.error ||
            (response.status === 403 ? 'You do not have permission to read reports.' : `Report request failed (${response.status}).`))
          const mapped = integration.mapApprovedPlantReport(value)
          if (!mapped) throw Error('The reporting service returned an invalid response.')
          return mapped
        },
      }
      if (name.endsWith('.vue')) return { name }
      throw Error(`Unexpected import: ${name}`)
    },
  }
  vm.runInNewContext(`(function () { ${transpile(script.content)} })()`, context)
  const state = scope.run(() => exports.default.setup({}, { expose() {} }))
  vm.runInNewContext(`(function () { ${transpile(template.code)} })()`, context)
  return { state, calls, pdfs, tables, drawn, blobs, locale, render: () => exports.render({}, [], {}, vue.proxyRefs(state), {}, {}), stop: () => scope.stop() }
}
function nodes(root) {
  const result = []
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (!node || typeof node !== 'object') return
    result.push(node)
    if (Array.isArray(node.children)) walk(node.children)
    else if (node.children?.default) walk(node.children.default())
  }
  walk(root)
  return result
}

test('real report uses the plant-backend proxy path and renders rows plus generatedAt', async () => {
  const h = harness(async () => Response.json(reportFixture()))
  try {
    await h.state.loadReport()
    assert.equal(h.calls[0].url, '/api/data/reports')
    assert.equal(h.state.report.value.generatedAt, '2026-11-03T12:00:00.000Z')
    assert.equal(h.state.report.value.rows[0].approvedPlants, 3)
    assert.equal(h.state.totalSpecies.value, 2)
    assert.equal(h.state.totalApprovedPlants.value, 4)
    const rendered = nodes(h.render())
    assert.ok(rendered.some((node) => node.children === 'Shorea alpha'))
    assert.ok(rendered.some((node) => String(node.children).includes('3 Nov 2026')))
    assert.match(viteSource, /'\/api\/data'[\s\S]*replace\(\/\^\\\/api\\\/data\/, '\/api'\)/)
  } finally { h.stop() }
})

test('successful empty report is not presented as an API failure', async () => {
  const h = harness(async () => Response.json(reportFixture({ rows: [] })))
  try {
    await h.state.loadReport()
    assert.equal(h.state.loadError.value, '')
    assert.equal(h.state.totalSpecies.value, 0)
    assert.ok(nodes(h.render()).some((node) => node.children === 'No report data available.'))
  } finally { h.stop() }
})

test('malformed response and structured HTTP failures do not become zero-count reports', async () => {
  for (const response of [
    () => Response.json({ generatedAt: 'bad', rows: [] }),
    () => new Response('<html>gateway</html>', { status: 502 }),
    () => Response.json({ message: 'Sign in required.' }, { status: 401 }),
    () => Response.json({}, { status: 403 }),
  ]) {
    const h = harness(response)
    try {
      await h.state.loadReport()
      assert.equal(h.state.report.value, null)
      assert.ok(h.state.loadError.value)
      assert.ok(nodes(h.render()).some((node) => node.children === 'Report failed to load.'))
      if (h.calls.length && h.calls[0]) assert.equal(h.calls[0].url, '/api/data/reports')
    } finally { h.stop() }
  }
})

test('network failures are distinguished by the real report API helper', async () => {
  const originalFetch = globalThis.fetch
  try {
    let path = ''
    globalThis.fetch = async (url) => { path = url; throw Error('offline') }
    await assert.rejects(integration.requestReport(), { kind: 'network' })
    assert.equal(path, '/api/data/reports')
    globalThis.fetch = async () => Response.json({}, { status: 403 })
    await assert.rejects(integration.requestReport(), { message: /permission/i, status: 403 })
  } finally { globalThis.fetch = originalFetch }
})

test('category selector exposes only the supported report with explicit filter actions', async () => {
  const h = harness(async () => Response.json(reportFixture()))
  try {
    await h.state.loadReport()
    const tree = nodes(h.render())
    const category = tree.find(n => n.type === 'select' && n.props.id === 'report-category')
    assert.ok(category)
    assert.equal(nodes(category).filter(n => n.type === 'option').length, 1)
    assert.ok(!tree.some(n => n.props?.type === 'radio'))
    assert.ok(tree.some(n => n.type === 'label' && n.props.for === 'report-category'))
    assert.ok(tree.some(n => n.type === 'button' && n.props.type === 'submit' && n.children === 'Apply'))
    assert.ok(!tree.some(n => n.props?.id === 'report-start'))
    h.state.pendingPeriod.value = 'custom'
    const custom = nodes(h.render())
    for (const id of ['report-start', 'report-end']) {
      assert.ok(custom.some(n => n.props?.id === id && n.props.type === 'date'))
      assert.ok(custom.some(n => n.type === 'label' && n.props.for === id))
    }
    assert.equal(h.calls.length, 1)
  } finally { h.stop() }
})

test('search and sorting operate only over real loaded rows', () => {
  const report = integration.mapApprovedPlantReport(reportFixture())
  assert.ok(report)
  assert.deepEqual(integration.filterAndSortReportRows(report.rows, '', 'scientific-asc').map((row) => row.scientificName), ['Hopea beta', 'Shorea alpha'])
  assert.deepEqual(integration.filterAndSortReportRows(report.rows, '', 'approved-desc').map((row) => row.approvedPlants), [3, 1])
  assert.deepEqual(integration.filterAndSortReportRows(report.rows, 'beta', 'approved-desc').map((row) => row.commonName), ['Beta hopea'])
})

test('CSV and PDF export receive only real report rows and backend generation time', async () => {
  const report = integration.mapApprovedPlantReport(reportFixture())
  assert.ok(report)
  const csv = integration.buildReportCsv(report, report.rows)
  assert.match(csv, /2026-11-03T12:00:00.000Z/)
  assert.match(csv, /Shorea alpha,Alpha meranti,3/)
  assert.doesNotMatch(csv, /Observation ID|Alert ID|September/)
  const h = harness(async () => Response.json(reportFixture()))
  try {
    await h.state.loadReport()
    await h.state.exportPdf()
    assert.equal(h.tables.length, 1)
    assert.deepEqual(Array.from(h.tables[0].options.body[0]), ['Hopea beta', 'Beta hopea', 1])
    assert.ok(h.pdfs[0].saved.startsWith('niah-species-approved-plants-2026-11-03'))
  } finally { h.stop() }
})

test('production report source has no conservationStore, fake dates, or persistence claims', () => {
  assert.doesNotMatch(source, /conservationStore|speciesForPlant|2026-09-01|2026-10-03/)
  assert.match(source, /requestReport\(snapshot\)/)
  assert.match(source, /rt\('downloadOnly'\)/)
  assert.doesNotMatch(source, /Saved Report|report history/i)
})


test('period inputs stay pending; apply, refresh and reset use the right snapshot', async () => {
  const h = harness(async () => Response.json(reportFixture()))
  try {
    await h.state.loadReport()
    h.state.pendingPeriod.value = 'custom'
    h.state.pendingStart.value = '2026-11-01'; h.state.pendingEnd.value = '2026-11-03'
    assert.equal(h.calls.length, 1)
    assert.match(h.state.appliedScope.value, /All time/)
    await h.state.applyFilters()
    assert.equal(h.calls.at(-1).url, '/api/data/reports?period=custom&start=2026-11-01&end=2026-11-03')
    h.state.pendingPeriod.value = 'last-month'
    await h.state.loadReport()
    assert.match(h.calls.at(-1).url, /period=custom/)
    h.state.search.value = 'alpha'; h.state.sort.value = 'approved-desc'
    await h.state.resetFilters()
    assert.equal(h.calls.at(-1).url, '/api/data/reports')
    assert.equal(h.state.pendingPeriod.value, 'all-time')
    assert.equal(h.state.search.value, ''); assert.equal(h.state.sort.value, 'scientific-asc')
    for (const [start,end] of [['2026-02-30','2026-03-01'],['2026-12-01','2026-11-01'],['','2026-11-01']]) {
      h.state.pendingPeriod.value = 'custom';h.state.pendingStart.value=start;h.state.pendingEnd.value=end
      const count=h.calls.length;await h.state.applyFilters();assert.equal(h.calls.length,count);assert.ok(h.state.filterError.value)
    }
    for(const period of ['this-month','last-month']) {
      h.state.pendingPeriod.value=period;await h.state.applyFilters();assert.equal(h.calls.at(-1).url, '/api/data/reports?period='+period)
    }
  } finally { h.stop() }
})

test('stale successes and errors cannot overwrite a later snapshot; loading blocks exports', async () => {
  const waiting=[]
  const h=harness(()=>new Promise((resolve,reject)=>waiting.push({resolve,reject})))
  try {
    const first=h.state.loadReport();const second=h.state.loadReport()
    h.state.exportCsv();await h.state.exportPdf();assert.equal(h.blobs.length,0);assert.equal(h.pdfs.length,0)
    waiting[1].resolve(Response.json(reportFixture({rows:[{scientific_name:'Newest',common_name:'',approved_plants:7}]})))
    await second;assert.equal(h.state.isLoading.value,false)
    waiting[0].reject(Error('Stale failure'));await first
    assert.equal(h.state.report.value.rows[0].scientificName,'Newest');assert.equal(h.state.loadError.value,'')
    const third=h.state.loadReport();const fourth=h.state.loadReport()
    waiting[3].resolve(Response.json(reportFixture()));await fourth
    waiting[2].resolve(Response.json(reportFixture({rows:[]})));await third
    assert.equal(h.state.report.value.rows.length,2)
  } finally {h.stop()}
})

test('search drives metrics, top chart, CSV and both PDF paths from matching rows', async () => {
  const h=harness(async()=>Response.json(reportFixture()))
  try {
    await h.state.loadReport();h.state.search.value='beta'
    assert.equal(h.state.totalSpecies.value,2)
    assert.equal(h.state.filteredRows.value.length,1);assert.equal(h.state.totalApprovedPlants.value,1)
    assert.deepEqual(Array.from(h.state.chartRows.value,r=>r.scientificName),['Hopea beta'])
    h.state.exportCsv();const csv=await h.blobs[0].text()
    assert.match(csv,/All Species in Scope,2/);assert.match(csv,/Matching Species,1/)
    assert.match(csv,/Total Approved Plants,1/);assert.doesNotMatch(csv,/Shorea alpha/)
    assert.match(csv,/Asia\/Kuala_Lumpur/);assert.match(csv,/Search,beta/)
    await h.state.exportPdf();assert.equal(h.tables[0].options.body.length,1)
    h.locale.value='zh-CN';await h.state.exportPdf()
    assert.equal(h.pdfs.length,2);assert.ok(h.pdfs[1].saved.endsWith('.pdf'))
    assert.ok(h.drawn.some(text=>String(text).includes('Hopea beta')))
    h.state.search.value='no match';h.state.exportCsv();await h.state.exportPdf()
    assert.equal(h.blobs.length,1);assert.equal(h.pdfs.length,2);assert.equal(h.state.totalApprovedPlants.value,0)
  } finally {h.stop()}
})

test('CSV keeps BOM, quotes and formula protection; period metadata is applied data', () => {
  const report={generatedAt:'2026-11-04T00:00:00Z',scope:{period:'custom',timezone:'Asia/Kuala_Lumpur',startDate:'2026-11-01',endDate:'2026-11-03'},rows:[{scientificName:'=SUM(A1)',commonName:'A,"B"',approvedPlants:2}]}
  const csv=integration.buildReportCsv(report,report.rows)
  assert.equal(csv.charCodeAt(0),0xfeff);assert.match(csv,/'=SUM/);assert.match(csv,/"A,""B"""/)
  assert.match(csv,/2026-11-01 to 2026-11-03/)
})


test('real adapter sends period parameters and rejects missing/mismatched period metadata', async () => {
  const original=globalThis.fetch
  const scope={period:'custom',timezone:'Asia/Kuala_Lumpur',startDate:'2026-11-01',endDate:'2026-11-03',startInclusive:'2026-10-31T16:00:00Z',endExclusive:'2026-11-03T16:00:00Z'}
  const filters={period:'custom',start:'2026-11-01',end:'2026-11-03'}
  try {
    globalThis.fetch=async (url,opts)=>{
      assert.equal(url,'/api/data/reports?period=custom&start=2026-11-01&end=2026-11-03')
      assert.equal(opts.credentials,'same-origin');return Response.json(reportFixture({scope}))
    }
    assert.equal((await integration.requestReport(filters)).scope.startInclusive,scope.startInclusive)
    for(const result of [reportFixture(),reportFixture({scope:{...scope,period:'all-time'}}),reportFixture({scope:{...scope,startDate:'2026-11-02'}})]) {
      globalThis.fetch=async()=>Response.json(result)
      await assert.rejects(integration.requestReport(filters),{kind:'invalid'})
    }
    let fetched=false;globalThis.fetch=async()=>{fetched=true;return Response.json(reportFixture())}
    await assert.rejects(integration.requestReport({...filters,start:'2026-02-30'}));assert.equal(fetched,false)
  } finally {globalThis.fetch=original}
})

test('applied period labels come from response metadata and zero-count periods remain truthful', async () => {
  const scope={period:'custom',timezone:'Asia/Kuala_Lumpur',startDate:'2026-11-01',endDate:'2026-11-03',startInclusive:'2026-10-31T16:00:00Z',endExclusive:'2026-11-03T16:00:00Z'}
  let fail=false
  const h=harness(async()=>fail ? Response.json({error:'Reporting unavailable'},{status:503}) : Response.json(reportFixture({scope,rows:[{scientific_name:'Zero species',common_name:'',approved_plants:0}]})))
  try {
    h.state.pendingPeriod.value='custom';h.state.pendingStart.value='2026-11-01';h.state.pendingEnd.value='2026-11-03'
    await h.state.applyFilters()
    assert.match(h.state.appliedScope.value,/2026-11-01 to 2026-11-03/)
    assert.equal(h.state.totalSpecies.value,1);assert.equal(h.state.totalApprovedPlants.value,0)
    assert.ok(nodes(h.render()).some(n=>n.children===messages.conservationPages.reports.noPlantsInPeriod))
    h.state.pendingStart.value='2026-11-02';assert.match(h.state.appliedScope.value,/2026-11-01/)
    fail=true;await h.state.loadReport();assert.equal(h.state.report.value,null)
    assert.match(h.state.loadError.value,/Reporting unavailable/)
    h.state.exportCsv();await h.state.exportPdf();assert.equal(h.pdfs.length,0)
  } finally {h.stop()}
})


test('chart stays capped at twelve matching species and form submit supports keyboard apply', async () => {
  const rows=Array.from({length:15},(_,i)=>({species_id:i+1,scientific_name:'Species '+String(i).padStart(2,'0'),common_name:'',approved_plants:i}))
  const h=harness(async()=>Response.json(reportFixture({rows})))
  try {
    await h.state.loadReport()
    assert.equal(h.state.chartRows.value.length,12)
    assert.equal(h.state.chartRows.value[0].approvedPlants,14)
    h.state.search.value='Species 0'
    assert.equal(h.state.filteredRows.value.length,10);assert.equal(h.state.chartRows.value.length,10)
    assert.equal(h.state.totalApprovedPlants.value,45)
    const form=nodes(h.render()).find(n=>n.type==='form')
    let prevented=false
    await form.props.onSubmit({preventDefault(){prevented=true}})
    assert.equal(prevented,true);assert.equal(h.calls.length,2)
  } finally {h.stop()}
})


test('page shows one localized applied-period label without technical labels; exports retain scope', async () => {
  let scope={period:'all-time',timezone:'Asia/Kuala_Lumpur',startDate:null,endDate:null,startInclusive:null,endExclusive:null}
  const h=harness(async()=>Response.json(reportFixture({scope})))
  try {
    await h.state.loadReport()
    assert.equal(h.state.appliedPeriodLabel.value,'Reporting Period: All time')
    h.state.pendingPeriod.value='last-month'
    assert.equal(h.state.appliedPeriodLabel.value,'Reporting Period: All time')
    for(const [period,label] of [['this-month','This month'],['last-month','Last month']]) {
      scope={...scope,period,startDate:'2026-11-01',endDate:'2026-11-30',startInclusive:'2026-10-31T16:00:00Z',endExclusive:'2026-11-30T16:00:00Z'}
      await h.state.loadReport()
      assert.equal(h.state.appliedPeriodLabel.value,`Reporting Period: ${label}`)
    }
    scope={...scope,period:'custom',startDate:'2026-11-01',endDate:'2026-11-04'}
    await h.state.loadReport()
    assert.match(h.state.appliedPeriodLabel.value,/1.*4 Nov 2026/)
    assert.doesNotMatch(h.state.appliedPeriodLabel.value,/Asia|Kuala|All time/)
    const tree=nodes(h.render())
    assert.ok(tree.some(n=>n.props?.class==='applied-scope' && n.children===h.state.appliedPeriodLabel.value))
    assert.ok(!tree.some(n=>n.props?.class==='section-kicker'))
    assert.match(h.state.appliedScope.value,/Asia\/Kuala_Lumpur/)
    for(const language of ['en','ms','zh-CN']) {
      const translations=JSON.parse(readFileSync(new URL(`../src/locales/${language}.json`,import.meta.url),'utf8')).conservationPages.reports
      assert.ok(translations.appliedPeriod.includes('{period}'))
      assert.equal('realBackendReport' in translations,false)
    }
  } finally {h.stop()}
})
