<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import ActionFeedback from './ActionFeedback.vue'

const props = defineProps<{ value?: string | number | null; copyLabel?: string }>()
const raw = computed(() => props.value == null ? '—' : String(props.value))
const abbreviated = computed(() => /^(?:staff:)?[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(raw.value))
const label = computed(() => {
  if (!abbreviated.value) return raw.value
  const prefix = /^staff:/i.test(raw.value) ? raw.value.slice(0, 6) : ''
  return prefix + raw.value.slice(prefix.length, prefix.length + 8) + '…'
})
const pending = ref(false)
const feedback = ref<{ id: number; variant: 'success' | 'error'; message: string } | null>(null)
let attempt = 0
const reset = () => { attempt++; pending.value = false; feedback.value = null }
watch(raw, reset)
onBeforeUnmount(reset)
async function copy() {
  if (!abbreviated.value || pending.value) return
  const value = raw.value, current = ++attempt
  pending.value = true
  feedback.value = null
  try {
    if (!navigator.clipboard?.writeText) throw Error('Clipboard unavailable')
    await navigator.clipboard.writeText(value)
    if (attempt === current) feedback.value = { id: current, variant: 'success', message: 'Full identifier copied.' }
  } catch {
    if (attempt === current) feedback.value = { id: current, variant: 'error', message: 'Unable to copy the identifier. Please try again.' }
  } finally {
    if (attempt === current) pending.value = false
  }
}
</script>

<template>
  <span class="admin-table-id" :class="{ 'is-short': abbreviated }">
    <code :title="raw">{{ label }}</code>
    <button v-if="abbreviated" type="button" class="admin-table-id-copy" :disabled="pending" :title="copyLabel || 'Copy full identifier'" :aria-label="copyLabel || 'Copy full identifier'" @click.stop="copy">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true" focusable="false"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V4H4v12h4" /></svg>
    </button>
  </span>
  <Teleport to="body"><ActionFeedback v-if="feedback" :key="feedback.id" :feedback-id="feedback.id" :variant="feedback.variant" :message="feedback.message" @dismiss="feedback = null" /></Teleport>
</template>
