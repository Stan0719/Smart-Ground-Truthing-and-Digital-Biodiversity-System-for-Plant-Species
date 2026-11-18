import { monitoringDate } from './officerMonitoringDisplay.ts'
import type { CanonicalThreatAlert } from '../services/threatAlerts.ts'

const sensorLabels: Record<string, string> = { temperature: 'Temperature Threshold', humidity: 'Humidity Threshold', soilMoisture: 'Soil Moisture Threshold', movement: 'Movement Threshold', rainfall: 'Rainfall Threshold', sound: 'Sound Threshold' }
const cameraLabels: Record<string, string> = { possible_plant_contact: 'Possible Plant Contact', human_detected: 'Human Detected', animal_detected: 'Animal Detected', suspicious_movement: 'Suspicious Movement' }
export function alertSource(alert: Pick<CanonicalThreatAlert, 'metric'>): 'Sensor' | 'Camera' | 'Unknown' {
  // Classify documented event codes, never IDs, display labels or a guessed device name.
  return Object.hasOwn(sensorLabels, alert.metric) ? 'Sensor' : Object.hasOwn(cameraLabels, alert.metric) ? 'Camera' : 'Unknown'
}
export function alertTypeLabel(metric: string) {
  if (Object.hasOwn(sensorLabels, metric)) return sensorLabels[metric]!
  if (Object.hasOwn(cameraLabels, metric)) return cameraLabels[metric]!
  return metric.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim() || metric
}
export const alertStatusLabel = (status: string) => status === 'Reviewing' ? 'Under Review' : status
export const sensorUnit = (metric: string) => metric === 'temperature' ? '°C' : metric === 'humidity' ? '%' : metric === 'movement' ? 'Binary (0/1)' : ['soilMoisture', 'rainfall', 'sound'].includes(metric) ? 'raw' : null
export function sensorMetricLabel(metric: string) {
  const labels: Record<string, string> = { temperature: 'Temperature', humidity: 'Humidity', soilMoisture: 'Soil Moisture', movement: 'Movement', rainfall: 'Rainfall', sound: 'Sound' }
  return Object.hasOwn(labels, metric) ? labels[metric]! : metric
}
export function threatAlertDate(value: string | null | undefined, locale = 'en') {
  if (!value || monitoringDate(value) === '—') return '—'
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const date = new Date(dateOnly ? value + 'T00:00:00Z' : value.replace(' ', 'T'))
  const formatter = new Intl.DateTimeFormat(locale.startsWith('zh') ? 'zh-CN' : locale === 'ms' ? 'ms-MY' : 'en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: dateOnly ? 'UTC' : 'Asia/Kuching',
    ...(dateOnly ? {} : { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' as const }),
  })
  if (locale.startsWith('zh')) return formatter.format(date)
  const parts = Object.fromEntries(formatter.formatToParts(date).map(p => [p.type, p.value]))
  return `${parts.day} ${parts.month} ${parts.year}${dateOnly ? '' : `, ${parts.hour}:${parts.minute}`}`
}
export function threatAlertDay(value: string) {
  if (monitoringDate(value) === '—') return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: 'Asia/Kuching', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value.replace(' ', 'T'))).map(p => [p.type, p.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}
