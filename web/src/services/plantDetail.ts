import { requestPlantApi } from './plantIntegration.ts'
export interface PlantInformation {
  plant_id: string; scientific_name: string | null; common_name: string | null; genus_name: string | null; family_name: string | null; description: string | null
}
export interface DetailLocation { latitude: number | null; longitude: number | null; accuracy_m: number | null; altitude_m: number | null; zone: string | null }
export interface PlantDetail {
  information: PlantInformation
  staff: { status: string; registered_at: string; conservation_status: string | null; habitat: string | null; approved_location: DetailLocation | null } | null
}
export function canReadPlantDetail(user: { role: string; status: string; mustChangePassword: boolean } | null) {
  return Boolean(user && ['Conservation Officer', 'Administrator'].includes(user.role) && user.status === 'Active' && user.mustChangePassword === false)
}
export async function readPlantDetail(id: string, staff: boolean, request = requestPlantApi): Promise<PlantDetail> {
  const result = await request(`/api/data/plants/${id}/detail`)
  const information = result.information as PlantInformation | undefined
  const keys = ['plant_id', 'scientific_name', 'common_name', 'genus_name', 'family_name', 'description']
  if (!information || information.plant_id !== id || Object.keys(information).length !== keys.length ||
    keys.some(key => !Object.hasOwn(information, key)) ||
    Object.values(information).some(value => value !== null && typeof value !== 'string') ||
    (!staff && result.staff !== null)) throw Error('The plant service returned an invalid response.')
  // The server response, in addition to verified session role, authorizes staff rendering.
  if (result.staff !== null) {
    if (!result.staff || typeof result.staff !== 'object' || Array.isArray(result.staff)) throw Error('The plant service returned an invalid response.')
    const data = result.staff as Record<string, unknown>
    if (!['Approved', 'Pending Review', 'Rejected'].includes(String(data.status)) || typeof data.registered_at !== 'string' || !Number.isFinite(Date.parse(data.registered_at)) ||
      ['conservation_status', 'habitat'].some(key => data[key] !== null && typeof data[key] !== 'string')) throw Error('The plant service returned an invalid response.')
    if (data.approved_location !== null) {
      const location = data.approved_location as Record<string, unknown> | undefined
      if (!location || typeof location !== 'object' || Array.isArray(location) ||
        ['latitude', 'longitude', 'accuracy_m', 'altitude_m'].some(key => location[key] !== null && (typeof location[key] !== 'number' || !Number.isFinite(location[key]))) ||
        typeof location.latitude !== 'number' || Math.abs(location.latitude) > 90 || typeof location.longitude !== 'number' || Math.abs(location.longitude) > 180 ||
        (typeof location.accuracy_m === 'number' && location.accuracy_m < 0) || (location.zone !== null && typeof location.zone !== 'string')) throw Error('The plant service returned an invalid response.')
    }
  }
  return { information, staff: result.staff as PlantDetail['staff'] }
}
