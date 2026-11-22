<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import ActionFeedback from '../ActionFeedback.vue'
import { officerActionError, officerSaveUncertain } from '../../services/officerActionFeedback'
import AppModal from './AppModal.vue'
import MonitoringIdentifier from './MonitoringIdentifier.vue'
import PlantPhotoLightbox from '../PlantPhotoLightbox.vue'
import { workflowBadgeStyle } from '../../utils/workflowBadge'
import { sessionSnapshot, subscribeSession } from '../../services/auth'
import { mapObservationEdit, observationEditDestination, observationEditRequest, type ObservationEdit } from '../../services/observationEdits'
import { assetUrlFromId } from '../../services/assetImages'
import { reviewDateTime } from '../../utils/officerMonitoringDisplay'
const emit = defineEmits<{ updated: [row: ObservationEdit] }>()
const { t } = useI18n(), route = useRoute(), router = useRouter()
const { t: mobileLabel } = useI18n({ useScope: 'local', messages: {
  en: { unchangedFields: 'Unchanged fields' },
  ms: { unchangedFields: 'Medan tidak berubah' },
  'zh-CN': { unchangedFields: '未更改的字段' },
} })
const label = (key: string) => t('observationEdits.' + key)
const modalId = ref<string | null>(null), loadingDetails = ref(false)
const session = ref(sessionSnapshot()), selected = ref<ObservationEdit | null>(null)
const ready = computed(() => !session.value.pending && session.value.user?.role === 'Conservation Officer' && session.value.user.status === 'Active' && !session.value.user.mustChangePassword)
const identifiers = computed(() => new Map(selected.value ? [[selected.value.id,'CHANGE-'+selected.value.id.slice(0,8)],[selected.value.observation_edit.observation_id,'OBS-'+selected.value.observation_edit.observation_id.slice(0,8)]] : []))
const comment = ref(''), busy = ref(false), blocked = ref(true), message = ref('')
const actionText = (key: string) => t('officerFeedback.' + key)
const commentError = ref(''), commentInput = ref<HTMLTextAreaElement | null>(null)
const successNotice = ref(false), successSequence = ref(0), outcomeUncertain = ref(false), conflictNotice = ref(false)
const inspectable = ref(false)
const readbackUnverified = ref(false)
const failed = ref(new Set<string>()), names = ref<Record<string,string>>({})
let generation = 0, disposed = false
let pendingDetail: { id: string; actor: string | undefined; task: Promise<boolean | undefined> } | null = null
const currency = (token: number, id: string, actor: string | undefined) => !disposed && token === generation && ready.value && session.value.user?.id === actor && route.query.observationEdit === id
const eligible = computed(() => ready.value && !busy.value && !blocked.value && selected.value?.status === 'Pending Review' &&
  Number.isSafeInteger(selected.value.revision) && selected.value.revision > 0 && selected.value.owner_subject !== `staff:${session.value.user?.id}` && selected.value.observation_edit.current.status === 'Approved')
const fields = ['heightCm','lifeStage','healthStatus','morphology','notes','zone','latitude','longitude','accuracy_m','altitudeM','taxonomy']
const content = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string,unknown> : {}
const show = (value: unknown) => value === undefined ? label('notRecorded') : value === null ? label('nullValue') : value === '' ? label('emptyValue') : typeof value === 'object' ? JSON.stringify(value) : String(value)
const person = (subject: string | null) => { const name = subject?.startsWith('staff:') ? names.value[subject.slice(6)] : ''; return typeof name === 'string' && name.trim() ? name.trim() : '\u2014' }
const stamp = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? reviewDateTime(value) : label('unavailable')
const basePhotos = computed(() => (Array.isArray(selected.value?.base_snapshot.photo_ids) ? selected.value!.base_snapshot.photo_ids : []).flatMap(id => { const url = assetUrlFromId(id); return url ? [url] : [] }))
const proposedPhotos = computed(() => selected.value ? [
  ...selected.value.observation_edit.retained_photo_ids.flatMap(id => {const url = assetUrlFromId(id);return url ? [url] : []}),
  ...Array.from({length:selected.value.proposal_photo_count},(_,index)=>`/api/data/observation-edits/${encodeURIComponent(selected.value!.id)}/photos/${index}`),
] : [])
const preview = ref<InstanceType<typeof PlantPhotoLightbox> | null>(null)
const sharedLabel = (key: string) => t('approvedChanges.' + key)
const fieldLabel = (key: string) => {
  const path = 'observationEdits.fields.' + key, translated = t(path)
  return translated === path ? key.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ') : translated
}
const canonical = (value: unknown): string => value && typeof value === 'object'
  ? JSON.stringify(Array.isArray(value) ? value.map(canonical) : Object.keys(value).sort().map(key => [key, canonical(content(value)[key])]))
  : `${typeof value}:${String(value)}`
const comparisons = computed(() => {
  const before = content(selected.value?.base_snapshot.content), after = content(selected.value?.proposed_snapshot.content)
  return [...new Set([...fields, ...Object.keys(before), ...Object.keys(after)])]
    .filter(key => Object.hasOwn(before, key) || Object.hasOwn(after, key))
    .map(key => ({ key, before: before[key], after: after[key], changed: Object.hasOwn(before, key) !== Object.hasOwn(after, key) || canonical(before[key]) !== canonical(after[key]) }))
})
const changedFields = computed(() => comparisons.value.filter(row => row.changed))
const unchangedFields = computed(() => comparisons.value.filter(row => !row.changed))
const baselinePhotosKnown = computed(() => Array.isArray(selected.value?.base_snapshot.photo_ids))
const photoChanges = computed(() => {
  if (!selected.value) return null
  if (selected.value.proposal_photo_count > 0) return true
  if (!baselinePhotosKnown.value) return null
  const base = selected.value.base_snapshot.photo_ids as string[], retained = selected.value.observation_edit.retained_photo_ids
  return base.length !== retained.length || base.some(id => !retained.includes(id))
})
const photoPanels = computed(() => [
  { title: label('baselinePhotos'), urls: basePhotos.value, empty: baselinePhotosKnown.value && !(selected.value?.base_snapshot.photo_ids as string[]).length ? label('noPhotos') : label('baselinePhotosUnavailable') },
  { title: label('proposedPhotos'), urls: proposedPhotos.value, empty: selected.value && (selected.value.observation_edit.retained_photo_ids.length || selected.value.proposal_photo_count) ? label('photosUnavailable') : label('noPhotos') },
])
function enlarge(items: string[], index: number, event: Event, title: string) {
  if (!ready.value || busy.value) return
  const available = items.filter(url => !failed.value.has(url)), at = available.indexOf(items[index] || '')
  if (at >= 0) void preview.value?.open(available.map((url, i) => ({ id: String(i), url })), at, title, event.currentTarget as HTMLElement)
}
function open(id: string, preserve = false): Promise<boolean | undefined> {
  const actor = session.value.user?.id
  if (pendingDetail?.id === id && pendingDetail.actor === actor && modalId.value === id) return pendingDetail.task
  const task = loadDetails(id, preserve)
  pendingDetail = { id, actor, task }
  const release = () => { if (pendingDetail?.task === task) pendingDetail = null }
  void task.then(release, release)
  return task
}
async function loadDetails(id: string, preserve = false) {
  if (!ready.value) return
  modalId.value = id; loadingDetails.value = !preserve || !selected.value || selected.value.id !== id
  preview.value?.close()
  const token = ++generation, actor = session.value.user?.id
  busy.value = true; blocked.value = true; inspectable.value = false; message.value = ''; failed.value = new Set()
  if (!preserve) { readbackUnverified.value = false; outcomeUncertain.value = false; conflictNotice.value = false; successNotice.value = false; commentError.value = ''; comment.value = ''; selected.value = null; names.value = {} }
  try {
    const payload = await observationEditRequest('/observation-edits/' + encodeURIComponent(id))
    if (!currency(token,id,actor)) return false
    const row = await mapObservationEdit(payload.edit)
    if (!currency(token,id,actor)) return
    if (row.id !== id) throw Error('Invalid proposal identity')
    const destination = observationEditDestination(row.id, row.observation_edit.current.origin_type)
    if (route.name && route.name !== destination.name) {
      await router.replace(destination)
      return false
    }
    selected.value = row; loadingDetails.value = false; emit('updated',row)
    blocked.value = preserve; inspectable.value = true
    if (row.status === 'Cancelled') message.value = label('cancelledReadOnly')
    else if (preserve) message.value = actionText(conflictNotice.value ? 'conflict' : 'refreshed')
    const ids = [...new Set([row.owner_subject,row.reviewed_by].filter((value):value is string=>typeof value==='string' && value.startsWith('staff:')).map(value=>value.slice(6)))]
    if (ids.length) try {
      const response = await fetch('/api/conservation/submitter-names?ids=' + encodeURIComponent(ids.join(',')),{credentials:'same-origin'})
      if (response.ok) { const payload=await response.json(); if(currency(token,id,actor)) names.value=content(payload.names) as Record<string,string> }
    } catch { /* Names remain unavailable without verified directory data. */ }
    if (currency(token,id,actor) && readbackUnverified.value) { readbackUnverified.value=false; message.value=label('reloaded') }
    if (currency(token,id,actor)) outcomeUncertain.value = false
    return currency(token,id,actor)
  } catch (error) { if (currency(token,id,actor)) message.value=readbackUnverified.value ? label('savedUnverified') : outcomeUncertain.value ? actionText('uncertain') : (error as Error)?.name === 'ObservationEditEvidenceError' ? t('unifiedObservations.invalidEvidence') : actionText(officerActionError(error)); return false }
  finally { if(currency(token,id,actor)) { busy.value=false; loadingDetails.value=false } }
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
function close() { modalId.value=null; loadingDetails.value=false; pendingDetail=null; preview.value?.close(); successNotice.value=false; readbackUnverified.value=false; generation++;busy.value=false;selected.value=null;comment.value='';void router.replace({query:{...route.query,observationEdit:undefined}}) }
watch(()=>route.query.observationEdit,id=>{generation++;pendingDetail=null;loadingDetails.value=false;busy.value=false;selected.value=null;modalId.value=null;if(typeof id==='string' && id.trim())void open(id);else comment.value=''},{immediate:true})
const unsubscribe=subscribeSession((user,pending)=>{
 successNotice.value=false
 const same=user?.id===session.value.user?.id
 generation++;pendingDetail=null;loadingDetails.value=false;busy.value=false;blocked.value=true
 session.value={user,pending}
 if(pending && user && same)return
 if(!user || !same || user.role!=='Conservation Officer' || user.status!=='Active' || user.mustChangePassword){modalId.value=null;selected.value=null;comment.value='';message.value='';names.value={};readbackUnverified.value=false;return}
 if(ready.value && typeof route.query.observationEdit==='string')void open(route.query.observationEdit,true)
})
watch(() => [ready.value, selected.value?.id], () => preview.value?.close())
onBeforeUnmount(()=>{preview.value?.close();disposed=true;generation++;pendingDetail=null;unsubscribe()})
defineExpose({open})
</script>
<template>
  <AppModal v-if="modalId" class="observation-edit-modal" :title="label('title')" wide accessible @close="close">
    <template #title><span class="proposal-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M20 4C9 3 3 8 4 15c1 7 12 7 16-11ZM4 21 16 9" /></svg>{{ label('title') }}</span></template>
    <ActionFeedback v-if="successNotice" :key="successSequence" :feedback-id="successSequence" variant="success" :message="actionText('saved')" @dismiss="successNotice = false" />
    <div class="review-content" :aria-busy="loadingDetails || busy">
      <div v-if="loadingDetails && !selected" class="detail-loading" role="status">
        <span class="sr-only">{{ label('loadingRequest') }}</span>
        <div class="loading-skeleton" aria-hidden="true"><div class="skeleton-meta" /><div class="skeleton-summary" /><div class="skeleton-table"><div v-for="row in 6" :key="row" /></div><div class="skeleton-photos"><div /><div /></div></div>
      </div>
      <div v-else-if="!selected" class="detail-load-error" role="alert"><p>{{ message || actionText('unavailable') }}</p><button class="action-button" type="button" :disabled="busy || !ready" @click="open(modalId)">{{ label('retry') }}</button></div>
      <template v-else>
      <div class="proposal-metadata">
        <span><span class="meta-label">{{ label('proposal') }}</span><MonitoringIdentifier :labels="identifiers" :value="selected.id" /></span>
        <span><span class="meta-label">{{ label('observation') }}</span><MonitoringIdentifier :labels="identifiers" :value="selected.observation_edit.observation_id" /></span>
        <span><span class="meta-label">{{ label('submittedBy') }}</span>{{ person(selected.owner_subject) }}</span>
        <time :datetime="selected.created_at">{{ stamp(selected.created_at) }}</time>
        <span v-if="!selected.reviewed_at && !selected.reviewed_by && !selected.review_comment" class="proposal-status" :style="workflowBadgeStyle(selected.status)">{{ t('observationEdits.statuses.'+selected.status) }}</span>
        <span class="proposal-refresh-control">
          <button class="action-button refresh-proposal" type="button" :aria-label="readbackUnverified ? label('retryReload') : actionText('refresh')" aria-describedby="proposal-refresh-tooltip" :aria-busy="busy" :disabled="busy || !ready" @click="open(selected.id,true)">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 15.5-6.4L21 8 M21 3v5h-5 M21 12a9 9 0 0 1-15.5 6.4L3 16 M8 16H3v5" /></svg>
          </button>
          <span id="proposal-refresh-tooltip" class="proposal-refresh-tooltip" role="tooltip">{{ readbackUnverified ? label('retryReload') : actionText('refresh') }}</span>
        </span>
      </div>
      <div v-if="message && message !== label('saved')" class="review-recovery"><p class="review-alert" :role="selected.status !== 'Pending Review' && !readbackUnverified && !outcomeUncertain ? 'status' : 'alert'">{{ message }}</p></div>
      <section class="change-summary" aria-labelledby="observation-change-summary">
        <h3 id="observation-change-summary">{{ sharedLabel('summary') }}</h3>
        <div><span class="summary-label">{{ sharedLabel('changedFields') }}: {{ changedFields.length }}</span><span v-if="!changedFields.length">{{ sharedLabel('noChanges') }}</span><span v-for="field in changedFields" :key="field.key" class="changed-field">{{ fieldLabel(field.key) }}</span></div>
        <div><span class="summary-label">{{ sharedLabel('photographs') }}</span><strong>{{ photoChanges === null ? label('photoComparisonUnavailable') : photoChanges ? sharedLabel('changed') : label('photosUnchanged') }}</strong><span class="photo-summary">{{ baselinePhotosKnown ? (selected.base_snapshot.photo_ids as string[]).length : label('notRecorded') }} &#8594; {{ selected.observation_edit.retained_photo_ids.length + selected.proposal_photo_count }}</span></div>
      </section>
      <section v-if="comparisons.length" class="comparison-section"><h3>{{ sharedLabel('fieldComparison') }}</h3>
        <div class="comparison-scroll" role="region" tabindex="0" :aria-label="label('comparison')"><table class="comparison-table"><caption class="sr-only">{{ label('comparison') }}</caption><colgroup><col class="field-column" /><col /><col /></colgroup><thead><tr><th scope="col">{{ label('field') }}</th><th scope="col">{{ sharedLabel('baseline') }}</th><th scope="col">{{ sharedLabel('proposedValue') }}</th></tr></thead>
          <tbody><tr v-for="field in comparisons" :key="field.key" :class="{ changed: field.changed }"><th scope="row">{{ fieldLabel(field.key) }}<span v-if="field.changed" class="changed-badge">{{ sharedLabel('changed') }}</span></th><td>{{ show(field.before) }}</td><td :class="{ 'proposed-changed': field.changed }">{{ show(field.after) }}</td></tr></tbody>
        </table></div>
        <div class="mobile-comparison">
          <article v-for="field in changedFields" :key="field.key" class="mobile-field-card changed">
            <header><h4>{{ fieldLabel(field.key) }}</h4><span class="changed-badge">{{ sharedLabel('changed') }}</span></header>
            <dl><div><dt>{{ sharedLabel('baseline') }}</dt><dd>{{ show(field.before) }}</dd></div><div class="mobile-proposed"><dt>{{ sharedLabel('proposedValue') }}</dt><dd>{{ show(field.after) }}</dd></div></dl>
          </article>
          <details v-if="unchangedFields.length" class="unchanged-fields">
            <summary tabindex="0">{{ mobileLabel('unchangedFields') }} ({{ unchangedFields.length }})</summary>
            <article v-for="field in unchangedFields" :key="field.key" class="mobile-field-card">
              <header><h4>{{ fieldLabel(field.key) }}</h4></header>
              <dl><div><dt>{{ sharedLabel('baseline') }}</dt><dd>{{ show(field.before) }}</dd></div><div><dt>{{ sharedLabel('proposedValue') }}</dt><dd>{{ show(field.after) }}</dd></div></dl>
            </article>
          </details>
        </div>
      </section>
      <section><h3>{{ sharedLabel('photographs') }}</h3><div class="photograph-panels">
        <section v-for="panel in photoPanels" :key="panel.title" class="photo-panel"><header><h4>{{ panel.title }}</h4><span v-if="panel.urls.length" class="photo-count">{{ panel.urls.length }} {{ sharedLabel('photoUnit') }}</span></header>
          <p v-if="!panel.urls.length" class="photo-empty">{{ panel.empty }}</p>
          <div v-else class="photo-grid"><template v-for="(url,index) in panel.urls" :key="url"><button v-if="!failed.has(url)" type="button" class="photo-thumbnail" :disabled="!ready || busy" :aria-label="panel.title+' '+(index+1)" @click="enlarge(panel.urls,index,$event,panel.title)"><img :src="url" :alt="panel.title+' '+(index+1)" @error="failed=new Set([...failed,url])" /></button></template></div>
          <p v-if="panel.urls.some(url => failed.has(url))" class="photo-error" role="status">{{ label('photosUnavailable') }}</p>
        </section>
      </div></section>
      <section v-if="selected.reviewed_at || selected.reviewed_by || selected.review_comment" class="recorded-decision"><h3>{{ sharedLabel('decision') }}</h3>
        <dl class="decision-metadata">
          <div><dt>{{ label('status') }}</dt><dd><span class="decision-status" :style="workflowBadgeStyle(selected.status)">{{ t('observationEdits.statuses.'+selected.status) }}</span></dd></div>
          <div v-if="selected.reviewed_by"><dt>{{ label('reviewedBy') }}</dt><dd>{{ person(selected.reviewed_by) }}</dd></div>
          <div v-if="selected.reviewed_at"><dt>{{ t('conservationPages.observations.date') }}</dt><dd><time :datetime="selected.reviewed_at">{{ stamp(selected.reviewed_at) }}</time></dd></div>
        </dl>
        <div v-if="selected.review_comment" class="recorded-comment"><h4>{{ label('comment') }}</h4><p>{{ selected.review_comment }}</p></div>
      </section>
      <section v-if="selected.status==='Pending Review'" class="review-decision"><h3>{{ sharedLabel('reviewDecision') }}</h3>
        <p v-if="selected.observation_edit.current.status!=='Approved'" class="review-alert" role="status">{{ label('currentStatus') }}: {{ t('observationEdits.statuses.'+selected.observation_edit.current.status) }}</p>
        <label v-if="blocked && inspectable" class="inspection-check"><input type="checkbox" :disabled="busy || !ready" @change="blocked=!($event.target as HTMLInputElement).checked" />{{ label('inspect') }}</label>
        <label for="observation-edit-comment">{{ label('comment') }}</label><textarea id="observation-edit-comment" ref="commentInput" v-model="comment" :aria-invalid="Boolean(commentError)" :aria-describedby="commentError ? 'edit-comment-error' : undefined" maxlength="4000" rows="3" :disabled="!ready || busy || selected.status!=='Pending Review'" />
        <p v-if="commentError" id="edit-comment-error" class="comment-error" role="alert">{{ commentError }}</p>
      </section>
      </template>
    </div>
    <footer v-if="selected" class="review-footer"><div v-if="selected.status==='Pending Review'" class="review-actions">
      <button class="reject-change" type="button" :disabled="!eligible" @click="decide('Rejected')">{{ t('observationEdits.decisions.Rejected') }}</button>
      <button class="correction-change" type="button" :disabled="!eligible" @click="decide('Correction Required')">{{ t('observationEdits.decisions.Correction Required') }}</button>
      <button class="approve-change" type="button" :disabled="!eligible" @click="decide('Approved')">{{ t('observationEdits.decisions.Approved') }}</button>
    </div><p v-else class="read-only-message">{{ label('readOnly') }}</p></footer>
    <PlantPhotoLightbox ref="preview" root-scroll-lock />
  </AppModal>
</template>
<style scoped>

.proposal-title{display:flex;align-items:center;gap:10px;color:var(--green-dark,#174c38)}.proposal-title svg{width:32px;height:32px;flex:none}.proposal-metadata{display:flex;align-items:center;flex-wrap:wrap;gap:10px 16px;background:#f7f9f7;border:1px solid #d7e2dc;border-radius:10px;padding:10px 14px;font-size:13px;margin-bottom:16px}.proposal-metadata>span:not(.proposal-status){display:flex;align-items:center;gap:7px;min-width:0}.meta-label{color:#52685d}.proposal-status,.edit-badge,.changed-field,.changed-badge,.photo-count,.retention-summary span{display:inline-flex;align-items:center;border-radius:8px;padding:4px 9px;font-size:12px;font-weight:600}.proposal-status{margin-left:auto;white-space:nowrap}.change-summary{display:grid;grid-template-columns:1.05fr 1fr 1.2fr 1.2fr 1.25fr;gap:16px;padding:16px;background:#edf4ed;border-radius:12px;margin-bottom:20px}.change-summary h3{margin:0}.change-summary>div{min-width:0;border-left:1px solid #c6d7cb;padding-left:16px;overflow-wrap:anywhere}.summary-label{display:block;font-size:12px;color:#52685d;margin-bottom:7px}.edit-badge{border:1px solid}.plant-edit{background:#e5f2f7;color:#22546b;border-color:#aacbd8}.species-edit{background:#f0eaf7;color:#654580;border-color:#ccb9dc}.changed-field{background:#dceccb;color:#244f34;margin:0 4px 4px 0}h3{font-size:20px;line-height:1.4;color:var(--green-dark,#214f40);margin:0 0 10px}h4{font-size:14px;margin:0;color:var(--green-dark,#214f40)}section{margin-bottom:20px}.comparison-table{border-collapse:separate;border-spacing:0;width:100%;table-layout:fixed;border:1px solid #c9d9ce;border-radius:9px;overflow:hidden}.field-column{width:27%}.comparison-table th,.comparison-table td{padding:9px 14px;text-align:left;vertical-align:top;border-right:1px solid #d2dfd7;border-bottom:1px solid #d2dfd7;overflow-wrap:anywhere;white-space:pre-wrap;font-size:14px;line-height:1.45}.comparison-table thead th{background:#245443;color:white;font-weight:700}.comparison-table tbody th{background:#edf3e9;color:#244c3b;font-weight:700}.comparison-table tbody td{background:#fff}.comparison-table tr:last-child>*{border-bottom:0}.comparison-table tr>*:last-child{border-right:0}.comparison-table .changed>*{background:#eef5d9}.comparison-table .changed>th{background:#e6efc6}.proposed-changed{font-weight:600}.changed-badge{background:#fff1bd;color:#75551c;border:1px solid #e3d28b;padding:2px 8px;margin-left:10px;font-size:11px}.photograph-panels{display:grid;grid-template-columns:1fr 1fr;gap:18px}.photo-panel{border:1px solid #d7e2dc;border-radius:10px;padding:14px;margin:0;min-width:0}.photo-panel header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px}.photo-count,.retention-summary span{background:#edf3ec;color:#536a5d;font-weight:400}.photo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(95px,1fr));gap:10px}.photo-thumbnail{padding:0;border:1px solid #d7e2dc;border-radius:7px;overflow:hidden;background:#f5f8f4;cursor:zoom-in;min-width:0}.photo-thumbnail img{display:block;width:100%;height:125px;object-fit:cover}.photo-empty{text-align:center;background:#f5f8f4;border:1px dashed #c5d5c8;border-radius:9px;padding:18px;color:#53675c;font-size:13px}.photo-empty svg{width:28px;height:28px}.photo-empty p{margin:7px 0 0}.retention-summary{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 0}.retention-summary .removed-count{background:#fff0e8;color:#88432b}.review-decision label{display:block;font-weight:600;font-size:13px;margin-bottom:6px}.review-decision textarea{width:100%;box-sizing:border-box;font:inherit;padding:12px;border:1px solid #b9cbc0;border-radius:8px;resize:vertical;min-height:105px}.character-count{text-align:right;color:#617569;font-size:12px;margin:4px 0 12px}.review-actions{display:flex;justify-content:flex-end;gap:14px;flex-wrap:wrap}.review-actions button{display:inline-flex;align-items:center;justify-content:center;gap:9px;min-height:44px;padding:10px 20px;border-radius:9px;font:inherit;font-size:14px;font-weight:700;cursor:pointer;transition:background-color .15s ease,box-shadow .15s ease}.review-actions svg{width:20px;height:20px}.reject-change{background:white;color:#a52424;border:1px solid #b82b2b}.reject-change:hover:not(:disabled){background:#fff2ef}.approve-change{background:var(--green,#245443);color:white;border:1px solid #245443}.approve-change:hover:not(:disabled){background:#193e31}.review-actions button:disabled{opacity:.5;cursor:default}button:focus-visible,summary:focus-visible,textarea:focus-visible{outline:2px solid #33745d;outline-offset:3px}.review-alert{color:#9e2929;padding:12px;background:#fff0ed;border-radius:8px;margin-bottom:14px}.review-alert button{font:inherit;padding:8px;margin-left:10px}.recorded-decision p{white-space:pre-wrap;overflow-wrap:anywhere}.read-only-message{color:#52685d;background:#f4f7f2;padding:12px;border-radius:8px}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@media(max-width:900px){.change-summary{grid-template-columns:1fr 1fr}.change-summary h3{grid-column:1/-1}.change-summary>div{border-left:0;padding-left:0}.proposal-status{margin-left:0}}@media(max-width:600px){.photograph-panels,.change-summary{grid-template-columns:1fr}.comparison-table th,.comparison-table td{padding:8px;font-size:13px}.field-column{width:30%}.changed-badge{margin:4px 0 0}.proposal-metadata{align-items:flex-start;gap:9px}.proposal-metadata>span{flex-wrap:wrap;max-width:100%}.review-actions button{flex:1}.photo-thumbnail img{height:115px}}@media(prefers-reduced-motion:reduce){.review-actions button{transition:none}}

.observation-edit-modal.observation-edit-modal :deep(.modal-card.wide) { display: flex; flex-direction: column; width: min(1120px, calc(100vw - 40px)); max-width: 1120px; max-height: calc(100dvh - 40px); height: min(880px, calc(100dvh - 40px)); padding: 0; overflow: hidden; }
.observation-edit-modal :deep(.modal-header) { flex: none; align-items: center; margin: 0; padding: 20px 24px; border-bottom: 1px solid #d7e2dc; }
.observation-edit-modal :deep(.close-button) { flex: none; }
.review-content { flex: 1 1 auto; min-height: 0; padding: 20px 24px; overflow-y: auto; overscroll-behavior: contain; }
.review-footer { flex: none; padding: 14px 24px; border-top: 1px solid #d7e2dc; background: #fff; }
.review-footer .review-actions { margin: 0; justify-content: flex-end; }
.review-footer .read-only-message { margin: 0; padding: 0; background: none; }
.change-summary { grid-template-columns: .9fr 2fr 1fr; }
.photo-thumbnail:disabled { cursor: default; opacity: .65; }
.photo-summary { display: block; margin-top: 8px; color: #52685d; font-size: 13px; }
.comparison-scroll { max-width: 100%; overflow-x: auto; }
.comparison-table { min-width: 520px; }
.mobile-comparison { display: none; }
@media (max-width: 600px) {
  .comparison-scroll { display: none; }
  .mobile-comparison { display: grid; gap: 12px; min-width: 0; }
  .mobile-field-card { min-width: 0; border: 1px solid #d2dfd7; border-radius: 9px; background: #fff; }
  .mobile-field-card.changed { background: #eef5d9; border-color: #d5dfb0; }
  .mobile-field-card header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; padding: 10px 12px; border-bottom: 1px solid #d2dfd7; }
  .mobile-field-card h4 { min-width: 0; overflow-wrap: anywhere; }
  .mobile-field-card .changed-badge { margin: 0; }
  .mobile-field-card dl { display: grid; gap: 12px; margin: 0; padding: 12px; }
  .mobile-field-card dt { margin-bottom: 4px; font-weight: 600; }
  .mobile-field-card dd { margin: 0; padding: 8px 10px; border: 1px solid #dce5db; border-radius: 6px; background: #fff; white-space: pre-wrap; overflow-wrap: anywhere; word-break: normal; line-height: 1.5; }
  .mobile-field-card .mobile-proposed dd { background: #e7f1dc; font-weight: 600; }
  .unchanged-fields { min-width: 0; border: 1px solid #d2dfd7; border-radius: 9px; background: #f7f9f7; }
  .unchanged-fields > summary { padding: 12px; min-height: 44px; box-sizing: border-box; cursor: pointer; color: #245443; font-weight: 600; overflow-wrap: anywhere; }
  .unchanged-fields .mobile-field-card { margin: 0 10px 10px; }
  .proposal-metadata { padding: 10px; gap: 8px 12px; }
  .proposal-metadata > span:not(.proposal-refresh-control) { flex: 1 1 100%; }
  .proposal-metadata > time { flex: 1 1 10rem; overflow-wrap: anywhere; }
  .change-summary { padding: 12px; gap: 12px; }
  .change-summary > div { border: 0; padding: 0; }
  .proposal-title { gap: 8px; }
  .proposal-title svg { width: 24px; height: 24px; }
  .observation-edit-modal :deep(.modal-header h2) { font-size: 18px; line-height: 1.35; }
  .review-content { overflow-x: hidden; }
  .review-footer .review-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .review-footer .approve-change { grid-column: 1 / -1; }
  .review-footer .review-actions button { min-width: 0; padding: 8px; white-space: normal; overflow-wrap: anywhere; }
}
.proposal-refresh-control { position: relative; margin-left: auto; display: inline-flex; }
.refresh-proposal { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; padding: 0; border: 1px solid #dfe7df; border-radius: 8px; background: #fff; color: #33745d; }
.proposal-refresh-tooltip { position: absolute; top: calc(100% + 6px); right: 0; z-index: 4; width: max-content; max-width: min(240px, calc(100vw - 64px)); padding: 7px 10px; border-radius: 6px; background: #173f34; color: #fff; font-size: 12px; font-weight: 400; line-height: 1.5; opacity: 0; visibility: hidden; pointer-events: none; }
.proposal-refresh-control:hover .proposal-refresh-tooltip, .proposal-refresh-control:focus-within .proposal-refresh-tooltip { opacity: 1; visibility: visible; }
.photo-error { color: #657369; font-size: 13px; }
.inspection-check { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 12px; }
.inspection-check input { margin-top: 4px; }
.review-decision { margin-bottom: 0; }
.review-decision textarea { box-sizing: border-box; }
.comment-error { color: #9e2929; font-size: 13px; margin: 8px 0 0; }
.correction-change { background: #fff8e5; color: #79551a; border: 1px solid #cda85b; }
.correction-change:hover:not(:disabled) { background: #fff0c2; }
@media(max-width: 900px) { .change-summary { grid-template-columns: 1fr 1fr; } }
@media(max-width: 600px) { .observation-edit-modal.observation-edit-modal :deep(.modal-card.wide) { width: calc(100vw - 20px); max-height: calc(100dvh - 20px); height: calc(100dvh - 20px); } .observation-edit-modal :deep(.modal-header), .review-content { padding: 16px; } .review-footer { padding: 12px 16px; } .change-summary { grid-template-columns: 1fr; } .review-actions { gap: 8px; } .review-actions button { padding: 8px 12px; } }

.detail-loading { min-height: 360px; }
.loading-skeleton { display: grid; gap: 20px; }
.loading-skeleton > div, .skeleton-table > div, .skeleton-photos > div { border-radius: 8px; background: #edf3ed; }
.skeleton-meta { height: 52px; }
.skeleton-summary { height: 100px; }
.skeleton-table { display: grid; gap: 1px; overflow: hidden; border: 1px solid #d7e2dc; }
.skeleton-table > div { height: 34px; border-radius: 0; background: #f5f8f4; }
.skeleton-table > div:first-child { background: #d0e0d5; }
.loading-skeleton .skeleton-photos { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; background: none; }
.skeleton-photos > div { height: 115px; }
.loading-skeleton { animation: skeleton-pulse 1.5s ease-in-out infinite alternate; }
@keyframes skeleton-pulse { from { opacity: .65; } to { opacity: 1; } }
.detail-load-error { display: grid; place-content: center; justify-items: center; min-height: 320px; gap: 8px; text-align: center; }
.detail-load-error p { max-width: 48ch; color: #9e2929; }
@media (prefers-reduced-motion: reduce) { .loading-skeleton { animation: none; } }
.decision-metadata { display: flex; align-items: center; flex-wrap: wrap; gap: 12px 24px; margin: 0 0 16px; font-size: 14px; }
.decision-metadata > div { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; min-width: 0; }
.decision-metadata dt { color: #536b60; font-weight: 600; }
.decision-metadata dt::after { content: ':'; }
.decision-metadata dd { margin: 0; overflow-wrap: anywhere; }
.recorded-comment.recorded-comment.recorded-comment h4 { margin: 0 0 6px; color: var(--officer-muted, #536b60); font-size: var(--officer-label, 13px); font-weight: 600; line-height: 1.5; }
.recorded-comment p { margin: 0; }
.decision-status { display: inline-flex; border-radius: 999px; padding: 4px 10px; font-size: 13px; font-weight: 700; line-height: 1.5; }
</style>
