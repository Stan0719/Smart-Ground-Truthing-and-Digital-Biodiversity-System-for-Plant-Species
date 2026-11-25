import { api } from './auth'
import { plantApi } from './plantApi'

export interface OverviewUser { id: string; role: string }
export interface OverviewDevice {
  id: string; plant_id?: string | number | null; status: string; last_seen: string | null
  latest_reading?: { values: Record<string, number>; created_at: string } | null
}
export interface OverviewAlert { id: string; device_id: string; metric: string; status: string; created_at: string }
export interface OverviewEvent { id: number; reason: string; created_at: string | number }
export interface OverviewData {
  users: OverviewUser[] | null; devices: OverviewDevice[] | null; alerts: OverviewAlert[] | null
  events: OverviewEvent[] | null; totals: { plants: number; alerts: number } | null
}
export const emptyOverview = (): OverviewData => ({ users: null, devices: null, alerts: null, events: null, totals: null })
function collection<T>(value: unknown): T[] {
  if (!Array.isArray(value)) throw Error('Invalid dashboard response.')
  return value as T[]
}
export async function loadOverview(): Promise<OverviewData> {
  const result = emptyOverview()
  await Promise.allSettled([
    api<{ users: OverviewUser[] }>('/admin/users').then(r => { result.users = collection(r.users) }),
    plantApi<{ devices: OverviewDevice[] }>('/devices').then(r => { result.devices = collection(r.devices) }),
    plantApi<{ alerts: OverviewAlert[] }>('/alerts').then(r => { result.alerts = collection(r.alerts) }),
    api<{ events: OverviewEvent[] }>('/admin/audit').then(r => { result.events = collection(r.events) }),
    plantApi<{ overview: { plants: number; alerts: number } }>('/admin/overview').then(r => {
      if (![r.overview?.plants, r.overview?.alerts].every(n => Number.isSafeInteger(n) && n >= 0)) throw Error('Invalid dashboard totals.')
      result.totals = r.overview
    }),
  ])
  return result
}
export function overviewDate(value: string | number | null | undefined) {
  if (value == null || value === '') return '—'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuching', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date)
}
export function accountSummary(users: OverviewUser[] | null) {
  if (!users) return null
  const unique = [...new Map(users.map(u => [u.id, u])).values()]
  return { total: unique.length, roles: new Set(unique.map(u => u.role)).size, users: unique }
}
