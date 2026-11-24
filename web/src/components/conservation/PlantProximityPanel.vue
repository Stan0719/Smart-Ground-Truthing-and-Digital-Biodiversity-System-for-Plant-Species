<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { sessionSnapshot, subscribeSession } from '../../services/auth'
import { requestPlantPreview, type PlantPreview, type ProximityResult } from '../../services/plantProximity'
import { formatPlantId } from '../../utils/plantId'
import PlantProximityImage from './PlantProximityImage.vue'
import ReviewLocationMap from './ReviewLocationMap.vue'
import { proximityScoreTone, formatProximityScore, gpsAccuracyUncertain, groupRiskScore, matchStatusKey } from '../../services/plantProximityScore'
import { workflowBadgeStyle } from '../../utils/workflowBadge'
const props = defineProps<{ observationId?: string; revision?: number; value?: ProximityResult | null; loading?: boolean; failed?: boolean; context?: string }>()
const emit = defineEmits<{ retry: [] }>()
const { t, locale } = useI18n(), text = (key: string, values = {}) => t('plantProximity.' + key, values)
const session = ref(sessionSnapshot()), result = computed(() => props.value || null)
const authorized = computed(() => !session.value.pending && session.value.user?.role === 'Conservation Officer' && session.value.user.status === 'Active' && !session.value.user.mustChangePassword)
const drawer = ref<HTMLDialogElement | null>(null), drawerOpen = ref(false)
const previews = ref<Record<string, PlantPreview>>({})
const previewTokens = new Map<string, symbol>()
const mapRemoved = ref(false)
const nearby = computed(() => result.value?.candidates.slice(0, 5) || [])
const candidateScore = (candidate: ProximityResult['candidates'][number]) => result.value?.state === 'complete' ? groupRiskScore(candidate, result.value) : null
const scoreText = (candidate: ProximityResult['candidates'][number]) => {
  if (result.value?.state === 'incomplete') return text('tableIncomplete')
  const score = candidateScore(candidate)
  if (score !== null) return formatProximityScore(score, locale.value)
  return candidate.match_status === 'same_species_zone' ? text('tableUncertainMatch') : text(matchStatusKey(candidate.match_status))
}
const matchText = (candidate: ProximityResult['candidates'][number]) => {
  const speciesStatus = candidate.species_match_status
  const zoneStatus = candidate.zone_match_status
  if (speciesStatus === 'provisional_same_name' || speciesStatus === 'provisional_different_name') {
    const key = speciesStatus === 'provisional_same_name'
      ? zoneStatus === 'same' ? 'matchProvisionalSameNameSameZone' : zoneStatus === 'different' ? 'matchProvisionalSameNameDifferentZone' : 'matchProvisionalSameNameUnknownZone'
      : zoneStatus === 'same' ? 'matchProvisionalDifferentNameSameZone' : zoneStatus === 'different' ? 'matchProvisionalDifferentNameDifferentZone' : 'matchProvisionalDifferentNameUnknownZone'
    return text(key)
  }
  if (speciesStatus === 'unknown') return text(zoneStatus === 'unknown' ? 'matchSpeciesAndZoneUnknown' : 'matchUncertainSpecies')
  if (speciesStatus === 'confirmed_different') return text('matchDifferentSpecies')
  if (candidate.match_status === 'same_species_zone' && result.value &&
      (gpsAccuracyUncertain(result.value.accuracy_m, result.value.config.accuracy_warning_m) || gpsAccuracyUncertain(candidate.accuracy_m, result.value.config.accuracy_warning_m))) return text('matchGpsUncertain')
  if (zoneStatus === 'unknown') return text('matchUncertainZone')
  if (zoneStatus === 'different') return text('matchDifferentZone')
  return candidate.match_status === 'same_species_zone'
    ? text(candidate.within_grouping_radius ? 'matchWithinGroupingRadius' : 'matchBeyondGroupingRadius', { radius: number(result.value?.config.grouping_radius_m ?? 5) })
    : text(matchStatusKey(candidate.match_status))
}
let drawerGeneration = 0, generation = 0, disposed = false
let trigger: HTMLElement | null = null, previewController: AbortController | null = null
const mapCandidate = ref<ProximityResult['candidates'][number] | null>(null)
function closeDrawer() {
  mapCandidate.value = null
  drawerGeneration++; drawerOpen.value = false
  if (drawer.value?.open) drawer.value.close()
  const target = trigger; trigger = null
  if (target?.isConnected) target.focus({ preventScroll: true })
}
async function openDrawer(event: Pick<Event, 'currentTarget'>) {
  if (!props.observationId || !authorized.value || drawerOpen.value) return
  trigger = event.currentTarget as HTMLElement
  const attempt = ++drawerGeneration
  drawerOpen.value = true
  await nextTick()
  if (attempt !== drawerGeneration || !drawerOpen.value || !authorized.value || !drawer.value) return
  drawer.value.inert = false
  drawer.value.showModal()
  await loadPreviews()
}
async function loadPreviews() {
  if (!drawerOpen.value || !result.value || !authorized.value) return
  const token = generation
  previewController ??= new AbortController()
  const signal = previewController.signal
  await Promise.all(nearby.value.map(async candidate => {
    if (previews.value[candidate.plant_id]) return
    // Reserve each entry before fetching: reopening cannot duplicate requests.
    previews.value[candidate.plant_id] = { image: '', scientificName: '', commonName: '' }
    const requestToken = Symbol(); previewTokens.set(candidate.plant_id, requestToken)
    try {
      const preview = await requestPlantPreview(candidate.plant_id, signal)
      if (token === generation && previewTokens.get(candidate.plant_id) === requestToken && authorized.value && !disposed) previews.value[candidate.plant_id] = preview
    } catch { /* Keep the authorized placeholder; proximity remains usable. */ }
  }))
}
function backdrop(event: MouseEvent) {
  if (event.target !== drawer.value || !drawer.value) return
  const box = drawer.value.getBoundingClientRect()
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeDrawer()
}
function clearPreviews() { mapCandidate.value = null; mapRemoved.value = false; previewTokens.clear(); generation++; previewController?.abort(); previewController = null; previews.value = {} }
function reset() { closeDrawer(); clearPreviews() }
const unsubscribe = subscribeSession(() => { reset(); session.value = sessionSnapshot() })
watch(() => [props.observationId, props.revision], reset)
watch(() => props.value, (value, previous) => {
  if (!value || value.observation_id !== previous?.observation_id || value.revision !== previous?.revision) {
    clearPreviews(); void loadPreviews(); return
  }
  const candidates = new Map(value.candidates.map(candidate => [candidate.plant_id, candidate]))
  for (const id of Object.keys(previews.value)) {
    const candidate = candidates.get(id), old = previous?.candidates.find(item => item.plant_id === id)
    if (!candidate || candidate.status !== old?.status || candidate.plant_name !== old?.plant_name || candidate.species_name !== old?.species_name) {
      delete previews.value[id]; previewTokens.delete(id)
    }
  }
  if (mapCandidate.value) {
    const next = candidates.get(mapCandidate.value.plant_id)
    if (!next) {
      mapCandidate.value = null; mapRemoved.value = true
      void nextTick(() => { if (drawerOpen.value && authorized.value && mapRemoved.value) drawer.value?.focus({ preventScroll: true }) })
    } else if (JSON.stringify(next) !== JSON.stringify(mapCandidate.value)) mapCandidate.value = next
  }
  void loadPreviews()
}, { flush: 'sync' })
onBeforeUnmount(() => { disposed = true; reset(); unsubscribe() })
const number = (value: number) => new Intl.NumberFormat(locale.value, { maximumFractionDigits: 2 }).format(value)
const accuracyText = (value: number | null | undefined) => value == null ? text('accuracyUnknown') : `${number(value)} m`
const uncertain = (value: number | null | undefined) => gpsAccuracyUncertain(value, result.value?.config.accuracy_warning_m ?? 10)
defineExpose({ openDrawer, closeDrawer })
</script>

<template>
  <Teleport to="body">
    <dialog ref="drawer" class="nearby-drawer" :aria-label="text('nearbyTitle')" @cancel.prevent.stop="closeDrawer" @keydown.stop @click="backdrop" @close="!drawer?.open && closeDrawer()">
      <template v-if="drawerOpen && authorized">
        <header class="nearby-drawer-header"><div><h2><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>{{ text('nearbyTitle') }}</h2><p v-if="context">{{ context }}</p><p v-if="result">{{ text('showing', { count: nearby.length, radius: number(result.config.radius_m) }) }}</p></div><button type="button" class="nearby-close" autofocus :aria-label="text('closeDrawer')" @click="closeDrawer">×</button></header>
        <div class="nearby-drawer-content">
          <p v-if="loading && !result" role="status">{{ text('loading') }}</p>
          <p v-else-if="failed || result?.state === 'unavailable'" role="status">{{ text('unavailable') }}</p>
          <p v-if="mapRemoved" role="status">{{ text('mapCandidateRemoved') }}</p>
          <template v-if="result">
            <p v-if="result.state === 'not_eligible'">{{ text('tableNotEligible') }}</p>
            <p v-if="result.state === 'complete' && !nearby.length" role="status">{{ text('none', { radius: number(result.config.radius_m) }) }} {{ text('noScore') }}</p>
            <p v-if="result.state === 'incomplete'" class="proximity-incomplete" role="status">{{ text('incomplete') }}</p>
            <ol class="proximity-candidates">
              <li v-for="candidate in nearby" :key="candidate.plant_id" :class="proximityScoreTone(candidateScore(candidate))">
                <PlantProximityImage :src="previews[candidate.plant_id]?.image || ''" :alt="text('photo', { plant: formatPlantId(candidate.plant_id) })" :unavailable="text('photoUnavailable')" />
                <div class="nearby-plant-copy">
                  <div class="proximity-candidate-heading">
                    <div class="nearby-names"><strong class="nearby-plant-id">{{ formatPlantId(candidate.plant_id) }}</strong><p><em>{{ previews[candidate.plant_id]?.scientificName || candidate.plant_name || candidate.species_name || text('unnamed') }}</em></p><p v-if="previews[candidate.plant_id]?.commonName">{{ previews[candidate.plant_id]?.commonName }}</p><span class="proximity-status" :style="workflowBadgeStyle(candidate.status)">{{ t('dashboardValues.' + (candidate.status === 'Approved' ? 'approved' : 'pendingreview')) }}</span></div>
                    <aside class="candidate-risk" :class="proximityScoreTone(candidateScore(candidate))" :aria-label="text('scoreHeading')"><span>{{ text('scoreHeading') }}</span><strong v-if="candidateScore(candidate) !== null">{{ scoreText(candidate) }}</strong><span v-else class="candidate-match" :class="candidate.match_status">{{ matchText(candidate) }}</span></aside>
                  </div>
                  <div class="candidate-distance"><span>{{ text('distanceLabel') }}: <strong>{{ number(candidate.distance_m) }} m</strong></span><span class="proximity-category" :class="candidate.category">{{ text('short_' + candidate.category) }}</span></div>
                  <div class="nearby-plant-footer"><div class="gps-accuracy"><strong>{{ text('accuracyHeading') }}</strong><dl><div><dt>{{ text('newPlantAccuracy') }}:</dt><dd>{{ accuracyText(result.accuracy_m) }}</dd></div><div><dt>{{ text('existingPlantAccuracy') }}:</dt><dd>{{ accuracyText(candidate.accuracy_m) }}</dd></div></dl></div><button type="button" class="nearby-map-button" @click="mapRemoved = false; mapCandidate = candidate">{{ text('viewOnMap') }}</button></div>
                  <p v-if="uncertain(result.accuracy_m) || uncertain(candidate.accuracy_m)" class="score-uncertainty"><span aria-hidden="true">ⓘ</span><span>{{ text('drawerGpsWarning') }}</span></p>
                </div>
              </li>
            </ol>
          </template>
          <button v-if="failed || result?.state === 'unavailable' || result?.state === 'incomplete'" type="button" class="proximity-retry" :disabled="loading" @click="emit('retry')">{{ text('retry') }}</button>
        </div>
      </template>
    </dialog>
    <ReviewLocationMap v-if="mapCandidate && result && authorized" :key="observationId + ':' + revision + ':' + mapCandidate.plant_id"
      :target="{ plantId: result.plant_id, status: result.target_location?.status || '', latitude: result.target_location?.latitude, longitude: result.target_location?.longitude, accuracy: result.accuracy_m, source: result.target_location?.source || '' }"
      :candidate="{ plantId: mapCandidate.plant_id, status: mapCandidate.status, latitude: mapCandidate.latitude, longitude: mapCandidate.longitude, accuracy: mapCandidate.accuracy_m, source: mapCandidate.location_source }" @close="mapCandidate = null" />
  </Teleport>
</template>

<style scoped>
.proximity-retry { padding: 7px 12px; border: 1px solid #afc8b7; border-radius: 6px; background: #fff; color: #245a46; cursor: pointer; }
.nearby-drawer { position: fixed; inset: 0 0 0 auto; box-sizing: border-box; width: min(700px, 100vw); max-width: 100vw; height: 100dvh; max-height: 100dvh; margin: 0; padding: 0; border: 0; border-left: 1px solid #d5dfd8; background: #fff; color: #173f34; box-shadow: -12px 0 40px #102b2529; overflow: hidden; }
.nearby-drawer[open] { display: flex; flex-direction: column; animation: nearby-enter 180ms ease-out; }
.nearby-drawer::backdrop { background: rgb(0 0 0 / 38%); }
.nearby-drawer-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 18px 22px; border-bottom: 1px solid #e1e9e3; background: #15563f; color: #fff; }
.nearby-drawer-header h2 svg { width: 26px; height: 26px; flex-shrink: 0; }
.nearby-drawer-header h2 { display: flex; align-items: center; gap: 10px; margin: 0; font-size: 22px; }
.nearby-drawer-header p { margin: 5px 0 0 36px; font-size: 12px; color: #e2eee8; }
.nearby-close { flex: 0 0 40px; height: 40px; border: 1px solid #d6e2da; border-radius: 50%; background: #fff; color: #244b3d; font-size: 26px; cursor: pointer; }
.nearby-drawer-content { min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 18px 22px 28px; }
.proximity-candidates { display: grid; gap: 14px; margin: 0; padding: 0; list-style: none; }
.proximity-candidates li { display: grid; grid-template-columns: 112px minmax(0, 1fr); gap: 14px; padding: 13px; border: 1px solid #dce5de; border-radius: 12px; background: #fff; }
.proximity-candidates li.high { border-color: #e5aaa4; background: #fff8f7; }
.nearby-plant-copy { min-width: 0; overflow-wrap: anywhere; }
.proximity-candidate-heading { display: grid; grid-template-columns: minmax(0, 1fr) 126px; align-items: start; gap: 12px; }
.nearby-names { min-width: 0; }
.nearby-plant-id { font-size: 18px; }
.candidate-match { display: block; margin-top: 5px; color: inherit; font-size: 10px; font-weight: 500; line-height: 1.3; overflow-wrap: anywhere; }
.candidate-match.same_species_zone { color: #245a46; font-weight: 700; }
.candidate-match.different_species, .candidate-match.different_zone { color: #526a5e; }
.candidate-match.uncertain_species, .candidate-match.uncertain_zone, .candidate-match.uncertain_match { color: #815f1e; }
.nearby-names p { margin: 4px 0; font-size: 13px; line-height: 1.45; }
.candidate-risk { min-width: 0; padding: 9px 10px; border: 1px solid #e2eae4; border-radius: 10px; background: #f2f6f3; text-align: center; }
.candidate-risk > span:first-child { display: block; font-size: 10px; font-weight: 700; line-height: 1.3; }
.candidate-risk strong { display: block; margin-top: 3px; font-size: 23px; line-height: 1.2; }
.candidate-risk.high { background: #fde2df; color: #973831; }
.candidate-risk.raised { background: #fff0c5; color: #79580e; }
.candidate-risk.moderate { background: #e6f0e7; color: #315c48; }
.candidate-risk.low, .candidate-risk.unknown { background: #eef1f3; color: #455661; }
.candidate-distance { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 14px 0 8px; font-size: 13px; }
.proximity-category { display: inline-block; padding: 3px 8px; border-radius: 12px; background: #edf3ef; color: #315c48; font-size: 11px; font-weight: 600; }
.proximity-category.very_close { background: #fde2df; color: #973831; }
.proximity-category.close { background: #fff0c5; color: #79580e; }
.proximity-category.nearby { background: #e6f0e7; color: #315c48; }
.proximity-status { display: inline-block; margin-top: 8px; padding: 3px 8px; border-radius: 12px; font-size: 11px; }
.nearby-plant-footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; margin-top: 6px; }
.gps-accuracy { flex: 1 1 180px; font-size: 11px; line-height: 1.5; }
.gps-accuracy dl { display: grid; gap: 2px; margin: 4px 0 0; }
.gps-accuracy dl div { display: flex; flex-wrap: wrap; gap: 4px; }
.gps-accuracy dd { margin: 0; }
.nearby-plant-footer a, .nearby-map-button { padding: 8px 10px; border: 1px solid #91b5a1; border-radius: 6px; color: #245a46; text-decoration: none; font-size: 12px; font-weight: 600; }
.score-uncertainty { display: flex; align-items: flex-start; gap: 6px; color: #78561c; font-size: 12px; line-height: 1.5; margin: 10px 0 0; }
.proximity-incomplete { color: #815f1e; font-size: 12px; line-height: 1.5; }
button:focus-visible, a:focus-visible { outline: 3px solid #33745d; outline-offset: 3px; }
@keyframes nearby-enter { from { transform: translateX(100%); } to { transform: translateX(0); } }
@media (prefers-reduced-motion: reduce) { .nearby-drawer[open] { animation: none; } }
@media (max-width: 580px) {
  .nearby-drawer-header { padding: 14px 12px; } .nearby-drawer-header h2 { font-size: 19px; } .nearby-drawer-header h2 svg { width: 22px; height: 22px; } .nearby-drawer-header p { margin-left: 32px; }
  .nearby-drawer-content { padding: 14px 10px 24px; }
  .proximity-candidates li { grid-template-columns: 76px minmax(0, 1fr); gap: 10px; padding: 10px; }
  .proximity-candidate-heading { grid-template-columns: minmax(0, 1fr) 96px; gap: 6px; } .nearby-plant-id { font-size: 15px; }
  .candidate-risk { padding: 6px; } .candidate-risk strong { font-size: 19px; } .candidate-match { font-size: 9px; }
  .candidate-distance { margin-top: 10px; }
}
@media (max-width: 360px) { .proximity-candidate-heading { grid-template-columns: minmax(0, 1fr); } .candidate-risk { justify-self: stretch; } }
</style>
