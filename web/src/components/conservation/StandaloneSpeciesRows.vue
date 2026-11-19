<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { LinkedSpeciesRequest } from '../../services/reviewSpeciesRequest'
import { workflowBadgeStyle } from '../../utils/workflowBadge'
import { reviewDateTime } from '../../utils/officerMonitoringDisplay'
defineProps<{ row: LinkedSpeciesRequest; submitter: string; reviewer: string; authorized: boolean }>()
const emit = defineEmits<{ open: [id: string] }>()
const { t } = useI18n()
</script>
<template>
    <td :class="{ 'terminal-cell': row.status === 'Withdrawn' }"><strong :title="row.id">SPECIES-{{ row.id }}</strong></td><td :class="{ 'terminal-cell': row.status === 'Withdrawn' }">—</td><td :class="{ 'terminal-cell': row.status === 'Withdrawn' }">{{ t('conservationPages.reviews.speciesRequest.title') }}</td><td :class="{ 'terminal-cell': row.status === 'Withdrawn' }"><em>{{ row.scientificName || '\u2014' }}</em></td><td :class="{ 'terminal-cell': row.status === 'Withdrawn' }">{{ submitter }}</td><td :class="{ 'terminal-cell': row.status === 'Withdrawn' }">{{ reviewer }}</td><td :class="{ 'terminal-cell': row.status === 'Withdrawn' }">—</td><td :class="{ 'terminal-cell': row.status === 'Withdrawn' }">{{ reviewDateTime(row.submittedAt) }}</td><td :class="{ 'terminal-cell': row.status === 'Withdrawn' }"><span class="badge" :style="workflowBadgeStyle(row.status)">{{ t('observationEdits.statuses.'+row.status) }}</span></td><td :class="{ 'terminal-cell': row.status === 'Withdrawn' }"><button type="button" class="action-button" :disabled="!authorized" @click="emit('open',row.id)">{{ t('common.viewDetails') }}</button></td>
</template>

<style scoped>
td { padding: 12px 14px; text-align: left; vertical-align: middle; overflow-wrap: anywhere; }
.terminal-cell { background: #f3f4f6; color: #374151; }
.badge, .action-button { white-space: nowrap; }
.action-button { min-height: 32px; font-size: 13px; }
@media (max-width: 767px) { .action-button { min-height: 44px; } }
</style>
