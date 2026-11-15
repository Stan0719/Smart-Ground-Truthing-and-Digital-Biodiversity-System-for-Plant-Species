// Visual review guidance only; cosine similarity is not identification confidence.
export function similarityLabel(score: number) {
  return score < 0.70 ? 'Low visual similarity' : score < 0.90 ? 'Moderate visual similarity' : 'High visual similarity'
}
export function similarityBadgeStyle(score: unknown) {
  if (typeof score !== 'number' || !Number.isFinite(score) || Math.abs(score) > 1) return undefined
  const [background, text] = score < 0.70 ? ['#DCFCE7', '#166534']
    : score < 0.90 ? ['#FEF9C3', '#854D0E'] : ['#FEE2E2', '#B91C1C']
  return { '--similarity-background': background, '--similarity-text': text }
}
