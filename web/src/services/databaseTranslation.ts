import { reactive, watch } from 'vue'
import { i18n, type SupportedLocale } from '../i18n'

type RecordType = 'species' | 'observation' | 'review' | 'review-comment'
type FieldName = 'description' | 'habitat' | 'culturalSignificance' | 'morphology' | 'notes' | 'comment'
type Entry = { recordType: RecordType; recordId: string; fieldName: FieldName }
type WeakTarget<T extends object> = { deref(): T | undefined }
type TrackedField = Entry & { target: WeakTarget<Record<string, unknown>>; targetField: string; source: string }
type TranslationResponse = { locale?: string; translations?: Array<Entry & { text: string }> }

const fields = new Set<TrackedField>()
const maxTrackedFields = 4000
const maxFieldsPerLocaleRefresh = 20
let localeGeneration = 0
let translationLocale = String(i18n.global.locale.value)
let activeRefresh: { locale: string; generation: number; controller: AbortController; rerun: boolean } | null = null
let scheduled: number | undefined
const attemptedByLocale = new Set<string>()
const localizedByEntry = new Map<string, { source: string; text: string }>()

function translationDiagnostic(event: string, detail: Record<string, unknown> = {}) {
  console.info('[database-translation]', { event, ...detail })
}

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
const weakTarget = (target: Record<string, unknown>): WeakTarget<Record<string, unknown>> =>
  new (globalThis as unknown as { WeakRef: new (value: Record<string, unknown>) => WeakTarget<Record<string, unknown>> }).WeakRef(target)
const entryKey = (entry: Entry) => `${entry.recordType}\u0000${entry.recordId}\u0000${entry.fieldName}`

function collectTargets(root: unknown) {
  const targets: Array<{ entry: Entry; target: Record<string, unknown>; key: string }> = []
  const visited = new WeakSet<object>()
  const add = (target: Record<string, unknown>, recordType: RecordType, recordId: unknown, fieldName: FieldName, targetField: string = fieldName) => {
    if ((typeof recordId !== 'string' && typeof recordId !== 'number') || !String(recordId).trim()) return
    if (typeof target[targetField] !== 'string' || !(target[targetField] as string).trim()) return
    const entry = { recordType, recordId: String(recordId), fieldName }
    targets.push({ entry, target, key: `${entryKey(entry)}\u0000${targets.length}` })
  }
  const walk = (value: unknown, parentObservationId?: unknown) => {
    if (Array.isArray(value)) { value.forEach((item) => walk(item, parentObservationId)); return }
    const row = object(value)
    if (!row || visited.has(row)) return
    visited.add(row)
    if (row.species_id !== undefined) {
      add(row, 'species', row.species_id, 'description')
      add(row, 'species', row.species_id, 'habitat')
      add(row, 'species', row.species_id, 'culturalSignificance')
    }
    const content = object(row.content)
    const observationId = row.id ?? row.observation_id
    if (content && observationId !== undefined) {
      add(content, 'observation', observationId, 'morphology')
      add(content, 'observation', observationId, 'notes')
    }
    if (row.observation_id !== undefined && row.id !== undefined && typeof row.comment === 'string')
      add(row, 'review', row.id, 'comment')
    else if (row.id !== undefined && typeof row.review_comment === 'string')
      add(row, 'review-comment', row.id, 'comment', 'review_comment')
    if (parentObservationId !== undefined && typeof row.comment === 'string' && row.observation_id === undefined)
      add(row, 'review-comment', parentObservationId, 'comment')
    for (const [key, child] of Object.entries(row)) {
      if (key === 'content' || key === 'review' || key === 'assets' || key === 'image' || key === 'photo') {
        if (key === 'review') walk(child, row.id ?? row.observation_id ?? parentObservationId)
        continue
      }
      if (Array.isArray(child)) child.forEach((item) => walk(item, parentObservationId))
      else if (object(child)) walk(child, parentObservationId)
    }
  }
  walk(root)
  return targets
}

function applyOriginals() {
  for (const field of fields) {
    const target = field.target.deref()
    if (target) target[field.targetField] = field.source
    else fields.delete(field)
  }
}

function currentTargets() {
  const indexed = new Map<string, TrackedField[]>()
  for (const field of fields) {
    const target = field.target.deref()
    if (!target) { fields.delete(field); continue }
    const key = entryKey(field)
    indexed.set(key, [...(indexed.get(key) || []), field])
  }
  return indexed
}

async function runLocaleRefresh(state: NonNullable<typeof activeRefresh>) {
  const { locale, generation, controller } = state
  const current = () => generation === localeGeneration && !controller.signal.aborted && i18n.global.locale.value === locale
  try {
    while (current()) {
      const indexed = currentTargets()
      const pending = [...indexed.entries()].filter(([key]) => !attemptedByLocale.has(`${generation}\u0000${key}`))
      if (!pending.length) {
        if (state.rerun) { state.rerun = false; continue }
        break
      }
      const batch = pending.slice(0, maxFieldsPerLocaleRefresh)
      const entries = batch.map(([, items]) => {
        const { recordType, recordId, fieldName } = items[0]!
        return { recordType, recordId, fieldName }
      })
      for (const [key] of batch) attemptedByLocale.add(`${generation}\u0000${key}`)
      translationDiagnostic('request-start', { locale, entries })
      const response = await fetch('/api/data/website/translations', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale, entries }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180000)]),
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) translationDiagnostic('request-network-failure', { locale, name: error instanceof Error ? error.name : 'Error' })
        return null
      })
      if (!current()) {
        if (controller.signal.aborted) translationDiagnostic('request-canceled', { locale, reason: 'locale-or-route-changed' })
        return
      }
      if (!response?.ok) {
        translationDiagnostic('request-rejected', { locale, status: response?.status ?? 'network-error' })
        continue
      }
      const body = await response.json().catch(() => null) as TranslationResponse | null
      if (!current() || body?.locale !== locale || !Array.isArray(body.translations)) {
        translationDiagnostic('response-ignored', { locale, reason: 'stale-or-invalid-response' })
        continue
      }
      let applied = 0
      for (const translation of body.translations) {
        if (typeof translation.text !== 'string' || !translation.text.trim()) continue
        const key = entryKey(translation)
        const source = batch.find(([candidate]) => candidate === key)?.[1]?.[0]?.source
        if (source !== undefined) localizedByEntry.set(key, { source, text: translation.text })
        for (const item of currentTargets().get(key) || []) {
          const target = item.target.deref()
          if (target && target[item.targetField] === item.source) {
            target[item.targetField] = translation.text
            applied++
          }
        }
      }
      translationDiagnostic('response-applied', { locale, returned: body.translations.length, targetsUpdated: applied })
      state.rerun = false
    }
  } finally {
    if (activeRefresh === state) activeRefresh = null
  }
}

function startLocaleRefresh(locale: string, reason: 'locale-change' | 'new-fields') {
  if (locale !== 'en' && locale !== 'ms' && locale !== 'zh-CN') return
  if (activeRefresh?.locale === locale && activeRefresh.generation === localeGeneration) {
    activeRefresh.rerun = true
    return
  }
  if (locale !== translationLocale) {
    translationLocale = locale
    localeGeneration++
    activeRefresh?.controller.abort()
    activeRefresh = null
    attemptedByLocale.clear()
    localizedByEntry.clear()
    applyOriginals()
  }
  if (locale === 'en') {
    translationDiagnostic('locale-source-displayed', { locale, reason })
    return
  }
  const state = { locale, generation: localeGeneration, controller: new AbortController(), rerun: false }
  activeRefresh = state
  void runLocaleRefresh(state)
}

function scheduleRefresh() {
  if (scheduled !== undefined) window.clearTimeout(scheduled)
  scheduled = window.setTimeout(() => {
    scheduled = undefined
    startLocaleRefresh(String(i18n.global.locale.value), 'new-fields')
  }, 80)
}

function registerField(entry: Entry, targetValue: Record<string, unknown>, targetField: string, source: string) {
  const target = reactive(targetValue)
  const existing = [...fields].some((field) => field.target.deref() === target && field.targetField === targetField)
  if (!existing) {
    fields.add({ ...entry, target: weakTarget(target), targetField, source })
    const cached = localizedByEntry.get(entryKey(entry))
    if (i18n.global.locale.value !== 'en' && cached?.source === source) target[targetField] = cached.text
  }
}

watch(() => String(i18n.global.locale.value), (locale) => {
  startLocaleRefresh(locale, 'locale-change')
}, { flush: 'sync' })

export function trackDatabaseTranslationResponse<T>(value: T): T {
  const source = object(value) || (Array.isArray(value) ? value : null)
  if (!source) return value
  const reactiveValue = reactive(source)
  for (const item of collectTargets(reactiveValue)) {
    const targetField = item.entry.fieldName === 'comment' && typeof item.target.review_comment === 'string' ? 'review_comment' : item.entry.fieldName
    registerField(item.entry, item.target, targetField, item.target[targetField] as string)
  }
  while (fields.size > maxTrackedFields) fields.delete(fields.values().next().value!)
  if (i18n.global.locale.value !== 'en') scheduleRefresh()
  return reactiveValue as T
}

export function trackDatabaseTranslationFields(
  fieldsToTrack: Array<{ recordType: RecordType; recordId: string | number; fieldName: FieldName; target: object; targetField?: string }>,
) {
  for (const item of fieldsToTrack) {
    const targetField = item.targetField || item.fieldName
    const target = item.target as Record<string, unknown>
    const source = target[targetField]
    if (typeof source !== 'string' || !source.trim()) continue
    registerField({ recordType: item.recordType, recordId: String(item.recordId), fieldName: item.fieldName }, target, targetField, source)
  }
  while (fields.size > maxTrackedFields) fields.delete(fields.values().next().value!)
  if (i18n.global.locale.value !== 'en') scheduleRefresh()
}

export function clearDatabaseTranslationTargets() {
  localeGeneration++
  activeRefresh?.controller.abort()
  activeRefresh = null
  translationLocale = String(i18n.global.locale.value)
  attemptedByLocale.clear()
  localizedByEntry.clear()
  if (scheduled !== undefined) window.clearTimeout(scheduled)
  scheduled = undefined
  fields.clear()
}

export function supportedDatabaseLocale(locale: string): locale is SupportedLocale {
  return locale === 'en' || locale === 'ms' || locale === 'zh-CN'
}
