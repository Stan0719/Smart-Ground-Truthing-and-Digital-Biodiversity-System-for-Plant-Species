<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import PlantPhotoLightbox from './PlantPhotoLightbox.vue'
import { useConservationText } from '../composables/useConservationText'
import type { GalleryAsset, GalleryGroup } from '../services/plantGallery'
const props = defineProps<{ groups: GalleryGroup[]; loading: boolean; error: string; complete: boolean; hasMore: boolean; registrationOnly?: boolean }>()
defineEmits<{ retry: []; more: [] }>()
const { ct } = useConservationText()
const selected = reactive<Record<string, string>>({})
const failed = reactive(new Set<string>())
const loaded = reactive(new Set<string>())
const lightbox = ref<InstanceType<typeof PlantPhotoLightbox> | null>(null)
function enlarge(group: GalleryGroup, event: MouseEvent) {
  void lightbox.value?.open(group.assets, group.assets.indexOf(active(group)), ct('Initial Registration Photos'), event.currentTarget as HTMLElement)
}
const sections = computed(() => props.registrationOnly ? [
  { title: 'Initial Registration Photos', groups: props.groups.filter(g => g.origin === 'initial_registration') },
] : [
  { title: 'Initial Registration Photos', groups: props.groups.filter(g => g.origin === 'initial_registration') },
  { title: 'Subsequent Observations', groups: props.groups.filter(g => g.origin === 'subsequent_observation') },
  { title: 'Other Plant Photos', groups: props.groups.filter(g => g.origin === 'unknown') },
])
const count = computed(() => sections.value.reduce((n, section) => n + section.groups.reduce((total, g) => total + g.assets.length, 0), 0))
const active = (group: GalleryGroup) => group.assets.find(a => a.id === selected[group.key]) || group.assets[0]!
const label = (group: GalleryGroup, index: number) => `${ct('Photo')} ${index + 1} / ${group.assets.length} · ${group.observationId || ct('Unlinked plant photos')}`
function move(group: GalleryGroup, offset: number) {
  const at = group.assets.findIndex(a => a.id === active(group).id)
  const next = props.registrationOnly ? (at + offset + group.assets.length) % group.assets.length : at + offset
  const photo = group.assets[next]; if (photo) selected[group.key] = photo.id
}
function imageFailed(event: Event, asset: GalleryAsset) {
  if ((event.currentTarget as HTMLImageElement | null)?.getAttribute('src') === asset.url) failed.add(asset.id)
}
function imageLoaded(event: Event, asset: GalleryAsset) {
  if ((event.currentTarget as HTMLImageElement | null)?.getAttribute('src') === asset.url) loaded.add(asset.id)
}
</script>

<template>
  <section class="plant-photo-gallery" :class="{ 'registration-gallery': registrationOnly }" :aria-busy="loading" aria-label="ct(registrationOnly ? 'Initial Registration Photos' : 'Plant Photos')">
    <h2 v-if="registrationOnly" class="visually-hidden">{{ ct('Initial Registration Photos') }}</h2>
    <header v-if="!registrationOnly" class="gallery-header">
      <div><p class="gallery-eyebrow">{{ ct('PHOTO RECORD') }}</p><h2 id="plant-photos-title">{{ ct('Plant Photos') }}</h2><p class="gallery-intro">{{ ct('Browse the photos available for this plant.') }}</p></div>
      <p v-if="count" class="gallery-count" role="status"><strong>{{ count }}</strong><span>{{ ct(complete ? 'photos available' : 'photos loaded') }}</span></p>
    </header>
    <p v-if="loading" class="loading-status" role="status">{{ ct('Loading photos…') }}</p>
    <div v-if="error" class="gallery-message gallery-error" role="alert"><div><strong>{{ ct('Photos could not be loaded') }}</strong><p>{{ ct('Please try again. Your plant record is still available.') }}</p><details><summary>{{ ct('Details') }}</summary><p>{{ ct(error) }}</p></details></div><button class="gallery-action" type="button" :disabled="loading" @click="$emit('retry')">{{ ct('Retry') }}</button></div>
    <div v-if="loading && !count" class="gallery-skeleton" aria-hidden="true"><div></div><span></span><span></span><span></span></div>
    <div v-if="!loading && !error && complete && !count" class="gallery-message gallery-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="8" cy="8" r="1.5" /><path d="m3 16 5-5 5 5 3-3 5 5" /></svg><p>{{ ct('No eligible plant photos are available.') }}</p></div>
    <section v-for="section in sections" v-show="section.groups.length || (complete && count > 0)" :key="section.title" class="photo-section" :class="{ 'empty-section': !section.groups.length }">
      <header v-if="!registrationOnly" class="section-heading"><h3><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M20 4C9 3 3 9 6 15s14 3 14-11Z" /><path d="m4 21 11-12" /></svg>{{ ct(section.title) }}</h3><span class="section-count">{{ section.groups.reduce((n, g) => n + g.assets.length, 0) }} {{ ct(complete ? 'photos' : 'loaded') }}</span></header>
      <p v-if="!section.groups.length && complete && !error" class="section-empty">{{ ct('No eligible photos in this section.') }}</p>
      <article v-for="(group, groupIndex) in section.groups" :key="group.key" class="photo-group">
        <header v-if="!registrationOnly" class="group-heading"><div><h4>{{ group.date ? new Date(group.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : `${ct('Photo set')} ${groupIndex + 1}` }}</h4><p v-if="group.origin === 'unknown'" class="provenance-note">{{ ct('Origin not verified') }}</p></div><span v-if="group.status" class="photo-status">{{ ct(group.status) }}</span></header>
        <details v-if="group.observationId && !registrationOnly" class="observation-reference"><summary>{{ ct('Observation details') }}</summary><code>{{ group.observationId }}</code></details>
        <figure class="large-photo">
          <div v-if="!loaded.has(active(group).id) && !failed.has(active(group).id)" class="image-skeleton" aria-hidden="true"></div>
          <img v-if="!failed.has(active(group).id)" :key="active(group).id" :class="{ 'image-ready': loaded.has(active(group).id) }" :src="active(group).url" :alt="label(group, group.assets.indexOf(active(group)))" loading="lazy" @load="imageLoaded($event, active(group))" @error="imageFailed($event, active(group))" />
          <button v-if="registrationOnly && !failed.has(active(group).id)" type="button" class="enlarge-photo" :aria-label="ct('Enlarge plant photo')" @click="enlarge(group, $event)"></button>
          <div v-if="failed.has(active(group).id)" class="photo-placeholder" role="img" :aria-label="ct('Photo unavailable')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3" /><path d="m3 3 18 18M3 16l5-5m6 3 2-2 5 5" /></svg><strong>{{ ct('Photo unavailable') }}</strong><span>{{ ct('Try another photo or reload the gallery.') }}</span></div>
          <template v-if="registrationOnly">
            <button v-if="group.assets.length > 1" type="button" class="image-nav previous-photo" :aria-label="ct('Previous photo')" @click.stop="move(group, -1)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m14 6-6 6 6 6" /></svg></button>
            <button v-if="group.assets.length > 1" type="button" class="image-nav next-photo" :aria-label="ct('Next photo')" @click.stop="move(group, 1)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m10 6 6 6-6 6" /></svg></button>
            <span class="gallery-counter" role="status" aria-live="polite" aria-atomic="true"><span aria-hidden="true">{{ group.assets.indexOf(active(group)) + 1 }} / {{ group.assets.length }}</span><span class="visually-hidden">{{ ct('Photo') }} {{ group.assets.indexOf(active(group)) + 1 }} {{ ct('of') }} {{ group.assets.length }}</span></span>
          </template>
          <figcaption class="visually-hidden">{{ label(group, group.assets.indexOf(active(group))) }}</figcaption>
        </figure>
        <div v-if="!registrationOnly" class="photo-navigation">
          <button class="photo-nav-button" type="button" :aria-label="ct('Previous photo')" :disabled="active(group).id === group.assets[0]?.id" @click="move(group, -1)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg><span class="photo-nav-label">{{ ct('Previous') }}</span></button>
          <p class="selected-counter" role="status" aria-live="polite" aria-atomic="true"><span class="counter-label">{{ ct('Photo') }}</span> <strong>{{ group.assets.indexOf(active(group)) + 1 }}</strong> {{ ct('of') }} {{ group.assets.length }}</p>
          <button class="photo-nav-button" type="button" :aria-label="ct('Next photo')" :disabled="active(group).id === group.assets.at(-1)?.id" @click="move(group, 1)"><span class="photo-nav-label">{{ ct('Next') }}</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m10 6 6 6-6 6" /></svg></button>
        </div>
        <div v-if="!registrationOnly || group.assets.length > 1" class="photo-thumbnails" role="group" :aria-label="ct('Photo selection')">
          <button v-for="(asset, index) in group.assets" :key="asset.id" class="photo-thumbnail" type="button" :aria-label="label(group, index)" :aria-pressed="active(group).id === asset.id" @click="selected[group.key] = asset.id">
            <img v-if="!failed.has(asset.id)" :src="asset.url" alt="" loading="lazy" @error="imageFailed($event, asset)" />
            <span v-else class="thumbnail-unavailable" aria-hidden="true">—</span><span v-if="!registrationOnly" class="thumbnail-number">{{ index + 1 }}</span><svg v-if="!registrationOnly && active(group).id === asset.id" class="thumbnail-selected" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 10 3 3 7-7" /></svg><span v-if="registrationOnly && active(group).id === asset.id" class="visually-hidden">{{ ct('Selected photo') }}</span>
          </button>
        </div>
      </article>
    </section>
    <footer v-if="hasMore" class="gallery-footer"><p>{{ ct('More photos are available. Counts show the photos loaded so far.') }}</p><button class="gallery-action" type="button" :disabled="loading" @click="$emit('more')">{{ ct('Load more photos') }}</button></footer>
    <PlantPhotoLightbox ref="lightbox" />
  </section>
</template>

<style scoped>
.registration-gallery .photo-group { padding-top: 0; }
.registration-gallery .photo-section { margin: 0; padding-top: 0; border: 0; }
.registration-gallery .section-heading { margin-top: 0; }
.enlarge-photo { position: absolute; inset: 0; width: 100%; border: 0; background: transparent; color: #fff; cursor: zoom-in; }
.enlarge-photo:focus-visible { outline: 3px solid #315f4e; outline-offset: 3px; }
.enlarge-photo:not(:disabled):hover { background: transparent; }
.plant-photo-gallery { --photo-green: #315f4e; color: #304c40; max-width: 960px; min-width: 0; margin-inline: auto; padding: clamp(20px, 3vw, 36px); border: 1px solid #dfe6dd; border-radius: 20px; background: #fff; box-shadow: 0 8px 32px #254b3a08; }
.gallery-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; padding-bottom: 28px; }
.gallery-eyebrow { margin: 0 0 6px; color: #66796b; font-size: 10px; font-weight: 700; letter-spacing: .13em; }
.gallery-header h2 { margin: 0; color: #284c3c; font-size: clamp(22px, 3vw, 28px); font-weight: 600; letter-spacing: -.03em; }
.gallery-intro { margin: 7px 0 0; color: #647268; font-size: 12px; line-height: 1.7; }
.gallery-count { flex: none; display: grid; gap: 2px; margin: 1px 0 0; text-align: right; }
.gallery-count strong { font-size: 24px; font-weight: 600; line-height: 1.3; }
.gallery-count span { color: #657367; font-size: 11px; }
.photo-section { padding-top: 24px; border-top: 1px solid #e5eae2; }
.photo-section + .photo-section { margin-top: 28px; }
.section-heading, .group-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.section-heading h3 { display: flex; align-items: center; gap: 9px; margin: 0; font-size: 15px; font-weight: 600; line-height: 1.5; }
.section-heading svg { width: 19px; height: 19px; flex: none; color: #557b60; }
.section-count { flex: none; color: #6b776d; font-size: 11px; }
.photo-group { min-width: 0; padding-top: 22px; }
.photo-group + .photo-group { margin-top: 28px; padding-top: 26px; border-top: 1px solid #e9ede6; }
.group-heading h4 { margin: 0; font-size: 13px; font-weight: 600; }
.photo-status { max-width: 50%; padding: 5px 9px; border-radius: 6px; background: #eef3ec; color: #355b40; font-size: 10px; font-weight: 600; text-align: center; }
.provenance-note, .section-empty { margin: 7px 0 0; color: #6a7469; font-size: 12px; line-height: 1.7; }
.empty-section { padding-top: 20px; }
.empty-section .section-heading h3 { font-size: 13px; color: #5a6c60; }
.observation-reference { margin-top: 6px; color: #68756a; font-size: 10px; }
.observation-reference summary { cursor: pointer; width: fit-content; padding-block: 4px; }
.observation-reference code { display: block; margin-top: 5px; overflow-wrap: anywhere; }
.large-photo { position: relative; display: grid; place-items: center; isolation: isolate; box-sizing: border-box; width: 100%; min-width: 0; aspect-ratio: 16 / 10; min-height: 240px; max-height: 500px; margin: 14px 0 0; overflow: hidden; border: 1px solid #e2e7df; border-radius: 14px; background: #f1f3ee; }
.large-photo > img { position: absolute; inset: 0; display: block; width: 100%; height: 100%; object-fit: contain; opacity: 0; transition: opacity 160ms ease; }
.large-photo > img.image-ready { opacity: 1; }
.photo-placeholder { display: grid; justify-items: center; align-content: center; gap: 10px; padding: 24px; color: #667568; text-align: center; font-size: 12px; }
.photo-placeholder > svg, .gallery-empty > svg { width: 34px; height: 34px; color: #839789; }
.photo-placeholder strong { color: #435d4b; font-size: 14px; font-weight: 500; }
.photo-navigation { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 12px; }
button { box-sizing: border-box; min-height: 44px; border: 1px solid #c9d5c9; border-radius: 9px; color: var(--photo-green); background: #fff; font: inherit; cursor: pointer; transition: border-color 150ms ease, background-color 150ms ease, box-shadow 150ms ease; }
.photo-nav-button { display: inline-flex; justify-content: center; align-items: center; gap: 6px; padding: 9px 13px; font-size: 11px; font-weight: 500; }
.photo-nav-button svg { width: 17px; height: 17px; }
.selected-counter { margin: 0; color: #6b766c; font-size: 12px; font-variant-numeric: tabular-nums; }
.selected-counter strong { color: #304f3c; font-weight: 600; }
.counter-label { margin-right: 3px; }
.photo-thumbnails { display: flex; gap: 9px; min-width: 0; max-width: 100%; padding: 6px 3px 12px; margin-top: 13px; overflow-x: auto; overscroll-behavior-x: contain; scroll-snap-type: x proximity; scrollbar-width: thin; scrollbar-color: #bdccbc transparent; }
.photo-thumbnail { position: relative; flex: 0 0 80px; height: 72px; min-width: 0; padding: 4px; scroll-snap-align: start; }
.photo-thumbnail > img { display: block; width: 100%; height: 100%; object-fit: contain; border-radius: 5px; background: #f1f3ee; }
.thumbnail-number { position: absolute; bottom: 6px; left: 6px; min-width: 17px; padding: 1px 3px; border-radius: 3px; color: #fff; background: #294535e6; font-size: 9px; line-height: 1.5; text-align: center; }
.thumbnail-selected { position: absolute; top: -5px; right: -5px; width: 18px; height: 18px; padding: 1px; border: 2px solid #fff; border-radius: 50%; color: #fff; background: #315f4e; }
.thumbnail-unavailable { display: grid; height: 100%; place-items: center; color: #778878; background: #f1f3ee; border-radius: 5px; }
.photo-thumbnail[aria-pressed="true"] { border: 2px solid #315f4e; padding: 3px; box-shadow: 0 0 0 2px #e5eee2; }
button:not(:disabled):hover { border-color: #71947b; background: #f3f7f0; }
button:focus-visible, summary:focus-visible { outline: 3px solid #468585; outline-offset: 3px; }
button:disabled { opacity: .4; cursor: default; }
.gallery-action { padding: 10px 18px; color: #fff; background: #315f4e; border-color: #315f4e; font-size: 12px; font-weight: 500; }
.gallery-action:not(:disabled):hover { color: #fff; background: #254c3d; border-color: #254c3d; }
.gallery-message { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 22px; border: 1px solid #e2e7de; border-radius: 12px; background: #f8faf6; }
.gallery-message strong { font-size: 13px; font-weight: 600; }
.gallery-message p, .gallery-footer p { margin: 7px 0 0; color: #68756a; font-size: 12px; line-height: 1.7; }
.gallery-error details { margin-top: 8px; font-size: 11px; }
.gallery-error summary { cursor: pointer; }
.gallery-empty { flex-direction: column; justify-content: center; gap: 12px; min-height: 160px; text-align: center; }
.gallery-footer { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 16px; padding-top: 22px; margin-top: 28px; border-top: 1px solid #e5eae2; }
.gallery-footer p { margin: 0; }
.loading-status { display: flex; align-items: center; gap: 8px; color: #617665; font-size: 12px; }
.loading-status::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: #719879; animation: gallery-pulse 1.4s ease-in-out infinite; }
.image-skeleton { position: absolute; inset: 0; background: #e7ece3; animation: gallery-pulse 1.4s ease-in-out infinite; }
.gallery-skeleton { display: flex; flex-wrap: wrap; gap: 10px; }
.gallery-skeleton div { width: 100%; height: 260px; border-radius: 14px; background: #e9ede5; animation: gallery-pulse 1.4s ease-in-out infinite; }
.gallery-skeleton span { width: 76px; height: 64px; border-radius: 8px; background: #edf0e9; }
.visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@keyframes gallery-pulse { 50% { opacity: .55; } }
@media (max-width: 680px) { .gallery-header { gap: 16px; padding-bottom: 22px; } .section-heading { align-items: flex-start; gap: 10px; } .section-heading h3 { font-size: 14px; } .large-photo { aspect-ratio: 4 / 3; min-height: 220px; } }
@media (max-width: 480px) { .plant-photo-gallery { padding: 18px 14px; border-radius: 15px; } .gallery-intro { max-width: 23ch; font-size: 11px; } .gallery-count strong { font-size: 21px; } .gallery-count span { max-width: 9ch; font-size: 10px; } .gallery-count { padding-top: 3px; } .gallery-eyebrow { font-size: 9px; } .section-count { font-size: 10px; } .section-heading h3 { font-size: 13px; gap: 6px; } .section-heading svg { width: 16px; height: 16px; } .photo-nav-label { display: none; } .photo-nav-button { width: 44px; padding: 10px; } .photo-thumbnail { flex-basis: 72px; height: 66px; } .gallery-message { flex-wrap: wrap; padding: 18px; } .gallery-footer { align-items: stretch; } .gallery-footer .gallery-action { width: 100%; } }
/* Registration mode mirrors Species Detail without changing the general gallery. */
.plant-photo-gallery.registration-gallery { box-sizing: border-box; width: 100%; max-width: 100%; margin: 0; padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; align-self: start; }
.registration-gallery .large-photo { aspect-ratio: 4 / 3; height: auto; min-height: 0; max-height: none; margin: 0; border: 0; border-radius: 22px; background: transparent; }
.registration-gallery .large-photo > img { object-fit: cover; }
.registration-gallery .enlarge-photo { border-radius: 22px; }
.registration-gallery .enlarge-photo:focus-visible { outline-offset: -4px; }
.registration-gallery .image-nav { position: absolute; top: 50%; z-index: 1; display: grid; place-items: center; width: 44px; height: 44px; padding: 0; transform: translateY(-50%); border: 1px solid rgb(255 255 255 / 45%); border-radius: 50%; background: rgb(23 63 52 / 84%); color: #fff; cursor: pointer; box-shadow: 0 2px 8px rgb(0 0 0 / 16%); transition: background-color 120ms ease; }
.registration-gallery .image-nav svg { display: block; width: 20px; height: 20px; pointer-events: none; }
.registration-gallery .previous-photo { left: 10px; }
.registration-gallery .next-photo { right: 10px; }
.registration-gallery .image-nav:hover { background: #173f34; border-color: rgb(255 255 255 / 45%); }
.registration-gallery .image-nav:focus-visible { outline: 3px solid #fff; outline-offset: 2px; box-shadow: 0 0 0 5px #173f34; }
.registration-gallery .gallery-counter { position: absolute; right: 12px; bottom: 12px; z-index: 1; padding: 5px 9px; border-radius: 999px; background: rgb(23 63 52 / 84%); color: #fff; font-size: 12px; line-height: 1.4; pointer-events: none; }
.registration-gallery .photo-thumbnails { display: flex; gap: 8px; padding: 4px; margin-top: 12px; max-width: 100%; box-sizing: border-box; background: transparent; }
.registration-gallery .photo-thumbnail { flex: 0 0 64px; width: 64px; height: 52px; padding: 3px; border: 2px solid transparent; border-radius: 8px; background: transparent; box-shadow: none; }
.registration-gallery .photo-thumbnail > img { object-fit: cover; border-radius: 4px; background: transparent; }
.registration-gallery .photo-thumbnail:hover { border-color: transparent; background: transparent; }
.registration-gallery .photo-thumbnail[aria-pressed="true"] { border-color: #234a3c; }
.registration-gallery .photo-thumbnail:focus-visible { outline: 2px solid #234a3c; outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { *, *::before { animation: none !important; transition: none !important; scroll-behavior: auto !important; } }
</style>
