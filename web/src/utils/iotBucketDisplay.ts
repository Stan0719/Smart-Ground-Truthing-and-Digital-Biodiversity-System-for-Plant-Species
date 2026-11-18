import type { IoTSummary, SummaryBucket } from '../services/iotReporting'

export function iotDate(value: string, locale: string, timezone: string, year = true): string {
  const parts = new Intl.DateTimeFormat(locale, { timeZone: timezone, day: '2-digit', month: 'short', year: 'numeric' }).formatToParts(new Date(value))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value || ''
  const month = new Intl.DateTimeFormat(locale, { timeZone: timezone, month: 'short' }).format(new Date(value))
  return `${part('day')} ${month}${year ? ` ${part('year')}` : ''}`
}

export function iotTimestamp(value: string, locale: string, timezone: string): string {
  const time = new Intl.DateTimeFormat(locale, { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value))
  return `${iotDate(value, locale, timezone)}, ${time}`
}

// Display only: preserve API boundaries and use receipt-time reporting timezone.
export function iotBucketLabel(bucket: SummaryBucket, interval: IoTSummary['aggregation']['interval'], locale: string, timezone: string, detailed = false): string {
  if (interval === 'day') return iotDate(bucket.startInclusive, locale, timezone)
  if (interval === 'week') {
    const last = new Date(Date.parse(bucket.endExclusive) - 1).toISOString()
    const firstLabel = iotDate(bucket.startInclusive, locale, timezone), lastLabel = iotDate(last, locale, timezone)
    if (firstLabel === lastLabel) return firstLabel
    const parts = (value: string) => new Intl.DateTimeFormat(locale, { timeZone: timezone, day: '2-digit', month: 'numeric', year: 'numeric' }).formatToParts(new Date(value))
    const startParts = parts(bucket.startInclusive), endParts = parts(last)
    const part = (p: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) => p.find(v => v.type === type)?.value
    return part(startParts, 'month') === part(endParts, 'month') && part(startParts, 'year') === part(endParts, 'year')
      ? `${part(startParts, 'day')}–${lastLabel}` : `${firstLabel} – ${lastLabel}`
  }
  if (detailed) {
    const start = iotTimestamp(bucket.startInclusive, locale, timezone), end = iotTimestamp(bucket.endExclusive, locale, timezone)
    return iotDate(bucket.startInclusive, locale, timezone) === iotDate(bucket.endExclusive, locale, timezone)
      ? `${start}–${end.slice(end.lastIndexOf(',') + 2)}` : `${start} – ${end}`
  }
  const full = iotTimestamp(bucket.startInclusive, locale, timezone)
  return `${iotDate(bucket.startInclusive, locale, timezone, false)}${full.slice(full.lastIndexOf(','))}`
}

export function iotAxisLabel(bucket: SummaryBucket, interval: IoTSummary['aggregation']['interval'], locale: string, timezone: string): string {
  if (interval === 'day') return iotDate(bucket.startInclusive, locale, timezone, false)
  // Full years remain in tooltip/table formatting, including cross-year ranges.
  return iotBucketLabel(bucket, interval, locale, timezone).replace(/\s\d{4}(?=\s|$)/g, '')
}

// End labels align inward; intermediate labels stay centered on their category.
// Reserve the final label's measured footprint before selecting intermediates.
export function iotVisibleTickIndexes(widths: number[], width: number, gap = 12): number[] {
  if (!widths.length) return []
  if (widths.length === 1) return [0]
  const last = widths.length - 1, spacing = Math.max(0, width) / last
  const stride = Math.max(1, Math.ceil((Math.max(...widths) + gap) / Math.max(spacing, 1)), widths.length > 31 ? Math.ceil(last / 9) : 1)
  const selected = [0]
  let right = widths[0]!
  const finalLeft = width - widths[last]!
  for (let index = stride; index < last; index += stride) {
    const center = spacing * index, half = widths[index]! / 2
    if (center - half >= right + gap && center + half <= finalLeft - gap) {
      selected.push(index); right = center + half
    }
  }
  selected.push(last)
  return selected
}
