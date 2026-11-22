<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { searchGlobalWebsite, type GlobalSearchCategory, type GlobalSearchResponse } from '../services/globalSearch'

const route = useRoute()
const { t, locale } = useI18n()
const response = ref<GlobalSearchResponse | null>(null)
const loading = ref(false)
const error = ref('')
const offset = ref(0)
let controller: AbortController | null = null
let requestId = 0

const query = computed(() => typeof route.query.q === 'string' ? route.query.q.trim() : '')
const queryValid = computed(() => query.value.length >= 2 || /^\d$/.test(query.value))
const categories: GlobalSearchCategory[] = ['species', 'plants', 'observations', 'alerts', 'pages']
const categoryTitle = (category: GlobalSearchCategory) => t(`globalSearch.categories.${category}`)

async function loadResults() {
  const id = ++requestId
  controller?.abort()
  controller = new AbortController()
  response.value = null
  error.value = ''
  if (!queryValid.value) return
  loading.value = true
  try {
    const result = await searchGlobalWebsite(query.value, locale.value, {
      limit: 20,
      offset: offset.value,
      signal: controller.signal,
    })
    if (id === requestId) response.value = result
  } catch (cause) {
    if (id === requestId && !(cause instanceof DOMException && cause.name === 'AbortError'))
      error.value = cause instanceof Error ? cause.message : t('globalSearch.error')
  } finally {
    if (id === requestId) loading.value = false
  }
}

watch([query, locale], () => { offset.value = 0 }, { flush: 'sync' })
watch([query, locale, offset], () => { void loadResults() }, { immediate: true })
</script>

<template>
  <main class="global-search-page">
    <div class="global-search-heading">
      <p class="eyebrow">{{ t('globalSearch.eyebrow') }}</p>
      <h1>{{ t('globalSearch.title') }}</h1>
      <p>{{ t('globalSearch.queryLabel') }} <strong>{{ query }}</strong></p>
    </div>

    <p v-if="loading" class="global-search-state" role="status">{{ t('globalSearch.loading') }}</p>
    <p v-else-if="error" class="global-search-state error" role="alert">{{ error }}</p>
    <p v-else-if="!queryValid" class="global-search-state">{{ t('globalSearch.minimumLength') }}</p>
    <p v-else-if="!categories.some(category => (response?.results[category]?.length || 0) > 0)" class="global-search-state">
      {{ t('globalSearch.empty') }}
    </p>

    <div v-if="response" class="global-search-groups" aria-live="polite">
      <section v-for="category in categories" :key="category" v-show="response.results[category]?.length" class="global-search-group">
        <header>
          <h2>{{ categoryTitle(category) }}</h2>
          <span>{{ t('globalSearch.resultCount', { count: response.counts[category] || 0 }) }}</span>
        </header>
        <RouterLink v-for="item in response.results[category]" :key="`${category}-${item.id}`" :to="item.path" class="global-search-result">
          <span class="result-type" aria-hidden="true">{{ category === 'species' ? '✿' : category === 'plants' ? '◉' : category === 'observations' ? '⌕' : category === 'alerts' ? '!' : '↗' }}</span>
          <span class="result-copy">
            <strong>{{ item.title }}</strong>
            <small v-if="item.snippet">{{ item.snippet }}</small>
          </span>
          <span class="result-arrow" aria-hidden="true">→</span>
        </RouterLink>
      </section>
    </div>

    <nav v-if="response && (offset > 0 || categories.some(category => response?.hasMore[category]))" class="global-search-pagination" :aria-label="t('globalSearch.pagination')">
      <button type="button" :disabled="loading || offset === 0" @click="offset = Math.max(0, offset - 20)">{{ t('globalSearch.previous') }}</button>
      <span>{{ t('globalSearch.batch', { start: offset + 1, end: offset + 20 }) }}</span>
      <button type="button" :disabled="loading || !categories.some(category => response?.hasMore[category])" @click="offset += 20">{{ t('globalSearch.next') }}</button>
    </nav>
  </main>
</template>

<style scoped>
.global-search-page { width: min(1120px, calc(100% - 48px)); margin: 0 auto; padding: 76px 0 100px; color: #173f35; }
.global-search-heading { margin-bottom: 34px; }
.global-search-heading .eyebrow { margin: 0 0 10px; color: #50a88d; font-size: 12px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
.global-search-heading h1 { margin: 0; font-size: clamp(32px, 5vw, 52px); line-height: 1.1; }
.global-search-heading > p:last-child { margin: 14px 0 0; color: #668078; }
.global-search-groups { display: grid; gap: 18px; }
.global-search-group { overflow: hidden; border: 1px solid #dce8dc; border-radius: 18px; background: #fff; box-shadow: 0 12px 32px rgba(20, 62, 49, .06); }
.global-search-group > header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 18px 22px 12px; }
.global-search-group h2 { margin: 0; font-size: 19px; }
.global-search-group > header span { color: #69827a; font-size: 13px; }
.global-search-result { display: flex; align-items: center; gap: 14px; padding: 14px 22px; border-top: 1px solid #edf1ec; color: inherit; text-decoration: none; }
.global-search-result:hover, .global-search-result:focus-visible { background: #f2f7f1; outline: none; }
.result-type { display: grid; width: 36px; height: 36px; flex: 0 0 36px; place-items: center; border-radius: 11px; background: #e8f1e6; color: #28715c; font-size: 20px; }
.result-copy { display: grid; min-width: 0; gap: 4px; }
.result-copy strong { overflow: hidden; text-overflow: ellipsis; }
.result-copy small { color: #6b8079; line-height: 1.45; }
.result-arrow { margin-left: auto; color: #458c78; }
.global-search-state { padding: 20px 22px; border-radius: 14px; background: #edf4ec; color: #3c6257; }
.global-search-state.error { background: #fff0ed; color: #9b4036; }
.global-search-pagination { display: flex; align-items: center; justify-content: center; gap: 18px; margin-top: 28px; }
.global-search-pagination button { min-height: 42px; padding: 0 18px; border: 1px solid #bad1c5; border-radius: 999px; background: #fff; color: #235946; font: inherit; font-weight: 700; cursor: pointer; }
.global-search-pagination button:disabled { cursor: not-allowed; opacity: .5; }
.global-search-pagination span { color: #69827a; font-size: 13px; }
@media (max-width: 640px) { .global-search-page { width: min(100% - 32px, 560px); padding: 44px 0 72px; } .global-search-result { align-items: flex-start; padding: 13px 15px; } .global-search-group > header { padding-inline: 16px; } .global-search-pagination { gap: 9px; } .global-search-pagination button { padding-inline: 12px; } }
</style>
