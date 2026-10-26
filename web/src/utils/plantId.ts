export const formatPlantId = (id: string | number) => {
  const numericId = typeof id === 'number' ? id : Number(id)

  if (!Number.isSafeInteger(numericId) || numericId <= 0) return null

  return `PL${String(numericId).padStart(3, '0')}`
}

export const parsePlantId = (displayId: string) => {
  const match = /^PL(\d+)$/.exec(displayId)
  if (!match) return null

  const numericId = Number(match[1])
  return Number.isSafeInteger(numericId) && numericId > 0 ? numericId : null
}
