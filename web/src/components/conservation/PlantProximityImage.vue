<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import PlantPhotoLightbox from '../PlantPhotoLightbox.vue'
import { webAssetUrl } from '../../services/assetImages'
const props = defineProps<{ src: string; alt: string; unavailable: string }>()
const image = computed(() => webAssetUrl(props.src)), failed = ref('')
const preview = ref<InstanceType<typeof PlantPhotoLightbox> | null>(null)
watch(() => props.src, () => { preview.value?.close(); failed.value = '' })
function openPreview(event: MouseEvent) {
  if (!image.value || failed.value === image.value) return
  void preview.value?.open([{ id: 'nearby-photo', url: image.value }], 0, props.alt, event.currentTarget as HTMLElement)
}
function imageFailed(event: Event) {
  const src = (event.currentTarget as HTMLImageElement | null)?.getAttribute('src')
  if (src) failed.value = src
}
</script>
<template>
  <div class="nearby-plant-image">
    <button v-if="image && failed !== image" type="button" class="nearby-photo-button" :aria-label="alt" aria-haspopup="dialog" @click="openPreview"><img :src="image" :alt="alt" loading="lazy" @error="imageFailed" /></button>
    <div v-else class="record-placeholder" role="img" :aria-label="unavailable"><span aria-hidden="true">🌿</span></div>
    <PlantPhotoLightbox ref="preview" root-scroll-lock />
  </div>
</template>
<style scoped>
.nearby-plant-image { width: 100%; min-height: 108px; height: 100%; max-height: 170px; overflow: hidden; border-radius: 7px; background: #edf3ed; }
.nearby-plant-image img { display: block; width: 100%; height: 100%; max-height: 170px; object-fit: contain; }
.nearby-photo-button { display: block; width: 100%; height: 100%; padding: 0; border: 0; background: transparent; cursor: zoom-in; }
.nearby-photo-button:focus-visible { outline: 3px solid #33745d; outline-offset: -3px; }
.record-placeholder { height: 100%; min-height: 108px; display: grid; place-items: center; background: linear-gradient(145deg, #dfe9da, #c8d9c3); font-size: 32px; }
</style>
