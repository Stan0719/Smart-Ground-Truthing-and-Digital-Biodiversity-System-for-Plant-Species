import { plantApi, type Device } from './plantApi.ts'
export const KEEP_ASSIGNMENT = '__keep_current__'
export const PLANT_CATALOGUE_LIMIT = 500
export type Assignment = { state: 'assigned'; id: string } | { state: 'notLinked' | 'unavailable'; id: null }
export interface AssignmentPlant { id: string; label: string }
export function plantId(value: unknown): string | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^[1-9][0-9]{0,9}$/.test(value) ? Number(value) : NaN
  return Number.isSafeInteger(number) && number > 0 && number <= 2147483647 ? String(number) : null
}
export const plantLabel = (id: string) => `PL${id.padStart(3, '0')}`
export const deviceType = (device: Device) => device.device_type === 'Sensor' || device.device_type === 'Camera' ? device.device_type : 'Unknown'
export function currentAssignment(device?: Device | null): Assignment {
  if (device?.plant_id === null) return { state: 'notLinked', id: null }
  const id = plantId(device?.plant_id)
  return id ? { state: 'assigned', id } : { state: 'unavailable', id: null }
}
function option(value: unknown): AssignmentPlant | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid Plant response')
  const row = value as Record<string, unknown>, id = plantId(row.plant_id)
  if (!id || typeof row.rbac_status !== 'string') throw Error('Invalid Plant response')
  if (row.rbac_status !== 'Approved') return null
  const name = typeof row.scientific_name === 'string' && row.scientific_name.trim() ? row.scientific_name.trim() : ''
  return { id, label: plantLabel(id) + (name ? ` · ${name}` : '') }
}
export async function loadAssignmentPlants(api = plantApi) {
  const result = await api<{ plants: unknown[] }>('/plants')
  if (!Array.isArray(result.plants) || result.plants.length > PLANT_CATALOGUE_LIMIT) throw Error('Invalid Plant response')
  return { plants: result.plants.map(option).filter((p): p is AssignmentPlant => p !== null), capped: result.plants.length === PLANT_CATALOGUE_LIMIT }
}
export async function findAssignmentPlant(query: string, api = plantApi) {
  const raw = query.trim().replace(/^PL/i, ''), id = /^\d+$/.test(raw) ? plantId(Number(raw)) : null
  if (!id) throw Error('Invalid Plant ID')
  const result = await api<{ plant: unknown }>(`/plants/${id}`), plant = option(result.plant)
  if (!plant || plant.id !== id) throw Error('Approved Plant unavailable')
  return plant
}
export function assignmentPayload(value: string, editing: boolean): { plant_id?: number | null } {
  if (editing && value === KEEP_ASSIGNMENT) return {}
  if (value === '') return { plant_id: null }
  const id = plantId(value)
  if (!id) throw Error('Invalid Plant ID')
  return { plant_id: Number(id) }
}
