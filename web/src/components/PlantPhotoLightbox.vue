<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref } from 'vue'
import { useConservationText } from '../composables/useConservationText'
import type { HistoryPhoto } from '../services/plantHistory'
const { ct } = useConservationText()
const props = defineProps<{ rootScrollLock?: boolean }>()
const dialog = ref<HTMLDialogElement | null>(null), closeButton = ref<HTMLButtonElement | null>(null)
const photos = ref<HistoryPhoto[]>([]), index = ref(0), title = ref('')
const failed = reactive(new Set<string>()), active = computed(() => photos.value[index.value])
let trigger: HTMLElement | null = null, overflow: string | null = null, generation = 0
let scrollRoot: HTMLElement | null = null
function close() {
  generation++
  if (dialog.value?.open) dialog.value.close()
  photos.value = []; failed.clear()
  if (overflow !== null && scrollRoot) { scrollRoot.style.overflow = overflow; overflow = null; scrollRoot = null }
  const target = trigger; trigger = null
  if (target?.isConnected) target.focus({ preventScroll: true })
}
async function open(items: HistoryPhoto[], at: number, label: string, source: HTMLElement) {
  if (!items[at]) return
  close(); const attempt = ++generation
  photos.value = [...items]; index.value = at; title.value = label; trigger = source
  await nextTick()
  if (attempt !== generation || !dialog.value || !active.value) return
  dialog.value.showModal()
  scrollRoot = props.rootScrollLock ? document.documentElement : document.body
  overflow = scrollRoot.style.overflow; scrollRoot.style.overflow = 'hidden'
  closeButton.value?.focus()
}
function move(offset: number) { if (photos.value.length > 1) index.value = (index.value + offset + photos.value.length) % photos.value.length }
function keydown(event: KeyboardEvent) {
  // Opt-in nested drawer preview: keep keyboard handling in the topmost dialog.
  if (props.rootScrollLock) {
    event.stopPropagation?.()
    if (event.key === 'Tab') {
      const entries = Array.from(dialog.value?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') || [])
      const first = entries[0], last = entries.at(-1)
      if (first && (!dialog.value?.contains(document.activeElement) || (!event.shiftKey && document.activeElement === last))) {
        event.preventDefault(); first.focus()
      } else if (last && event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus()
      }
      return
    }
  }
  if (event.altKey || event.ctrlKey || event.metaKey) return
  if (event.key === 'Escape') { event.preventDefault(); close() }
  if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1) }
}
function imageFailed(event: Event) {
  const url = (event.currentTarget as HTMLImageElement | null)?.getAttribute('src')
  const photo = photos.value.find(photo => photo.url === url)
  if (photo) failed.add(photo.id)
}
onBeforeUnmount(close)
defineExpose({ open, close })
</script>

<template>
  <dialog ref="dialog" class="photo-lightbox" :aria-label="title || ct('Plant photo')" @cancel.prevent="close" @close="() => { if (!dialog?.open) close() }" @keydown="keydown" @click="event => { if (event.target === event.currentTarget) close() }">
    <div v-if="active" class="lightbox-content">
      <header><p>{{ title }}</p><button ref="closeButton" type="button" :aria-label="ct('Close photo')" @click="close">×</button></header>
      <div class="lightbox-image">
        <img v-if="!failed.has(active.id)" :key="active.id" :src="active.url" :alt="`${title} · ${ct('Photo')} ${index + 1} / ${photos.length}`" @error="imageFailed" />
        <p v-else role="status">{{ ct('Photo unavailable') }}</p>
      </div>
      <footer>
        <button type="button" :disabled="photos.length < 2" :aria-label="ct('Previous photo')" @click="move(-1)">← {{ ct('Previous') }}</button>
        <p role="status" aria-live="polite" aria-atomic="true">{{ ct('Photo') }} {{ index + 1 }} / {{ photos.length }}</p>
        <button type="button" :disabled="photos.length < 2" :aria-label="ct('Next photo')" @click="move(1)">{{ ct('Next') }} →</button>
      </footer>
    </div>
  </dialog>
</template>

<style scoped>
.photo-lightbox { width: min(1040px, calc(100vw - 32px)); max-width: none; max-height: calc(100dvh - 32px); padding: 0; border: 0; border-radius: 16px; color: #f8f6ee; background: #173f34; box-shadow: 0 24px 80px #102f2666; }
.photo-lightbox::backdrop { background: #10241ee8; }
.lightbox-content { padding: 12px 20px; }
header, footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
header p { margin: 0; overflow-wrap: anywhere; }
button { min-width: 44px; min-height: 44px; padding: 8px 12px; border: 1px solid #b1c7b866; border-radius: 8px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
header button { font-size: 28px; }
button:disabled { opacity: .45; cursor: default; }
button:hover:not(:disabled) { background: #ffffff18; }
button:focus-visible { outline: 3px solid #d7e6bd; outline-offset: 3px; }
.lightbox-image { display: grid; place-items: center; min-height: 180px; }
img { display: block; max-width: 100%; max-height: calc(100dvh - 190px); object-fit: contain; animation: reveal 120ms ease-out; }
footer p { white-space: nowrap; font-size: 13px; }
@keyframes reveal { from { opacity: .6; } to { opacity: 1; } }
@media (max-width: 480px) { .lightbox-content { padding: 8px; } footer { gap: 6px; } footer button { font-size: 12px; padding: 6px; } }
@media (prefers-reduced-motion: reduce) { img { animation: none; } }
</style>
