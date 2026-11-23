<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ref } from 'vue'

withDefaults(defineProps<{
  id: string
  modelValue: string
  label: string
  placeholder?: string
  required?: boolean
  disabled?: boolean
  invalid?: boolean
  describedBy?: string
  rows?: number
}>(), { required: false, disabled: false, invalid: false, rows: 4 })
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const { t } = useI18n()
const textarea = ref<HTMLTextAreaElement | null>(null)
defineExpose({ focus: (options?: FocusOptions) => textarea.value?.focus(options) })
</script>

<template>
  <div class="review-comment-field">
    <label :for="id"><slot name="label-prefix" />{{ label }} <span v-if="required">*</span><span v-else class="optional">({{ t('reviewComments.optionalForApproval') }})</span></label>
    <textarea ref="textarea" :id="id" :value="modelValue" :placeholder="placeholder" :disabled="disabled" :aria-required="required" :aria-invalid="invalid || undefined" :aria-describedby="describedBy" :maxlength="4000" :rows="rows" @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)" />
    <small class="counter" aria-live="polite">{{ modelValue.length }}/4000</small>
  </div>
</template>

<style scoped>
.review-comment-field { display: grid; gap: 6px; min-width: 0; }
.review-comment-field label { color: #29483e; font-size: 13px; font-weight: 600; }
.optional { color: #64766c; font-size: 12px; font-weight: 400; }
.review-comment-field textarea { width: 100%; min-width: 0; box-sizing: border-box; resize: vertical; border: 1px solid #bdcfc2; border-radius: 8px; background: #fff; padding: 11px 12px; color: #243f32; font: inherit; font-size: 13px; line-height: 1.55; }
.review-comment-field textarea:focus-visible { outline: 3px solid #75a88b; outline-offset: 2px; }
.review-comment-field textarea:disabled { opacity: .6; cursor: not-allowed; }
.counter { justify-self: end; color: #617569; font-size: 12px; }
</style>
