<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import PlantPhotoLightbox from '../PlantPhotoLightbox.vue'
import { assetUrlFromId } from '../../services/assetImages'
import { requestSpeciesApi, type ManagedSpecies } from '../../services/speciesManagement'
import type { HistoryPhoto } from '../../services/plantHistory'

const props = defineProps<{ species: ManagedSpecies }>()
const { t } = useI18n()
const pt = (key: string, params: Record<string, string | number> = {}) => t('conservationPages.species.photos.' + key, params)
const photos = ref<HistoryPhoto[]>([]), loading = ref(false), error = ref(false)
const failed = ref(new Set<string>())
const preview = ref<InstanceType<typeof PlantPhotoLightbox> | null>(null)
let generation = 0
async function load() {
  const token = ++generation, id = props.species.id
  preview.value?.close(); photos.value = []; failed.value = new Set(); error.value = false; loading.value = true
  try {
    const result = await requestSpeciesApi('/api/assets?species_id=' + encodeURIComponent(id))
    if (token !== generation) return
    if (!Array.isArray(result.assets)) throw Error('Invalid image response')
    const seen = new Set<string>()
    photos.value = result.assets.flatMap((value: unknown) => {
      if (!value || typeof value !== 'object') return []
      const asset = value as Record<string, unknown>, url = assetUrlFromId(asset.id)
      if (!url || !['image/jpeg', 'image/png'].includes(String(asset.content_type)) || seen.has(url)) return []
      seen.add(url); return [{ id: String(asset.id), url }]
    })
    const portrait = props.species.portraitUrl
    photos.value.sort((a, b) => Number(b.url === portrait) - Number(a.url === portrait))
  } catch { if (token === generation) error.value = true }
  finally { if (token === generation) loading.value = false }
}
function zoom(photo: HistoryPhoto, event: MouseEvent) {
  if (failed.value.has(photo.url)) return
  const available = photos.value.filter(item => !failed.value.has(item.url))
  void preview.value?.open(available, available.findIndex(item => item.id === photo.id), props.species.scientificName, event.currentTarget as HTMLElement)
}
watch(() => props.species.id, () => { void load() }, { immediate: true })
onBeforeUnmount(() => { generation++; preview.value?.close() })
</script>

<template>
  <section class="species-view-images" :aria-label="pt('gallery')" :aria-busy="loading">
    <h3>{{ pt('gallery') }}</h3>
    <p v-if="loading" role="status">{{ pt('loading') }}</p>
    <div v-else-if="error" role="alert"><p>{{ pt('galleryFailed') }}</p><button type="button" class="secondary-button" @click="load">{{ pt('retry') }}</button></div>
    <p v-else-if="!photos.length" class="image-empty">{{ pt('emptyGallery') }}</p>
    <div v-else class="species-view-photo-grid">
      <template v-for="(photo, index) in photos" :key="photo.id">
        <div v-if="failed.has(photo.url)" class="image-empty">{{ pt('noImage') }}</div>
        <button v-else type="button" class="species-view-photo" :aria-label="pt('photoAlt', { number: index + 1 })" @click="zoom(photo, $event)"><img :src="photo.url" :alt="pt('photoAlt', { number: index + 1 })" loading="lazy" @error="failed.add(photo.url)" /></button>
      </template>
    </div>
    <PlantPhotoLightbox ref="preview" root-scroll-lock />
  </section>
</template>

<style scoped>
.species-view-images { margin-top: 24px; }
h3 { margin: 0 0 16px; color: #245443; }
.species-view-photo-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 16px; }
.species-view-photo { padding: 0; border: 1px solid #d7e2dc; border-radius: 12px; background: #f2f6ef; overflow: hidden; cursor: zoom-in; }
.species-view-photo img { display: block; width: 100%; height: 180px; object-fit: contain; }
.image-empty { padding: 16px; border-radius: 10px; background: #f2f6ef; color: #53695e; }
.species-view-photo:focus-visible { outline: 3px solid #245443; outline-offset: 3px; }
</style>
