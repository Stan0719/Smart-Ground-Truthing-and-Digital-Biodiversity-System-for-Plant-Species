<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { nextTick, onMounted, onBeforeUnmount, ref } from 'vue'
const { t } = useI18n()
const props = withDefaults(defineProps<{ title: string; subtitle?: string; wide?: boolean; accessible?: boolean; suspended?: boolean; closeOnBackdrop?: boolean; closeOnEscape?: boolean; hideClose?: boolean; compact?: boolean; dangerBackdrop?: boolean }>(), { accessible: true, closeOnBackdrop: true, closeOnEscape: true })
const emit = defineEmits<{ close: [] }>()
const backdrop = ref<HTMLElement | null>(null)
const card = ref<HTMLElement | null>(null)
let opener: HTMLElement | null = null
let previousOverflow = ''
const inertNodes = new Map<HTMLElement, boolean>()
const focusables = () => Array.from(card.value?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])') || []).filter(element => !element.matches('[aria-disabled="true"]') && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden' && !element.closest('[inert],[aria-hidden="true"]'))
function backdropClick() {
  if (props.dangerBackdrop) {
    card.value?.classList.remove('danger-shake')
    void card.value?.offsetWidth
    card.value?.classList.add('danger-shake')
  } else if (props.closeOnBackdrop) emit('close')
}
function animationEnd(event: AnimationEvent) {
  if (event.target === card.value) card.value?.classList.remove('danger-shake')
}
function keyboard(event: KeyboardEvent) {
  if (!props.accessible) return
  if (event.key === 'Escape') {
    event.preventDefault()
    if (props.closeOnEscape) emit('close')
    else event.stopPropagation()
    return
  }
  if (event.key !== 'Tab') return
  const entries = focusables(), first = entries[0], last = entries.at(-1)
  if (!entries.length) { event.preventDefault(); card.value?.focus({ preventScroll: true }); return }
  if (event.shiftKey && (document.activeElement === first || !card.value?.contains(document.activeElement))) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && (document.activeElement === last || !card.value?.contains(document.activeElement))) { event.preventDefault(); first?.focus() }
}
onMounted(async () => {
  if (!props.accessible) return
  opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  // Lock the root scroller; locking body changes sticky dashboard ancestors.
  previousOverflow = document.documentElement.style.overflow
  document.documentElement.style.overflow = 'hidden'
  let current = backdrop.value
  while (current?.parentElement) {
    for (const sibling of current.parentElement.children) if (sibling !== current && sibling instanceof HTMLElement) {
      inertNodes.set(sibling, sibling.inert); sibling.inert = true
    }
    current = current.parentElement
    if (current === document.body) break
  }
  await nextTick(); (focusables()[0] || card.value)?.focus({ preventScroll: true })
})
onBeforeUnmount(() => {
  if (!props.accessible) return
  for (const [node, inert] of inertNodes) node.inert = inert
  document.documentElement.style.overflow = previousOverflow
  if (opener?.isConnected) opener.focus({ preventScroll: true })
})
</script>
<template>
  <div v-show="!suspended" ref="backdrop" class="modal-backdrop" :class="{ 'danger-backdrop': dangerBackdrop }" :inert="suspended || undefined" :aria-hidden="suspended ? 'true' : undefined" @click.self="backdropClick" @keydown="keyboard">
    <section
      class="modal-card"
      ref="card"
      tabindex="-1"
      :class="{ wide }"
      :data-compact="compact ? '' : undefined"
      role="dialog"
      :aria-modal="suspended ? undefined : 'true'"
      :aria-label="title"
      @animationend="animationEnd"
    >
      <header class="modal-header">
        <div :class="{ 'custom-modal-title': $slots.title }">
          <h2><slot name="title">{{ title }}</slot></h2>
          <p v-if="subtitle">{{ subtitle }}</p>
        </div>
        <button
          class="close-button"
          v-if="!hideClose"
          type="button"
          :aria-label="t('common.close')"
          @click="$emit('close')"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>
      </header>
      <slot />
    </section>
  </div>
</template>

<style scoped>
.custom-modal-title { flex: 1; min-width: 0; }
.close-button { display: grid; flex: 0 0 44px; min-width: 44px; min-height: 44px; place-items: center; padding: 0; }
.close-button svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
.modal-card[data-compact] { width: min(440px, calc(100vw - 32px)); }
.danger-shake { animation: modal-danger-shake 300ms ease-in-out; }
@keyframes modal-danger-shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-4px); } 50% { transform: translateX(4px); } 75% { transform: translateX(-3px); } }
@media (prefers-reduced-motion: reduce) { .danger-shake { animation: none; } }
</style>
