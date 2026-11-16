// Presentation only: lookup canonical database values without changing their labels.
const neutral = Object.freeze({ backgroundColor: '#E5E7EB', color: '#374151' })
export const conservationBadgePalette = Object.freeze({
  'Not Assessed': neutral,
  'Least Concern': Object.freeze({ backgroundColor: '#DCFCE7', color: '#166534' }),
  'Near Threatened': Object.freeze({ backgroundColor: '#FEF9C3', color: '#854D0E' }),
  'Vulnerable': Object.freeze({ backgroundColor: '#FFEDD5', color: '#9A3412' }),
  'Endangered': Object.freeze({ backgroundColor: '#FEE2E2', color: '#B91C1C' }),
  'Critically Endangered': Object.freeze({ backgroundColor: '#7F1D1D', color: '#FFFFFF' }),
})
export function conservationBadgeStyle(status: unknown) {
  return typeof status === 'string' && Object.hasOwn(conservationBadgePalette, status)
    ? conservationBadgePalette[status as keyof typeof conservationBadgePalette] : neutral
}
