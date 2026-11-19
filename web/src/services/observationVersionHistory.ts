import { assetUrlFromId } from './assetImages.ts'

export type ObservationHistoricalVersion = {
  key: string; id: string; observationId: string; ordinal: number | null; status: string
  content: Record<string, unknown> | null; photos: string[]; createdAt: string; reviewedAt: string; reviewer: string; reviewComment: string; reviewable: false
  plantSpecies?: Record<string, unknown>
}
const object = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
export async function loadObservationVersionHistory(observationId: string, plantId: string, origin: string, transport: typeof fetch = fetch) {
  if (origin !== 'initial_registration') return { available: false, versions: [] as ObservationHistoricalVersion[] }
  if (!observationId || !/^[1-9]\d*$/.test(plantId)) throw Error('Invalid history target')
  const response = await transport('/api/data/record-versions?kind=plant&id=' + encodeURIComponent(plantId), { credentials: 'same-origin', signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw Error('History unavailable')
  const payload = object(await response.json())
  if (payload?.history_available === false) return { available: false, versions: [] as ObservationHistoricalVersion[] }
  if (payload?.history_available !== true || !Array.isArray(payload.versions)) throw Error('Invalid history response')
  const versions: ObservationHistoricalVersion[] = []
  for (const value of payload.versions) {
    const row = object(value), snapshot = object(row?.snapshot)
    // Exclude approved-edit proposals and append-only approval captures. Never reconstruct a missing original.
    if (!row || row.record_type !== 'plant' || String(row.plant_id) !== plantId || row.change_id != null ||
        snapshot?.observation_id !== observationId || snapshot.review_provenance != null) continue
    if (typeof row.id !== 'string' || !row.id || (row.version_number != null && (!Number.isSafeInteger(row.version_number) || Number(row.version_number) < 1)) ||
        !['Pending Review','Superseded','Correction Required','Approved','Rejected','Flagged','Withdrawn'].includes(String(row.status))) throw Error('Invalid historical identity')
    const photoIds = Array.isArray(snapshot.photo_ids) ? snapshot.photo_ids : []
    versions.push({ key: 'record-version:' + row.id, id: row.id, observationId, ordinal: row.version_number == null ? null : Number(row.version_number), status: String(row.status),
      content: object(snapshot.content), photos: photoIds.flatMap(id => { const url = assetUrlFromId(id); return url ? [url] : [] }),
      createdAt: typeof row.created_at === 'string' ? row.created_at : '',
      reviewedAt: typeof row.reviewed_at === 'string' ? row.reviewed_at : '', reviewer: typeof row.reviewed_by === 'string' ? row.reviewed_by : '',
      reviewComment: typeof row.review_comment === 'string' ? row.review_comment : '', reviewable: false })
    // Only saved, allowlisted context; never substitute current catalogue values
    // or expose operational QR tokens from the broader history snapshot.
    versions[versions.length - 1]!.plantSpecies = Object.fromEntries(['plant_id','scientific_name','species_id','species_scientific_name','common_name'].filter(key => Object.hasOwn(snapshot,key)).map(key => [key,snapshot[key]]))
  }
  if (new Set(versions.map(row => row.key)).size !== versions.length) throw Error('Duplicate historical identity')
  return { available: true, versions }
}
