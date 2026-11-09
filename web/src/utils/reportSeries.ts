export interface ReportPoint { x: number; y: number | null }
// A conservative visual break for long interruptions, not a claim that the
// hardware has a configured cadence. Explicit missing values are always gaps.
export function reportSeries(labels: string[], values: (number | null)[]): ReportPoint[] {
  const raw = labels.map((time, index) => ({ x: Date.parse(time), y: values[index] ?? null }))
  const intervals = raw.slice(1).map((point, index) => point.x - raw[index]!.x).filter(value => value > 0).sort((a, b) => a - b)
  const middle = Math.floor(intervals.length / 2)
  const cadence = intervals.length >= 2 ? (intervals.length % 2 ? intervals[middle]! : (intervals[middle - 1]! + intervals[middle]!) / 2) : Infinity
  const points: ReportPoint[] = []
  raw.forEach((point, index) => {
    const previous = raw[index - 1]
    if (previous && point.x - previous.x > cadence * 2) points.push({ x: previous.x + 1, y: null })
    points.push(point)
  })
  if (points.length <= 1500) return points
  // Min/max buckets retain endpoints AND every gap with its neighbours. Summary
  // statistics, detailed rows and exports continue to use all original readings.
  const keep = new Set<number>([0, points.length - 1])
  const size = Math.ceil(points.length / 300)
  for (let start = 0; start < points.length; start += size) {
    const end = Math.min(points.length, start + size)
    let min = -1, max = -1
    keep.add(start); keep.add(end - 1)
    for (let index = start; index < end; index++) {
      const value = points[index]!.y
      if (value === null) {
        keep.add(index); if (index) keep.add(index - 1); if (index + 1 < points.length) keep.add(index + 1)
      } else {
        if (min === -1 || value < points[min]!.y!) min = index
        if (max === -1 || value > points[max]!.y!) max = index
      }
    }
    if (min >= 0) keep.add(min)
    if (max >= 0) keep.add(max)
  }
  return [...keep].sort((a, b) => a - b).map(index => points[index]!)
}
