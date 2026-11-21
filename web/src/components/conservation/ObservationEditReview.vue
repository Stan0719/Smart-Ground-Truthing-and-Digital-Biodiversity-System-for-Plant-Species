<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import ActionFeedback from '../ActionFeedback.vue'
import { officerActionError, officerSaveUncertain } from '../../services/officerActionFeedback'
import AppModal from './AppModal.vue'
import MonitoringIdentifier from './MonitoringIdentifier.vue'
import { sessionSnapshot, subscribeSession } from '../../services/auth'
import { mapObservationEdit, observationEditDestination, observationEditRequest, type ObservationEdit } from '../../services/observationEdits'
import { assetUrlFromId } from '../../services/assetImages'
import { reviewDateTime } from '../../utils/officerMonitoringDisplay'
const emit = defineEmits<{ updated: [row: ObservationEdit] }>()
const { t } = useI18n(), route = useRoute(), router = useRouter()
const label = (key: string) => t('observationEdits.' + key)
const session = ref(sessionSnapshot()), selected = ref<ObservationEdit | null>(null)
const ready = computed(() => !session.value.pending && session.value.user?.role === 'Conservation Officer' && session.value.user.status === 'Active' && !session.value.user.mustChangePassword)
const identifiers = computed(() => new Map(selected.value ? [[selected.value.id,'CHANGE-'+selected.value.id.slice(0,8)],[selected.value.observation_edit.observation_id,'OBS-'+selected.value.observation_edit.observation_id.slice(0,8)]] : []))
const comment = ref(''), busy = ref(false), blocked = ref(true), message = ref(''), history = ref<Record<string, unknown>[]>([]), historyUnavailable = ref(false)
const actionText = (key: string) => t('officerFeedback.' + key)
const commentError = ref(''), commentInput = ref<HTMLTextAreaElement | null>(null)
const successNotice = ref(false), successSequence = ref(0), outcomeUncertain = ref(false), conflictNotice = ref(false)
const inspectable = ref(false)
const readbackUnverified = ref(false)
const failed = ref(new Set<string>()), names = ref<Record<string,string>>({})
let generation = 0, disposed = false
const currency = (token: number, id: string, actor: string | undefined) => !disposed && token === generation && ready.value && session.value.user?.id === actor && route.query.observationEdit === id
const eligible = computed(() => ready.value && !busy.value && !blocked.value && selected.value?.status === 'Pending Review' &&
  Number.isSafeInteger(selected.value.revision) && selected.value.revision > 0 && selected.value.owner_subject !== `staff:${session.value.user?.id}` && selected.value.observation_edit.current.status === 'Approved')
const fields = ['heightCm','lifeStage','healthStatus','morphology','notes','zone','latitude','longitude','accuracy_m']
const content = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string,unknown> : {}
const show = (value: unknown) => value === undefined || value === null ? label('unavailable') : String(value)
const person = (subject: string | null) => { const name = subject?.startsWith('staff:') ? names.value[subject.slice(6)] : ''; return typeof name === 'string' && name.trim() ? name.trim() : '\u2014' }
const stamp = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? reviewDateTime(value) : label('unavailable')
const basePhotos = computed(() => (Array.isArray(selected.value?.base_snapshot.photo_ids) ? selected.value!.base_snapshot.photo_ids : []).flatMap(id => { const url = assetUrlFromId(id); return url ? [url] : [] }))
const currentPhotos = computed(() => { const assets=selected.value?.observation_edit.current.assets;return Array.isArray(assets) ? assets.flatMap(asset=>{const url=assetUrlFromId(content(asset).id);return url ? [url] : []}) : [] })
const proposedPhotos = computed(() => selected.value ? [
  ...selected.value.observation_edit.retained_photo_ids.flatMap(id => {const url = assetUrlFromId(id);return url ? [url] : []}),
  ...Array.from({length:selected.value.proposal_photo_count},(_,index)=>`/api/data/observation-edits/${encodeURIComponent(selected.value!.id)}/photos/${index}`),
] : [])
async function open(id: string, preserve = false) {
  if (!ready.value) return
  const token = ++generation, actor = session.value.user?.id
  busy.value = true; blocked.value = true; inspectable.value = false; message.value = ''; history.value = []; historyUnavailable.value = false; failed.value = new Set()
  if (!preserve) { readbackUnverified.value = false; outcomeUncertain.value = false; conflictNotice.value = false; successNotice.value = false; commentError.value = ''; comment.value = ''; selected.value = null; names.value = {} }
  try {
    const row = await mapObservationEdit((await observationEditRequest('/observation-edits/' + encodeURIComponent(id))).edit)
    if (!currency(token,id,actor)) return
    if (row.id !== id) throw Error('Invalid proposal identity')
    const destination = observationEditDestination(row.id, row.observation_edit.current.origin_type)
    if (route.name && route.name !== destination.name) {
      await router.replace(destination)
      return false
    }
    selected.value = row; emit('updated',row)
    blocked.value = preserve; inspectable.value = true
    if (row.status === 'Cancelled') message.value = label('cancelledReadOnly')
    else if (preserve) message.value = actionText(conflictNotice.value ? 'conflict' : 'refreshed')
    try {
      const payload = await observationEditRequest('/observations/' + encodeURIComponent(row.observation_edit.observation_id) + '/edit-history')
      if (!currency(token,id,actor)) return
      if (!Array.isArray(payload.events)) throw Error('Invalid history')
      history.value = payload.events.map(event => content(event)).filter(event => event.request_id === id)
    } catch { if (currency(token,id,actor)) historyUnavailable.value = true }
    const ids = [...new Set([row.owner_subject,row.reviewed_by,...history.value.map(event=>event.actor_subject)].filter((value):value is string=>typeof value==='string' && value.startsWith('staff:')).map(value=>value.slice(6)))]
    if (ids.length) try {
      const response = await fetch('/api/conservation/submitter-names?ids=' + encodeURIComponent(ids.join(',')),{credentials:'same-origin'})
      if (response.ok) { const payload=await response.json(); if(currency(token,id,actor)) names.value=content(payload.names) as Record<string,string> }
    } catch { /* Names remain unavailable without verified directory data. */ }
    if (currency(token,id,actor) && readbackUnverified.value) { readbackUnverified.value=false; message.value=label('reloaded') }
    if (currency(token,id,actor)) outcomeUncertain.value = false
    return currency(token,id,actor)
  } catch (error) { if (currency(token,id,actor)) message.value=readbackUnverified.value ? label('savedUnverified') : outcomeUncertain.value ? actionText('uncertain') : (error as Error)?.name === 'ObservationEditEvidenceError' ? t('unifiedObservations.invalidEvidence') : actionText(officerActionError(error)); return false }
  finally { if(currency(token,id,actor)) busy.value=false }
}
async function decide(decision: 'Approved'|'Rejected'|'Correction Required') {
  if (!eligible.value || !selected.value) return
  commentError.value = ''
  if (!comment.value.trim() || comment.value.length>4000) { commentError.value=actionText('commentRequired'); await nextTick(); commentInput.value?.focus(); return }
  const row=selected.value, token=generation, actor=session.value.user?.id
  busy.value=true;message.value='';successNotice.value=false
  try {
    const response = await observationEditRequest('/observation-edits/'+encodeURIComponent(row.id)+'/review',{decision,comment:comment.value.trim(),revision:row.revision})
    if (!currency(token,row.id,actor)) return
    const saved = content(response.edit)
    if (saved.id !== row.id || saved.status !== decision) throw Error('Unverified review acknowledgement')
    readbackUnverified.value=true; successSequence.value++; successNotice.value=true
    const verified=await open(row.id,true)
    if (currency(token+1,row.id,actor) && verified) message.value=label('saved')
  } catch (error) {
    if (!currency(token,row.id,actor)) return
    blocked.value=true;inspectable.value=false
    const kind = officerActionError(error)
    if (kind === 'conflict') { conflictNotice.value=true; message.value=actionText('conflict'); await open(row.id,true) }
    else if (kind === 'validation') { blocked.value=false; inspectable.value=true; commentError.value=actionText('validation'); await nextTick(); commentInput.value?.focus() }
    else { outcomeUncertain.value=officerSaveUncertain(error); message.value=kind==='evidence' ? t('unifiedObservations.invalidEvidence') : actionText(outcomeUncertain.value ? 'uncertain' : kind) }
  } finally {if(currency(token,row.id,actor))busy.value=false}
}
function close() { successNotice.value=false; readbackUnverified.value=false; generation++;busy.value=false;selected.value=null;comment.value='';void router.replace({query:{...route.query,observationEdit:undefined}}) }
watch(()=>route.query.observationEdit,id=>{generation++;busy.value=false;selected.value=null;if(typeof id==='string')void open(id);else comment.value=''},{immediate:true})
const unsubscribe=subscribeSession((user,pending)=>{
 successNotice.value=false
 const same=user?.id===session.value.user?.id
 generation++;busy.value=false;blocked.value=true
 session.value={user,pending}
 if(pending && user && same)return
 if(!user || !same || user.role!=='Conservation Officer' || user.status!=='Active' || user.mustChangePassword){selected.value=null;comment.value='';history.value=[];message.value='';names.value={};readbackUnverified.value=false;return}
 if(ready.value && typeof route.query.observationEdit==='string')void open(route.query.observationEdit,true)
})
onBeforeUnmount(()=>{disposed=true;generation++;unsubscribe()})
defineExpose({open})
</script>
<template>
  <p v-if="message && !selected" role="alert">{{ message }}</p>
  <AppModal v-if="selected" :title="label('title')" wide accessible @close="close">
    <ActionFeedback v-if="successNotice" :key="successSequence" :feedback-id="successSequence" variant="success" :message="actionText('saved')" @dismiss="successNotice = false" />
    <div class="review-recovery"><p v-if="message && message !== label('saved')" :role="selected.status !== 'Pending Review' && !readbackUnverified && !outcomeUncertain ? 'status' : 'alert'">{{ message }}</p><button type="button" :disabled="busy || !ready" @click="open(selected.id,true)">{{ readbackUnverified ? label('retryReload') : actionText('refresh') }}</button></div>
    <p role="note">{{ label('limitations') }}</p>
    <dl class="metadata"><dt>{{ label('proposal') }}</dt><dd><MonitoringIdentifier :labels="identifiers" :value="selected.id" /></dd><dt>{{ label('observation') }}</dt><dd><MonitoringIdentifier :labels="identifiers" :value="selected.observation_edit.observation_id" /></dd><dt>{{ label('revision') }}</dt><dd>{{ selected.revision }}</dd><dt>{{ label('status') }}</dt><dd>{{ t('observationEdits.statuses.'+selected.status) }}</dd><dt>{{ label('submittedBy') }}</dt><dd>{{ person(selected.owner_subject) }}</dd><dt>{{ label('reviewedBy') }}</dt><dd>{{ person(selected.reviewed_by) }}</dd><dt>{{ label('submittedAt') }}</dt><dd>{{ stamp(selected.created_at) }}</dd></dl>
    <p>{{ label('reasonUnavailable') }}</p>
    <section><h3>{{ label('currentApproved') }}</h3><p v-if="selected.observation_edit.current.status!=='Approved'">{{ label('unavailable') }}</p><dl v-else class="metadata"><template v-for="field in fields" :key="field"><dt>{{ t('observationEdits.fields.'+field) }}</dt><dd>{{ show(content(selected.observation_edit.current.content)[field]) }}</dd></template></dl></section>
    <section><h3>{{ label('comparison') }}</h3><div class="scroll"><table><thead><tr><th>{{ label('field') }}</th><th>{{ label('baseline') }}</th><th>{{ label('proposed') }}</th></tr></thead><tbody><tr v-for="field in fields" :key="field"><th scope="row">{{ t('observationEdits.fields.'+field) }}</th><td>{{ show(content(selected.base_snapshot.content)[field]) }}</td><td>{{ show(content(selected.proposed_snapshot.content)[field]) }}</td></tr></tbody></table></div></section>
    <div class="photo-panels"><section v-for="panel in [{title:label('currentApproved'),urls:currentPhotos},{title:label('baselinePhotos'),urls:basePhotos},{title:label('proposedPhotos'),urls:proposedPhotos}]" :key="panel.title"><h3>{{ panel.title }}</h3><p v-if="!panel.urls.length">{{ label('unavailable') }}</p><template v-for="(url,index) in panel.urls" :key="url"><img v-if="!failed.has(url)" :src="url" :alt="panel.title+' '+(index+1)" @error="failed=new Set([...failed,url])" /><p v-else>{{ label('unavailable') }}</p></template></section></div>
    <section><h3>{{ label('history') }}</h3><p v-if="historyUnavailable || !history.length">{{ label('unavailable') }}</p><ul><li v-for="(event,index) in history" :key="String(event.id||index)">{{ typeof event.event_type==='string' && ['submitted','approved','rejected','correction_required','resubmitted','cancelled'].includes(event.event_type) ? t('observationEdits.events.'+event.event_type) : label('unavailable') }} ? {{ stamp(event.created_at) }} ? {{ person(typeof event.actor_subject==='string'?event.actor_subject:null) }}<p>{{ show(event.comment) }}</p></li></ul></section>

    <label v-if="blocked && inspectable && selected.status==='Pending Review'"><input type="checkbox" :disabled="busy || !ready" @change="blocked=!($event.target as HTMLInputElement).checked" />{{ label('inspect') }}</label>
    <p v-if="selected.status!=='Pending Review'">{{ label('readOnly') }}</p>
    <label for="observation-edit-comment">{{ label('comment') }}</label><textarea id="observation-edit-comment" ref="commentInput" v-model="comment" :aria-invalid="Boolean(commentError)" :aria-describedby="commentError ? 'edit-comment-error' : undefined" maxlength="4000" :disabled="!ready || busy || selected.status!=='Pending Review'" />
    <p v-if="commentError" id="edit-comment-error" role="alert">{{ commentError }}</p>
    <div class="actions"><button v-for="decision in ['Approved','Rejected','Correction Required'] as const" :key="decision" type="button" :disabled="!eligible" @click="decide(decision)">{{ t('observationEdits.decisions.'+decision) }}</button></div>
  </AppModal>
</template>
<style scoped>
.review-recovery { margin-bottom: 12px; }
.review-recovery p[role="alert"] { padding: 12px; border: 1px solid #d5b67d; border-radius: 8px; background: #fff8e8; color: #704f1d; }
.metadata{display:grid;grid-template-columns:minmax(8rem,1fr) 2fr;gap:.5rem}.metadata dd{margin:0;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse}th,td{padding:.65rem;border:1px solid #d7e2dc;text-align:left;white-space:pre-wrap;overflow-wrap:anywhere}.scroll{overflow:auto}.photo-panels{display:grid;grid-template-columns:1fr 1fr;gap:1rem}img{max-width:100%;width:150px;height:150px;object-fit:contain}textarea{display:block;width:100%;box-sizing:border-box;min-height:6rem}.actions{display:flex;gap:.75rem;flex-wrap:wrap;margin-top:1rem}button{padding:.65rem;background:#245A46;color:white;border:0;border-radius:6px}button:disabled{opacity:.5}label{display:block;margin:.75rem 0}section{margin:1.25rem 0}@media(max-width:600px){.photo-panels{grid-template-columns:1fr}}
</style>
