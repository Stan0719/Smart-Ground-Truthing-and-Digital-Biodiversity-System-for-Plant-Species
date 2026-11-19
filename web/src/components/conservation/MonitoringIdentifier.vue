<script setup lang="ts">
import '../../styles/officer-copy.css'
import { useOfficerCopyConfirmation } from '../../composables/useOfficerCopyConfirmation'
const confirmation = useOfficerCopyConfirmation({ schedule: (fn, ms) => setTimeout(fn, ms), cancel: id => clearTimeout(id as ReturnType<typeof setTimeout>) })
const copied = confirmation.copied, toastKey = confirmation.toastKey

import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { sessionSnapshot, subscribeSession } from '../../services/auth'

const props = defineProps<{ value?: string | number | null; labels: ReadonlyMap<string, string>; copyLabel?: string; feedbackDuration?: number }>()
const { t } = useI18n()
const raw = computed(() => props.value === null || props.value === undefined ? '' : String(props.value))
const label = computed(() => props.labels.get(raw.value) || raw.value || '\u2014')
const shortened = computed(() => !!raw.value && label.value !== raw.value)
const session = ref(sessionSnapshot())
const authorized = computed(() => !session.value.pending && session.value.user?.role === 'Conservation Officer' && session.value.user.status === 'Active' && !session.value.user.mustChangePassword)
const feedback = ref(''), failed = ref(false), pending = ref(false)
let attempt = 0, disposed = false
const reset = () => { confirmation.clear(); attempt++; feedback.value = ''; failed.value = false; pending.value = false }
const unsubscribe = subscribeSession(() => { session.value = sessionSnapshot(); reset() })
watch(raw, reset)
async function copy() {
  if (!authorized.value || !shortened.value || pending.value) return
  const value = raw.value, token = ++attempt
  confirmation.reset('identifier')
  pending.value = true; feedback.value = ''; failed.value = false
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
    await navigator.clipboard.writeText(value)
    if (!disposed && token === attempt && value === raw.value && authorized.value) {
      confirmation.confirm('identifier')
    }
  } catch {
    if (!disposed && token === attempt) { failed.value = true; feedback.value = t('monitoringDisplay.copyUnavailable') }
  } finally { if (!disposed && token === attempt) pending.value = false }
}
onBeforeUnmount(() => { disposed = true; reset(); unsubscribe() })
</script>

<template>
  <span class="monitoring-identifier">
    <span class="monitoring-id-line">
      <span :title="raw">{{ label }}</span>
      <span v-if="shortened" class="officer-copy-anchor"><button class="monitoring-id-copy" type="button" :disabled="!authorized || pending" :aria-label="copyLabel || t('monitoringDisplay.copy', { id: label })" :title="copyLabel || t('monitoringDisplay.copy', { id: label })" @click.stop="copy">
        <svg v-if="!copied.identifier" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true" focusable="false"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/></svg>
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 12 4 4 10-10" /></svg>
      </button><span v-if="toastKey" class="officer-copy-toast" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m5 12 4 4 10-10" /></svg><span>{{ t('conservationPages.reviews.copiedToast') }}</span></span></span>
      <span class="officer-copy-live" role="status" aria-live="polite" aria-atomic="true"><span v-if="toastKey">{{ t('conservationPages.reviews.copiedToast') }}</span></span>
    </span>
    <span v-if="feedback" class="monitoring-copy-feedback" role="status">{{ feedback }}</span>
    <span v-if="failed" class="monitoring-full-id">{{ raw }}</span>
  </span>
</template>

<style scoped>
.monitoring-identifier { display: inline-flex; flex-direction: column; max-width: 100%; vertical-align: middle; }
.monitoring-id-line { display: inline-flex; align-items: center; justify-content: flex-start; gap: 7px; white-space: nowrap; }
.officer-layout .monitoring-identifier .monitoring-id-copy { display: inline-flex; align-items: center; justify-content: flex-start; flex: 0 0 44px; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 5px; background: transparent; color: inherit; box-shadow: none; transform: none; cursor: pointer; }
.monitoring-id-copy svg { width: 17px; height: 17px; }
.officer-layout .monitoring-identifier .monitoring-id-copy:focus-visible { outline: 2px solid #245443; outline-offset: 2px; }
.monitoring-copy-feedback { font-size: 12px; white-space: normal; }
.monitoring-full-id { user-select: text; overflow-wrap: anywhere; white-space: normal; }
</style>
