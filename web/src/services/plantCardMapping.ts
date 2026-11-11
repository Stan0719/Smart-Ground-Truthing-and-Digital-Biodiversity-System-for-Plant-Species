import { mapPlantContract } from './plantIntegration.ts'

export const plantReviewStatuses = ['Pending Review', 'Approved', 'Rejected', 'Flagged', 'Correction Required'] as const

export function mapPlantCardMetadata(value: unknown) {
  const plant = mapPlantContract(value)
  const approved = plant?.latestApproved
  return {
    reviewStatus: plantReviewStatuses.find(status => status === plant?.status) || '',
    latestApproved: {
      // A registration timestamp is not a verification event.
      date: approved ? plant?.observedAt || '' : '',
      heightCm: approved?.heightCm ?? NaN,
      healthStatus: approved?.healthStatus || '',
      lifeStage: approved?.lifeStage || '',
      morphology: approved?.morphology || '',
      notes: approved?.notes || '',
    },
    location: {
      zone: plant?.zone || '',
      latitude: plant?.latitude ?? NaN,
      longitude: plant?.longitude ?? NaN,
      accuracyM: plant?.accuracyM ?? NaN,
      altitudeM: plant?.altitudeM ?? NaN,
    },
  }
}
