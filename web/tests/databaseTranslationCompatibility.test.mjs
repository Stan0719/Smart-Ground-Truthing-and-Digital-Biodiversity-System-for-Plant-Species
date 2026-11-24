import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash, webcrypto } from 'node:crypto'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'
import backend from '../../plant-conservation-backend/translation-service.cjs'

const hash = text => createHash('sha256').update(text).digest('hex')
const id = '00000000-0000-4000-8000-000000000001'
const code = ts.transpileModule(readFileSync(new URL('../src/services/databaseTranslation.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const settle = async predicate => {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)) }
  assert.fail('Synthetic translation did not settle')
}
function fixture(source = 'Current leaf', revision = '2', responseOverride) {
  let writes = 0, requests = 0
  const diagnostics = []
  const service = backend.createTranslationService({ env: {}, fetchImpl: () => { throw Error('No network allowed') }, pool: {
    async query(sql, values) {
      if (/^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)) { writes++; throw Error('No writes allowed') }
      if (sql.includes('FROM observation_review r')) return { rows: [{ id: values[0], source_text: source, source_version: values[0] }] }
      if (sql.includes('FROM plant_observation o')) return { rows: [{ id, source_text: source, source_version: revision }] }
      if (sql.includes('FROM plant_translation_source_language')) return { rows: values[3] === hash(source) ? [{ record_type: values[4], source_locale: 'en' }] : [] }
      if (sql.includes('FROM plant_translation_cache')) return { rows: [{ translated_text: 'Daun diterjemah', source_locale: 'en', source_hash: hash(source) }] }
      if (sql.includes('SELECT scientific_name AS name')) return { rows: [] }
      throw Error('Unexpected synthetic query')
    },
  } })
  const scope = vue.effectScope(), locale = vue.ref('en'), exports = {}
  const context = { exports, crypto: webcrypto, TextEncoder, WeakRef, AbortController, AbortSignal,
    window: { setTimeout, clearTimeout }, console: { info(...items) { diagnostics.push(items) } },
    async fetch(_url, options) {
      requests++
      const body = JSON.parse(options.body)
      const translations = responseOverride ? responseOverride(body.entries) : await service.translateEntries(body.entries, body.locale, {
        id: 'synthetic-officer', role: 'Conservation Officer', status: 'Active', mustChangePassword: false,
      })
      return Response.json({ locale: body.locale, translations })
    },
    require(name) { assert.equal(name, 'vue'); return vue },
  }
  vm.runInNewContext(code, context)
  scope.run(() => exports.configureDatabaseTranslation(locale))
  return { api: exports, locale, diagnostics, requests: () => requests, writes: () => writes,
    stop() { exports.clearDatabaseTranslationTargets(); scope.stop() } }
}

test('historical and current fields sharing an ID receive only their exact source/revision translation', async () => {
  const f = fixture(), historical = { notes: 'Historical leaf' }, current = { notes: 'Current leaf' }
  try {
    f.api.trackDatabaseTranslationFields([
      { recordType: 'observation', recordId: id, fieldName: 'notes', sourceVersion: '1', target: historical },
      { recordType: 'observation', recordId: id, fieldName: 'notes', sourceVersion: '2', target: current },
    ])
    f.locale.value = 'ms'
    await settle(() => current.notes === 'Daun diterjemah').catch(error => { error.message += JSON.stringify(f.diagnostics); throw error })
    assert.equal(historical.notes, 'Historical leaf'); assert.equal(f.writes(), 0)
    const lateHistorical = { notes: 'Historical leaf' }
    f.api.trackDatabaseTranslationFields([{ recordType: 'observation', recordId: id, fieldName: 'notes', sourceVersion: '1', target: lateHistorical }])
    assert.equal(lateHistorical.notes, 'Historical leaf', 'current cache must not replace a historical value')
    f.locale.value = 'en'; assert.equal(current.notes, 'Current leaf')
  } finally { f.stop() }
})

test('identical text at different revisions still requires the displayed revision to match', async () => {
  const f = fixture(), old = { notes: 'Current leaf' }, current = { notes: 'Current leaf' }
  try {
    f.api.trackDatabaseTranslationFields([
      { recordType: 'observation', recordId: id, fieldName: 'notes', sourceVersion: '1', target: old },
      { recordType: 'observation', recordId: id, fieldName: 'notes', sourceVersion: '2', target: current },
    ])
    f.locale.value = 'zh-CN'; await settle(() => current.notes === 'Daun diterjemah').catch(error => { error.message += JSON.stringify(f.diagnostics); throw error })
    assert.equal(old.notes, 'Current leaf'); assert.equal(f.writes(), 0)
  } finally { f.stop() }
})

test('Plant/Species/Observation comparisons and original registration snapshots remain original', async () => {
  const f = fixture(), proposal = { base_snapshot: { id, content: { notes: 'Baseline' } }, proposed_snapshot: { id, content: { notes: 'Proposal' } } }
  const registration = { id, historical_review: { state: 'available' }, content: { notes: 'Historical leaf' } }
  try {
    f.api.trackDatabaseTranslationResponse(proposal)
    f.api.trackDatabaseTranslationResponse(registration)
    f.api.trackDatabaseTranslationResponse([{ id, content: { notes: 'Earlier history' } }], { historical: true })
    f.locale.value = 'ms'; await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(f.requests(), 0)
    assert.equal(proposal.base_snapshot.content.notes, 'Baseline'); assert.equal(proposal.proposed_snapshot.content.notes, 'Proposal')
    assert.equal(registration.content.notes, 'Historical leaf')
  } finally { f.stop() }
})

test('mismatched response bindings and edits made while translation is in flight are not overwritten', async () => {
  const f = fixture('Current leaf', '2', entries => entries.map(e => ({ ...e, sourceHash: hash('Different source'), text: 'Wrong translation' })))
  const current = { notes: 'Current leaf' }
  try {
    f.api.trackDatabaseTranslationFields([{ recordType: 'observation', recordId: id, fieldName: 'notes', sourceVersion: '2', target: current }])
    f.locale.value = 'ms'; await settle(() => f.requests() > 0).catch(error => { error.message += JSON.stringify(f.diagnostics); throw error }); await new Promise(resolve => setTimeout(resolve, 15))
    assert.equal(current.notes, 'Current leaf')
    current.notes = 'New local value'; f.locale.value = 'en'; assert.equal(current.notes, 'New local value')
  } finally { f.stop() }
})


test('review history comments are bound to immutable review IDs and exact comment text', async () => {
  const f=fixture('Recorded decision comment');
  const reviews=[{id:'review-one',observation_id:id,comment:'Recorded decision comment'}, {id:'review-two',observation_id:id,comment:'Earlier decision comment'}];
  try {
    f.api.trackDatabaseTranslationResponse({reviews});f.locale.value='ms';await settle(()=>reviews[0].comment==='Daun diterjemah');
    assert.equal(reviews[1].comment,'Earlier decision comment');assert.equal(f.writes(),0);
    f.locale.value='en';assert.equal(reviews[0].comment,'Recorded decision comment');
  }finally{f.stop()}
})
