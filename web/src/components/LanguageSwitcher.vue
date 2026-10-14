<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { setAppLocale, type SupportedLocale } from '../i18n'

const { locale, t } = useI18n()
const open = ref(false)
const root = ref<HTMLElement | null>(null)

const languages: Array<{ code: SupportedLocale; labelKey: string; short: string }> = [
  { code: 'en', labelKey: 'language.english', short: 'EN' },
  { code: 'ms', labelKey: 'language.malay', short: 'MS' },
  { code: 'zh-CN', labelKey: 'language.chinese', short: '中文' },
]

const currentLanguage = computed(
  () => languages.find((language) => language.code === locale.value) ?? languages[0]!,
)

const selectLanguage = (language: SupportedLocale) => {
  setAppLocale(language)
  open.value = false
}

const closeOnOutsideClick = (event: MouseEvent) => {
  if (!root.value?.contains(event.target as Node)) open.value = false
}

onMounted(() => document.addEventListener('click', closeOnOutsideClick))
onBeforeUnmount(() => document.removeEventListener('click', closeOnOutsideClick))
</script>

<template>
  <div ref="root" class="language-switcher">
    <button
      class="language-trigger"
      type="button"
      :aria-label="t('language.change')"
      :aria-expanded="open"
      aria-haspopup="listbox"
      @click.stop="open = !open"
      @keydown.esc="open = false"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c3 3.2 4.2 6.2 4.2 9S15 17.8 12 21M12 3C9 6.2 7.8 9.2 7.8 12S9 17.8 12 21" />
      </svg>
      <span class="language-full">{{ t(currentLanguage.labelKey) }}</span>
      <span class="language-short">{{ currentLanguage.short }}</span>
      <span aria-hidden="true" class="language-chevron">⌄</span>
    </button>

    <div v-if="open" class="language-menu" role="listbox" :aria-label="t('language.change')">
      <button
        v-for="language in languages"
        :key="language.code"
        type="button"
        role="option"
        :aria-selected="locale === language.code"
        :class="{ active: locale === language.code }"
        @click="selectLanguage(language.code)"
      >
        <span>{{ t(language.labelKey) }}</span>
        <span v-if="locale === language.code" aria-hidden="true">✓</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.language-switcher { position: relative; }
.language-trigger { min-height: 38px; padding: 0 11px; display: inline-flex; align-items: center; gap: 7px; border: 1px solid rgba(70,133,133,.32); border-radius: 999px; background: rgba(255,255,255,.28); color: #3f7777; cursor: pointer; font: inherit; font-size: 11px; font-weight: 700; white-space: nowrap; transition: background .2s ease, border-color .2s ease; }
.language-trigger:hover,.language-trigger:focus-visible { border-color: #50b498; background: rgba(255,255,255,.58); outline: none; }
.language-trigger:focus-visible { box-shadow: 0 0 0 3px rgba(80,180,152,.2); }
.language-trigger svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
.language-short { display: none; }
.language-chevron { margin-top: -3px; font-size: 14px; }
.language-menu { position: absolute; top: calc(100% + 9px); right: 0; z-index: 1200; width: 175px; padding: 6px; border: 1px solid rgba(70,133,133,.18); border-radius: 12px; background: #fffdf7; box-shadow: 0 14px 34px rgba(32,74,60,.18); }
.language-menu button { width: 100%; padding: 10px; display: flex; align-items: center; justify-content: space-between; border: 0; border-radius: 8px; background: transparent; color: #46655c; cursor: pointer; font: inherit; font-size: 11px; text-align: left; }
.language-menu button:hover,.language-menu button:focus-visible,.language-menu button.active { background: #e4efe2; color: #285c4c; outline: none; }
.language-menu button.active { font-weight: 800; }
@media (max-width: 1100px) and (min-width: 901px) { .language-full { display: none; } .language-short { display: inline; } }
@media (max-width: 900px) { .language-switcher { width: 100%; } .language-trigger { width: 100%; min-height: 44px; justify-content: flex-start; padding: 0 14px; border-radius: 10px; background: rgba(255,255,255,.12); color: #eef7ef; } .language-full { display: inline; } .language-short { display: none; } .language-chevron { margin-left: auto; } .language-menu { position: static; width: 100%; margin-top: 7px; box-shadow: none; } }
</style>
