export const formatObservationId = (id: string | number) => {
  const numericId = typeof id === 'number' ? id : Number(id)

  if (!Number.isSafeInteger(numericId) || numericId <= 0) return null

  return `OBS${String(numericId).padStart(3, '0')}`
}
