<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppModal from './AppModal.vue'
import { sessionSnapshot, subscribeSession } from '../../services/auth'
import { readPlantDetail, type PlantDetail } from '../../services/plantDetail'
import { useConservationText } from '../../composables/useConservationText'
import { reviewDateTime } from '../../utils/officerMonitoringDisplay'

const props = defineProps<{ plantId: string | null }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const { ct } = useConservationText()
const session = ref(sessionSnapshot())
const detail = ref<PlantDetail | null>(null)
const loading = ref(false)
const error = ref(false)
let request = 0
let controller: AbortController | null = null
const ready = () => !session.value.pending && session.value.user?.role === 'Conservation Officer' && session.value.user.status === 'Active' && !session.value.user.mustChangePassword
const label = (key: string) => t(`officerPlants.${key}`)
const display = (value: string | number | null | undefined) => value === null || value === undefined || value === '' ? ct('Unavailable') : String(value)
const locationFields = (location: NonNullable<NonNullable<PlantDetail['staff']>['approved_location']>) => [
  [ct('Latitude'), display(location.latitude)], [ct('Longitude'), display(location.longitude)],
  [ct('Accuracy'), location.accuracy_m == null ? ct('Unavailable') : `${location.accuracy_m} m`],
  [ct('Altitude'), location.altitude_m == null ? ct('Unavailable') : `${location.altitude_m} m`], [ct('Zone'), display(location.zone)],
]
async function load() {
  controller?.abort()
  const current = ++request
  detail.value = null
  error.value = false
  if (!props.plantId || !ready()) { loading.value = false; return }
  const abort = new AbortController()
  controller = abort
  loading.value = true
  try {
    const result = await readPlantDetail(props.plantId, true)
    if (current === request && !abort.signal.aborted && ready()) detail.value = result
  } catch {
    if (current === request && !abort.signal.aborted) error.value = true
  } finally {
    if (current === request) loading.value = false
  }
}
watch(() => props.plantId, () => { if (props.plantId) void load() }, { immediate: true })
const unsubscribe = subscribeSession((user, pending) => {
  session.value = { user, pending }
  if (ready()) void load()
  else { controller?.abort(); request++; detail.value = null; loading.value = false; emit('close') }
})
onBeforeUnmount(() => { request++; controller?.abort(); unsubscribe() })
</script>

<template>
  <AppModal v-if="plantId" class="plant-view-modal" wide accessible :title="detail?.information.scientific_name || ct('Plant Information')" @close="emit('close')">
    <template #title><span class="plant-view-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M20 3C8 3 3 7 4 15s12 6 16-12ZM3 22 16 9" /></svg>{{ ct('Plant Information') }}</span></template>
    <p v-if="loading" class="state-note" role="status">{{ label('viewLoading') }}</p>
    <div v-else-if="error" class="state-note error" role="alert"><p>{{ label('viewError') }}</p><button type="button" class="secondary-button" @click="load">{{ label('retry') }}</button></div>
    <template v-else-if="detail">
      <section class="plant-view-section">
        <h3>{{ ct('Plant Information') }}</h3>
        <dl class="plant-view-fields">
          <div><dt>{{ ct('Plant ID') }}</dt><dd>{{ detail.information.plant_id }}</dd></div>
          <div><dt>{{ label('plantScientificName') }}</dt><dd><em>{{ display(detail.information.plant_scientific_name ?? detail.information.scientific_name) }}</em></dd></div>
          <div v-if="detail.information.species_scientific_name !== undefined"><dt>{{ ct('Species scientific name') }}</dt><dd><em>{{ display(detail.information.species_scientific_name) }}</em></dd></div>
          <div><dt>{{ ct('Common name') }}</dt><dd>{{ display(detail.information.common_name) }}</dd></div>
          <div><dt>{{ ct('Genus') }}</dt><dd>{{ display(detail.information.genus_name) }}</dd></div>
          <div><dt>{{ ct('Family') }}</dt><dd>{{ display(detail.information.family_name) }}</dd></div>
          <div v-if="detail.information.habitat !== undefined"><dt>{{ t('speciesLabels.habitat') }}</dt><dd>{{ display(detail.information.habitat) }}</dd></div>
          <div class="full-field"><dt>{{ ct('Description') }}</dt><dd>{{ display(detail.information.description) }}</dd></div>
        </dl>
      </section>
      <section v-if="detail.staff" class="plant-view-section">
        <h3>{{ label('viewRegistry') }}</h3>
        <dl class="plant-view-fields">
          <div><dt>{{ ct('Plant status') }}</dt><dd>{{ ct(detail.staff.status) }}</dd></div>
          <div><dt>{{ ct('Registered date') }}</dt><dd>{{ reviewDateTime(detail.staff.registered_at) }}</dd></div>
          <div><dt>{{ ct('Conservation status') }}</dt><dd>{{ display(detail.staff.conservation_status) }}</dd></div>
          <div><dt>{{ t('speciesLabels.habitat') }}</dt><dd>{{ display(detail.staff.habitat) }}</dd></div>
        </dl>
        <h4>{{ label('viewApprovedLocation') }}</h4>
        <dl v-if="detail.staff.approved_location" class="plant-view-fields">
          <div v-for="([name, value], index) in locationFields(detail.staff.approved_location)" :key="index"><dt>{{ name }}</dt><dd>{{ value }}</dd></div>
        </dl>
        <p v-else class="plant-view-empty">{{ ct('Unavailable') }}</p>
        <h4>{{ label('viewLatestApprovedObservation') }}</h4>
        <template v-if="detail.staff.latest_approved_observation">
          <dl class="plant-view-fields">
            <div><dt>{{ ct('Status') }}</dt><dd>{{ ct(detail.staff.latest_approved_observation.status) }}</dd></div>
            <div><dt>{{ ct('Date') }}</dt><dd>{{ reviewDateTime(detail.staff.latest_approved_observation.created_at) }}</dd></div>
            <div><dt>{{ ct('Height') }}</dt><dd>{{ display(detail.staff.latest_approved_observation.content.heightCm) }}</dd></div>
            <div><dt>{{ ct('Health') }}</dt><dd>{{ display(detail.staff.latest_approved_observation.content.healthStatus) }}</dd></div>
            <div><dt>{{ ct('Growth stage') }}</dt><dd>{{ display(detail.staff.latest_approved_observation.content.lifeStage) }}</dd></div>
            <div><dt>{{ ct('Latitude') }} / {{ ct('Longitude') }}</dt><dd>{{ display(detail.staff.latest_approved_observation.content.latitude) }} / {{ display(detail.staff.latest_approved_observation.content.longitude) }}</dd></div>
            <div><dt>{{ ct('Accuracy') }}</dt><dd>{{ display(detail.staff.latest_approved_observation.content.accuracy_m) }}</dd></div>
            <div><dt>{{ ct('Altitude') }}</dt><dd>{{ display(detail.staff.latest_approved_observation.content.altitude_m) }}</dd></div>
            <div><dt>{{ ct('Zone') }}</dt><dd>{{ display(detail.staff.latest_approved_observation.content.zone) }}</dd></div>
            <div v-for="([key, value]) in Object.entries(detail.staff.latest_approved_observation.content.taxonomy)" :key="key"><dt>{{ ct(key) }}</dt><dd>{{ display(value) }}</dd></div>
            <div class="full-field"><dt>{{ ct('Morphology') }}</dt><dd>{{ display(detail.staff.latest_approved_observation.content.morphology) }}</dd></div>
            <div class="full-field"><dt>{{ ct('Notes') }}</dt><dd>{{ display(detail.staff.latest_approved_observation.content.notes) }}</dd></div>
          </dl>
        </template>
        <p v-else class="plant-view-empty">{{ label('viewNoApprovedObservation') }}</p>
        <h4>{{ label('viewLatestObservation') }}</h4>
        <template v-if="detail.staff.latest_observation">
          <dl class="plant-view-fields">
            <div><dt>{{ ct('Status') }}</dt><dd>{{ ct(detail.staff.latest_observation.status) }}</dd></div>
            <div><dt>{{ ct('Date') }}</dt><dd>{{ reviewDateTime(detail.staff.latest_observation.created_at) }}</dd></div>
            <div><dt>{{ ct('Height') }}</dt><dd>{{ display(detail.staff.latest_observation.content.heightCm) }}</dd></div>
            <div><dt>{{ ct('Health') }}</dt><dd>{{ ct(detail.staff.latest_observation.content.healthStatus) }}</dd></div>
            <div><dt>{{ ct('Growth stage') }}</dt><dd>{{ ct(detail.staff.latest_observation.content.lifeStage) }}</dd></div>
            <div><dt>{{ ct('Latitude') }} / {{ ct('Longitude') }}</dt><dd>{{ display(detail.staff.latest_observation.content.latitude) }} / {{ display(detail.staff.latest_observation.content.longitude) }}</dd></div>
            <div v-for="([key, value]) in Object.entries(detail.staff.latest_observation.content.taxonomy)" :key="key"><dt>{{ ct(key) }}</dt><dd>{{ display(value) }}</dd></div>
            <div class="full-field"><dt>{{ ct('Morphology') }}</dt><dd>{{ display(detail.staff.latest_observation.content.morphology) }}</dd></div>
            <div class="full-field"><dt>{{ ct('Notes') }}</dt><dd>{{ display(detail.staff.latest_observation.content.notes) }}</dd></div>
          </dl>
        </template>
        <p v-else class="plant-view-empty">{{ label('viewNoLatestObservation') }}</p>
      </section>
    </template>
  </AppModal>
</template>

<style scoped>
.plant-view-modal :deep(.modal-card.wide) { width:min(760px,calc(100vw - 32px));box-sizing:border-box;max-height:calc(100dvh - 32px);overflow-y:auto;padding:24px; }
.plant-view-modal :deep(.modal-header) { align-items:flex-start;gap:16px;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid #d7e2dc; }
.plant-view-title { display:flex;align-items:center;gap:12px;color:#174c38;overflow-wrap:anywhere; }
.plant-view-title svg { width:36px;height:36px;flex:none; }
.plant-view-section { display:grid;gap:12px;margin-bottom:20px;min-width:0; }
.plant-view-section h3,.plant-view-section h4 { margin:0;color:#174c38; }
.plant-view-section h3 { font-size:18px;line-height:26px; }
.plant-view-section h4 { font-size:16px;line-height:24px; }
.plant-view-fields { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:0; }
.plant-view-fields>div { min-width:0;padding:12px;border:1px solid #d7e2dc;border-radius:10px;background:#f2f6ef; }
.plant-view-fields dt { margin-bottom:4px;color:#315848;font-size:13px;font-weight:600;line-height:20px; }
.plant-view-fields dd { margin:0;color:#29483e;font-size:14px;line-height:22px;white-space:pre-wrap;overflow-wrap:anywhere; }
.plant-view-fields .full-field { grid-column:1/-1; }
.plant-view-empty { margin:0;color:#53695e;font-size:14px;line-height:22px; }
@media(max-width:600px) { .plant-view-modal :deep(.modal-card.wide){width:calc(100vw - 20px);max-height:calc(100dvh - 20px);padding:16px}.plant-view-fields{grid-template-columns:minmax(0,1fr);gap:8px}.plant-view-fields .full-field{grid-column:auto}.plant-view-title{gap:8px}.plant-view-title svg{width:30px;height:30px} }
</style>
