import { requestPlantApi } from './plantIntegration.ts'
export interface PlantInformation {
  habitat?: string | null
  plant_scientific_name?: string | null; species_scientific_name?: string | null; plant_id: string; scientific_name: string | null; common_name: string | null; genus_name: string | null; family_name: string | null; description: string | null
}
export interface DetailLocation { latitude: number | null; longitude: number | null; accuracy_m: number | null; altitude_m: number | null; zone: string | null }
export interface DetailObservationContent extends DetailLocation {
  heightCm: number | null; healthStatus: string | null; lifeStage: string | null; morphology: string | null; notes: string | null
  taxonomy: Record<string, string>
}
export interface DetailObservation { status: string; created_at: string; content: DetailObservationContent }
export interface PlantDetail {
  information: PlantInformation
  staff: { status: string; registered_at: string; conservation_status: string | null; habitat: string | null; approved_location: DetailLocation | null
    latest_observation: DetailObservation | null; latest_approved_observation: DetailObservation | null } | null
}
export function canReadPlantDetail(user: { role: string; status: string; mustChangePassword: boolean } | null) {
  return Boolean(user && ['Conservation Officer', 'Administrator'].includes(user.role) && user.status === 'Active' && user.mustChangePassword === false)
}
export async function readPlantDetail(id: string, staff: boolean, request = requestPlantApi): Promise<PlantDetail> {
  const result = await request(`/api/data/plants/${id}/detail`)
  const information = result.information as PlantInformation | undefined
  const keys = ['plant_id', 'scientific_name', 'common_name', 'genus_name', 'family_name', 'description']
  for (const field of ['plant_scientific_name', 'species_scientific_name'])
    if (information && Object.hasOwn(information, field)) keys.push(field)
  if (!staff && information && Object.hasOwn(information, 'habitat')) keys.push('habitat')
  if (!information || information.plant_id !== id || Object.keys(information).length !== keys.length ||
    keys.some(key => !Object.hasOwn(information, key)) ||
    Object.values(information).some(value => value !== null && typeof value !== 'string') ||
    (!staff && result.staff !== null)) throw Error('The plant service returned an invalid response.')
  // The server response, in addition to verified session role, authorizes staff rendering.
  if (result.staff !== null) {
    if (!result.staff || typeof result.staff !== 'object' || Array.isArray(result.staff)) throw Error('The plant service returned an invalid response.')
    const data = result.staff as Record<string, unknown>
    if (typeof data.status !== 'string' || !['Approved', 'Pending Review', 'Rejected', 'Flagged', 'Correction Required', 'Withdrawn'].includes(data.status) || typeof data.registered_at !== 'string' || !Number.isFinite(Date.parse(data.registered_at)) ||
      ['conservation_status', 'habitat'].some(key => data[key] !== null && typeof data[key] !== 'string')) throw Error('The plant service returned an invalid response.')
    const validObservation = (value: unknown): value is DetailObservation => {
      if (value === null) return true
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false
      const observation = value as Record<string, unknown>, content = observation.content
      if (typeof observation.status !== 'string' || !['Approved', 'Pending Review', 'Rejected', 'Flagged', 'Correction Required', 'Draft', 'Withdrawn'].includes(observation.status) ||
        typeof observation.created_at !== 'string' || !Number.isFinite(Date.parse(observation.created_at)) || !content || typeof content !== 'object' || Array.isArray(content)) return false
      const fields = content as Record<string, unknown>
      if (['heightCm', 'latitude', 'longitude', 'accuracy_m', 'altitude_m'].some(key => fields[key] !== null &&
        (typeof fields[key] !== 'number' || !Number.isFinite(fields[key] as number)))) return false
      if ((fields.latitude === null) !== (fields.longitude === null) ||
        (typeof fields.latitude === 'number' && Math.abs(fields.latitude) > 90) ||
        (typeof fields.longitude === 'number' && Math.abs(fields.longitude) > 180) ||
        (typeof fields.accuracy_m === 'number' && fields.accuracy_m < 0) ||
        ['healthStatus', 'lifeStage', 'morphology', 'notes', 'zone'].some(key => fields[key] !== null && typeof fields[key] !== 'string') ||
        !fields.taxonomy || typeof fields.taxonomy !== 'object' || Array.isArray(fields.taxonomy) ||
        Object.values(fields.taxonomy as Record<string, unknown>).some(item => typeof item !== 'string')) return false
      return true
    }
    if (!Object.hasOwn(data, 'latest_observation') || !Object.hasOwn(data, 'latest_approved_observation') ||
      !validObservation(data.latest_observation) || !validObservation(data.latest_approved_observation) ||
      (data.latest_approved_observation !== null && (data.latest_approved_observation as DetailObservation).status !== 'Approved'))
      throw Error('The plant service returned an invalid response.')
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
