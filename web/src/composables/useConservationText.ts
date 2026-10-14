import { useI18n } from 'vue-i18n'
import {
  speciesForPlant,
  speciesRequestForPlant,
  type SpeciesRecord,
  type Observation,
} from '../data/conservation'

export function useConservationText() {
  const { t, te, locale } = useI18n({ useScope: 'global' })
  const keyFor = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '')
  const ct = (value: unknown, params: Record<string, string | number> = {}): string => {
    if (value == null || value === '') return '—'
    const text = String(value)
    const key = keyFor(text)
    for (const prefix of [
      'conservationText',
      'conservationPages.observations.values',
      'dashboardValues',
    ]) {
      if (te(`${prefix}.${key}`)) return t(`${prefix}.${key}`, params)
    }
    return text
  }
  const sf = (
    sp: SpeciesRecord | undefined,
    field: 'scientific' | 'common' | 'genus' | 'family' = 'scientific',
  ) => {
    if (!sp) return '—'
    const key = `conservationSpecies.${field}.${sp.id}`
    const raw =
      field === 'scientific' ? sp.scientificName : field === 'common' ? sp.commonName : sp[field]
    return te(key) ? t(key) : ct(raw)
  }
  const speciesText = (plantId: string) => {
    const sp = speciesForPlant(plantId)
    return sp
      ? sf(sp)
      : ct(speciesRequestForPlant(plantId)?.proposedScientificName || 'Identification pending')
  }
  const dt = (value: string | undefined) => {
    if (!value || value === '—') return '—'
    const match = /^(\d{1,2}) ([A-Za-z]{3}) (\d{4})(?:, (\d{2}):(\d{2}))?$/.exec(value)
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(value)
    if (!match && !iso) return value
    const month = match
      ? [
          'Jan',
          'Feb',
          'Mar',
          'Apr',
          'May',
          'Jun',
          'Jul',
          'Aug',
          'Sep',
          'Oct',
          'Nov',
          'Dec',
        ].indexOf(match[2]!)
      : -1
    const date = iso
      ? new Date(value + 'T00:00:00')
      : new Date(
          Number(match![3]),
          month,
          Number(match![1]),
          Number(match![4] || 0),
          Number(match![5] || 0),
        )
    if (Number.isNaN(date.getTime()) || (!iso && month < 0)) return value
    return new Intl.DateTimeFormat(locale.value === 'ms' ? 'ms-MY' : locale.value, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      ...(match?.[4] ? ({ hour: '2-digit', minute: '2-digit', hour12: false } as const) : {}),
    }).format(date)
  }
  const observationText = (
    record: Observation,
    field: 'morphology' | 'notes' | 'reviewComment',
  ) => {
    const value = record[field]
    const key = `conservationPages.observations.records.${record.id}.${field}`
    return value && te(key) && value === t(`${key}Source`) ? t(key) : ct(value)
  }
  return { ct, sf, dt, speciesText, observationText, locale }
}
