// Keep localized months and the browser-local timezone with a fixed day-first order.
export function formatAdminLastLogin(value: unknown, locale: string): string {
  if (value === 'Never') return 'Never'
  if (typeof value !== 'string' || !value.trim()) return '—'
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return '—'
  const parts = new Intl.DateTimeFormat(locale === 'ms' ? 'ms-MY' : locale, {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(parsed)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.day} ${values.month} ${values.year}, ${values.hour}:${values.minute}`
}
