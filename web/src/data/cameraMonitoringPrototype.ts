import type { CameraEvent, PlantCameraStatus } from '../types/cameraMonitoring'

// Frontend-only fixtures. Replace these objects with authorized API data when integration exists.
export const prototypePlantCamera: PlantCameraStatus = {
  cameraId: 'CAM-001',
  plantId: 'PL001',
  name: 'Plant Monitoring Camera 01',
  status: 'Unavailable',
  lastSeenAt: '2026-10-24T20:35:00+08:00',
}

export const prototypeCameraEvents: CameraEvent[] = [
  {
    eventId: 'CAM-EVT-001',
    plantId: 'PL001',
    cameraId: 'CAM-001',
    eventType: 'possible_plant_contact',
    title: 'Possible suspicious activity detected',
    description: 'Possible plant contact detected',
    confidence: 0.87,
    detectedAt: '2026-10-24T20:35:00+08:00',
    durationSeconds: 18,
    status: 'New',
  },
  {
    eventId: 'CAM-EVT-002',
    plantId: 'PL001',
    cameraId: 'CAM-001',
    eventType: 'human_detected',
    title: 'Human detected near plant',
    description: 'A person was detected within the monitored area.',
    confidence: 0.81,
    detectedAt: '2026-10-23T18:12:00+08:00',
    durationSeconds: 12,
    status: 'Reviewing',
  },
  {
    eventId: 'CAM-EVT-003',
    plantId: 'PL001',
    cameraId: 'CAM-001',
    eventType: 'animal_detected',
    title: 'Animal detected near plant',
    description: 'An animal was detected within the monitored area.',
    confidence: 0.74,
    detectedAt: '2026-10-22T07:48:00+08:00',
    durationSeconds: 9,
    status: 'Resolved',
  },
]
