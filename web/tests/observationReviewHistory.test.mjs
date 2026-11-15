import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import * as vue from 'vue'
import ts from 'typescript'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import * as historyService from '../src/services/observationReviewHistory.ts'
import { workflowBadgeStyle } from '../src/utils/workflowBadge.ts'

const entry = (id = 'review-one', changes = {}) => ({ id, observation_id: '1', decision: 'Correction Required', reviewer_subject: 'staff:archived-officer', comment: '<script>plain text</script>\nKeep this line.', created_at: '2026-11-05T02:30:00.123456Z', ...changes })
const page = (reviews = [], next = null, observationId = '1') => Response.json({ observation_id: observationId, reviews, page: { limit: 50, has_more: next !== null, next_cursor: next } })
const tick = async () => { await new Promise(resolve => setImmediate(resolve)); await vue.nextTick() }

test('actual review timestamps use Kuching 24-hour time and safely handle unavailable values', () => {
  assert.equal(historyService.formatReviewTimestamp('2026-11-07T06:20:00.123456Z'), '7 Nov 2026, 14:20')
  assert.equal(historyService.formatReviewTimestamp('2026-11-06T20:20:00Z'), '7 Nov 2026, 04:20')
  assert.equal(historyService.formatReviewTimestamp('2026-11-07T14:20:00+08:00'), '7 Nov 2026, 14:20')
  for (const value of [null, '', 'bad', '2026-11-07T06:20:00', '2026-02-30T00:00:00Z']) assert.equal(historyService.formatReviewTimestamp(value), '\u2014')
  for (const locale of ['ms', 'zh-CN']) assert.ok(historyService.formatReviewTimestamp(entry().created_at, locale).includes('10:30'))
})

test('service uses only the read endpoint and keeps stored fields and server ordering', async () => {
  const calls = []
  const client = historyService.createObservationReviewHistory(async (url, options) => {
    calls.push({ url, options })
    return page([entry('z'), entry('a', { decision: 'Flagged' })], 'older-page')
  })
  await client.load('1')
  assert.equal(calls[0].url, '/api/data/observations/1/reviews?limit=50')
  assert.equal(calls[0].options.credentials, 'same-origin')
  assert.equal(calls[0].options.method, undefined)
  assert.deepEqual(client.state.reviews.map(row => row.id), ['z', 'a'])
  assert.equal(client.state.reviews[0].created_at, entry().created_at)
  assert.equal(client.state.reviews[0].reviewer_subject, entry().reviewer_subject)
  assert.equal(client.state.hasMore, true)
  client.reset()
})

test('pagination, retries and safe refresh preserve confirmed records without fabricating entries', async () => {
  let mode = 'first'
  const client = historyService.createObservationReviewHistory(async url => {
    if (mode === 'failed') throw Error('offline')
    if (mode === 'older') { assert.match(url, /cursor=older-page/); return page([entry('old')]) }
    return page([entry()], 'older-page')
  })
  await client.load('1')
  mode = 'failed'; await client.load('1', true)
  assert.equal(client.state.failed, true); assert.equal(client.state.reviews.length, 1)
  mode = 'older'; await client.retry()
  assert.deepEqual(client.state.reviews.map(row => row.id), ['review-one', 'old'])
  assert.equal(client.state.hasMore, false)
  mode = 'failed'; await client.load('1')
  assert.equal(client.state.failed, true); assert.equal(client.state.reviews.length, 2)
  client.reset()
})

test('stale requests, close/reset and permission errors cannot restore protected history', async () => {
  let finish
  const client = historyService.createObservationReviewHistory(url => url.includes('/1/')
    ? new Promise(resolve => { finish = resolve }) : Promise.resolve(page([entry('second', { observation_id: '2' })], null, '2')))
  const old = client.load('1')
  await client.load('2')
  finish(page([entry()]))
  await old
  assert.equal(client.state.observationId, '2'); assert.equal(client.state.reviews[0].id, 'second')
  const pending = client.load('1'); client.reset(); finish(page([entry()])); await pending
  assert.equal(client.state.reviews.length, 0); assert.equal(client.state.observationId, '')
  let denied = false
  const restricted = historyService.createObservationReviewHistory(async () => denied ? Response.json({}, { status: 403 }) : page([entry()]))
  await restricted.load('1'); denied = true; await restricted.load('1')
  assert.equal(restricted.state.reviews.length, 0); assert.equal(restricted.state.failed, true)
})

test('malformed rows, wrong observation, duplicate IDs and cyclic cursors are rejected', async () => {
  for (const response of [Response.json({}), page([entry('x', { observation_id: '2' })]), page([entry(), entry()]), page([entry('x', { decision: 'Unknown' })])]) {
    const client = historyService.createObservationReviewHistory(async () => response)
    await client.load('1'); assert.equal(client.state.failed, true); assert.equal(client.state.reviews.length, 0)
  }
  const client = historyService.createObservationReviewHistory(async () => page([entry()], 'cycle'))
  await client.load('1'); await client.load('1', true)
  assert.equal(client.state.failed, true); assert.equal(client.state.reviews.length, 1)
})

const source = readFileSync(new URL('../src/components/conservation/ObservationReviewHistory.vue', import.meta.url), 'utf8')
const messages = JSON.parse(readFileSync(new URL('../src/locales/en.json', import.meta.url), 'utf8'))
function harness(transport) {
  const original = globalThis.fetch
  globalThis.fetch = transport
  const { descriptor } = parse(source), script = compileScript(descriptor, { id: 'review-history' })
  const template = compileTemplate({ source: descriptor.template.content, filename: 'ObservationReviewHistory.vue', id: 'review-history', compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  const exports = {}, cleanup = [], listeners = new Set(), scope = vue.effectScope()
  let session = { pending: false, user: { id: 'officer', role: 'Conservation Officer', status: 'Active', mustChangePassword: false } }
  const context = { exports, require(name) {
    if (name === 'vue') return { ...vue, onBeforeUnmount: fn => cleanup.push(fn), renderSlot: (slots, name, props, fallback) => vue.h(vue.Fragment, null, slots?.[name]?.(props) || fallback?.()) }
    if (name === 'vue-i18n') return { useI18n: () => ({ locale: vue.ref('en'), t: key => key.split('.').reduce((value, part) => value?.[part], messages) || key }) }
    if (name.endsWith('/auth')) return { sessionSnapshot: () => session, subscribeSession: fn => { listeners.add(fn); return () => listeners.delete(fn) } }
    if (name.endsWith('observationReviewHistory')) return historyService
    if (name.endsWith('workflowBadge')) return { workflowBadgeStyle }
    throw Error(name)
  } }
  const transpile = code => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(`(function(){${transpile(script.content)}})()`, context)
  const props = vue.reactive({ observationId: '1', refreshKey: 0 })
  const state = scope.run(() => exports.default.setup(props, { expose() {} }))
  vm.runInNewContext(`(function(){${transpile(template.code)}})()`, context)
  return { state, props, render: () => exports.render({}, [], props, vue.proxyRefs(state), {}, {}), changeSession: user => { session = { pending: false, user }; for (const fn of listeners) fn() }, stop: () => { cleanup.forEach(fn => fn()); scope.stop(); globalThis.fetch = original } }
}
function nodes(root) {
  const result = []
  function walk(value) {
    if (Array.isArray(value)) { value.forEach(walk); return }
    if (!value || typeof value !== 'object') return
    result.push(value)
    if (Array.isArray(value.children)) walk(value.children)
  }
  walk(root)
  return result
}

test('section renders actual badge, identity, plain comment and database timestamp', async () => {
  const h = harness(async () => page([entry()]))
  try {
    await tick()
    const rendered = nodes(h.render())
    assert.ok(rendered.some(node => node.type === 'time' && node.children === '5 Nov 2026, 10:30' && node.props.datetime === entry().created_at))
    assert.ok(rendered.some(node => node.children === entry().comment && node.type === 'p'))
    assert.ok(rendered.some(node => node.children === entry().reviewer_subject))
    assert.ok(rendered.some(node => node.props?.style?.backgroundColor === workflowBadgeStyle('Correction Required').backgroundColor))
    assert.ok(!rendered.some(node => node.props?.innerHTML)); assert.doesNotMatch(source, /v-html/)
    assert.ok(!rendered.some(node => node.children === 'Approve'))
  } finally { h.stop() }
})

test('section handles loading, empty, retry, background refresh failure and logout', async () => {
  let finish, mode = 'pending'
  const h = harness(async () => {
    if (mode === 'pending') return new Promise(resolve => { finish = resolve })
    if (mode === 'failed') throw Error('offline')
    return page([entry()])
  })
  try {
    assert.ok(nodes(h.render()).some(node => node.props?.role === 'status'))
    finish(page()); await tick()
    assert.ok(nodes(h.render()).some(node => node.children === 'No review history recorded yet.'))
    mode = 'failed'; h.props.refreshKey++; await tick()
    assert.ok(nodes(h.render()).some(node => node.children === messages.observationReviewHistory.refreshError))
    mode = 'success'
    await nodes(h.render()).find(node => node.type === 'button' && node.children === 'Retry').props.onClick()
    assert.equal(h.state.state.reviews.length, 1)
    h.changeSession(null); await tick()
    assert.equal(h.state.state.reviews.length, 0)
    assert.ok(!nodes(h.render()).some(node => node.children === entry().comment))
  } finally { h.stop() }
})

test('section refresh key retrieves newly committed records and switching observations invalidates older reads', async () => {
  let latest = false, finishOld
  const h = harness(async url => {
    if (url.includes('/2/')) return page([entry('second', { observation_id: '2' })], null, '2')
    if (latest === 'pending') return new Promise(resolve => { finishOld = resolve })
    return page(latest ? [entry('new', { decision: 'Approved', created_at: '2026-11-07T06:20:00.000001Z' }), entry()] : [entry()])
  })
  try {
    await tick()
    latest = true; h.props.refreshKey++; await tick()
    assert.deepEqual(h.state.state.reviews.map(row => row.id), ['new', 'review-one'])
    assert.equal(h.state.state.reviews[0].created_at, '2026-11-07T06:20:00.000001Z')
    latest = 'pending'; h.props.refreshKey++; await tick()
    h.props.observationId = '2'; await tick()
    finishOld(page([entry()])); await tick()
    assert.equal(h.state.state.reviews[0].id, 'second')
    assert.equal(h.state.state.observationId, '2')
  } finally { h.stop() }
})

test('latest three expand and collapse without discarding loaded reviews or fetching more pages', async () => {
  let requests = 0
  const records = Array.from({ length: 6 }, (_, index) => entry('review-' + index))
  const h = harness(async () => { requests++; return page(records) })
  try {
    await tick()
    const count = () => nodes(h.render()).filter(node => node.type === 'li').length
    assert.equal(count(), 3)
    assert.equal(h.state.state.reviews.length, 6)
    let toggle = nodes(h.render()).find(node => node.props?.class?.includes('history-toggle'))
    assert.equal(toggle.children, 'View more reviews')
    assert.equal(toggle.props['aria-expanded'], false)
    await toggle.props.onClick()
    assert.equal(count(), 6)
    toggle = nodes(h.render()).find(node => node.props?.class?.includes('history-toggle'))
    assert.equal(toggle.children, 'Show fewer reviews')
    assert.equal(toggle.props['aria-expanded'], true)
    await toggle.props.onClick()
    assert.equal(count(), 3)
    assert.equal(h.state.state.reviews.length, 6)
    assert.equal(requests, 1)
    await h.state.toggleHistory()
    h.props.refreshKey++; await tick()
    assert.equal(count(), 3)
    assert.equal(h.state.expanded.value, false)
  } finally { h.stop() }
})

test('older pages require explicit expansion and keep their control focusable while loading', async () => {
  let finish, requests = 0
  const h = harness(async () => {
    requests++
    if (requests === 1) return page(Array.from({ length: 4 }, (_, index) => entry('review-' + index)), 'older-page')
    return new Promise(resolve => { finish = resolve })
  })
  try {
    await tick()
    assert.ok(!nodes(h.render()).some(node => node.children === 'Load older decisions'))
    await h.state.toggleHistory()
    assert.equal(requests, 1)
    const request = h.state.requestHistory(true)
    const button = nodes(h.render()).find(node => node.type === 'button' && node.children === 'Load older decisions')
    assert.ok(button)
    assert.equal(button.props.disabled, undefined)
    assert.equal(button.props['aria-disabled'], true)
    finish(page([entry('older')]))
    await request
    assert.equal(h.state.state.reviews.length, 5)
    assert.equal(h.state.announcement.value, messages.observationReviewHistory.complete)
  } finally { h.stop() }
})

test('all supported languages have history labels and responsive comments wrap safely', () => {
  for (const lang of ['en', 'ms', 'zh-CN']) {
    const labels = JSON.parse(readFileSync(new URL(`../src/locales/${lang}.json`, import.meta.url), 'utf8')).observationReviewHistory
    for (const key of Object.keys(messages.observationReviewHistory)) assert.ok(labels[key] && !labels[key].includes('???'))
  }
  assert.match(source, /flex-wrap: wrap/)
  assert.match(source, /overflow-wrap: anywhere/)
  assert.match(source, /white-space: pre-wrap/)
})
