import { readApiResponse } from './apiResponse'

export interface Species {
  species_id: string
  scientific_name: string
  common_name: string
  genus_name?: string
  family_name?: string
  genus_id?: number
  status_id?: number
  description: string
  habitat?: string
  culturalSignificance?: string
  conservation_status?: string
  sensitivity?: string
}
export interface Observation {
  assets?:{id:string;content_type:string}[]
  id: string
  plant_id: string
  owner_subject: string
  status: string
  revision: number
  content: {
    heightCm: number
    healthStatus: string
    lifeStage: string
    morphology: string
    notes?: string
    latitude?: number
    longitude?: number
  }
}
export interface Device {
  id: string
  name: string
  status: string
  last_seen: string | null
  thresholds: Record<string, number>
}
export async function plantApi<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  if (!path.startsWith('/') || path.startsWith('//')) throw Error('Invalid API path.')
  let response: Response
  try {
    response = await fetch(`/api/data${path}`, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    })
  } catch {
    throw new Error('Unable to reach the plant data service. Please try again later.')
  }
  return readApiResponse<T>(
    response,
    'The plant data service is unavailable. Please try again later.',
  )
}
