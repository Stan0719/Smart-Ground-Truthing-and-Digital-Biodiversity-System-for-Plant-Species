import { monitoringDate } from './officerMonitoringDisplay.ts'

const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kuching', day: '2-digit', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})
// Reuse existing validation; date-only/unzoned inputs have no recorded instant.
export function iotDate(value?: string | null): string {
  if (!value || !/[T ]\d{2}:\d{2}/.test(value) || monitoringDate(value) === '\u2014') return '\u2014'
  const parts = Object.fromEntries(formatter.formatToParts(new Date(value.replace(' ', 'T'))).map(part => [part.type, part.value]))
  return `${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute}`
}

// Display-only expansion of the known compact name; preserve other names verbatim.
export function deviceDisplayTitle(name: string): string {
  return name.toLowerCase() === 'plantsensordevice' ? 'Plant Sensor Device' : name
}
