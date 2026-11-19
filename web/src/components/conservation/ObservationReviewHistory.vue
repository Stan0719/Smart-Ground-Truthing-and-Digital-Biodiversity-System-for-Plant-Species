<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { sessionSnapshot, subscribeSession } from '../../services/auth'
import { createObservationReviewHistory, formatReviewTimestamp } from '../../services/observationReviewHistory'
import { workflowBadgeStyle } from '../../utils/workflowBadge'

const props = defineProps<{ observationId: string; refreshKey: number }>()
const { t, locale } = useI18n()
const ht = (key: string) => t('observationReviewHistory.' + key)
const history = createObservationReviewHistory()
const state = history.state
const expanded = ref(false)
const heading = ref<HTMLElement | null>(null)
const olderButton = ref<HTMLButtonElement | null>(null)
const retryButton = ref<HTMLButtonElement | null>(null)
const expandButton = ref<HTMLButtonElement | null>(null)
const announcement = ref('')
const visibleReviews = computed(() => expanded.value ? state.reviews : state.reviews.slice(0, 3))
const canExpand = computed(() => state.reviews.length > 3 || state.hasMore)
const eventsId = computed(() => 'observation-review-events-' + props.observationId)
let interaction = 0
let disposed = false
const session = ref(sessionSnapshot())
const authorized = computed(() => !session.value.pending && session.value.user?.role === 'Conservation Officer' && session.value.user.status === 'Active' && !session.value.user.mustChangePassword)
const unsubscribe = subscribeSession(() => {
  interaction++
  expanded.value = false
  announcement.value = ''
  history.reset()
  session.value = sessionSnapshot()
})
watch(() => [props.observationId, props.refreshKey, authorized.value, session.value.user?.id], () => {
  interaction++
  expanded.value = false
  announcement.value = ''
  if (authorized.value) void history.load(props.observationId)
  else history.reset()
}, { immediate: true })
onBeforeUnmount(() => { disposed = true; interaction++; history.reset(); unsubscribe() })
const decisionLabel = (decision: string) => t('conservationPages.observations.values.' + decision.toLowerCase().replace(/[^a-z0-9]+/g, ''))

async function toggleHistory() {
  expanded.value = !expanded.value
  const token = ++interaction
  announcement.value = ''
  await nextTick()
  if (!disposed && token === interaction) expandButton.value?.focus({ preventScroll: true })
}

async function requestHistory(append: boolean) {
  if (state.loading || !authorized.value) return
  const token = ++interaction
  const observationId = props.observationId
  const initiatingElement = typeof document === 'undefined' ? null : document.activeElement
  const restoreFocus = initiatingElement !== null && (initiatingElement === olderButton.value || initiatingElement === retryButton.value)
  // Retry feedback is replaced during loading, so move focus before it disappears.
  if (restoreFocus && initiatingElement === retryButton.value) heading.value?.focus({ preventScroll: true })
  const retainedElement = typeof document === 'undefined' ? null : document.activeElement
  announcement.value = ''
  if (append) await history.load(observationId, true)
  else await history.retry()
  await nextTick()
  if (disposed || token !== interaction || observationId !== props.observationId || !authorized.value) return
  if (!state.failed) announcement.value = ht(state.hasMore ? 'updated' : 'complete')
  // Retain a user's deliberate move elsewhere while the request was pending.
  if (!restoreFocus || (document.activeElement !== retainedElement && document.activeElement !== document.body)) return
  const target = state.failed ? retryButton.value : state.hasMore && expanded.value ? olderButton.value : heading.value
  target?.focus({ preventScroll: true })
}
</script>

<template>
  <section v-if="authorized" class="observation-review-history" :aria-label="ht('title')" :aria-busy="state.loading">
    <h3 ref="heading" class="history-heading" tabindex="-1">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 2.7-6.4L3 8" /><path d="M3 3v5h5M12 7v5l4 2" /></svg>
      {{ ht('title') }}
    </h3>
    <div class="history-content">
    <p class="history-status" role="status" aria-live="polite">{{ state.loading ? ht('loading') : announcement }}</p>
    <div v-if="state.failed" role="alert">
      <p>{{ refreshKey ? ht('refreshError') : ht('error') }}</p>
      <button ref="retryButton" type="button" class="action-button" :aria-disabled="state.loading" @click="requestHistory(false)">{{ ht('retry') }}</button>
    </div>
    <p v-if="!state.loading && !state.failed && !state.reviews.length">{{ ht('empty') }}</p>
    <ol v-if="state.reviews.length" :id="eventsId" class="review-events">
      <li v-for="review in visibleReviews" :key="review.id" class="review-event">
        <div class="review-event-summary">
          <span class="badge" :style="workflowBadgeStyle(review.decision)">{{ decisionLabel(review.decision) }}</span>
          <time :datetime="review.created_at || undefined">{{ formatReviewTimestamp(review.created_at, locale) }}</time>
        </div>
        <div class="history-reviewer"><slot v-if="review.reviewer_subject?.trim()" name="reviewer" :review="review" :subject="review.reviewer_subject.trim()">{{ review.reviewer_subject.trim() }}</slot><template v-else>{{ ht('reviewerUnavailable') }}</template></div>
        <p v-if="review.review_origin === 'species_dependency'" class="history-comment"><strong>{{ t('submissionChanges.automaticRejection') }}</strong> ? {{ review.species_request_id }}</p>
        <p class="history-comment">{{ review.comment }}</p>
      </li>
    </ol>
    <button v-if="canExpand" ref="expandButton" type="button" class="action-button history-toggle" :aria-expanded="expanded" :aria-controls="eventsId" @click="toggleHistory">{{ ht(expanded ? 'fewer' : 'more') }}</button>
    <template v-if="expanded">
      <p v-if="state.hasMore">{{ ht('partial') }}</p>
      <button v-if="state.hasMore && !state.failed" ref="olderButton" type="button" class="action-button" :aria-disabled="state.loading" @click="requestHistory(true)">{{ ht('older') }}</button>
    </template>
    </div>
  </section>
</template>

<style scoped>
.observation-review-history { min-width: 0; }
.observation-review-history .history-heading { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 6px; background: #edf5ee; color: #245443; font-size: .875rem; text-transform: uppercase; }
.history-heading svg { width: 18px; height: 18px; flex: 0 0 18px; }
.history-content { padding: 16px; }
.history-status:empty { margin: 0; }
.history-toggle { margin-top: 8px; }
.history-heading:focus-visible { outline: 3px solid #315b49; outline-offset: 2px; }
.review-events { list-style: none; margin: 0; padding: 0; }
.review-event { min-width: 0; padding: 14px 0; }
.review-event + .review-event { border-top: 1px solid #e0e7df; }
.review-event-summary { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; }
.review-event-summary time { color: #5b7065; }
.history-reviewer, .history-comment { margin: 8px 0 0; overflow-wrap: anywhere; }
.history-comment { white-space: pre-wrap; }
</style>
