<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { LinkedSpeciesRequest } from '../../services/reviewSpeciesRequest'
import { workflowBadgeStyle } from '../../utils/workflowBadge'
import { reviewDateTime } from '../../utils/officerMonitoringDisplay'
defineProps<{ row: LinkedSpeciesRequest; submitter: string; reviewer: string; zoneLabel: string; authorized: boolean }>()
const emit = defineEmits<{ open: [id: string] }>()
const { t } = useI18n()
</script>
<template>
  <td :class="{ 'terminal-cell': row.status === 'Withdrawn' }"><span class="review-card-emblem" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 3C8 3 3 7 4 15s12 6 16-12ZM3 22 16 9" /></svg></span><span class="review-cell-label" aria-hidden="true">{{ t('approvedChanges.submissionId') }}</span><strong :title="row.id">SPECIES-{{ row.id }}</strong></td>
  <td :class="{ 'terminal-cell': row.status === 'Withdrawn' }"><span class="review-cell-label" aria-hidden="true">{{ t('approvedChanges.plantId') }}</span>—</td>
  <td :class="{ 'terminal-cell': row.status === 'Withdrawn' }"><span class="review-cell-label" aria-hidden="true">{{ t('approvedChanges.submissionType') }}</span>{{ t('conservationPages.reviews.speciesRequest.title') }}</td>
  <td :class="{ 'terminal-cell': row.status === 'Withdrawn' }"><span class="review-cell-label" aria-hidden="true">{{ t('conservationText.species') }}</span><em>{{ row.scientificName || '—' }}</em></td>
  <td :class="{ 'terminal-cell': row.status === 'Withdrawn' }"><span class="review-cell-label" aria-hidden="true">{{ t('conservationText.submittedby') }}</span>{{ submitter }}</td>
  <td :class="{ 'terminal-cell': row.status === 'Withdrawn' }"><span class="review-cell-label" aria-hidden="true">{{ t('approvedChanges.reviewedByColumn') }}</span>{{ reviewer }}</td>
  <td :class="{ 'terminal-cell': row.status === 'Withdrawn' }"><span class="review-cell-label" aria-hidden="true">{{ zoneLabel }}</span>—</td>
  <td :class="{ 'terminal-cell': row.status === 'Withdrawn' }"><span class="review-cell-label" aria-hidden="true">{{ t('conservationPages.reviews.recordCreated') }}</span>{{ reviewDateTime(row.submittedAt) }}</td>
  <td :class="{ 'terminal-cell': row.status === 'Withdrawn' }"><span class="review-cell-label" aria-hidden="true">{{ t('conservationText.status') }}</span><span class="badge" :style="workflowBadgeStyle(row.status)">{{ t('observationEdits.statuses.' + row.status) }}</span></td>
  <td :class="{ 'terminal-cell': row.status === 'Withdrawn' }"><span class="review-cell-label" aria-hidden="true">{{ t('plantProximity.scoreColumn') }}</span>—</td>
  <td class="actions-cell" :class="{ 'terminal-cell': row.status === 'Withdrawn' }"><span class="review-cell-label" aria-hidden="true">{{ t('conservationText.actions') }}</span><button type="button" class="action-button" :disabled="!authorized" @click="emit('open', row.id)"><svg class="review-row-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>{{ t('common.viewDetails') }}</button></td>
</template>

<style scoped>
td { padding: 12px 14px; text-align: left; vertical-align: middle; overflow-wrap: anywhere; }
.terminal-cell { background: #f3f4f6; color: #374151; }
.badge, .action-button { white-space: nowrap; }
.action-button { min-height: 32px; font-size: 13px; }
.review-cell-label { display: none; }
.review-card-emblem { display:none; }
@container (max-width: 767px) {
  td { display: block; min-width: 0; padding: 0; border: 0; white-space: normal; }
  td:first-child, td:nth-child(4), td.actions-cell { grid-column: 1 / -1; }
  td:first-child { position:relative;min-height:48px;padding:0 0 12px 64px; }
  .review-card-emblem { position:absolute;left:0;top:0;display:grid;place-items:center;width:48px;height:48px;border-radius:10px;background:#dcebd8;color:#245443; }
  .review-card-emblem svg { width:32px;height:32px; }
  td:not(:first-child):not(:nth-child(4)):not(.actions-cell) { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 0; }
  td:first-child .review-cell-label { display: none; }
  td:first-child strong { color: #174c38; font-size: 18px; font-weight: 700; line-height: 1.4; }
  .badge { max-width: 100%; white-space: normal; overflow-wrap: anywhere; }
.review-cell-label { display: inline-flex; align-items: center; margin: 0 8px 0 0; color: #426b56; font-size: 14px; font-weight: 600; line-height: 1.5; }
.review-cell-label::after { content: ':'; }
  .actions-cell .review-cell-label { display: none; }
  .actions-cell .action-button { display: inline-flex; align-items: center; justify-content: center; gap: 8px; width: 100%; min-height: 44px; border: 0; background: transparent; color: #245443; font-size: 14px; font-weight: 600; }
  .actions-cell .action-button:hover { background: #eaf3e9; }
  .review-row-action-icon { display: block; width: 18px; height: 18px; flex: none; }
  tr.terminal-read-only > td { background: transparent; color: #29483e; }
}
</style>
