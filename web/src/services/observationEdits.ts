import type { RecordChange } from './recordChanges'
export type ObservationEdit = RecordChange & { observation_edit: { observation_id: string; base_revision: number; retained_photo_ids: string[]; current: Record<string, unknown> } }
export interface ObservationEditQueueState { rows: ObservationEdit[]; names: Record<string,string>; loading: boolean; error: string }
export class ObservationEditEvidenceError extends Error {
  constructor() { super('Observation edit photo evidence is invalid.'); this.name = 'ObservationEditEvidenceError' }
}
const plantId = (value: unknown): number => {
  if ((typeof value !== 'number' && (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value))) ||
      !Number.isSafeInteger(Number(value)) || Number(value) < 1) throw Error('Invalid Observation target')
  return Number(value)
}
export class ObservationEditCapabilityError extends Error {}
export class ObservationEditQueueLimitError extends Error { constructor() { super('Observation Edit Request queue reached its 500-row safety limit') } }
export class ObservationEditError extends Error { status: number; constructor(status: number) { super('Observation edit request failed'); this.status = status } }
export async function observationEditRequest(path: string, body?: object): Promise<Record<string, unknown>> {
  const response = await fetch('/api/data' + path, { credentials: 'same-origin', signal: AbortSignal.timeout(15000),
    ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  if (!response.ok) {
    if (response.status === 409) {
      const body = await response.json().catch(() => null)
      if (typeof body?.error === 'string' && body.error.startsWith('Observation edit photo evidence is invalid.')) throw new ObservationEditEvidenceError()
    }
    throw new ObservationEditError(response.status)
  }
  return response.json()
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid Observation edit response')
  return value as Record<string, unknown>
}
export async function mapObservationEdit(value: unknown, read = observationEditRequest): Promise<ObservationEdit> {
  const row = object(value)
  if (typeof row.id !== 'string' || !row.id || typeof row.observation_id !== 'string' || !row.observation_id ||
      typeof row.owner_subject !== 'string' || !Number.isSafeInteger(row.revision) || Number(row.revision) < 1 ||
      !['Pending Review','Correction Required','Approved','Rejected','Cancelled','Withdrawn','Superseded'].includes(String(row.status)) ||
      !Number.isFinite(Date.parse(String(row.created_at)))) throw Error('Invalid Observation edit response')
  const current = object((await read('/observations/' + encodeURIComponent(row.observation_id))).observation)
  if (current.owner_subject !== row.owner_subject || current.id !== row.observation_id) throw Error('Invalid Observation target')
  const normalizedPlantId = plantId(current.plant_id)
  object(current.content)
  const base = object(row.base_snapshot), content = object(row.proposed_content)
  object(base.content)
  const photoIds = (value: unknown) => Array.isArray(value) && value.every(id => typeof id === 'string' && id.length > 0)
  if (!photoIds(row.retained_photo_ids) || (base.photo_ids !== undefined && !photoIds(base.photo_ids))) throw new ObservationEditEvidenceError()
  if (!Number.isSafeInteger(row.base_revision) || Number(row.base_revision) < 1 || !Number.isSafeInteger(row.added_photo_count) || Number(row.added_photo_count) < 0 || Number(row.added_photo_count) > 3) throw Error('Invalid Observation evidence')
  return { id: row.id, plant_id: normalizedPlantId, species_id: null, owner_subject: row.owner_subject,
    revision: Number(row.revision), status: row.status as RecordChange['status'], created_at: String(row.created_at),
    base_snapshot: { ...base, scientific_name: current.scientific_name, species_id: current.species_id },
    proposed_snapshot: { content, photo_ids: row.retained_photo_ids, scientific_name: current.scientific_name, species_id: current.species_id },
    proposal_photo_count: Number(row.added_photo_count), review_comment: typeof row.review_comment === 'string' ? row.review_comment : null,
    reviewed_by: typeof row.reviewed_by === 'string' ? row.reviewed_by : null, reviewed_at: typeof row.reviewed_at === 'string' ? row.reviewed_at : null,
    observation_edit: { observation_id: row.observation_id, base_revision: Number(row.base_revision), retained_photo_ids: row.retained_photo_ids as string[], current } }
}
export async function loadObservationEditQueue(read = observationEditRequest, current = () => true): Promise<ObservationEdit[]> {
  const capability = await read('/observation-edits/capabilities')
  if (!current()) return []
  if (capability.available === false) return []
  if (capability.available !== true || capability.versioning_available !== false) throw new ObservationEditCapabilityError('Unsupported Observation edit capability')
  const payload = await read('/observation-edits')
  if (!Array.isArray(payload.edits)) throw Error('Invalid Observation edit queue')
  if (payload.edits.length >= 500) throw new ObservationEditQueueLimitError()
  const rows: ObservationEdit[] = []
  for (const value of payload.edits) { if (!current()) return []; rows.push(await mapObservationEdit(value, read)) }
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw Error('Duplicate Observation edit identity')
  return current() ? rows : []
}

// Destinations use only authenticated canonical origin; unknown origins retain explicit compatibility details.
export function observationEditDestination(id: string, origin: unknown) {
  return { name: origin === 'subsequent_observation' ? 'conservation-observations' : 'conservation-reviews', query: { observationEdit: id } }
}
