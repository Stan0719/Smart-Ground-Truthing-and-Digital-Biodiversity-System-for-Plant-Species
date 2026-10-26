export type CameraEventType =
  'possible_plant_contact' | 'human_detected' | 'animal_detected' | 'suspicious_movement'

export interface CameraEvent {
  eventId: string
  plantId: string
  cameraId: string
  eventType: CameraEventType
  title: string
  description: string
  confidence: number | null
  detectedAt: string
  recordingStartedAt?: string
  recordingEndedAt?: string
  durationSeconds?: number
  videoUrl?: string
  thumbnailUrl?: string
  status: 'New' | 'Reviewing' | 'Resolved'
}

export interface PlantCameraStatus {
  cameraId: string
  plantId: string
  name: string
  status: 'Online' | 'Offline' | 'Unavailable'
  liveStreamUrl?: string
  lastSeenAt?: string
}
