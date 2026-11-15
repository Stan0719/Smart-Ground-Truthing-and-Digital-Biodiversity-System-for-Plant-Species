import { assetUrlFromId, webAssetUrl } from './assetImages.ts'
import type { AuthUser } from './auth.ts'

export type SpeciesVisibility = 'public' | 'internal' | 'protected'

// Only a versioned server decision backed by runtime metadata can enable writes.
// Missing fields, old responses and successful public reads all fail closed.
export function speciesPhotoWritesAvailable(value: unknown): boolean {
  const cap = record(value)
  return cap?.version === 1 && cap.activationRequested === true && cap.writesEnabled === true &&
    cap.schemaReady === true && cap.galleryAvailable === true && cap.semanticRolesAvailable === true &&
    cap.migration014 === 'verified-applied' && cap.migration015 === 'verified-applied'
}
export const canManageSpeciesPhotos = (user: AuthUser | null, pending: boolean) =>
  !pending && user?.role === 'Conservation Officer' && user.status === 'Active' && !user.mustChangePassword

export interface SpeciesGalleryImage {
  assetId: string
  url: string
  contentType: 'image/jpeg' | 'image/png'
  position: number
  eligible: boolean
}
export interface SpeciesGallerySnapshot {
  speciesId: number
  revision: number
  primaryAssetId: string | null
  images: SpeciesGalleryImage[]
  managed?: boolean
}
export interface SpeciesPhotoUpload {
  id: string
  clientKey: string
  file: File
  url: string
  status: 'queued' | 'uploading' | 'uploaded' | 'failed'
  assetId?: string
  error?: string
  removed?: boolean // Keep successful receipts until their gallery removal is committed.
}
export type SpeciesPhotoOrder = ({ assetId: string } | { queueId: string })[]
export async function readSpeciesGallery(id: string): Promise<SpeciesGallerySnapshot> {
  const value = await requestSpeciesApi(`/api/species/${encodeURIComponent(id)}/images`)
  if (value.speciesId !== Number(id) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 || !Array.isArray(value.images)) throw new Error('Invalid gallery response.')
  const images: SpeciesGalleryImage[] = value.images.map((entry: unknown) => {
    const row = record(entry), url = webAssetUrl(row?.url)
    if (!row || !url || assetUrlFromId(row.assetId) !== url || !['image/jpeg', 'image/png'].includes(String(row.contentType)) || !Number.isInteger(row.position) || typeof row.eligible !== 'boolean') throw new Error('Invalid gallery image.')
    return { assetId: String(row.assetId), url, contentType: row.contentType as SpeciesGalleryImage['contentType'], position: Number(row.position), eligible: row.eligible }
  })
  const primary = value.primaryAssetId
  if (primary !== null && (typeof primary !== 'string' || !images.some(image => image.assetId === primary))) throw new Error('Invalid primary image.')
  return { speciesId: Number(id), revision: Number(value.revision), primaryAssetId: primary, images, managed: value.managed === true }
}
async function photoWrite(url: string, method: 'POST' | 'PUT', body: unknown) {
  const response = await fetch(url, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) })
  const result = await response.json()
  if (!response.ok) throw new SpeciesApiError(result.error || 'Photo save failed.', response.status)
  return result
}
// Called only after the form's explicit frontend gate AND server capabilities pass.
// Separate commits are intentional. Receipts remain attached to files across retries.
export async function persistSpeciesPhotoBatch(id: string, baseline: SpeciesGallerySnapshot, files: SpeciesPhotoUpload[], primaryFile: string | null, arrangement: SpeciesGalleryDraft | null, current: () => boolean = () => true, photoOrder?: SpeciesPhotoOrder) {
  const assertCurrent = () => { if (!current()) throw new SpeciesApiError('The photo editing session changed.', 409) }
  assertCurrent()
  if (baseline.speciesId !== Number(id)) throw new SpeciesApiError('Gallery belongs to another species.', 409)
  const capabilities = await requestSpeciesApi('/api/species/photos/capabilities')
  assertCurrent()
  if (!speciesPhotoWritesAvailable(capabilities)) throw new SpeciesApiError('Photo management is unavailable.', 503)
  for (const entry of files) {
    assertCurrent()
    if (entry.assetId) continue
    const invalid = await validateSpeciesPhoto(entry.file)
    assertCurrent()
    if (invalid) { entry.status = 'failed'; entry.error = invalid; continue }
    entry.status = 'uploading'; entry.error = undefined
    try {
      const bytes = new Uint8Array(await entry.file.arrayBuffer())
      let binary = ''
      for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768))
      assertCurrent()
      const result = await photoWrite('/api/assets', 'POST', { species_id: Number(id), client_key: entry.clientKey, content_type: entry.file.type, base64: btoa(binary) })
      if (!assetUrlFromId(result.id)) throw new Error('Invalid upload receipt.')
      entry.assetId = result.id; entry.status = 'uploaded'
    } catch (error) { entry.status = 'failed'; entry.error = error instanceof Error ? error.message : 'Upload failed.' }
  }
  if (files.some(file => !file.assetId)) return { complete: false, snapshot: baseline }
  assertCurrent()
  const latest = await readSpeciesGallery(id)
  assertCurrent()
  const uploaded = files.map(file => file.assetId!)
  const expectedIds = new Set([...baseline.images.map(image => image.assetId), ...uploaded])
  const expectedRevision = baseline.revision + (baseline.managed ? uploaded.filter(asset => !baseline.images.some(image => image.assetId === asset)).length : 0)
  if (latest.revision !== expectedRevision || latest.images.length !== expectedIds.size || latest.images.some(image => !expectedIds.has(image.assetId))) throw new SpeciesApiError('Gallery changed. Your draft and upload receipts have been preserved.', 409)
  const removedAssetIds = [...new Set([...(arrangement?.removedAssetIds || []), ...files.filter(file => file.removed && file.assetId).map(file => file.assetId!)])]
  const orderedAssetIds = photoOrder
    ? photoOrder.map(item => 'assetId' in item ? item.assetId : files.find(file => file.id === item.queueId)?.assetId).filter((asset): asset is string => Boolean(asset))
    : [...new Set([...(arrangement?.orderedAssetIds || baseline.images.map(image => image.assetId)), ...uploaded])].filter(id => !removedAssetIds.includes(id))
  // Explicit grid order must account for every active member, including retry receipts.
  if (photoOrder && (new Set(orderedAssetIds).size !== orderedAssetIds.length || orderedAssetIds.length + removedAssetIds.length !== expectedIds.size || [...orderedAssetIds, ...removedAssetIds].some(asset => !expectedIds.has(asset)) || orderedAssetIds.some(asset => removedAssetIds.includes(asset)))) throw new SpeciesApiError('Photo order no longer matches the gallery.', 409)
  const primaryAssetId = photoOrder
    ? orderedAssetIds.find(asset => latest.images.some(image => image.assetId === asset && image.eligible)) ?? null
    : primaryFile ? files.find(file => file.id === primaryFile)?.assetId ?? null : arrangement ? arrangement.primaryAssetId : baseline.primaryAssetId
  await photoWrite(`/api/species/${encodeURIComponent(id)}/images`, 'PUT', { expectedRevision: latest.revision, orderedAssetIds, primaryAssetId, removedAssetIds })
  return { complete: true, snapshot: await readSpeciesGallery(id) }
}
export interface SpeciesGallerySave {
  expectedRevision: number
  orderedAssetIds: string[]
  primaryAssetId: string | null
  removedAssetIds: string[]
}
export interface SpeciesGalleryDraft extends SpeciesGallerySave { speciesId: number }
export function reconcileSpeciesPhotoDraft(latest: SpeciesGallerySnapshot, local: SpeciesGalleryDraft | null, files: SpeciesPhotoUpload[], keepDraft: boolean): SpeciesGalleryDraft {
  const base = createSpeciesGalleryDraft(latest)
  const active = new Set(base.orderedAssetIds), own = new Set(files.flatMap(file => file.assetId ? [file.assetId] : []))
  const removed = keepDraft ? (local?.removedAssetIds || []).filter(id => active.has(id)) : []
  const ordered = keepDraft ? (local?.orderedAssetIds || []).filter(id => active.has(id) && !removed.includes(id) && !own.has(id)) : []
  for (const id of base.orderedAssetIds) if (!ordered.includes(id) && !removed.includes(id) && !own.has(id)) ordered.push(id)
  const proposed = keepDraft ? local?.primaryAssetId : base.primaryAssetId
  const primary = proposed && !removed.includes(proposed) && latest.images.some(image => image.assetId === proposed && image.eligible) ? proposed : null
  return { ...base, orderedAssetIds: ordered, primaryAssetId: primary, removedAssetIds: removed }
}
export const createSpeciesGalleryDraft = (snapshot: SpeciesGallerySnapshot): SpeciesGalleryDraft => ({
  speciesId: snapshot.speciesId,
  expectedRevision: snapshot.revision,
  orderedAssetIds: [...snapshot.images].sort((a, b) => a.position - b.position).map(image => image.assetId),
  primaryAssetId: snapshot.primaryAssetId,
  removedAssetIds: [],
})
export function moveSpeciesPhoto(draft: SpeciesGalleryDraft, id: string, direction: -1 | 1): SpeciesGalleryDraft {
  const ids = [...draft.orderedAssetIds], index = ids.indexOf(id), target = index + direction
  if (index < 0 || target < 0 || target >= ids.length) return draft
  const adjacent = ids[target]
  if (!adjacent) return draft
  ids[index] = adjacent; ids[target] = id
  return { ...draft, orderedAssetIds: ids }
}
export const removeSpeciesPhoto = (draft: SpeciesGalleryDraft, id: string): SpeciesGalleryDraft =>
  !draft.orderedAssetIds.includes(id) ? draft : ({ ...draft,
    orderedAssetIds: draft.orderedAssetIds.filter(asset => asset !== id),
    primaryAssetId: draft.primaryAssetId === id ? null : draft.primaryAssetId,
    removedAssetIds: [...draft.removedAssetIds, id],
  })

export const SPECIES_PHOTO_MAX_BYTES = 4194304
export type SpeciesPhotoValidationError = 'emptyFile' | 'unsupportedType' | 'tooLarge' | 'invalidImage'
export async function validateSpeciesPhoto(file: File): Promise<SpeciesPhotoValidationError | null> {
  if (!file.size) return 'emptyFile'
  if (file.size > SPECIES_PHOTO_MAX_BYTES) return 'tooLarge'
  if (!['image/jpeg', 'image/png'].includes(file.type)) return 'unsupportedType'
  try {
    const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer())
    const signature = file.type === 'image/jpeg' ? [255, 216, 255] : [137, 80, 78, 71, 13, 10, 26, 10]
    return signature.every((byte, index) => bytes[index] === byte) ? null : 'invalidImage'
  } catch { return 'invalidImage' }
}

export interface ManagedSpecies {
  id: string
  scientificName: string
  commonName: string
  genusId: string
  genus: string
  family: string
  conservationStatus: string
  statusId: string
  visibility: SpeciesVisibility | ''
  description: string
  habitat: string
  culturalSignificance: string
  portraitUrl: string
}

export interface TaxonomyGenus {
  id: string
  name: string
  family: string
}

export interface SpeciesForm {
  scientificName: string
  commonName: string
  genusId: string
  conservationStatus: string
  visibility: SpeciesVisibility | ''
  description: string
  habitat: string
}

export interface SpeciesPayload {
  scientific_name: string
  common_name: string
  description: string
  visibility: SpeciesVisibility
  genus_id: number | null
  conservation_status: string
  habitat: string
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
const text = (value: unknown) =>
  typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
    ? String(value)
    : ''

export const mapManagedSpecies = (value: unknown): ManagedSpecies | null => {
  const item = record(value)
  if (!item) return null
  const id = text(item.species_id).trim()
  if (!id) return null
  const visibility = text(item.sensitivity)
  return {
    id,
    scientificName: text(item.scientific_name),
    commonName: text(item.common_name),
    genusId: text(item.genus_id),
    genus: text(item.genus_name),
    family: text(item.family_name),
    conservationStatus: text(item.conservation_status),
    statusId: text(item.status_id),
    visibility: ['public', 'internal', 'protected'].includes(visibility)
      ? (visibility as SpeciesVisibility)
      : '',
    description: text(item.description),
    habitat: text(item.habitat),
    culturalSignificance: text(item.culturalSignificance),
    portraitUrl: webAssetUrl(item.image_url) || assetUrlFromId(item.image_asset_id),
  }
}

export const mapTaxonomyGenus = (value: unknown): TaxonomyGenus | null => {
  const item = record(value)
  if (!item) return null
  const id = text(item.genus_id).trim()
  const name = text(item.genus_name).trim()
  if (!id || !name) return null
  return { id, name, family: text(item.family_name) }
}

export const validateSpeciesForm = (
  form: SpeciesForm,
  taxonomy: readonly TaxonomyGenus[],
  knownStatuses: readonly string[],
) => {
  const errors: Partial<Record<keyof SpeciesForm, string>> = {}
  if (!form.scientificName.trim()) errors.scientificName = 'Scientific name is required.'
  else if (form.scientificName.length > 200) errors.scientificName = 'Scientific name must not exceed 200 characters.'
  if (!form.commonName.trim()) errors.commonName = 'Common name is required.'
  else if (form.commonName.length > 200) errors.commonName = 'Common name must not exceed 200 characters.'
  if (!form.description.trim()) errors.description = 'Description is required.'
  else if (form.description.length > 4000) errors.description = 'Description must not exceed 4000 characters.'
  if (!['public', 'internal', 'protected'].includes(form.visibility))
    errors.visibility = 'Select a valid visibility.'
  if (form.genusId && !taxonomy.some((item) => item.id === form.genusId))
    errors.genusId = 'Select a valid genus from the taxonomy list.'
  if (
    form.conservationStatus &&
    !knownStatuses.some((item) => item.toLowerCase() === form.conservationStatus.toLowerCase())
  )
    errors.conservationStatus = 'Select a conservation status from the loaded species data.'
  if (form.habitat.length > 4000) errors.habitat = 'Text must not exceed 4000 characters.'
  return errors
}

export const speciesPayload = (form: SpeciesForm): SpeciesPayload => ({
  scientific_name: form.scientificName.trim(),
  common_name: form.commonName.trim(),
  description: form.description.trim(),
  visibility: form.visibility as SpeciesVisibility,
  genus_id: form.genusId ? Number(form.genusId) : null,
  conservation_status: form.conservationStatus.trim(),
  habitat: form.habitat.trim(),
})

export class SpeciesApiError extends Error {
  readonly status: number
  readonly kind: 'network' | 'invalid' | 'http'

  constructor(message: string, status = 0, kind: 'network' | 'invalid' | 'http' = 'http') {
    super(message)
    this.status = status
    this.kind = kind
  }
}

export async function requestSpeciesApi(
  url: string,
  options: { method?: 'POST' | 'PATCH' | 'DELETE'; body?: SpeciesPayload } = {},
): Promise<Record<string, unknown>> {
  let response: Response
  try {
    response = await fetch(url, {
      method: options.method || 'GET',
      credentials: 'same-origin',
      signal: AbortSignal.timeout(15000),
      ...(options.body
        ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options.body) }
        : {}),
    })
  } catch {
    throw new SpeciesApiError('The species service could not be reached. Please try again.', 0, 'network')
  }
  let result: Record<string, unknown> | null
  try {
    result = record(await response.json())
  } catch {
    throw new SpeciesApiError('The species service returned an invalid response.', response.status, 'invalid')
  }
  if (!response.ok) {
    const backendMessage = [result?.message, result?.error].find(
      (value): value is string => typeof value === 'string' && Boolean(value.trim()),
    )
    const fallback = response.status === 401
      ? 'Your session has expired. Please sign in again.'
      : response.status === 403
        ? 'You do not have permission to manage species.'
        : response.status === 404
          ? 'The species record is unavailable.'
          : response.status === 409
            ? 'The species conflicts with an existing or referenced record.'
            : `Species request failed (${response.status}).`
    throw new SpeciesApiError(backendMessage || fallback, response.status)
  }
  if (!result) throw new SpeciesApiError('The species service returned an invalid response.', response.status, 'invalid')
  return result
}
