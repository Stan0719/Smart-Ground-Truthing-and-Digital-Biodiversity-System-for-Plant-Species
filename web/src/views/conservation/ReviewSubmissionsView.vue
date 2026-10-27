<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import ActionFeedback from '../../components/ActionFeedback.vue'
import { plantApi, type Observation } from '../../services/plantApi'
import AppModal from '../../components/conservation/AppModal.vue'

const observations = ref<Observation[]>([]), selected = ref<Observation | null>(null), comment = ref(''), error = ref(''), busy = ref(false)
const feedback = ref<{ id: number; variant: 'success' | 'error'; message: string } | null>(null)
let feedbackId = 0
const showFeedback = (variant: 'success' | 'error', message: string) => { feedback.value = { id: ++feedbackId, variant, message } }
const dismissFeedback = (id: number) => { if (feedback.value?.id === id) feedback.value = null }
const search = ref(''), status = ref(''), species = ref('')
const speciesOptions = computed(() => [...new Set(observations.value.map(row => row.plant_id))].sort())
const counts = computed(() => ['Pending Review', 'Approved', 'Rejected', 'Correction Required', 'Flagged'].map(name => [name, observations.value.filter(row => row.status === name).length] as const))
const filtered = computed(() => observations.value.filter(row => {
  const query = search.value.trim().toLowerCase()
  return (!query || [row.id, row.plant_id, row.owner_subject].some(value => String(value || '').toLowerCase().includes(query))) && (!status.value || row.status === status.value) && (!species.value || row.plant_id === species.value)
}))
async function load() { observations.value = (await plantApi<{ observations: Observation[] }>('/observations')).observations }
onMounted(async () => { try { await load() } catch (e) { error.value = e instanceof Error ? e.message : 'Unable to load review submissions.' } })
function open(row: Observation) { selected.value = row; comment.value = ''; error.value = '' }
async function review(decision: string) { if (!selected.value || busy.value) return; busy.value = true; error.value = ''; try { await plantApi('/observations/' + selected.value.id + '/review', 'POST', { decision, comment: comment.value, revision: selected.value.revision }); await load(); selected.value = null; showFeedback('success', 'Decision saved.') } catch (e) { error.value = e instanceof Error ? e.message : 'Review failed.'; showFeedback('error', error.value) } finally { busy.value = false } }
</script>

<template>
  <ActionFeedback v-if="feedback" :key="feedback.id" :feedback-id="feedback.id" :variant="feedback.variant" :message="feedback.message" @dismiss="dismissFeedback" />
  <section class="page-intro"><div><p class="page-kicker">VERIFICATION WORKFLOW</p><h2>Review Submissions</h2><p>Verify botanist observations and preserve a clear review decision.</p></div></section>
  <p v-if="error" class="page-alert" role="alert">{{ error }}</p>
  <section class="summary-grid"><article v-for="count in counts" :key="count[0]" class="summary-card"><p>{{ count[0] }}</p><strong>{{ count[1] }}</strong><small>Observation submissions</small></article></section>
  <div class="control-bar"><label class="field search-field"><span>Search</span><input v-model="search" placeholder="Observation ID, Plant ID or botanist" /></label><label class="field"><span>Review status</span><select v-model="status"><option value="">All statuses</option><option v-for="count in counts" :key="count[0]" :value="count[0]">{{ count[0] }}</option></select></label><label class="field"><span>Plant ID</span><select v-model="species"><option value="">All plants</option><option v-for="id in speciesOptions" :key="id" :value="id">{{ id }}</option></select></label></div>
  <section class="panel"><div class="table-scroll"><table><thead><tr><th>Observation ID</th><th>Plant ID</th><th>Submitted By</th><th>Status</th><th>Actions</th></tr></thead><tbody><tr v-for="row in filtered" :key="row.id"><td><strong>{{ row.id }}</strong></td><td>{{ row.plant_id }}</td><td>{{ row.owner_subject }}</td><td><span class="badge" :class="row.status.toLowerCase().replaceAll(' ', '-')">{{ row.status }}</span></td><td><button class="action-button" @click="open(row)">Review</button></td></tr><tr v-if="!filtered.length"><td colspan="5" class="empty-row">{{ observations.length ? 'No submissions match the selected filters.' : 'No observation submissions recorded.' }}</td></tr></tbody></table></div></section>
  <AppModal v-if="selected" title="Review observation" wide @close="selected = null"><template v-if="selected"><p class="section-kicker">OBSERVATION DETAILS</p><div class="review-meta"><strong>{{ selected.id }}</strong><span class="badge" :class="selected.status.toLowerCase().replaceAll(' ', '-')">{{ selected.status }}</span></div><p>Plant ID: {{ selected.plant_id }} · Submitted by: {{ selected.owner_subject }}</p><div class="review-photos"><img v-for="asset in selected.assets || []" :key="asset.id" :src="'/api/data/assets/' + asset.id" alt="Observation photo" /></div><dl class="review-details"><template v-for="(value, key) in selected.content" :key="key"><dt>{{ key }}</dt><dd>{{ value }}</dd></template></dl><label class="form-field"><span>Feedback</span><textarea v-model="comment" maxlength="4000" /></label><p v-if="error" class="page-alert" role="alert">{{ error }}</p><div v-if="['Pending Review', 'Flagged'].includes(selected.status)" class="review-actions"><button v-for="decision in ['Approved', 'Rejected', 'Flagged', 'Correction Required']" :key="decision" :class="decision === 'Approved' ? 'primary-button' : decision === 'Rejected' ? 'danger-button' : 'secondary-button'" :disabled="busy" @click="review(decision)">{{ decision === 'Approved' ? 'Approve' : decision === 'Rejected' ? 'Reject' : decision === 'Flagged' ? 'Flag' : 'Request correction' }}</button></div></template></AppModal>
</template>

<style scoped>
.page-alert{padding:11px 14px;border-radius:9px;margin:0 0 16px;font-size:12px;background:#fff0ec;color:#a02020}.review-meta,.review-actions{display:flex;align-items:center;flex-wrap:wrap;gap:9px}.review-meta{margin-bottom:12px}.review-details{display:grid;grid-template-columns:minmax(110px,1fr) 3fr;gap:8px 12px;font-size:11px}.review-details dt{font-weight:700;color:#587267}.review-details dd{margin:0;overflow-wrap:anywhere}.review-photos{display:flex;gap:10px;flex-wrap:wrap}.review-photos img{max-width:100%;max-height:240px;border-radius:8px}.review-actions{margin-top:18px}.form-field textarea{min-height:90px}
</style>
