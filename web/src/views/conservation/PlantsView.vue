<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { sessionSnapshot, subscribeSession } from '../../services/auth'
import { readOfficerPlants, type RegistryPlant } from '../../services/officerPlants'
import { formatPlantId } from '../../utils/plantId'
import { reviewDateTime } from '../../utils/officerMonitoringDisplay'
import OfficerPlantDelete from '../../components/conservation/OfficerPlantDelete.vue'
import OfficerPlantEdit from '../../components/conservation/OfficerPlantEdit.vue'
import OfficerPlantView from '../../components/conservation/OfficerPlantView.vue'
const editing=ref<string|null>(null),deleting=ref<string|null>(null),viewing=ref<string|null>(null),deleteFeedback=ref('')
async function afterDelete(){ await load();deleteFeedback.value=t('officerPlantDelete.'+(error.value?'savedRefresh':'saved')) }
const { t } = useI18n()
const text = (key: string) => t('officerPlants.' + key)
const q = ref(''), species = ref('')
const rows = ref<RegistryPlant[]>([]), choices = ref<{ id: string; name: string }[]>([])
const loading = ref(false), error = ref(false), cursor = ref<string | null>(null), next = ref<string | null>(null)
const previous = ref<(string | null)[]>([]), session = ref(sessionSnapshot())
let controller: AbortController | null = null, generation = 0, timer: ReturnType<typeof setTimeout> | undefined, refreshAfterPending = false
const ready = () => !session.value.pending && session.value.user?.role === 'Conservation Officer' && session.value.user.status === 'Active' && !session.value.user.mustChangePassword
async function load({ preserveRows = false }: { preserveRows?: boolean } = {}) {
  clearTimeout(timer); controller?.abort(); const token = ++generation
  if (!preserveRows) { rows.value = []; next.value = null }
  error.value = false
  if (!ready()) { loading.value = false; return }
  const abort = new AbortController(); controller = abort; loading.value = true
  try {
    const result = await readOfficerPlants({ q: q.value.trim(), species: species.value }, cursor.value, abort.signal)
    if (token !== generation || abort.signal.aborted || !ready()) return
    rows.value = result.plants; choices.value = result.species; next.value = result.page.next_cursor
  } catch { if (token === generation && !abort.signal.aborted) error.value = true }
  finally { if (token === generation) { loading.value = false; if (controller === abort) controller = null } }
}
function reset() {
  controller?.abort(); generation++; rows.value = []; next.value = null; cursor.value = null; previous.value = []; error.value = false
  clearTimeout(timer); loading.value = ready(); timer = setTimeout(() => { void load() }, 300)
}
watch([q, species], reset, { flush: 'sync' })
const unsubscribe = subscribeSession((user, pending) => {
  const authority = (value: typeof user) => {
    if (!value) return ''
    const permissions = (value as typeof value & { permissions?: string[] }).permissions
    return JSON.stringify([value.id, value.role, value.status, value.mustChangePassword,
      Array.isArray(permissions) ? [...permissions].sort() : null])
  }
  const previousAuthority = authority(session.value.user)
  const wasPending = session.value.pending
  session.value = { user, pending }
  if (authority(user) === previousAuthority) {
    if (pending && !wasPending && controller) refreshAfterPending = true
    else if (!pending && wasPending && refreshAfterPending && ready()) {
      refreshAfterPending = false
      void load({ preserveRows: rows.value.length > 0 })
    }
    return
  }
  refreshAfterPending = false
  controller?.abort(); generation++; choices.value = []; rows.value = []; cursor.value = null; next.value = null; previous.value = []; error.value = false
  editing.value = null; deleting.value = null; viewing.value = null; deleteFeedback.value = ''
  void load()
})
void load()
function forward() { if (!next.value || loading.value || error.value) return; previous.value.push(cursor.value); cursor.value = next.value; void load() }
function back() { if (!previous.value.length || loading.value) return; cursor.value = previous.value.pop() ?? null; void load() }
onBeforeUnmount(() => { generation++; controller?.abort(); clearTimeout(timer); unsubscribe() })
</script>

<template>
  <section class="plants-registry">
    <header class="page-intro"><div><p class="page-kicker">{{ text('eyebrow') }}</p><h2>{{ text('title') }}</h2></div></header>
    <div class="control-bar registry-filters">
      <label class="field"><span>{{ text('search') }}</span><input v-model="q" type="search" maxlength="200" :placeholder="text('searchPlaceholder')" /></label>
      <label class="field"><span>{{ text('species') }}</span><select v-model="species"><option value="">{{ text('allSpecies') }}</option><option v-for="choice in choices" :key="choice.id" :value="choice.id">{{ choice.name }}</option></select></label>
    </div>
    <p v-if="deleteFeedback" role="status">{{ deleteFeedback }}</p>
    <section class="panel registry-panel" :aria-busy="loading">
      <p v-if="!ready()" class="registry-state" role="status">{{ text('session') }}</p>
      <p v-else-if="loading && !rows.length" class="registry-state" role="status">{{ text('loading') }}</p>
      <div v-else-if="error && !rows.length" class="registry-state" role="alert"><p>{{ text('error') }}</p><button class="secondary-button" @click="load()">{{ text('retry') }}</button></div>
      <p v-if="ready() && loading && rows.length" class="registry-refresh" role="status">{{ text('loading') }}</p>
      <div v-if="ready() && error && rows.length" class="registry-refresh registry-refresh-error" role="alert"><span>{{ text('error') }}</span><button class="secondary-button" @click="load({ preserveRows: true })">{{ text('retry') }}</button></div>
      <p v-if="ready() && !loading && !error && !rows.length" class="registry-state">{{ text('empty') }}</p>
      <div v-if="ready() && rows.length" class="registry-scroll"><table class="registry-table" role="table">
        <thead role="rowgroup"><tr role="row"><th v-for="key in ['plantId','species','registered','actions']" :key="key" scope="col" role="columnheader">{{ text(key) }}</th></tr></thead>
        <tbody role="rowgroup"><tr v-for="plant in rows" :key="plant.id" role="row">
          <td role="cell" class="plant-identity"><span class="plant-emblem" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 4C9 4 4 9 4 17c0 2 1 3 3 3 8 0 13-5 13-16Z"/><path d="M3 21c4-6 8-9 14-13"/></svg></span><span class="cell-label" aria-hidden="true">{{ text('plantId') }}</span><div class="cell-value"><strong>{{ formatPlantId(plant.id) }}</strong><em class="plant-name-inline">{{ plant.scientific_name }}</em></div></td>
          <td role="cell"><span class="cell-label" aria-hidden="true">{{ text('species') }}</span><div class="cell-value"><strong class="species-name">{{ plant.species_scientific_name }}</strong><small v-if="plant.common_name">{{ plant.common_name }}</small></div></td>
          <td role="cell"><span class="cell-label" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 10h16M8 2v6M16 2v6"/></svg>{{ text('registered') }}:</span><div class="cell-value">{{ reviewDateTime(plant.registered_at) }}</div></td>
          <td role="cell"><div class="registry-actions">
            <span class="action-wrap"><button type="button" class="action-button icon-action" :aria-label="text('view')" :aria-describedby="`plant-${plant.id}-view-tooltip`" @click="viewing=plant.id"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0" /></svg><span class="mobile-action-label">{{ t('common.view') }}</span></button><span :id="`plant-${plant.id}-view-tooltip`" class="action-tip" role="tooltip">{{ text('view') }}</span></span>
            <span class="action-wrap"><button class="action-button icon-action" :disabled="!ready()||plant.status!=='Approved'" :aria-label="text('edit')" :aria-describedby="`plant-${plant.id}-edit-tooltip`" @click="editing=plant.id"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m16 3 5 5-12 12-6 1 1-6ZM14 5l5 5" /></svg><span class="mobile-action-label">{{ text('edit') }}</span></button><span :id="`plant-${plant.id}-edit-tooltip`" class="action-tip" role="tooltip">{{ text('edit') }}</span></span>
            <span class="action-wrap"><button class="action-button icon-action danger" :disabled="!ready()" :aria-label="text('delete')" :aria-describedby="`plant-${plant.id}-delete-tooltip`" @click="deleting=plant.id"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></svg><span class="mobile-action-label">{{ text('delete') }}</span></button><span :id="`plant-${plant.id}-delete-tooltip`" class="action-tip" role="tooltip">{{ text('delete') }}</span></span>
          </div></td>
        </tr></tbody>
      </table></div>
      <nav class="registry-pagination" :aria-label="text('pagination')"><button class="secondary-button" :disabled="!previous.length || loading" @click="back">{{ text('previous') }}</button><span>{{ text('page') }} {{ previous.length + 1 }}</span><button class="secondary-button" :disabled="!next || loading || error" @click="forward">{{ text('next') }}</button></nav>
    </section>
  </section>
  <OfficerPlantDelete :plant-id="deleting" @close="deleting=null" @deleted="afterDelete" />
  <OfficerPlantEdit :plant-id="editing" @close="editing=null" @saved="load" />
  <OfficerPlantView :plant-id="viewing" @close="viewing=null" />
</template>

<style scoped>
.plants-registry { min-width: 0; container-type: inline-size; }
.registry-filters { display: grid; grid-template-columns: minmax(0,2fr) repeat(2,minmax(0,1fr)); gap: 16px; margin-bottom: 24px; }
.registry-filters .field { min-width: 0; }
.registry-panel { min-width: 0; padding: 20px; }
.registry-scroll { overflow-x: auto; }
.registry-table { width: 100%; border-collapse: collapse; font-size: 14px; table-layout: fixed; }
.officer-layout.officer-layout.officer-layout .registry-table { min-width: 0; white-space: normal; }
.registry-table th:nth-child(1) { width: 29%; }
.registry-table th:nth-child(2) { width: 34%; }
.registry-table th:nth-child(3) { width: 22%; }
.registry-table th:nth-child(4) { width: 15%; }
th, td { padding: 12px; text-align: left; vertical-align: middle; border-bottom: 1px solid #dfe7df; overflow-wrap: anywhere; }
th { background: #245443; color: #fff; font-size: 12px; }
td small { display: block; color: #53695e; }
.registry-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.icon-action { width: 44px; height: 44px; padding: 0; display: inline-flex; align-items: center; justify-content: center; }
.icon-action svg { width: 18px; height: 18px; }
.registry-actions .icon-action:hover:not(:disabled), .registry-actions .icon-action:focus-visible:not(:disabled) { border-color: #33745d; background: #33745d; color: #fff; }
.registry-actions .icon-action.danger:hover:not(:disabled), .registry-actions .icon-action.danger:focus-visible:not(:disabled) { border-color: #b84d42; background: #b84d42; color: #fff; }
.action-wrap { position: relative; display: inline-flex; }
.action-tip { position: absolute; bottom: calc(100% + 6px); right: 0; z-index: 5; width: max-content; max-width: 180px; padding: 6px 9px; border-radius: 6px; background: #173f34; color: #fff; font-size: 12px; line-height: 1.5; pointer-events: none; opacity: 0; visibility: hidden; white-space: normal; }
.action-wrap:hover .action-tip, .action-wrap:focus-within .action-tip { opacity: 1; visibility: visible; }
.registry-pagination { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 12px; margin-top: 20px; }
.registry-state { padding: 16px; color: #53695e; }
.registry-refresh { display:flex;align-items:center;gap:12px;margin:0;padding:8px 12px;color:#53695e;font-size:13px;line-height:1.5; }
.registry-refresh-error { justify-content:space-between;color:#9f3028; }
.cell-label, .plant-emblem, .mobile-action-label { display: none; }
.cell-value { min-width: 0; }
.plant-identity .cell-value { display: grid; gap: 3px; min-width: 0; }
.plant-identity strong, .species-name { color: #245443; font-weight: 700; }
.plant-name-inline { display: block; min-width: 0; color: #53695e; font-size: 13px; font-weight: 400; }
.species-name { display: block; }
.registry-actions .icon-action { text-decoration: none; }
.cell-value .badge { display: inline-flex; width: max-content; max-width: none; white-space: nowrap; flex: 0 0 auto; }
button:focus-visible, a:focus-visible, [tabindex]:focus-visible { outline: 3px solid #245443; outline-offset: 3px; }
@container (max-width: 900px) {
  .registry-filters { grid-template-columns: minmax(0,1fr); }
  .registry-panel { box-sizing:border-box;width:100%;min-width:0;max-width:100%;padding:0;border:0;background:transparent;box-shadow:none; }
  .registry-scroll { width:100%;min-width:0;max-width:100%;overflow:visible; }
  .registry-table, tbody { display:block;width:100%;min-width:0;max-width:100%;box-sizing:border-box; }
  thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  tbody { display: grid; gap: 16px; }
  tbody tr { display:grid;width:100%;min-width:0;max-width:100%;box-sizing:border-box;gap:12px;padding:16px;border:1px solid #cfdbd4;border-radius:16px;background:#fff; }
  td { display:grid;grid-template-columns:fit-content(50%) minmax(0,1fr);align-items:start;gap:8px;border:0;padding:0;min-width:0;max-width:100%;box-sizing:border-box; }
  .registry-table th:nth-child(n) { width: auto; }
  .plant-identity { position:relative;display:block;min-width:0;padding:0 0 14px 62px;border-bottom:1px solid #d7e0db; }
  .plant-identity .cell-label { display:none; }
  .plant-identity .plant-emblem { position:absolute;left:0;top:0;display:grid;width:48px;height:48px;place-items:center;border-radius:10px;background:#dcebd8;color:#245443; }
  .plant-emblem svg { width:32px;height:32px; }
  .plant-identity .cell-value { display:grid;gap:3px; }
  .plant-identity .cell-value strong { color:#174c38;font-size:18px;line-height:1.4;overflow-wrap:anywhere; }
  .plant-identity .plant-name-inline { display:block;font-size:14px;font-style:italic;line-height:1.5;overflow-wrap:anywhere; }
  .cell-label { display: flex; align-items: flex-start; gap: 8px; font-size: 14px; line-height: 1.5; font-weight: 600; color: #315848; }
  .cell-label svg { width: 20px; height: 20px; flex: 0 0 auto; margin-top: 1px; }
  .cell-value { min-width:0;font-size:14px;line-height:1.5;overflow-wrap:anywhere; }
  .cell-value em { color: #245443; font-weight: 500; }
  .cell-value small { font-size: 14px; line-height: 1.5; margin-top: 3px; }
  .badge { display: inline-flex; align-items: center; width: fit-content; max-width: 100%; padding: 4px 10px; border-radius: 99px; line-height: 1.4; }
  td:nth-child(2) { display:block;min-width:0;padding:0 0 14px 62px;border-bottom:1px solid #d7e0db; }
  td:nth-child(2) .cell-label { display:none; }
  td:nth-child(2) .cell-value { display:grid;gap:3px; }
  td:nth-child(2) .species-name { color:#174c38;font-size:16px;line-height:1.45;overflow-wrap:anywhere; }
  td:nth-child(2) .cell-value small { color:#53695e;font-size:14px;line-height:1.45; }
  td:nth-child(3) { display:grid;grid-template-columns:fit-content(48%) minmax(0,1fr);align-items:start;gap:8px; }
  td:last-child { display:block;min-width:0; }
  .registry-actions { display:grid;width:100%;min-width:0;grid-template-columns:repeat(3,minmax(0,1fr));gap:0;padding:12px 0 0;border-top:1px solid #cfdbd4; }
  .action-wrap { min-width:0;justify-content:center; }
  .action-wrap + .action-wrap { border-left: 1px solid #cfdbd4; }
  .officer-layout.officer-layout.officer-layout .registry-table .icon-action { width:100%;min-width:0;min-height:44px;height:auto;padding:8px 3px;gap:5px;border:0;border-radius:8px;background:transparent;color:#2b6b50;font-size:clamp(11px,3.2vw,14px);line-height:1.35;flex-wrap:nowrap;white-space:normal;box-shadow:none; }
  .officer-layout.officer-layout.officer-layout .registry-table .icon-action.danger { color:#b32b28; }
  .officer-layout.officer-layout.officer-layout .registry-table .icon-action:not(:disabled):hover { border-color:#3c7d64;background:#3c7d64;color:#fff; }
  .officer-layout.officer-layout.officer-layout .registry-table .icon-action.danger:not(:disabled):hover { border-color:#b84d42;background:#b84d42;color:#fff; }
  .officer-layout.officer-layout.officer-layout .registry-table .icon-action:disabled { border-color:transparent;background:transparent;color:#737d79;cursor:not-allowed;opacity:1; }
  .icon-action svg { width: 20px; height: 20px; flex: 0 0 auto; }
  .mobile-action-label { display: inline; overflow-wrap: anywhere; }
  .action-tip { display: none !important; }
  .registry-pagination { padding: 0 4px; }
}
@media (hover: none) {
  .action-wrap { flex-direction: column; align-items: center; }
  .action-tip { position: static; opacity: 1; visibility: visible; width: auto; max-width: 100%; padding: 4px 0 0; background: transparent; color: #245443; text-align: center; overflow-wrap: anywhere; }
}
</style>
