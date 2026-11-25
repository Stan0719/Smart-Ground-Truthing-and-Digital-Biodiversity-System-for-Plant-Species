export type RelativeAge = { key: string; params?: Record<string, number> }

export function relativeReadingAge(timestamp: string | null | undefined, now = Date.now()): RelativeAge | null {
  if (!timestamp) return null
  const parsed = Date.parse(timestamp)
  if (!Number.isFinite(parsed)) return null
  const minutes = Math.max(0, Math.floor((now - parsed) / 60_000))
  if (minutes < 1) return { key: 'justNow' }
  if (minutes < 60) return { key: 'minutesAgo', params: { count: minutes } }
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours < 24) return remainingMinutes
    ? { key: 'hoursMinutesAgo', params: { hours, minutes: remainingMinutes } }
    : { key: 'hoursAgo', params: { count: hours } }
  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  if (remainingHours && remainingMinutes) return { key: 'daysHoursMinutesAgo', params: { days, hours: remainingHours, minutes: remainingMinutes } }
  if (remainingHours) return { key: 'daysHoursAgo', params: { days, hours: remainingHours } }
  if (remainingMinutes) return { key: 'daysMinutesAgo', params: { days, minutes: remainingMinutes } }
  return { key: 'daysAgo', params: { count: days } }
}

export function newestReadingsByDevice<T extends { device_id: string; created_at: string }>(readings: T[]) {
  const newest = new Map<string, T>()
  for (const reading of readings) {
    const timestamp = Date.parse(reading.created_at)
    if (!Number.isFinite(timestamp)) continue
    const current = newest.get(reading.device_id)
    if (!current || timestamp > Date.parse(current.created_at)) newest.set(reading.device_id, reading)
  }
  return newest
}
