import { reactive } from 'vue'
import type { AlertResponseStatus, CanonicalThreatAlert } from '../services/threatAlerts'

// Loaded only by the localhost development preview. No transport or persistent storage.
export function createThreatAlertPreview() {
  const rows = reactive<CanonicalThreatAlert[]>([
    sample(1, 'temperature', 35.2, 'New'),
    sample(2, 'movement', 1, 'Reviewing'),
    sample(3, 'humidity', 94, 'Resolved'),
  ])
  let responseSequence = 0
  const owns = (alert: CanonicalThreatAlert) => rows.includes(alert)
  return {
    rows,
    owns,
    respond(alert: CanonicalThreatAlert, note: string, status: AlertResponseStatus) {
      if (!owns(alert)) return 'This alert does not belong to the sample preview.'
      if (alert.status === 'Resolved') return 'Resolved alerts cannot receive another response.'
      if (!['New', 'Reviewing'].includes(alert.status) || !['Reviewing', 'Resolved'].includes(status))
        return 'Invalid response status.'
      if (!note.trim()) return 'A response note is required.'
      if (note.length > 4000) return 'Response notes must be 4,000 characters or fewer.'
      alert.responses.unshift({
        id: `DEMO-RESPONSE-LOCAL-${++responseSequence}`,
        alertId: alert.id,
        officerSubject: 'DEMO-OFFICER (local simulation)',
        note: note.trim(), status, createdAt: new Date().toISOString(),
      })
      alert.status = status
      return null
    },
  }
}

function sample(index: number, metric: string, value: number, status: string): CanonicalThreatAlert {
  const id = `DEMO-ALERT-${String(index).padStart(3, '0')}`
  const createdAt = `2026-11-12T0${index}:15:00+08:00`
  return {
    id, deviceId: `DEMO-DEVICE-${index}`, readingId: `DEMO-READING-${index}`,
    cameraId: null, videoPath: null, metric, value, status, createdAt, detectedAt: createdAt,
    responses: status === 'New' ? [] : [{
      id: `DEMO-RESPONSE-INITIAL-${index}`, alertId: id,
      officerSubject: 'DEMO-OFFICER (sample history)',
      note: status === 'Resolved' ? 'Sample inspection completed; humidity returned to normal.' : 'Sample field inspection is in progress.',
      status: status === 'Resolved' ? 'Resolved' : 'Reviewing', createdAt,
    }],
  }
}

export type ThreatAlertPreview = ReturnType<typeof createThreatAlertPreview>
