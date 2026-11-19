import { formatPlantId } from '../utils/plantId.ts'
export interface RecordChange {
  observation_edit?: { observation_id: string; base_revision: number; retained_photo_ids: string[]; current: Record<string, unknown> }
  id: string; plant_id: number | null; species_id: number | null; owner_subject: string
  status: 'Pending Review' | 'Correction Required' | 'Approved' | 'Rejected' | 'Cancelled'; revision: number; created_at: string
  base_snapshot: Record<string, unknown>; proposed_snapshot: Record<string, unknown>
  proposal_photo_count: number; review_comment: string | null; reviewed_by: string | null; reviewed_at: string | null
}
export const changeApi = '/api/data/record-changes'
export async function changeRequest(path = '', body?: object) {
  const response = await fetch(changeApi + path, { credentials: 'same-origin', signal: AbortSignal.timeout(15000),
    ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  const data = await response.json()
  if (!response.ok) throw Object.assign(Error(response.status === 409 ? 'This proposal was already reviewed or its approved base changed. Reload the latest proposal before continuing.' : 'Unable to load or save the proposal.'), { status: response.status })
  return data
}
// Comparison only: canonical payloads and review requests are never normalized.
export function comparisonEqual(left: unknown, right: unknown, field = ''): boolean {
  if (Object.is(left,right)) return true
  const numeric = new Set(['heightCm','height_cm','latitude','longitude','accuracy_m','altitudeM','species_id','qr_id'])
  if (numeric.has(field) && left !== null && right !== null && left !== undefined && right !== undefined &&
    typeof left !== 'boolean' && typeof right !== 'boolean' && String(left).trim() !== '' && String(right).trim() !== '' &&
    Number.isFinite(Number(left)) && Number.isFinite(Number(right))) return Number(left) === Number(right)
  if (typeof left === 'string' && typeof right === 'string') return left.replaceAll('\r\n','\n') === right.replaceAll('\r\n','\n')
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object' || Array.isArray(left) !== Array.isArray(right)) return false
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b,key) && comparisonEqual(a[key],b[key]))
}
export function compareChange(change: RecordChange) {
  const flatten = (snapshot: Record<string, unknown>) => {
    const { content, ...rest } = snapshot
    return { ...rest, ...(content && typeof content === 'object' ? content : {}) } as Record<string, unknown>
  }
  const before = flatten(change.base_snapshot), after = flatten(change.proposed_snapshot)
  const hidden = new Set(['plant_id','request_id','observation_id','observation_revision','photo_ids','photo','photos','photo_fingerprint','species_version','photo_refs'])
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => !hidden.has(key)).map(key => ({
    key, before: before[key], after: Object.hasOwn(after,key) ? after[key] : before[key],
    changed: !comparisonEqual(before[key], Object.hasOwn(after,key) ? after[key] : before[key],key),
  }))
}

// Exhaust each source before combining it. Never sort two partial pages as a complete queue.
export async function readCompleteQueue<T>(read: (cursor: string | null) => Promise<{ rows: T[]; more: boolean; cursor: string | null }>, current: () => boolean = () => true): Promise<T[]> {
  const rows: T[] = [], seen = new Set<string>()
  let cursor: string | null = null
  for (let pages = 0; pages < 1000; pages++) {
    if (!current()) return []
    const page = await read(cursor)
    if (!current()) return []
    rows.push(...page.rows)
    if (!page.more) return rows
    if (!page.cursor || seen.has(page.cursor)) throw Error('Incomplete submission queue: invalid continuation.')
    seen.add(page.cursor); cursor = page.cursor
  }
  throw Error('Submission queue is too large to load completely. Narrower server-side queue support is required.')
}
export function changeSpeciesId(change: RecordChange): string {
  return String(change.plant_id ? change.proposed_snapshot.species_id ?? change.base_snapshot.species_id ?? '' : change.species_id ?? '')
}
export function changeZone(change: RecordChange): string {
  if (!change.plant_id) return ''
  const proposed = change.proposed_snapshot.content as Record<string, unknown> | undefined
  const base = change.base_snapshot.content as Record<string, unknown> | undefined
  const zone = proposed && Object.hasOwn(proposed, 'zone') ? proposed.zone : base?.zone
  return typeof zone === 'string' ? zone : ''
}
// Numeric queries match complete identifiers, never incidental UUID/name substrings.
export function submissionSearchMatches(query: string, numericIds: unknown[], identifiers: unknown[], text: unknown[]) {
  const normalize = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
  const needle = normalize(query)
  if (!needle) return true
  if (/^\d+$/.test(needle)) return numericIds.some(value => /^\d+$/.test(String(value ?? '')) && String(value).replace(/^0+(?=\d)/, '') === needle.replace(/^0+(?=\d)/, ''))
  if (/^pl\d+$/.test(needle)) return identifiers.some(value => normalize(value) === needle)
  const compact = /^(obs|change)-/.test(needle) ? needle.replaceAll('-', '') : ''
  return identifiers.some(value => normalize(value).includes(needle) || (compact && normalize(value).replaceAll('-', '').includes(compact))) || text.some(value => normalize(value).includes(needle))
}
export function changeMatches(change: RecordChange, filter: { search: string; status: string; species: string; date: string }, dateKey: (value: string) => string, display: { identifiers?: unknown[]; text?: unknown[] } = {}) {
  const matchesSearch = submissionSearchMatches(filter.search, [change.plant_id, change.id, change.observation_edit?.observation_id],
    [change.id, `CHANGE-${change.id}`, change.observation_edit?.observation_id, change.observation_edit ? `OBS-${change.observation_edit.observation_id}` : '', change.plant_id ? formatPlantId(change.plant_id) : '', change.owner_subject, ...(display.identifiers || [])],
    [change.base_snapshot.scientific_name, change.proposed_snapshot.scientific_name, change.base_snapshot.species_scientific_name, change.proposed_snapshot.species_scientific_name, change.status, change.plant_id ? 'Plant Edit' : 'Species Edit', changeZone(change), ...(display.text || [])])
  return matchesSearch && (!filter.status || change.status === filter.status) &&
    (!filter.species || changeSpeciesId(change) === filter.species) && (!filter.date || dateKey(change.created_at) === filter.date)
}
export type UnifiedReviewRow<T> = { kind: 'initial_registration' | 'linked_species_request' | 'legacy_observation'; key: string; observation: T; createdAt: string } |
  { kind: 'approved_plant_change' | 'approved_species_change' | 'observation_edit'; key: string; change: RecordChange; createdAt: string }
export function unifiedReviewRows<T extends { id: string; createdAt: string; speciesRequest: unknown; origin?: string }>(observations: T[], changes: RecordChange[]): UnifiedReviewRow<T>[] {
  const rows: UnifiedReviewRow<T>[] = [
    ...observations.map(observation => ({ kind: observation.origin === 'unknown' ? 'legacy_observation' as const : observation.speciesRequest ? 'linked_species_request' as const : 'initial_registration' as const, key: 'observation:' + observation.id, observation, createdAt: observation.createdAt })),
    ...changes.map(change => ({ kind: change.observation_edit ? 'observation_edit' as const : change.plant_id ? 'approved_plant_change' as const : 'approved_species_change' as const, key: (change.observation_edit ? 'observation-edit:' : 'change:') + change.id, change, createdAt: change.created_at })),
  ]
  return [...new Map(rows.map(row => [row.key,row])).values()].sort((a,b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0) || a.key.localeCompare(b.key))
}
