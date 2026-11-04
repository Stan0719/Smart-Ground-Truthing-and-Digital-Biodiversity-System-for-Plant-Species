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
    text() {}
    addImage() {}
    save(name) { this.saved = name }
  }
  const exports = {}
  const context = {
    exports,
    AbortSignal,
    Blob,
    console,
    document: { createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } },
    window: { setTimeout },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    fetch: async (url, options) => {
      calls.push({ url, options })
      return fetchHandler(url, options)
    },
    require(name) {
      if (name === 'vue') return {
        ...vue,
        onMounted() {},
        resolveComponent: (component) => component,
        withDirectives: (node) => node,
      }
      if (name === 'vue-i18n') return { useI18n: () => ({ t, locale: vue.ref('en') }) }
      if (name === 'jspdf') return { jsPDF: PdfMock }
      if (name === 'jspdf-autotable') return {
        __esModule: true,
        default: (doc, options) => tables.push({ doc, options }),
      }
      if (name.endsWith('reporting')) return {
        ...integration,
        requestReport: async () => {
          const response = await context.fetch(integration.REPORT_API_PATH, { credentials: 'same-origin' })
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
  return { state, calls, pdfs, tables, render: () => exports.render({}, [], {}, vue.proxyRefs(state), {}, {}), stop: () => scope.stop() }
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

test('unsupported report types are blocked without generating or fetching prototype data', async () => {
  const h = harness(async () => Response.json(reportFixture()))
  try {
    await h.state.loadReport()
    const callCount = h.calls.length
    h.state.reportType.value = 'observations'
    h.state.chooseReportType()
    assert.equal(h.calls.length, callCount)
    assert.equal(h.state.unsupportedMessage.value, 'Backend integration not available yet')
    const unsupported = h.state.reportTypes.filter((item) => !item.supported)
    assert.deepEqual(Array.from(unsupported, (item) => item.id), ['observations', 'threats', 'iot', 'camera', 'custom-date'])
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
    h.state.exportPdf()
    assert.equal(h.tables.length, 1)
    assert.deepEqual(Array.from(h.tables[0].options.body[0]), ['Hopea beta', 'Beta hopea', 1])
    assert.ok(h.pdfs[0].saved.startsWith('niah-species-approved-plants-2026-11-03'))
  } finally { h.stop() }
})

test('production report source has no conservationStore, fake dates, or persistence claims', () => {
  assert.doesNotMatch(source, /conservationStore|speciesForPlant|2026-09-01|2026-10-03/)
  assert.match(source, /requestReport\(\)/)
  assert.match(source, /rt\('downloadOnly'\)/)
  assert.doesNotMatch(source, /Saved Report|report history/i)
})
