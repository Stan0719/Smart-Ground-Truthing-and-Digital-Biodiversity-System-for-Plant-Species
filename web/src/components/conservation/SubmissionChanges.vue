<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { reviewDateTime } from '../../utils/officerMonitoringDisplay'
const props = defineProps<{ update: unknown; revision: number | null; initialSubmission?: boolean; busy?: boolean; hideReload?: boolean; hideRevision?: boolean }>()
defineEmits<{ reload: [] }>()
const { t } = useI18n()
interface Change { field: string; before: string | number | null; after: string | number | null }
const details = computed(() => {
  const value = props.update as { state?: string; version?: number; updated_at?: string; changes?: Change[] } | null
  if (value?.state !== 'updated' || !Number.isSafeInteger(value.version) || (value.version ?? 0) < 2 || !Array.isArray(value.changes) || !value.changes.length) return null
  return value
})
const valueText = (value: string | number | null) => {
  if (value === null) return t('submissionChanges.unavailable')
  const text = String(value)
  return text.length > 160 ? `${text.slice(0, 157)}...` : text
}
</script>

<template>
  <section class="submission-changes" aria-live="polite">
    <template v-if="details">
      <strong class="updated-badge">{{ t('submissionChanges.updated') }}</strong>
      <p>{{ t('submissionChanges.edited', { version: details.version, date: reviewDateTime(details.updated_at) }) }}</p>
      <ul>
        <li v-for="change in details.changes" :key="change.field">
          {{ t(`submissionChanges.fields.${change.field}`) }}
          <template v-if="change.before !== null || change.after !== null"> · {{ valueText(change.before) }} → {{ valueText(change.after) }}<template v-if="change.field === 'heightCm'"> cm</template></template>
        </li>
      </ul>
    </template>
    <p v-else-if="!initialSubmission && (update as { state?: string } | null)?.state !== 'unchanged'">{{ t('submissionChanges.historyUnavailable') }}</p>
    <p v-if="!hideRevision">{{ t('submissionChanges.loadedRevision', { revision: revision ?? '—' }) }}</p>
    <button v-if="!hideReload" type="button" class="secondary-button" :disabled="busy" @click="$emit('reload')">{{ t('submissionChanges.reload') }}</button>
  </section>
</template>

<style scoped>
.submission-changes { margin: 12px 0 18px; padding: 14px 16px; border: 1px solid #cbded1; border-radius: 10px; background: #f0f7f1; color: #234b3a; overflow-wrap: anywhere; }
.submission-changes p { margin: 6px 0; font-size: 13px; }
.submission-changes ul { padding-left: 20px; font-size: 13px; white-space: pre-wrap; }
.updated-badge { display: inline-flex; padding: 3px 9px; border-radius: 20px; background: #fff1db; color: #80510c; font-size: 12px; }
</style>
