<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import AppModal from './AppModal.vue'
import MonitoringIdentifier from './MonitoringIdentifier.vue'
import PlantPhotoLightbox from '../PlantPhotoLightbox.vue'
import { workflowBadgeStyle } from '../../utils/workflowBadge'
import { useI18n } from 'vue-i18n'
import { reviewDateTime } from '../../utils/officerMonitoringDisplay'
import { useRoute, useRouter } from 'vue-router'
import { changeApi, changeRequest, compareChange, type RecordChange } from '../../services/recordChanges'
import { sessionSnapshot, subscribeSession } from '../../services/auth'
const route = useRoute(), router = useRouter()
const emit = defineEmits<{ updated: [change: RecordChange] }>()
const { t, te } = useI18n({ useScope: 'global' })
const label = (key: string) => t('approvedChanges.' + key)
const statusLabel = (status: string) => te('approvedChanges.statuses.' + status) ? label('statuses.' + status) : status
const fieldLabel = (key: string) => te('approvedChanges.fields.' + key) ? label('fields.' + key) : key.replaceAll('_',' ')
const session = ref(sessionSnapshot())
const officerReady = computed(() => !session.value.pending && session.value.user?.role === 'Conservation Officer' && session.value.user.status === 'Active' && !session.value.user.mustChangePassword)
const selected = ref<RecordChange | null>(null)
const loading = ref(false), busy = ref(false), error = ref(''), conflict = ref(false), comment = ref('')
const photos = ref<string[]>([]), originalPhotos = ref<string[]>([])
let detailGeneration = 0
const recoveredMessage = ref('')
const recoveredInfo = ref(false)
const allComparisons = computed(() => selected.value ? compareChange(selected.value) : [])
const technicalKeys = new Set(['qr_id','qr_token','qr_code','species_id','change_id','created_at','updated_at','registered_at'])
const comparisons = computed(() => allComparisons.value.filter(row => !technicalKeys.has(row.key)))
const technical = computed(() => allComparisons.value.filter(row => technicalKeys.has(row.key)))
const changedFields = computed(() => allComparisons.value.filter(row => row.changed && !['qr_token','qr_code','change_id','created_at','updated_at','registered_at'].includes(row.key)))
const compact = (value: string) => value.length > 20 ? value.slice(0,value.startsWith('staff:') ? 13 : 8) + '\u2026' + value.slice(-4) : value
const identifiers = computed(() => new Map(selected.value ? [selected.value.id,selected.value.owner_subject,selected.value.reviewed_by || '',String(selected.value.plant_id || selected.value.species_id),...technical.value.filter(field => /_id$/.test(field.key)).flatMap(field => [String(field.before ?? ''),String(field.after ?? '')])].map(value => [value,compact(value)]) : []))
const preview = ref<InstanceType<typeof PlantPhotoLightbox> | null>(null)
const failedPhotos = ref(new Set<string>())
const basePhotoIds = computed<string[]>(() => Array.isArray(selected.value?.base_snapshot.photo_ids) ? selected.value!.base_snapshot.photo_ids as string[] : [])
const retainedIds = computed<string[]>(() => Array.isArray(selected.value?.proposed_snapshot.photo_ids) ? selected.value!.proposed_snapshot.photo_ids as string[] : photos.value.length ? [] : basePhotoIds.value)
const removedCount = computed(() => basePhotoIds.value.filter(id => !retainedIds.value.includes(id)).length)
function enlarge(items: string[], index: number, event: Event, title: string) {
  void preview.value?.open(items.map((url,index) => ({id: String(index),url})),index,title,event.currentTarget as HTMLElement)
}
function photoFailed(url: string) { failedPhotos.value = new Set([...failedPhotos.value,url]) }
const eligible = computed(() => selected.value?.status === 'Pending Review' && !conflict.value && !busy.value && !loading.value &&
  Number.isSafeInteger(selected.value.revision) && selected.value.revision > 0 && officerReady.value && selected.value.owner_subject !== `staff:${session.value.user?.id}`)
const display = (value: unknown) => value === undefined ? label('unavailable') : value === null ? label('nullValue') : value === '' ? label('emptyValue') : typeof value === 'object' ? JSON.stringify(value) : String(value)
const date = (value: string | null) => value ? reviewDateTime(value) : label('unavailable')
async function open(id: string, preserveComment = false) {
  if (!officerReady.value) return
  const inspect = preserveComment && conflict.value
  const generation = ++detailGeneration
  const actor = session.value.user?.id, routeId = route.query.change
  const current = () => generation === detailGeneration && officerReady.value && session.value.user?.id === actor && route.query.change === routeId
  recoveredMessage.value = ''; recoveredInfo.value = false
  conflict.value = true; busy.value = true; error.value = ''; photos.value = []; originalPhotos.value = []; failedPhotos.value = new Set(); preview.value?.close()
  if (!preserveComment) { comment.value = ''; selected.value = null }
  try {
    const data = await changeRequest('/' + encodeURIComponent(id))
    if (!current()) return
    if (!data.change || data.change.id !== id) throw Error('Invalid proposal response.')
    selected.value = data.change
    emit('updated', data.change)
    photos.value = Array.from({ length: Math.min(8,Math.max(0,Number(data.change.proposal_photo_count) || 0)) }, (_,i) => `${changeApi}/${encodeURIComponent(id)}/photos/${i}`)
    const base = data.change.base_snapshot
    if (data.change.plant_id) originalPhotos.value = (Array.isArray(base.photo_ids) ? base.photo_ids : []).map((asset: string) => '/api/data/assets/' + encodeURIComponent(asset))
    else if (base.request_id) {
      const response = await fetch('/api/data/record-versions?kind=species&id=' + encodeURIComponent(base.request_id), { credentials: 'same-origin' })
      if (response.ok) {
        const history = await response.json()
        const previous = typeof base.photo_fingerprint === 'string' && /^[a-f0-9]{64}$/.test(base.photo_fingerprint)
          ? history.versions?.find((v: { species_photo_fingerprint?: string; has_species_photo?: boolean }) => v.has_species_photo && v.species_photo_fingerprint === base.photo_fingerprint)
          : null
        if (generation === detailGeneration && previous?.has_species_photo) originalPhotos.value = ['/api/data/record-versions/' + encodeURIComponent(previous.id) + '/photo']
      }
    }
    if (!current()) return
    conflict.value = inspect && selected.value?.status === 'Pending Review'
    if (inspect) {
      const row = selected.value!
      const confirmed = ['Approved','Rejected'].includes(row.status) && Boolean(row.reviewed_at && Number.isFinite(Date.parse(row.reviewed_at)) && row.reviewed_by?.startsWith('staff:') && row.reviewed_by.length > 6 && row.reviewed_by !== `staff:${actor}`)
      recoveredInfo.value = row.status !== 'Pending Review'
      recoveredMessage.value = confirmed ? t('conservationPages.reviews.feedback.reviewedElsewhere') : recoveredInfo.value ? t('conservationPages.reviews.feedback.conflictRefreshed') : label('conflict')
    }

  } catch (failure) { if (current()) error.value = (failure as { status?: number }).status === 409 ? label('conflict') : label('requestFailed') }
  finally { if (current()) busy.value = false }
}
function close() {
  if (busy.value) return
  detailGeneration++; preview.value?.close(); selected.value = null
  if (route.query.change) void router.replace({ query: { ...route.query, change: undefined } })
}
async function decide(decision: 'Approved' | 'Rejected') {
  if (!eligible.value || !selected.value) return
  if (!comment.value.trim()) { error.value = label('commentRequired'); return }
  busy.value = true; error.value = ''
  const generation = detailGeneration
  try {
    const id = selected.value.id
    await changeRequest('/' + encodeURIComponent(id) + '/review', { decision, comment: comment.value.trim(), revision: selected.value.revision })
    if (generation !== detailGeneration) return
    await open(id,true)
  } catch (failure) {
    if (generation !== detailGeneration) return
    error.value = (failure as { status?: number }).status === 409 ? label('conflict') : label('requestFailed')
    conflict.value = true
    if ((failure as { status?: number }).status === 409) await open(selected.value!.id, true)
  } finally { if (generation === detailGeneration) busy.value = false }
}
watch(() => route.query.change, id => {
  if (typeof id === 'string') void open(id)
  else { recoveredMessage.value = ''; detailGeneration++; selected.value = null; comment.value = ''; error.value = ''; busy.value = false; photos.value = []; originalPhotos.value = [] }
}, { immediate: true })
const unsubscribe = subscribeSession((user,pending) => {
  if (!pending && session.value.pending && user && user.id === session.value.user?.id && user.role === 'Conservation Officer' && user.status === 'Active' && !user.mustChangePassword) {
    session.value = { user, pending }; return
  }
  if (pending && user && user.id === session.value.user?.id) {
    detailGeneration++; conflict.value = conflict.value || busy.value; busy.value = false
    session.value = { user, pending }; return
  }
  recoveredMessage.value = ''; detailGeneration++; selected.value = null; comment.value = ''; photos.value = []; originalPhotos.value = []
  loading.value = false; busy.value = false; session.value = { user,pending }
  if (officerReady.value) { if (typeof route.query.change === 'string') void open(route.query.change) }
  else error.value = label('sessionRequired')
})
defineExpose({ open })
onBeforeUnmount(() => { unsubscribe(); detailGeneration++; preview.value?.close() })
</script>
<template>
  <p v-if="error && !selected" role="alert">{{ error }}</p>
  <AppModal v-if="selected" class="change-review-modal" :title="label(selected.plant_id ? 'plantTitle' : 'speciesTitle')" wide accessible @close="close()">
    <template #title><span class="proposal-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M20 4C9 3 3 8 4 15c1 7 12 7 16-11ZM4 21 16 9" /></svg>{{ label(selected.plant_id ? 'plantTitle' : 'speciesTitle') }}</span></template>
    <div class="proposal-metadata">
      <span><span class="meta-label">{{ label('proposal') }}</span><MonitoringIdentifier :value="selected.id" :labels="identifiers" :copy-label="label('copyProposal')" :feedback-duration="2500" /></span>
      <span><span class="meta-label">{{ label(selected.plant_id ? 'plantId' : 'speciesId') }}</span><MonitoringIdentifier :value="selected.plant_id || selected.species_id" :labels="identifiers" :feedback-duration="2500" /></span>
      <span><span class="meta-label">{{ label('submittedBy') }}</span><MonitoringIdentifier :value="selected.owner_subject" :labels="identifiers" :feedback-duration="2500" /></span>
      <span><time :datetime="selected.created_at">{{ date(selected.created_at) }}</time></span>
      <span class="proposal-status" :style="workflowBadgeStyle(selected.status)">{{ statusLabel(selected.status) }}</span>
    </div>
    <section class="change-summary" aria-labelledby="change-summary-heading">
      <h3 id="change-summary-heading">{{ label('summary') }}</h3>
      <div><span class="summary-label">{{ label('targetType') }}</span><span class="edit-badge" :class="selected.plant_id ? 'plant-edit' : 'species-edit'">{{ label(selected.plant_id ? 'plantEdit' : 'speciesEdit') }}</span></div>
      <div><span class="summary-label">{{ label('approvedName') }}</span><strong>{{ display(selected.base_snapshot.scientific_name) }}</strong></div>
      <div><span class="summary-label">{{ label('proposedName') }}</span><strong>{{ display(selected.proposed_snapshot.scientific_name) }}</strong></div>
      <div><span class="summary-label">{{ label('changedFields') }}: {{ changedFields.length }}</span><span v-if="!changedFields.length">{{ label('noChanges') }}</span><span v-for="field in changedFields" :key="field.key" class="changed-field">{{ fieldLabel(field.key) }}</span></div>
    </section>
    <p v-if="error" class="review-alert" role="alert">{{ error }}</p>
    <p v-if="recoveredMessage" :class="recoveredInfo ? 'read-only-message' : 'review-alert'" :role="recoveredInfo ? 'status' : 'alert'">{{ recoveredMessage }}</p>
    <div v-if="conflict" class="review-alert" role="alert"><strong>{{ label('conflict') }}</strong><button class="action-button" :disabled="busy" @click="open(selected.id,true)">{{ label('reload') }}</button></div>
    <section class="comparison-section"><h3>{{ label('fieldComparison') }}</h3>
      <table class="comparison-table"><caption class="sr-only">{{ label('comparison') }}</caption><colgroup><col class="field-column" /><col /><col /></colgroup><thead><tr><th scope="col">{{ label('field') }}</th><th scope="col">{{ label('baseline') }}</th><th scope="col">{{ label('proposedValue') }}</th></tr></thead><tbody><tr v-for="field in comparisons" :key="field.key" :class="{ changed: field.changed }"><th scope="row">{{ fieldLabel(field.key) }}<span v-if="field.changed" class="changed-badge">{{ label('changed') }}</span></th><td>{{ display(field.before) }}</td><td :class="{ 'proposed-changed': field.changed }">{{ display(field.after) }}</td></tr></tbody></table>
    </section>
    <details v-if="technical.length" class="technical-details"><summary>{{ label('technicalDetails') }}</summary><table class="comparison-table"><thead><tr><th>{{ label('field') }}</th><th>{{ label('baseline') }}</th><th>{{ label('proposedValue') }}</th></tr></thead><tbody><tr v-for="field in technical" :key="field.key"><th>{{ fieldLabel(field.key) }}</th><td><span v-if="/token|qr_code/.test(field.key)">{{ label('masked') }}</span><MonitoringIdentifier v-else-if="/_id$/.test(field.key) && field.before !== null && field.before !== undefined" :value="String(field.before)" :labels="identifiers" /><span v-else>{{ display(field.before) }}</span></td><td><span v-if="/token|qr_code/.test(field.key)">{{ label('masked') }}</span><MonitoringIdentifier v-else-if="/_id$/.test(field.key) && field.after !== null && field.after !== undefined" :value="String(field.after)" :labels="identifiers" /><span v-else>{{ display(field.after) }}</span></td></tr></tbody></table></details>
    <section><h3>{{ label('photographs') }}</h3><div class="photograph-panels">
      <section class="photo-panel"><header><h4>{{ label('baselinePhotos') }}</h4><span v-if="originalPhotos.length" class="photo-count">{{ originalPhotos.length }} {{ label('photoUnit') }}</span></header><p v-if="!originalPhotos.length" class="photo-empty">{{ label('photosUnavailable') }}</p><div class="photo-grid"><template v-for="(src,index) in originalPhotos" :key="src"><button v-if="!failedPhotos.has(src)" type="button" class="photo-thumbnail" :aria-label="label('baselinePhotos') + ' ' + (index + 1)" @click="enlarge(originalPhotos,index,$event,label('baselinePhotos'))"><img :src="src" :alt="label('baselinePhotos') + ' ' + (index + 1)" @error="photoFailed(src)" /></button><span v-else role="status">{{ label('photosUnavailable') }}</span></template></div></section>
      <section class="photo-panel"><header><h4>{{ label('proposedPhotos') }}</h4><span class="photo-count">{{ photos.length }} {{ label('photoUnit') }}</span></header><div v-if="!photos.length" class="photo-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="m4 17 5-5 4 4 3-3 5 5"/></svg><p>{{ label('retainedPhotos') }}</p></div><div class="photo-grid"><template v-for="(src,index) in photos" :key="src"><button v-if="!failedPhotos.has(src)" type="button" class="photo-thumbnail" :aria-label="label('proposedPhotos') + ' ' + (index + 1)" @click="enlarge(photos,index,$event,label('proposedPhotos'))"><img :src="src" :alt="label('proposedPhotos') + ' ' + (index + 1)" @error="photoFailed(src)" /></button><span v-else role="status">{{ label('photosUnavailable') }}</span></template></div><p v-if="selected.plant_id" class="retention-summary"><span>{{ retainedIds.length }} {{ label('retainedPhotoCount') }}</span><span v-if="removedCount" class="removed-count">{{ removedCount }} {{ label('removedPhotoCount') }}</span></p></section>
    </div></section>
    <section v-if="selected.reviewed_at" class="recorded-decision"><h3>{{ label('decision') }}</h3><p>{{ statusLabel(selected.status) }} | <MonitoringIdentifier :value="selected.reviewed_by" :labels="identifiers" /> | {{ date(selected.reviewed_at) }}</p><p>{{ selected.review_comment }}</p></section>
    <label v-if="conflict && !busy && !error && recoveredMessage && selected.status === 'Pending Review'"><input type="checkbox" :checked="false" @change="conflict = !($event.target as HTMLInputElement).checked" /> {{ t('conservationPages.reviews.speciesRequest.inspectLatest') }}</label>
    <section v-if="selected.status === 'Pending Review'" class="review-decision"><h3>{{ label('reviewDecision') }}</h3><label for="proposal-review-comment">{{ label('comment') }}</label><textarea id="proposal-review-comment" v-model="comment" maxlength="4000" rows="4" :placeholder="label('commentPlaceholder')" :aria-invalid="Boolean(error)" /><p class="character-count">{{ comment.length }} / 4,000</p><div class="review-actions"><button class="reject-change" :disabled="!eligible" @click="decide('Rejected')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 8 8 8m0-8-8 8"/></svg>{{ label('reject') }}</button><button class="approve-change" :disabled="!eligible" @click="decide('Approved')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m4 12 5 5L20 6"/></svg>{{ label('approve') }}</button></div></section>
    <p v-else class="read-only-message">{{ label('readOnly') }}</p>
    <PlantPhotoLightbox ref="preview" root-scroll-lock />
  </AppModal>
</template>
<style scoped>
.change-review-modal :deep(.modal-card){width:min(1120px,96vw);max-width:1120px;overflow-x:hidden}.change-review-modal :deep(.modal-header){position:sticky;top:-24px;z-index:2;background:var(--surface,#fff);padding:10px 0 16px;margin-bottom:12px}.proposal-title{display:flex;align-items:center;gap:10px;color:var(--green-dark,#174c38)}.proposal-title svg{width:32px;height:32px;flex:none}.proposal-metadata{display:flex;align-items:center;flex-wrap:wrap;gap:10px 16px;background:#f7f9f7;border:1px solid #d7e2dc;border-radius:10px;padding:10px 14px;font-size:13px;margin-bottom:16px}.proposal-metadata>span:not(.proposal-status){display:flex;align-items:center;gap:7px;min-width:0}.meta-label{color:#52685d}.proposal-status,.edit-badge,.changed-field,.changed-badge,.photo-count,.retention-summary span{display:inline-flex;align-items:center;border-radius:8px;padding:4px 9px;font-size:12px;font-weight:600}.proposal-status{margin-left:auto;white-space:nowrap}.change-summary{display:grid;grid-template-columns:1.05fr 1fr 1.2fr 1.2fr 1.25fr;gap:16px;padding:16px;background:#edf4ed;border-radius:12px;margin-bottom:20px}.change-summary h3{margin:0}.change-summary>div{min-width:0;border-left:1px solid #c6d7cb;padding-left:16px;overflow-wrap:anywhere}.summary-label{display:block;font-size:12px;color:#52685d;margin-bottom:7px}.edit-badge{border:1px solid}.plant-edit{background:#e5f2f7;color:#22546b;border-color:#aacbd8}.species-edit{background:#f0eaf7;color:#654580;border-color:#ccb9dc}.changed-field{background:#dceccb;color:#244f34;margin:0 4px 4px 0}h3{font-size:20px;line-height:1.4;color:var(--green-dark,#214f40);margin:0 0 10px}h4{font-size:14px;margin:0;color:var(--green-dark,#214f40)}section{margin-bottom:20px}.comparison-table{border-collapse:separate;border-spacing:0;width:100%;table-layout:fixed;border:1px solid #c9d9ce;border-radius:9px;overflow:hidden}.field-column{width:27%}.comparison-table th,.comparison-table td{padding:9px 14px;text-align:left;vertical-align:top;border-right:1px solid #d2dfd7;border-bottom:1px solid #d2dfd7;overflow-wrap:anywhere;white-space:pre-wrap;font-size:14px;line-height:1.45}.comparison-table thead th{background:#245443;color:white;font-weight:700}.comparison-table tbody th{background:#edf3e9;color:#244c3b;font-weight:700}.comparison-table tbody td{background:#fff}.comparison-table tr:last-child>*{border-bottom:0}.comparison-table tr>*:last-child{border-right:0}.comparison-table .changed>*{background:#eef5d9}.comparison-table .changed>th{background:#e6efc6}.proposed-changed{font-weight:600}.changed-badge{background:#fff1bd;color:#75551c;border:1px solid #e3d28b;padding:2px 8px;margin-left:10px;font-size:11px}.technical-details{margin-bottom:20px}.technical-details summary{cursor:pointer;color:#52685d;padding:8px 0}.photograph-panels{display:grid;grid-template-columns:1fr 1fr;gap:18px}.photo-panel{border:1px solid #d7e2dc;border-radius:10px;padding:14px;margin:0;min-width:0}.photo-panel header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px}.photo-count,.retention-summary span{background:#edf3ec;color:#536a5d;font-weight:400}.photo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(95px,1fr));gap:10px}.photo-thumbnail{padding:0;border:1px solid #d7e2dc;border-radius:7px;overflow:hidden;background:#f5f8f4;cursor:zoom-in;min-width:0}.photo-thumbnail img{display:block;width:100%;height:125px;object-fit:cover}.photo-empty{text-align:center;background:#f5f8f4;border:1px dashed #c5d5c8;border-radius:9px;padding:18px;color:#53675c;font-size:13px}.photo-empty svg{width:28px;height:28px}.photo-empty p{margin:7px 0 0}.retention-summary{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 0}.retention-summary .removed-count{background:#fff0e8;color:#88432b}.review-decision label{display:block;font-weight:600;font-size:13px;margin-bottom:6px}.review-decision textarea{width:100%;box-sizing:border-box;font:inherit;padding:12px;border:1px solid #b9cbc0;border-radius:8px;resize:vertical;min-height:105px}.character-count{text-align:right;color:#617569;font-size:12px;margin:4px 0 12px}.review-actions{display:flex;justify-content:flex-end;gap:14px;flex-wrap:wrap}.review-actions button{display:inline-flex;align-items:center;justify-content:center;gap:9px;min-height:44px;padding:10px 20px;border-radius:9px;font:inherit;font-size:14px;font-weight:700;cursor:pointer;transition:background-color .15s ease,box-shadow .15s ease}.review-actions svg{width:20px;height:20px}.reject-change{background:white;color:#a52424;border:1px solid #b82b2b}.reject-change:hover:not(:disabled){background:#fff2ef}.approve-change{background:var(--green,#245443);color:white;border:1px solid #245443}.approve-change:hover:not(:disabled){background:#193e31}.review-actions button:disabled{opacity:.5;cursor:default}button:focus-visible,summary:focus-visible,textarea:focus-visible{outline:2px solid #33745d;outline-offset:3px}.review-alert{color:#9e2929;padding:12px;background:#fff0ed;border-radius:8px;margin-bottom:14px}.review-alert button{font:inherit;padding:8px;margin-left:10px}.recorded-decision p{white-space:pre-wrap;overflow-wrap:anywhere}.read-only-message{color:#52685d;background:#f4f7f2;padding:12px;border-radius:8px}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}@media(max-width:900px){.change-summary{grid-template-columns:1fr 1fr}.change-summary h3{grid-column:1/-1}.change-summary>div{border-left:0;padding-left:0}.proposal-status{margin-left:0}}@media(max-width:600px){.photograph-panels,.change-summary{grid-template-columns:1fr}.comparison-table th,.comparison-table td{padding:8px;font-size:13px}.field-column{width:30%}.changed-badge{margin:4px 0 0}.proposal-metadata{align-items:flex-start;gap:9px}.proposal-metadata>span{flex-wrap:wrap;max-width:100%}.review-actions button{flex:1}.change-review-modal :deep(.modal-header){top:-16px}.photo-thumbnail img{height:115px}}@media(prefers-reduced-motion:reduce){.review-actions button{transition:none}}
</style>
