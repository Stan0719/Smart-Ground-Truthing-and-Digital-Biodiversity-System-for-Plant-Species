// Presentation only: canonical workflow values remain unchanged.
const neutral = Object.freeze({ backgroundColor: '#E5E7EB', color: '#374151' })
export const workflowBadgePalette = Object.freeze({
  Approved: Object.freeze({ backgroundColor: '#DCFCE7', color: '#166534' }),
  'Pending Review': Object.freeze({ backgroundColor: '#FEF9C3', color: '#854D0E' }),
  'Correction Required': Object.freeze({ backgroundColor: '#FFEDD5', color: '#9A3412' }),
  Rejected: Object.freeze({ backgroundColor: '#FEE2E2', color: '#B91C1C' }),
  Flagged: Object.freeze({ backgroundColor: '#F3E8FF', color: '#6B21A8' }),
  Draft: neutral,
})
export function workflowBadgeStyle(status: unknown) {
  return typeof status === 'string' && Object.hasOwn(workflowBadgePalette, status)
    ? workflowBadgePalette[status as keyof typeof workflowBadgePalette] : neutral
}

// Alert-specific presentation keeps existing review/workflow palettes unchanged.
export const threatAlertBadgePalette = Object.freeze({
  New: Object.freeze({ backgroundColor: '#DBEAFE', color: '#1E40AF' }),
  Reviewing: Object.freeze({ backgroundColor: '#FEF9C3', color: '#854D0E' }),
  Resolved: Object.freeze({ backgroundColor: '#DCFCE7', color: '#166534' }),
})
export function threatAlertBadgeStyle(status: unknown) {
  return typeof status === 'string' && Object.hasOwn(threatAlertBadgePalette, status)
    ? threatAlertBadgePalette[status as keyof typeof threatAlertBadgePalette] : neutral
}
