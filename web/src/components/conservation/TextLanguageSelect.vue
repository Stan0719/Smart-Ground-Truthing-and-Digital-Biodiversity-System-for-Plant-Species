<script setup lang="ts">
import { useI18n } from 'vue-i18n'

defineProps<{ modelValue: string; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const { t } = useI18n()
</script>

<template>
  <label class="text-language-select">
    <span>{{ t('textLanguage.label') }}</span>
    <select :value="modelValue" :disabled="disabled" @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)">
      <option value="unknown">{{ t('textLanguage.unknown') }}</option>
      <option value="en">{{ t('textLanguage.english') }}</option>
      <option value="ms">{{ t('textLanguage.malay') }}</option>
      <option value="zh-CN">{{ t('textLanguage.chinese') }}</option>
    </select>
  </label>
</template>

<style scoped>
.text-language-select { display: grid; gap: 4px; margin-top: 7px; color: #52685d; font-size: 12px; font-weight: 600; }
.text-language-select select { width: 100%; min-height: 38px; padding: 6px 10px; border: 1px solid #cbd9d0; border-radius: 8px; background: #fff; color: #244b3c; font: inherit; }
.text-language-select select:focus-visible { outline: 2px solid #2f7655; outline-offset: 2px; }
</style>
