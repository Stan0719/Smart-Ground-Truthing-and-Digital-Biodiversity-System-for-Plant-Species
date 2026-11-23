import { mapPlantContract } from './plantIntegration.ts'

export const plantReviewStatuses = ['Pending Review', 'Approved', 'Rejected', 'Flagged', 'Correction Required', 'Withdrawn'] as const

export function mapPlantCardMetadata(value: unknown) {
  const plant = mapPlantContract(value)
  const row = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  const registration = row?.current_registration as Record<string, unknown> | undefined
  const content = registration?.content
  const approved = plant?.status === 'Approved' && registration?.state === 'available' &&
    typeof registration.observation_id === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(registration.observation_id) &&
    content && typeof content === 'object' && !Array.isArray(content) ? content as Record<string, unknown> : null
  const text = (key: string) => typeof approved?.[key] === 'string' ? approved[key] as string : ''
  return {
    plantScientificName: typeof row?.scientific_name === 'string' ? row.scientific_name : '',
    reviewStatus: plantReviewStatuses.find(status => status === plant?.status) || '',
    measurementSource: approved ? 'registration' as const : 'unavailable' as const,
    latestApproved: {
      // The registration contract has no approval timestamp. Never borrow a visit's updated_at.
      date: '',
      heightCm: typeof approved?.heightCm === 'number' && Number.isFinite(approved.heightCm) ? approved.heightCm : NaN,
      healthStatus: text('healthStatus'),
      lifeStage: text('lifeStage'),
      morphology: text('morphology'),
      notes: text('notes'),
    },
    location: {
      zone: approved ? plant?.zone || '' : '',
      latitude: approved ? plant?.latitude ?? NaN : NaN,
      longitude: approved ? plant?.longitude ?? NaN : NaN,
      accuracyM: approved ? plant?.accuracyM ?? NaN : NaN,
      altitudeM: approved ? plant?.altitudeM ?? NaN : NaN,
    },
  }
}
