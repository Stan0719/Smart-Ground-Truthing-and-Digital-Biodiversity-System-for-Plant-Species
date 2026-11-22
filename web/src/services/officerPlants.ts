import { createReviewRequest } from './observationReview'
export interface RegistryPlant { id: string; species_id: string; scientific_name: string; species_scientific_name: string; common_name: string | null; status: 'Approved'; registered_at: string; registration_id: string | null; has_location: boolean; qr_id: string | null; qr_status: string | null }
export interface RegistryPage { plants: RegistryPlant[]; species: { id: string; name: string }[]; page: { limit: number; has_more: boolean; next_cursor: string | null } }
export async function readOfficerPlants(filters: { q: string; species: string }, cursor: string | null, signal: AbortSignal): Promise<RegistryPage> {
  const query = new URLSearchParams(filters)
  if (cursor) query.set('cursor', cursor)
  const result = await createReviewRequest(() => 'Plant registry unavailable', fetch)('/api/data/officer/plants?' + query, undefined, { signal, retry: true }) as unknown as RegistryPage
  if (!Array.isArray(result.plants) || result.plants.length > 25 || !Array.isArray(result.species) || result.page?.limit !== 25 || typeof result.page.has_more !== 'boolean' ||
    (result.page.has_more ? typeof result.page.next_cursor !== 'string' || !result.page.next_cursor : result.page.next_cursor !== null) ||
    result.species.some(row => !row || !/^[1-9]\d*$/.test(row.id) || typeof row.name !== 'string') ||
    result.plants.some(row => !row || !/^[1-9]\d*$/.test(row.id) || !/^[1-9]\d*$/.test(row.species_id) || typeof row.scientific_name !== 'string' || typeof row.species_scientific_name !== 'string' || (row.common_name !== null && typeof row.common_name !== 'string') || row.status !== 'Approved' || !Number.isFinite(Date.parse(row.registered_at)) || typeof row.has_location !== 'boolean' || (row.qr_id !== null && !/^[1-9]\d*$/.test(row.qr_id)) || (row.qr_status !== null && typeof row.qr_status !== 'string') || (row.registration_id !== null && typeof row.registration_id !== 'string'))) throw Error('Invalid registry response')
  return result
}
