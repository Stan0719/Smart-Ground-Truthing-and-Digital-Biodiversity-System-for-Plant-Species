import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'

const translationHash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (predicate()) return
    await delay(20)
  }
  assert.fail(message)
}

test('same-locale field registration does not cancel an active translation request', async (testContext) => {
  const originals = {
    fetch: globalThis.fetch,
    window: globalThis.window,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    navigator: globalThis.navigator,
    info: console.info,
  }
  const storage = new Map([['language', 'en']])
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) } })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { language: 'en' } })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    documentElement: { lang: 'en' },
    createElement: () => ({ content: {} }),
    createElementNS: () => ({}),
  } })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis })
  const source = readFileSync(new URL('../src/services/databaseTranslation.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports = {}
  const moduleContext = {
    exports,
    require: name => {
      if (name === 'vue') return vue
      throw new Error(`Unexpected database translation dependency: ${name}`)
    },
    console,
    AbortController,
    AbortSignal,
    Response,
    TextEncoder,
    WeakRef,
    setTimeout,
    clearTimeout,
    crypto: globalThis.crypto,
    fetch: (...args) => globalThis.fetch(...args),
  }
  moduleContext.globalThis = moduleContext
  moduleContext.window = { setTimeout: (...args) => setTimeout(...args), clearTimeout: (...args) => clearTimeout(...args) }
  vm.runInNewContext(compiled, moduleContext)
  const translation = exports
  const locale = vue.ref('en')
  testContext.after(async () => {
    globalThis.fetch = originals.fetch
    console.info = originals.info
    translation.clearDatabaseTranslationTargets()
    for (const key of ['window', 'document', 'localStorage', 'navigator']) {
      const original = originals[key]
      if (original === undefined) delete globalThis[key]
      else Object.defineProperty(globalThis, key, { configurable: true, value: original })
    }
  })

  translation.configureDatabaseTranslation(locale)
  const requests = []
  let releaseFirst
  globalThis.fetch = (url, options) => new Promise((resolve) => {
    requests.push({ url, options, resolve })
    if (requests.length === 1) releaseFirst = () => resolve(new Response(JSON.stringify({
      locale: 'ms',
      translations: [{ recordType: 'species', recordId: '19', fieldName: 'description', sourceHash: JSON.parse(options.body).entries[0].sourceHash, text: 'Huraian diterjemahkan.' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    else resolve(new Response(JSON.stringify({
      locale: 'ms',
      translations: [{ recordType: 'species', recordId: '20', fieldName: 'description', sourceHash: JSON.parse(options.body).entries[0].sourceHash, text: 'Huraian kedua.' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  })
  console.info = () => {}

  const first = { description: 'Original first.' }
  const second = { description: 'Original second.' }
  locale.value = 'ms'
  translation.trackDatabaseTranslationFields([{ recordType: 'species', recordId: '19', fieldName: 'description', target: first }])
  await waitFor(() => requests.length === 1, 'first translation request did not start')
  translation.trackDatabaseTranslationFields([{ recordType: 'species', recordId: '20', fieldName: 'description', target: second }])
  await delay(120)

  assert.equal(requests.length, 1, 'new field should join the active same-locale refresh')
  assert.equal(requests[0].options.signal.aborted, false, 'same-locale registration must not abort active fetch')
  assert.equal(JSON.parse(requests[0].options.body).locale, 'ms')
  releaseFirst()

  await waitFor(() => requests.length === 2, 'newly registered field was not requested after the active batch')
  assert.equal(requests[1].options.signal.aborted, false)
  assert.deepEqual(JSON.parse(requests[1].options.body).entries, [{ recordType: 'species', recordId: '20', fieldName: 'description', sourceHash: await translationHash('Original second.') }])
  await waitFor(() => first.description === 'Huraian diterjemahkan.' && second.description === 'Huraian kedua.', 'returned translations did not update their reactive targets')
  translation.clearDatabaseTranslationTargets()
  locale.value = 'en'
})
