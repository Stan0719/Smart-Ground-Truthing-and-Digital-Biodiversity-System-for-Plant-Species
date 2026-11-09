<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { nextTick, onMounted, onBeforeUnmount, ref } from 'vue'
const { t } = useI18n()
const props = defineProps<{ title: string; subtitle?: string; wide?: boolean; accessible?: boolean }>()
const emit = defineEmits<{ close: [] }>()
const backdrop = ref<HTMLElement | null>(null)
const card = ref<HTMLElement | null>(null)
let opener: HTMLElement | null = null
let previousOverflow = ''
const inertNodes = new Map<HTMLElement, boolean>()
const focusables = () => Array.from(card.value?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex="0"]') || [])
function keyboard(event: KeyboardEvent) {
  if (!props.accessible) return
  if (event.key === 'Escape') { event.preventDefault(); emit('close') }
  if (event.key !== 'Tab') return
  const entries = focusables(), first = entries[0], last = entries.at(-1)
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
onMounted(async () => {
  if (!props.accessible) return
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  let current = backdrop.value
  while (current?.parentElement) {
    for (const sibling of current.parentElement.children) if (sibling !== current && sibling instanceof HTMLElement) {
      inertNodes.set(sibling, sibling.inert); sibling.inert = true
    }
    current = current.parentElement
    if (current === document.body) break
  }
  await nextTick(); focusables()[0]?.focus()
})
onBeforeUnmount(() => {
  if (!props.accessible) return
  for (const [node, inert] of inertNodes) node.inert = inert
  document.body.style.overflow = previousOverflow
  if (opener?.isConnected) opener.focus()
})
</script>
<template>
  <div ref="backdrop" class="modal-backdrop" @click.self="$emit('close')" @keydown="keyboard">
    <section
      class="modal-card"
      ref="card"
      :class="{ wide }"
      role="dialog"
      aria-modal="true"
      :aria-label="title"
    >
      <header class="modal-header">
        <div>
          <h2>{{ title }}</h2>
          <p v-if="subtitle">{{ subtitle }}</p>
        </div>
        <button
          class="close-button"
          type="button"
          :aria-label="t('common.close')"
          @click="$emit('close')"
        >
          ×
        </button>
      </header>
      <slot />
    </section>
  </div>
</template>
