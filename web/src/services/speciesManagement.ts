export type SpeciesVisibility = 'public' | 'internal' | 'protected'

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
  culturalSignificance: string
}

export interface SpeciesPayload {
  scientific_name: string
  common_name: string
  description: string
  visibility: SpeciesVisibility
  genus_id: number | null
  conservation_status: string
  habitat: string
  culturalSignificance: string
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
  for (const field of ['habitat', 'culturalSignificance'] as const)
    if (form[field].length > 4000) errors[field] = 'Text must not exceed 4000 characters.'
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
  culturalSignificance: form.culturalSignificance.trim(),
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
