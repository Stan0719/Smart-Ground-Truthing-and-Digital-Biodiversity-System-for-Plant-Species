<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useConservationText } from '../composables/useConservationText'
import { plantRegistrationDisplay } from '../services/plantRegistrationDisplay'
import type { HistoryObservation } from '../services/plantHistory'
import { workflowBadgeStyle } from '../utils/workflowBadge'
import { formatPlantDateTime } from '../utils/plantDateTime'
const props = defineProps<{ authorized: boolean; staff: unknown; plantId: string; observations: HistoryObservation[]; complete: boolean; loading: boolean; error: string; hasMore: boolean; verifiedComplete?: boolean }>()
const { t } = useI18n(), { ct } = useConservationText()
const model = computed(() => plantRegistrationDisplay(props.authorized, props.staff, props.plantId, props.observations, (props.verifiedComplete ?? (props.complete && !props.loading && !props.error)) && !props.hasMore))
const evidenceLabel = computed(() => t('plantRecord.' + (model.value.provenance === 'approved' ? 'approved' : 'submitted')))
const notice = computed(() => model.value.status === 'Pending Review' ? 'pendingNotice' : model.value.provenance === 'unavailable' ? 'unavailable' : model.value.provenance === 'approved' ? 'approvedNotice' : (({ 'Pending Review':'pendingNotice','Correction Required':'correctionNotice','Rejected':'rejectedNotice','Withdrawn':'withdrawnNotice','Flagged':'flaggedNotice' } as Record<string,string>)[model.value.status] || 'submittedNotice'))
const locationAvailable = computed(() => model.value.content?.latitude != null && model.value.content.longitude != null)
const facts = computed(() => {
  const value = model.value.content
  if (!value) return []
  return [
    { label: 'Height', value: value.heightCm == null ? null : value.heightCm + ' cm', wide: false },
    { label: 'Health status', value: value.healthStatus ? ct(value.healthStatus) : null, wide: false },
    { label: 'Life stage', value: value.lifeStage ? ct(value.lifeStage) : null, wide: true },
    { label: 'Morphology', value: value.morphology, wide: true },
    { label: 'Notes', value: value.notes, wide: true },
  ].filter(item => item.value !== null && item.value !== '')
})
const show = (value: unknown) => value == null || value === '' ? ct('Unavailable') : String(value)
const metres = (value: number | null | undefined) => value == null ? ct('Unavailable') : value + ' m'
// Decorative line icons only; evidence selection and value formatting stay above.
const icons: Record<string, string> = {
  leaf: 'M20 3C11 3 4 6 4 13a7 7 0 0 0 7 7c7 0 9-9 9-17ZM3 22 15 10',
  pin: 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0ZM15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  calendar: 'M5 5h14a2 2 0 0 1 2 2v13H3V7a2 2 0 0 1 2-2ZM7 2v6M17 2v6M3 10h18M7 14h2M13 14h2M7 17h2',
  info: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM12 11v6M12 7h.01',
  clock: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0ZM12 6v6l4 2',
  sprout: 'M12 22v-9M12 15C5 15 3 11 3 6c6 0 9 3 9 9ZM12 11c0-6 3-9 9-9 0 6-3 9-9 9ZM6 22h12',
  target: 'M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM12 1v4M12 19v4M1 12h4M19 12h4',
  mountain: 'm2 20 7-12 5 8 3-5 5 9H2ZM14 4h6M17 1v6',
  layers: 'm2 7 10-5 10 5-10 5L2 7Zm0 5 10 5 10-5M2 17l10 5 10-5',
  Height: 'M12 2v20M7 7l5-5 5 5M7 17l5 5 5-5',
  'Health status': 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z',
  Notes: 'M5 2h10l5 5v15H5V2ZM14 2v6h6M8 12h9M8 16h9',
}
icons['Life stage'] = icons.sprout!
icons.Morphology = icons.layers!
</script>
<template>
  <article v-if="authorized" class="plant-registration-record" aria-labelledby="plant-record-title">
    <header class="record-heading">
      <span class="record-botanical" aria-hidden="true"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path :d="icons.leaf" /></svg></span>
      <div class="record-title-group">
        <p class="record-kicker">{{ t('plantRecord.registration') }}</p>
        <h2 id="plant-record-title">{{ t('plantRecord.title') }}</h2>
        <p class="registration-date"><svg class="date-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path :d="icons.calendar" /></svg><span>{{ ct('Registered at') }}</span><time v-if="model.registeredAt" :datetime="model.registeredAt">{{ formatPlantDateTime(model.registeredAt, ct('Unavailable')) }}</time><span v-else>{{ ct('Unavailable') }}</span></p>
      </div>
      <span v-if="model.status" class="record-status" :style="workflowBadgeStyle(model.status)"><svg v-if="model.status === 'Pending Review'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path :d="icons.clock" /></svg>{{ ct(model.status) }}</span>
    </header>
    <div class="registration-notice" role="status"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path :d="icons.info" /></svg><p>{{ t('plantRecord.' + notice) }}</p></div>
    <div class="registration-columns">
      <section class="registration-location" aria-labelledby="registration-location-title">
        <header class="section-heading"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path :d="icons.pin" /></svg><h3 id="registration-location-title">{{ t('plantRecord.location') }}</h3><span v-if="model.content" class="evidence-tag">{{ evidenceLabel }}</span></header>
        <dl v-if="locationAvailable && model.content" class="measurement-grid location-measurements">
          <div class="field-card"><dt><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path :d="icons.pin" /></svg>{{ ct('Latitude') }}</dt><dd>{{ model.content.latitude }}</dd></div>
          <div class="field-card"><dt><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path :d="icons.pin" /></svg>{{ ct('Longitude') }}</dt><dd>{{ model.content.longitude }}</dd></div>
          <div class="field-card"><dt><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path :d="icons.target" /></svg>{{ ct('GPS Accuracy') }}</dt><dd>{{ metres(model.content.accuracy_m) }}</dd></div>
          <div class="field-card"><dt><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path :d="icons.mountain" /></svg>{{ ct('Altitude') }}</dt><dd>{{ metres(model.content.altitude_m) }}</dd></div>
          <div class="field-card wide"><dt><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path :d="icons.layers" /></svg>{{ ct('Zone') }}</dt><dd>{{ show(model.content.zone) }}</dd></div>
        </dl>
        <p v-else class="record-empty">{{ t('plantRecord.locationUnavailable') }}</p>
      </section>
      <section class="initial-observation" aria-labelledby="initial-observation-title">
        <header class="section-heading"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path :d="icons.sprout" /></svg><h3 id="initial-observation-title">{{ t('plantRecord.initial') }}</h3><span v-if="model.content" class="evidence-tag">{{ evidenceLabel }}</span></header>
        <dl v-if="facts.length" class="measurement-grid"><div v-for="fact in facts" :key="fact.label" class="field-card" :class="{ wide: fact.wide }"><dt><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path :d="icons[fact.label]" /></svg>{{ ct(fact.label) }}</dt><dd>{{ fact.value }}</dd></div></dl>
        <p v-else class="record-empty">{{ t('plantRecord.observationUnavailable') }}</p>
        <dl v-if="model.content && Object.keys(model.content.taxonomy).length" class="measurement-grid taxonomy-measurements"><div v-for="(value,key) in model.content.taxonomy" :key="key" class="field-card taxonomy-field"><dt>{{ key }}</dt><dd>{{ value }}</dd></div></dl>
      </section>
    </div>
  </article>
</template>
<style scoped>
.plant-registration-record { container: plant-record / inline-size; padding: clamp(18px, 3vw, 32px); border: 1px solid #dfe7e2; border-radius: 26px; background: #fff; color: #173f34; box-shadow: 0 2px 6px #173f3408; }
.record-heading { display: flex; align-items: flex-start; flex-wrap: wrap; gap: 18px; margin: 0 0 26px; }
.record-botanical { display: grid; place-items: center; flex: 0 0 64px; height: 64px; border-radius: 13px; background: #edf5ee; color: #20573f; }
.record-botanical svg { width: 36px; height: 36px; }
.record-title-group { flex: 1 1 230px; min-width: 0; }
h2 { margin: 0; color: #123e30; font-size: clamp(24px, 2.4vw, 30px); font-weight: 750; line-height: 1.2; overflow-wrap: anywhere; }
.record-kicker { margin: 0 0 5px; color: #597c6d; font-size: 12px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; }
.record-status { display: inline-flex; align-items: center; gap: 7px; max-width: 100%; margin: 8px 0 0 auto; padding: 8px 17px; box-sizing: border-box; border-radius: 999px; font-size: 13px; font-weight: 700; line-height: 1.5; overflow-wrap: anywhere; }
.record-status svg { flex: 0 0 19px; width: 19px; height: 19px; }
.registration-date { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 8px; margin: 14px 0 0; color: #253e34; font-size: 13px; line-height: 1.6; }
.date-icon { flex: 0 0 17px; width: 17px; height: 17px; }
.registration-date time { font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.registration-notice { display: flex; align-items: flex-start; gap: 16px; margin: 0 0 24px; padding: 17px 20px; border: 1px solid #e0ebe3; border-radius: 13px; background: #f0f7f1; color: #234e3c; font-size: 14px; line-height: 1.75; }
.registration-notice svg { flex: 0 0 24px; width: 24px; height: 24px; margin-top: 2px; }
.registration-notice p { min-width: 0; margin: 0; overflow-wrap: anywhere; }
.registration-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; gap: 20px; }
.registration-location, .initial-observation { min-width: 0; overflow: hidden; border: 1px solid #e1e9e3; border-radius: 13px; background: #fff; }
.section-heading { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding: 15px 17px; background: #edf6ef; }
.section-heading > svg { flex: 0 0 25px; width: 25px; height: 25px; color: #20573f; }
h3 { flex: 1 1 140px; min-width: 0; margin: 0; color: #173f34; font-size: 17px; font-weight: 700; line-height: 1.4; overflow-wrap: anywhere; }
.evidence-tag { flex: 0 0 auto; max-width: 100%; box-sizing: border-box; padding: 3px 10px; border: 2px solid #fff; border-radius: 999px; background: #dff2df; color: #285d3d; font-size: 12px; font-weight: 700; line-height: 1.5; overflow-wrap: anywhere; }
.measurement-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 0; padding: 14px; }
.field-card { position: relative; min-width: 0; padding: 12px 12px 12px 51px; border-radius: 11px; background: #f4f7f3; }
dt { color: #45574d; font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
dt svg { position: absolute; top: 22px; left: 15px; width: 24px; height: 24px; fill: none; stroke: #20573f; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
dd { margin: 4px 0 0; color: #192c22; font-size: 16px; font-weight: 700; line-height: 1.5; overflow-wrap: anywhere; white-space: pre-wrap; font-variant-numeric: tabular-nums; }
.wide { grid-column: 1 / -1; }
.record-empty { margin: 14px; padding: 18px; border-radius: 10px; background: #f5f7f3; color: #536b5b; font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; }
.taxonomy-measurements { padding-top: 0; }
.taxonomy-field { padding-left: 14px; }
@container plant-record (max-width: 760px) { .registration-columns { grid-template-columns: 1fr; gap: 18px; } }
@container plant-record (max-width: 480px) { .record-heading { gap: 12px; margin-bottom: 20px; } .record-botanical { flex-basis: 46px; height: 46px; border-radius: 10px; } .record-botanical svg { width: 28px; height: 28px; } .record-title-group { flex-basis: calc(100% - 58px); } .record-status { margin: 0; padding: 6px 13px; } .registration-date { margin-top: 9px; } .registration-notice { gap: 11px; padding: 14px; font-size: 13px; } .registration-notice svg { flex-basis: 21px; width: 21px; height: 21px; } .measurement-grid { grid-template-columns: 1fr; gap: 10px; padding: 12px; } .section-heading { padding: 13px; } h3 { font-size: 16px; } }
@media (max-width: 760px) { .registration-columns { grid-template-columns: 1fr; } }
@media (max-width: 380px) { .plant-registration-record { padding: 16px; border-radius: 20px; } .measurement-grid { grid-template-columns: 1fr; } }
</style>
