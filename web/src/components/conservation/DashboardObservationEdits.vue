<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import MonitoringIdentifier from './MonitoringIdentifier.vue'
import { sessionSnapshot, subscribeSession } from '../../services/auth'
import { loadObservationEditQueue, observationEditDestination, observationEditRequest, ObservationEditQueueLimitError, type ObservationEdit } from '../../services/observationEdits'
import { reviewDateTime } from '../../utils/officerMonitoringDisplay'
import { formatPlantId } from '../../utils/plantId'
const router = useRouter(), { t } = useI18n()
const label = (key: string) => t('dashboardObservationEdits.' + key)
const session = ref(sessionSnapshot()), rows = ref<ObservationEdit[]>([]), names = ref<Record<string,string>>({})
const loading = ref(false), error = ref('')
const ready = computed(() => !session.value.pending && session.value.user?.role === 'Conservation Officer' && session.value.user.status === 'Active' && session.value.user.mustChangePassword === false)
const eligible = computed(() => ready.value ? rows.value.filter(row => row.status === 'Pending Review' && Number.isSafeInteger(row.revision) && row.revision > 0 && row.owner_subject !== `staff:${session.value.user?.id}` && row.observation_edit.current.status === 'Approved') : [])
const preview = computed(() => eligible.value.slice(0,4))
const identifiers = computed(() => new Map(rows.value.flatMap(row => [[row.id,'CHANGE-'+row.id.slice(0,8)],[row.observation_edit.observation_id,'OBS-'+row.observation_edit.observation_id.slice(0,8)]])))
const people = computed(() => new Map(rows.value.map(row => { const id=row.owner_subject.startsWith('staff:') ? row.owner_subject.slice(6) : ''; return [row.owner_subject, names.value[id] || t('conservationPages.observations.submitterIdentifier',{id:row.owner_subject})] })))
const originLabel = (row: ObservationEdit) => t('observationTable.' + (row.observation_edit.current.origin_type === 'initial_registration' ? 'initial' : row.observation_edit.current.origin_type === 'subsequent_observation' ? 'subsequent' : 'legacy'))
let generation = 0, disposed = false
async function load() {
  const token = ++generation, actor = session.value.user?.id
  const current = () => !disposed && token === generation && ready.value && actor === session.value.user?.id
  rows.value=[]; names.value={}; error.value=''; loading.value=false
  if (!ready.value || disposed) return
  loading.value=true
  try {
    const result=await loadObservationEditQueue(async path => { const payload=await observationEditRequest(path); if(path.endsWith('/capabilities') && payload.available === false) throw Error('Unavailable capability'); return payload },current)
    if (!current()) return
    rows.value=result
    const ids=[...new Set(result.filter(row=>row.owner_subject.startsWith('staff:')).map(row=>row.owner_subject.slice(6)))].slice(0,100)
    if(ids.length) try {
      const response=await fetch('/api/conservation/submitter-names?ids='+encodeURIComponent(ids.join(',')),{credentials:'same-origin',signal:AbortSignal.timeout(15000)})
      if(response.ok){const payload=await response.json();if(current() && payload.names && typeof payload.names==='object' && !Array.isArray(payload.names)) names.value=Object.fromEntries(Object.entries(payload.names).filter(([id,name])=>ids.includes(id)&&typeof name==='string'&&name.trim())) as Record<string,string>}
    } catch { /* Keep the existing safe identifier fallback when verified names are unavailable. */ }
  } catch(cause) { if(current()) error.value=(cause as Error)?.name === 'ObservationEditEvidenceError' ? t('unifiedObservations.invalidEvidence') : label(cause instanceof ObservationEditQueueLimitError ? 'limit' : 'unavailable') }
  finally { if(current()) loading.value=false }
}
function review(row: ObservationEdit) {
  if(!ready.value || loading.value || error.value || !eligible.value.includes(row)) return
  void router.push(observationEditDestination(row.id, row.observation_edit.current.origin_type))
}
const unsubscribe=subscribeSession((user,pending)=>{session.value={user,pending}})
watch(() => [ready.value,session.value.user?.id], () => { void load() }, {immediate:true,flush:'sync'})
onBeforeUnmount(()=>{disposed=true;generation++;unsubscribe();rows.value=[];names.value={}})
</script>

<template>
  <section class="panel dashboard-observation-edits" :aria-label="label('title')">
    <header class="panel-header"><div><h2>{{ label('title') }}</h2><p>{{ label('scope') }}</p></div>
      <button type="button" class="secondary-button" :disabled="!ready || loading" @click="load">{{ label('refresh') }}</button>
    </header>
    <p class="proposal-count" role="status">{{ label('pending') }}: <strong>{{ !ready || loading || error ? String.fromCharCode(8212) : eligible.length }}</strong></p>
    <p v-if="!ready" role="status">{{ label('session') }}</p>
    <p v-else-if="loading" role="status">{{ label('loading') }}</p>
    <p v-else-if="error" class="error-state" role="alert">{{ error }}</p>
    <p v-else-if="!preview.length">{{ label('empty') }}</p>
    <div v-else class="table-scroll" role="region" :aria-label="label('title')" tabindex="0">
      <table class="proposal-preview"><thead><tr>
        <th scope="col">{{ label('request') }}</th><th scope="col">{{ label('observation') }}</th><th scope="col">{{ label('plant') }}</th><th scope="col">{{ t('observationTable.type') }}</th><th scope="col">{{ label('submitter') }}</th><th scope="col">{{ label('status') }}</th><th scope="col">{{ label('submitted') }}</th><th scope="col">{{ label('action') }}</th>
      </tr></thead><tbody><tr v-for="row in preview" :key="'observation-edit:'+row.id">
        <td><MonitoringIdentifier :value="row.id" :labels="identifiers" /></td>
        <td><MonitoringIdentifier :value="row.observation_edit.observation_id" :labels="identifiers" /></td>
        <td>{{ formatPlantId(row.plant_id ?? '') }}</td><td>{{ originLabel(row) }}</td>
        <td><MonitoringIdentifier :value="row.owner_subject" :labels="people" /></td>
        <td><span class="badge">{{ t('observationEdits.statuses.Pending Review') }}</span></td>
        <td>{{ reviewDateTime(row.created_at) }}</td><td><button type="button" class="action-button" @click="review(row)">{{ label('review') }}</button></td>
      </tr></tbody></table>
    </div>
    <button v-if="ready && !loading && !error && eligible.length" type="button" class="secondary-button" @click="router.push({name:'conservation-observations'})">{{ label('viewAll') }}</button>
  </section>
</template>

<style scoped>
.dashboard-observation-edits { margin-block: 18px; }
.proposal-count { color: #245443; }
.table-scroll { max-width: 100%; overflow-x: auto; }
.proposal-preview { min-width: 70rem; width: 100%; }
th, td { padding: 12px 14px; text-align: left; vertical-align: middle; }
td:last-child, td:nth-child(3), td:nth-child(7) { white-space: nowrap; }
.badge { background: #FEF9C3; color: #854D0E; white-space: nowrap; }
.error-state { color: #9b3d35; }
</style>
