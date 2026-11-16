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
function reconcile(items: HistoryPhoto[]) {
  const current = active.value
  if (!current) return
  const at = items.findIndex(photo => photo.id === current.id && photo.url === current.url)
  if (at < 0) { close(); return }
  photos.value = [...items]; index.value = at
}
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
defineExpose({ open, close, reconcile })
</script>

<template>
  <dialog ref="dialog" class="photo-lightbox" :aria-label="title || ct('Plant photo')" @cancel.prevent="close" @close="() => { if (!dialog?.open) close() }" @keydown="keydown" @click="event => { if (event.target === event.currentTarget) close() }">
    <div v-if="active" class="zoom-content" @click.self="close">
      <div class="zoom-photo-frame" @click.stop>
        <button ref="closeButton" type="button" class="zoom-close" :aria-label="ct('Close photo')" @click.stop="close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
        <img v-if="!failed.has(active.id)" :key="active.id" :src="active.url" :alt="`${title} - ${ct('Photo')} ${index + 1} / ${photos.length}`" @error="imageFailed" />
        <p v-else class="lightbox-error" role="status">{{ ct('Photo unavailable') }}</p>
        <template v-if="photos.length > 1">
          <button type="button" class="image-nav previous-photo" :aria-label="ct('Previous photo')" @click.stop="move(-1)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m14 6-6 6 6 6" /></svg></button>
          <button type="button" class="image-nav next-photo" :aria-label="ct('Next photo')" @click.stop="move(1)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m10 6 6 6-6 6" /></svg></button>
          <span class="gallery-counter" role="status" aria-live="polite" aria-atomic="true"><span aria-hidden="true">{{ index + 1 }}/{{ photos.length }}</span><span class="visually-hidden">{{ ct('Photo') }} {{ index + 1 }} / {{ photos.length }}</span></span>
        </template>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.photo-lightbox { position: fixed; inset: 0; margin: 0; padding: 0; border: 0; border-radius: 0; width: 100%; max-width: none; height: 100dvh; max-height: none; box-sizing: border-box; background: transparent; box-shadow: none; overflow: hidden; }
.photo-lightbox::backdrop { background: rgb(8 24 17 / 85%); }
.zoom-content { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; }
.zoom-photo-frame { position: relative; flex: 0 0 auto; width: fit-content; line-height: 0; }
.zoom-content img { display: block; max-width: calc(100vw - 128px); max-height: calc(100dvh - 128px); width: auto; height: auto; object-fit: contain; border-radius: 10px; }
.zoom-close { position: absolute; top: -12px; right: -12px; z-index: 2; display: grid; place-items: center; width: 44px; height: 44px; padding: 0; border: 1px solid rgb(255 255 255 / 45%); border-radius: 50%; background: rgb(23 63 52 / 84%); color: #fff; cursor: pointer; }
.zoom-close svg { display: block; width: 22px; height: 22px; pointer-events: none; }
.zoom-close:hover { background: #173f34; }
.zoom-close:focus-visible { outline: 3px solid #fff; outline-offset: 2px; box-shadow: 0 0 0 5px #173f34; }
.image-nav { position: absolute; top: 50%; z-index: 1; display: grid; place-items: center; width: 44px; height: 44px; padding: 0; transform: translateY(-50%); border: 1px solid rgb(255 255 255 / 45%); border-radius: 50%; background: rgb(23 63 52 / 84%); color: #fff; cursor: pointer; box-shadow: 0 2px 8px rgb(0 0 0 / 16%); transition: background-color 120ms ease; }
.image-nav svg { display: block; width: 20px; height: 20px; pointer-events: none; }
.image-nav:hover { background: #173f34; }
.image-nav:focus-visible { outline: 3px solid #fff; outline-offset: 2px; box-shadow: 0 0 0 5px #173f34; }
.gallery-counter { position: absolute; right: 12px; bottom: 12px; z-index: 1; padding: 5px 9px; border-radius: 999px; background: rgb(23 63 52 / 84%); color: #fff; font-size: 12px; line-height: 1.4; pointer-events: none; }
.zoom-photo-frame .previous-photo { left: -52px; }
.zoom-photo-frame .next-photo { right: -52px; }
.zoom-photo-frame .gallery-counter { top: calc(100% + 12px); bottom: auto; right: auto; left: 50%; transform: translateX(-50%); padding: 0; background: transparent; white-space: nowrap; }
.visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.photo-lightbox { color: #fff; }
.lightbox-error { display: grid; place-items: center; width: min(320px, calc(100vw - 128px)); min-height: 180px; margin: 0; padding: 12px; box-sizing: border-box; line-height: 1.5; text-align: center; }
.zoom-content img { animation: photo-reveal 120ms ease-out; }
@keyframes photo-reveal { from { opacity: .72; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .zoom-content img { animation: none; } .image-nav { transition: none; } }
</style>
