import type { ProximityResult } from './plantProximity.ts'
type Bands = Pick<ProximityResult['config'], 'very_close_m' | 'close_m' | 'nearby_m' | 'radius_m'>
// An engineering distance index, not an empirical probability or identity decision.
export function gpsProximityScore(distance: number, bands: Bands): number | null {
  const distances = [0, bands.very_close_m, bands.close_m, bands.nearby_m, bands.radius_m]
  const scores = [100, 80, 50, 20, 0]
  if (!Number.isFinite(distance) || distance < 0 || distances.some((n, i) => !Number.isFinite(n) || (i > 0 && n <= distances[i - 1]!)) || distance > bands.radius_m) return null
  for (let i = 1; i < distances.length; i++) {
    if (distance <= distances[i]!) {
      const fraction = (distance - distances[i - 1]!) / (distances[i]! - distances[i - 1]!)
      return Math.round(scores[i - 1]! + (scores[i]! - scores[i - 1]!) * fraction)
    }
  }
  return null
}
export function proximityScoreTone(score: number | null) {
  return score === null || !Number.isFinite(score) || score < 0 || score > 100 ? 'unknown' : score >= 80 ? 'high' : score >= 50 ? 'raised' : score >= 20 ? 'moderate' : 'low'
}
export function formatProximityScore(score: number | null, locale: string) {
  return score === null ? '—' : new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(score / 100)
}
export const gpsAccuracyUncertain = (accuracy: number | null | undefined, limit: number) =>
  accuracy == null || !Number.isFinite(accuracy) || accuracy <= 0 || accuracy > limit
