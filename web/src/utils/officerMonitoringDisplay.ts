// Officer reports use Malaysia time. Offset-bearing timestamps represent instants;
// date-only values retain their calendar date. Ambiguous unzoned times are unavailable.
export function monitoringDate(value: string | null | undefined, locale = 'en') {
  if (!value) return '\u2014'
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2}))?$/.exec(value)
  if (!match) return '\u2014'
  const [, year, month, day, hour, minute, second] = match
  const calendar = new Date(`${year}-${month}-${day}T00:00:00Z`)
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== value.slice(0, 10) || Number(hour || 0) > 23 || Number(minute || 0) > 59 || Number(second || 0) > 59) return '\u2014'
  const date = hour === undefined ? calendar : new Date(value.replace(' ', 'T'))
  if (!Number.isFinite(date.getTime())) return '\u2014'
  return new Intl.DateTimeFormat(locale === 'ms' ? 'ms-MY' : locale, {
    year: 'numeric', month: 'short', day: 'numeric',
    timeZone: hour === undefined ? 'UTC' : 'Asia/Kuala_Lumpur',
    ...(hour === undefined ? {} : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' as const }),
  }).format(date)
}

export function monitoringLabels(values: (string | number | null | undefined)[]) {
  const ids = [...new Set(values.filter(value => value !== null && value !== undefined && value !== '').map(String))]
  const entries = ids.map(id => ({ id, token: /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id) ? id.replaceAll('-', '').toUpperCase() : id,
    compact: id.length > 24 && !/^\d+$/.test(id) }))
  const labels = new Map<string, string>()
  for (const item of entries) {
    if (!item.compact) { labels.set(item.id, item.id); continue }
    let length = 8
    while (length < item.token.length && entries.some(other => other.id !== item.id && other.token.slice(0, length) === item.token.slice(0, length))) length = Math.min(length + 4, item.token.length)
    const label = item.token.slice(0, length) + (length < item.token.length ? '\u2026' : '')
    labels.set(item.id, label)
  }
  // Handle normalized duplicates and collisions with existing readable IDs too.
  const counts = new Map<string, number>()
  for (const label of labels.values()) counts.set(label, (counts.get(label) || 0) + 1)
  for (const [id, label] of labels) if ((counts.get(label) || 0) > 1) labels.set(id, id)
  return labels
}
