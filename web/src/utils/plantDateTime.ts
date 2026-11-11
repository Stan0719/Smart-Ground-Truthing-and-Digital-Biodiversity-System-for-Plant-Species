// Plant Detail uses a fixed format and explicit zone, independent of browser settings.
const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Kuching', month: 'short', day: 'numeric', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})
export function formatPlantDateTime(value: unknown, unavailable = '—'): string {
  if (typeof value !== 'string') return unavailable
  // Require an explicit offset: a date-only or timezone-less value has no known instant.
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/.exec(value.trim())
  if (!match) return unavailable
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3])
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]! || Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6] || 0) > 59) return unavailable
  const timestamp = Date.parse(value.trim())
  if (!Number.isFinite(timestamp)) return unavailable
  const parts = Object.fromEntries(formatter.formatToParts(timestamp).map(part => [part.type, part.value]))
  return `${parts.month} ${parts.day}, ${parts.year}, ${parts.hour}:${parts.minute}`
}
