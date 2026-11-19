<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import ObservationEditReview from './ObservationEditReview.vue'
import { sessionSnapshot, subscribeSession } from '../../services/auth'
import { loadObservationEditQueue, observationEditDestination, observationEditRequest, ObservationEditQueueLimitError, ObservationEditError, ObservationEditCapabilityError, type ObservationEdit, type ObservationEditQueueState } from '../../services/observationEdits'
const router = useRouter(), { t } = useI18n()
const emit = defineEmits<{ state: [value: ObservationEditQueueState] }>()
const label = (key: string) => t((['scope','empty','limit','unavailable'].includes(key) ? 'observationEditQueue.' : 'dashboardObservationEdits.') + key)
const session = ref(sessionSnapshot()), rows = ref<ObservationEdit[]>([]), names = ref<Record<string,string>>({})
const loading = ref(false), error = ref('')
const ready = computed(() => !session.value.pending && session.value.user?.role === 'Conservation Officer' && session.value.user.status === 'Active' && session.value.user.mustChangePassword === false)
let generation = 0, disposed = false, readbackSequence = 0
const readbacks = new Map<string, { sequence: number; row: ObservationEdit }>()
async function load() {
  const token = ++generation, actor = session.value.user?.id, started = readbackSequence
  const current = () => !disposed && token === generation && ready.value && actor === session.value.user?.id
  rows.value=[]; names.value={}; error.value=''; loading.value=false
  if (!ready.value || disposed) return
  loading.value=true
  try {
    const result=await loadObservationEditQueue(async path => { const payload=await observationEditRequest(path); if(path.endsWith('/capabilities') && payload.available === false) throw new ObservationEditCapabilityError('Unavailable capability'); return payload },current)
    if (!current()) return
    rows.value=[...new Map(result.map(row => {
      const fresh=readbacks.get(row.id)
      return [row.id, fresh && fresh.sequence > started ? fresh.row : row] as const
    })).values()]
    const ids=[...new Set(result.filter(row=>row.owner_subject.startsWith('staff:')).map(row=>row.owner_subject.slice(6)))].slice(0,100)
    if(ids.length) try {
      const response=await fetch('/api/conservation/submitter-names?ids='+encodeURIComponent(ids.join(',')),{credentials:'same-origin',signal:AbortSignal.timeout(15000)})
      if(response.ok){const payload=await response.json();if(current() && payload.names && typeof payload.names==='object' && !Array.isArray(payload.names)) names.value=Object.fromEntries(Object.entries(payload.names).filter(([id,name])=>ids.includes(id)&&typeof name==='string'&&name.trim())) as Record<string,string>}
    } catch { /* Keep the existing safe identifier fallback when verified names are unavailable. */ }
  } catch(cause) { if(current()) error.value = (cause as Error)?.name === 'ObservationEditEvidenceError' ? t('unifiedObservations.invalidEvidence') : cause instanceof ObservationEditQueueLimitError ? label('limit') : cause instanceof ObservationEditCapabilityError ? t('unifiedObservations.capabilityError') : cause instanceof ObservationEditError ? t('unifiedObservations.httpError', { status: cause.status }) : label('unavailable') }
  finally { if(current()) loading.value=false }
}
function view(row: ObservationEdit) {
  if (!ready.value || loading.value || error.value) return
  void router.push(observationEditDestination(row.id, row.observation_edit.current.origin_type))
}
function update(row: ObservationEdit) {
  if (!ready.value || disposed) return
  readbacks.set(row.id, { sequence: ++readbackSequence, row })
  rows.value=rows.value.map(item => item.id === row.id ? row : item)
}
const unsubscribe=subscribeSession((user,pending)=>{
  if (!user || user.id !== session.value.user?.id || pending) readbacks.clear()
  session.value={user,pending}
})
watch(() => [ready.value,session.value.user?.id], () => { void load() }, {immediate:true,flush:'sync'})
watch([rows,names,loading,error], () => emit('state', { rows: rows.value, names: names.value, loading: loading.value, error: error.value }), {immediate:true,flush:'sync'})
defineExpose({load,view})
onBeforeUnmount(()=>{disposed=true;generation++;unsubscribe();readbacks.clear();rows.value=[];names.value={}})
</script>

<!-- Queue state and the existing deep-link dialog; the parent owns the only table. -->
<template><ObservationEditReview @updated="update" /></template>
