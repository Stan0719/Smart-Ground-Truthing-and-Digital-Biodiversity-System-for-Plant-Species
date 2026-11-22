<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { loadObservationVersionHistory, type ObservationHistoricalVersion } from '../../services/observationVersionHistory'
import { reviewDateTime } from '../../utils/officerMonitoringDisplay'
import AppModal from './AppModal.vue'
import PlantPhotoLightbox from '../PlantPhotoLightbox.vue'
const props = defineProps<{ observationId: string; plantId: string; origin: string; enabled: boolean; context: string; displayedSnapshotId?: string; approvedSourceSnapshotId?: string }>()
const emit = defineEmits<{ active: [value: boolean] }>()
const { t } = useI18n()
const label = (key: string) => t('observationVersions.' + key)
const title = computed(() => label(props.origin === 'initial_registration' ? 'registrationTitle' : 'title'))
const versionLabel = (row: ObservationHistoricalVersion) => row.ordinal == null ? label('snapshot') : t('observationVersions.version', { number: row.ordinal })
const versions = ref<ObservationHistoricalVersion[]>([]), selected = ref<ObservationHistoricalVersion | null>(null)
const available = ref(false), loading = ref(false), failed = ref(false), failedPhotos = ref(new Set<string>())
const helpOpen = ref(false), historyOpen = ref(false)
const helpTooltip = ref<HTMLElement | null>(null), helpButton = ref<HTMLElement | null>(null)
watch(helpOpen, async open => {
  await nextTick()
  if (!open || !helpOpen.value || !helpTooltip.value || !helpButton.value) return
  const bounds = helpButton.value.getBoundingClientRect()
  const width = Math.min(290, window.innerWidth - 24)
  const tooltip = helpTooltip.value
  tooltip.style.width = `${width}px`
  tooltip.style.left = `${Math.max(12, Math.min(bounds.right - width, window.innerWidth - width - 12))}px`
  tooltip.style.top = `${bounds.bottom + 8}px`
  // Native popovers enter the browser top layer, escaping sidebar overflow and
  // ancestor stacking contexts rather than competing with larger z-indexes.
  tooltip.showPopover?.()
  const height = tooltip.getBoundingClientRect().height
  if (bounds.bottom + 8 + height > window.innerHeight - 12) tooltip.style.top = `${Math.max(12, bounds.top - height - 8)}px`
})
const historyButtons = new Map<string, HTMLElement>()
const preview = ref<InstanceType<typeof PlantPhotoLightbox> | null>(null)
function enlargePhoto(url: string, event: Event) {
  if (!selected.value || !props.enabled || failedPhotos.value.has(url)) return
  const items = selected.value.photos.map(photo => ({ id: photo, url: photo }))
  void preview.value?.open(items, items.findIndex(photo => photo.url === url), label('photo'), event.currentTarget as HTMLElement)
}
let opener: HTMLElement | null = null
let parentScroll: { node: HTMLElement; top: number; left: number }[] = []
const snapshotTitle = computed(() => selected.value?.ordinal == null ? label('snapshot') : t('observationVersions.snapshotVersion', { number: selected.value.ordinal }))
const isCurrent = (row: ObservationHistoricalVersion) => Boolean(props.displayedSnapshotId) && row.id === props.displayedSnapshotId && row.observationId === props.observationId
const isApprovedSource = (row: ObservationHistoricalVersion) => props.origin === 'initial_registration' && Boolean(props.approvedSourceSnapshotId) && row.id === props.approvedSourceSnapshotId && row.observationId === props.observationId
let generation = 0
function select(row: ObservationHistoricalVersion | null) {
  if (row && (!props.enabled || !versions.value.some(version => version.key === row.key && version.id === row.id))) return
  if (row && isCurrent(row) && !isApprovedSource(row)) return
  preview.value?.close()
  const closingId = selected.value?.id
  const closing = selected.value !== null && row === null
  if (row && typeof document !== 'undefined') {
    opener = document.activeElement as HTMLElement | null
    parentScroll = []
    let node = opener?.parentElement
    while (node && node !== document.body) { if (node.scrollHeight > node.clientHeight) parentScroll.push({ node, top: node.scrollTop, left: node.scrollLeft }); node = node.parentElement }
  }
  selected.value = row; failedPhotos.value = new Set(); emit('active', row !== null)
  if (closing) void nextTick(() => { for (const position of parentScroll) if (position.node.isConnected) { position.node.scrollTop = position.top; position.node.scrollLeft = position.left }; const target = closingId ? historyButtons.get(closingId) : opener; if (target?.isConnected) target.focus({ preventScroll: true }); opener = null; parentScroll = [] })
}
async function load() {
  const token = ++generation
  select(null); helpOpen.value = false; historyOpen.value = false; versions.value = []; available.value = false; loading.value = false; failed.value = false
  if (!props.enabled) return
  loading.value = true
  try {
    const result = await loadObservationVersionHistory(props.observationId, props.plantId, props.origin)
    if (token !== generation) return
    versions.value = result.versions; available.value = result.available
  } catch { if (token === generation) failed.value = true }
  finally { if (token === generation) loading.value = false }
}
watch(() => [props.observationId, props.plantId, props.origin, props.enabled, props.context, props.displayedSnapshotId, props.approvedSourceSnapshotId], load, { immediate: true })
onBeforeUnmount(() => { generation++; preview.value?.close(); emit('active', false) })
</script>

<template>
  <section class="observation-version-history" :aria-label="title">
    <div class="history-heading"><h3>{{ title }}</h3><span class="history-info" @mouseenter="helpOpen = true" @mouseleave="helpOpen = false" @keydown.esc.stop="helpOpen = false"><button ref="helpButton" type="button" class="history-help-button" :aria-label="label('historyHelp')" :aria-expanded="helpOpen" @focus="helpOpen = true" @blur="helpOpen = false" @click="helpOpen = true">?</button><span v-if="helpOpen" ref="helpTooltip" popover="manual" class="history-tooltip" role="tooltip">{{ label('historyHelp') }}</span></span></div>
    <p v-if="loading" role="status">{{ label('loading') }}</p>
    <p v-else-if="failed" role="alert">{{ label('unavailable') }} <button type="button" class="secondary-button" :disabled="!enabled" @click="load">{{ label('retry') }}</button></p>
    <p v-else-if="!available || !versions.length" role="status">{{ label('unavailable') }}</p>
    <template v-else>
      <details :open="historyOpen" class="history-disclosure" @toggle="historyOpen = ($event.target as HTMLDetailsElement).open" @keydown.esc.stop="select(null)"><summary>{{ label('savedSnapshots') }} ({{ versions.length }})</summary>
      <div class="registration-history-scroll"><table class="registration-history-table">
        <colgroup><col class="version-column" /><col class="status-column" /><col class="action-column" /></colgroup>
        <thead><tr><th scope="col">{{ label('versionHeading') }}</th><th scope="col">{{ label('snapshotStatus') }}</th><th scope="col">{{ label('action') }}</th></tr></thead>
        <tbody><tr v-for="row in versions" :key="row.key" :class="{ superseded: row.status === 'Superseded' }">
          <td><strong>{{ versionLabel(row) }}</strong><small>{{ row.createdAt ? reviewDateTime(row.createdAt) : label('unavailable') }}</small><small v-if="isApprovedSource(row)" class="approved-source-label">{{ label('approvedSource') }}</small></td>
          <td>{{ t('observationVersions.statuses.' + row.status) }}</td>
          <td><span v-if="isCurrent(row) && !isApprovedSource(row)" class="currently-viewing" role="status">{{ label('currentlyViewing') }}</span><button v-else :ref="element => { if (element) historyButtons.set(row.id, element as HTMLElement); else historyButtons.delete(row.id) }" type="button" class="secondary-button" :disabled="!enabled" @click="select(row)">{{ label(isApprovedSource(row) ? 'viewSubmission' : 'viewDetails') }}</button></td>
        </tr></tbody>
      </table></div>
      </details>
    </template>
    <Teleport to="body">
      <div v-if="selected" class="officer-layout history-dialog-host">
      <AppModal class="registration-snapshot-dialog" :title="snapshotTitle" :subtitle="label('readOnly')" wide accessible @close="select(null)">
      <template #title><span class="snapshot-title"><span class="snapshot-title-icon" aria-hidden="true">▱</span>{{ snapshotTitle }}</span></template>
      <article :key="selected.key" class="historical-detail" :aria-label="label('readOnly')">
        <section class="snapshot-overview">
        <p role="status"><strong>{{ label('readOnly') }}</strong></p>
        <p>{{ label('snapshotStatus') }}: {{ t('observationVersions.statuses.' + selected.status) }}</p>
        <p>{{ label('created') }}: {{ selected.createdAt ? reviewDateTime(selected.createdAt) : label('unavailable') }}</p>
        <p v-if="selected.reviewedAt">{{ label('reviewed') }}: {{ reviewDateTime(selected.reviewedAt) }}</p>
        <p v-if="selected.reviewComment">{{ label('comment') }}: {{ selected.reviewComment }}</p>
        <p v-if="selected.reviewer">{{ label('reviewerIdentifier') }}: {{ selected.reviewer }}</p>
        </section>
        <div class="snapshot-columns"><div class="snapshot-left">
        <section class="snapshot-section"><h4><span aria-hidden="true">♧</span>{{ label('plantSpecies') }}</h4><dl v-if="selected.plantSpecies && Object.keys(selected.plantSpecies).length" class="historical-fields"><template v-for="(value,key) in selected.plantSpecies" :key="key"><dt>{{ t('observationVersions.fields.' + key) === 'observationVersions.fields.' + key ? key : t('observationVersions.fields.' + key) }}</dt><dd>{{ value == null || value === '' ? label('contentUnavailable') : value }}</dd></template></dl><p v-else>{{ label('contentUnavailable') }}</p></section>
        <section class="snapshot-section snapshot-photo-section">
        <div class="historical-photos"><template v-for="url in selected.photos" :key="url">
          <p v-if="failedPhotos.has(url)">{{ label('photoUnavailable') }}</p>
          <button v-else type="button" class="snapshot-photo-button" :aria-label="label('photo')" @click="enlargePhoto(url, $event)"><img :src="url" :alt="label('photo')" @error="failedPhotos.add(url)" /></button>
        </template></div>
        <p v-if="!selected.photos.length">{{ label('photoUnavailable') }}</p>
        </section></div>
        <section class="snapshot-section snapshot-observation"><h4><span aria-hidden="true">⌖</span>{{ label('submittedFields') }}</h4>
        <dl v-if="selected.content" class="historical-fields"><template v-for="(value, key) in selected.content" :key="key"><dt>{{ t('observationVersions.fields.' + key) === 'observationVersions.fields.' + key ? key : t('observationVersions.fields.' + key) }}</dt><dd>{{ value == null || value === '' ? label('contentUnavailable') : typeof value === 'object' ? JSON.stringify(value) : value }}</dd></template></dl>
        <p v-else>{{ label('contentUnavailable') }}</p>
        </section></div>
        <details class="history-technical"><summary>{{ label('technical') }}</summary><dl>
          <dt>{{ label('identity') }}</dt><dd>{{ selected.id }}</dd>
          <dt>{{ label('canonical') }}</dt><dd>{{ selected.observationId }}</dd>
          <template v-if="selected.reviewer"><dt>{{ label('reviewerIdentifier') }}</dt><dd>{{ selected.reviewer }}</dd></template>
        </dl></details>
        <button type="button" class="secondary-button" @click="select(null)">{{ label('back') }}</button>
        <PlantPhotoLightbox ref="preview" root-scroll-lock />
      </article>
      </AppModal>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.observation-version-history { margin-block: 16px; min-width: 0; }
.history-heading, .history-viewer-heading { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.history-info { position: relative; display: inline-flex; }
.history-help-button { border: 1px solid #9eafa3; border-radius: 50%; background: #fff; color: #245a46; padding: 0; width: 24px; min-height: 24px; font-weight: 600; cursor: help; }
.history-tooltip { position: fixed; z-index: 2147483647; inset: auto; margin: 0; box-sizing: border-box; max-width: calc(100vw - 24px); border: 0; background: #245a46; color: #fff; padding: 10px 12px; border-radius: 7px; font-size: 12px; line-height: 1.5; box-shadow: 0 3px 12px #0002; }
.history-disclosure > summary { cursor: pointer; padding: 10px 0; color: #245a46; font-size: 13px; }
.currently-viewing { font-size: 12px; color: #245a46; font-weight: 600; }
.approved-source-label { color: #245a46; font-weight: 600; line-height: 1.4; white-space: normal; }
.history-viewer-heading { justify-content: space-between; }
h3, h4 { margin: 0 0 8px; }
.history-intro, .history-help { margin: 6px 0; font-size: 13px; line-height: 1.5; }
.history-help { color: #52685f; }
.registration-history-scroll { max-width: 100%; overflow-x: auto; margin-top: 10px; }
.registration-history-table { width: 100%; table-layout: fixed; border-collapse: collapse; }
.version-column { width: 36%; } .status-column { width: 34%; } .action-column { width: 30%; }
.superseded { background: #e5e7eb; color: #374151; }
th, td { padding: 10px 8px; text-align: left; vertical-align: middle; overflow-wrap: anywhere; }
th { font-size: 12px; color: #173f34; background: #eaf3e9; }
td { font-size: 13px; border-bottom: 1px solid #dfe7df; }
td small { display: block; margin-top: 4px; font-size: 11px; }
button { max-width: 100%; white-space: normal; overflow-wrap: anywhere; min-height: 36px; padding: 7px 10px; font: inherit; font-size: 12px; }
button:focus-visible, summary:focus-visible { outline: 3px solid #33745d; outline-offset: 2px; }
.historical-detail { padding: 14px; border: 1px solid #d1d5db; border-radius: 8px; margin-top: 12px; background: #fbfcf8; min-width: 0; }
.historical-detail p { font-size: 13px; line-height: 1.5; }
.historical-fields { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: 8px 12px; font-size: 13px; }
dt { font-weight: 700; overflow-wrap: anywhere; }
dd { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; min-width: 0; }
.history-technical { margin: 12px 0; font-size: 12px; }
.history-technical summary { cursor: pointer; color: #245a46; }
.history-technical dl { display: grid; gap: 6px; }
.historical-photos { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(160px, 100%), 1fr)); min-width: 0; gap: 10px; }
.historical-photos img { width: 160px; max-width: 100%; height: 120px; object-fit: contain; }
.history-dialog-host { display: contents; }
.history-dialog-host .registration-snapshot-dialog { background: rgb(0 0 0 / 55%); }
.history-dialog-host :deep(.photo-lightbox::backdrop) { background: rgb(0 0 0 / 85%); }
.registration-snapshot-dialog :deep(.modal-card.wide) { width: min(960px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; padding: 0; }
.registration-snapshot-dialog :deep(.modal-header) { position: sticky; top: 0; z-index: 2; background: #fbfcf8; padding: 18px 24px; border-bottom: 1px solid #dfe7df; }
.registration-snapshot-dialog .historical-detail { margin: 0; padding: 24px; border: 0; border-radius: 0; }
.registration-snapshot-dialog .historical-fields { grid-template-columns: minmax(0,1fr) minmax(0,2fr); min-width: 0; }
.registration-snapshot-dialog .historical-photos { width: 100%; margin-block: 20px; }
.snapshot-title { display: flex; align-items: center; gap: 14px; color: #113e2a; font-weight: 700; }
.snapshot-title-icon { display: grid; place-items: center; width: 52px; height: 52px; flex-shrink: 0; border-radius: 12px; background: #e6efe4; color: #24603f; font-size: 32px; }
.registration-snapshot-dialog :deep(.modal-header) { background: #fff; margin-bottom: 0; padding: 24px; }
.registration-snapshot-dialog .historical-detail { background: #fff; }
.snapshot-overview { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 0 24px; border: 1px solid #dbe5dc; border-radius: 12px; padding: 16px 20px; background: #f8fbf7; margin-bottom: 24px; }
.snapshot-overview p { margin: 0; padding: 10px 0; border-bottom: 1px solid #e4eae4; overflow-wrap: anywhere; }
.snapshot-overview p:first-child { grid-column: 1 / -1; color: #28573d; }
.snapshot-columns { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); align-items: start; gap: 24px; }
.snapshot-left { display: grid; gap: 24px; min-width: 0; }
.snapshot-section { min-width: 0; border: 1px solid #dbe5dc; border-radius: 12px; overflow: hidden; }
.snapshot-section h4 { display: flex; gap: 10px; align-items: center; margin: 0; padding: 16px 18px; background: #edf4e9; color: #164b31; font-size: 16px; line-height: 1.4; }
.snapshot-section h4 span { color: #2a7047; font-size: 22px; }
.registration-snapshot-dialog .snapshot-section .historical-fields { margin: 0; padding: 8px 18px 16px; grid-template-columns: minmax(0,1fr) minmax(0,1.4fr); gap: 0 16px; }
.snapshot-section dt, .snapshot-section dd { padding: 12px 0; border-bottom: 1px solid #e6ebe5; line-height: 1.5; font-size: 13px; }
.snapshot-section > p { padding: 0 18px; }
.registration-snapshot-dialog .historical-photos { margin: 0; padding: 18px; box-sizing: border-box; gap: 12px; }
.snapshot-photo-button { width: 100%; min-width: 0; padding: 0; border: 1px solid #d4dfd4; background: #f4f7f2; border-radius: 10px; overflow: hidden; cursor: zoom-in; width: 100%; }
.historical-photos .snapshot-photo-button img { display: block; width: 100%; height: 150px; object-fit: contain; }
.history-technical { border: 1px solid #dbe5dc; border-radius: 12px; margin-block: 24px; overflow: hidden; }
.history-technical summary { padding: 16px 18px; background: #e9f2e4; font-size: 15px; font-weight: 700; }
.history-technical dl { padding: 4px 18px 16px; grid-template-columns: minmax(0,1fr) minmax(0,2fr); }
@media (max-width: 760px) { .snapshot-columns, .snapshot-overview { grid-template-columns: minmax(0,1fr); } .snapshot-title { font-size: 20px; } .snapshot-title-icon { width: 42px; height: 42px; } }
@media (max-width: 600px) { .registration-snapshot-dialog :deep(.modal-card.wide) { width: calc(100vw - 16px); max-height: calc(100dvh - 16px); } .registration-snapshot-dialog .historical-detail { padding: 16px; } .registration-snapshot-dialog .historical-fields { grid-template-columns: minmax(0,1fr); } }
@media (max-width: 480px) { th, td { padding: 8px 5px; } .historical-fields { grid-template-columns: minmax(0, 1fr); gap: 4px; } .historical-fields dd { margin-bottom: 8px; } button { min-height: 44px; } }
</style>



