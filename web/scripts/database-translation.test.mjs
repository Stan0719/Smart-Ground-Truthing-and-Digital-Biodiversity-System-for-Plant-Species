import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (predicate()) return
    await delay(20)
  }
  assert.fail(message)
}

test('same-locale field registration does not cancel an active translation request', async (context) => {
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
  const server = await createServer({
    root: fileURLToPath(new URL('..', import.meta.url)),
    configFile: false,
    plugins: [],
    logLevel: 'silent',
    server: { middlewareMode: true },
    appType: 'custom',
  })
  context.after(async () => {
    globalThis.fetch = originals.fetch
    console.info = originals.info
    await server.close()
    for (const key of ['window', 'document', 'localStorage', 'navigator']) {
      const original = originals[key]
      if (original === undefined) delete globalThis[key]
      else Object.defineProperty(globalThis, key, { configurable: true, value: original })
    }
  })

  const { i18n } = await server.ssrLoadModule('/src/i18n.ts')
  const translation = await server.ssrLoadModule('/src/services/databaseTranslation.ts')
  const requests = []
  let releaseFirst
  globalThis.fetch = (url, options) => new Promise((resolve) => {
    requests.push({ url, options, resolve })
    if (requests.length === 1) releaseFirst = () => resolve(new Response(JSON.stringify({
      locale: 'ms',
      translations: [{ recordType: 'species', recordId: '19', fieldName: 'description', text: 'Huraian diterjemahkan.' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    else resolve(new Response(JSON.stringify({
      locale: 'ms',
      translations: [{ recordType: 'species', recordId: '20', fieldName: 'description', text: 'Huraian kedua.' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  })
  console.info = () => {}

  const first = { description: 'Original first.' }
  const second = { description: 'Original second.' }
  i18n.global.locale.value = 'ms'
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
  assert.deepEqual(JSON.parse(requests[1].options.body).entries, [{ recordType: 'species', recordId: '20', fieldName: 'description' }])
  await waitFor(() => first.description === 'Huraian diterjemahkan.' && second.description === 'Huraian kedua.', 'returned translations did not update their reactive targets')
  translation.clearDatabaseTranslationTargets()
  i18n.global.locale.value = 'en'
})
