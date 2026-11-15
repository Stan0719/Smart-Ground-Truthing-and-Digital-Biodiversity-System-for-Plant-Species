<script setup lang="ts">
defineProps<{ id: string; modelValue: string; disabled?: boolean; required?: boolean; invalid?: boolean; error?: string; validationField?: string; horizontal?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const options = [
  { value: 'public', name: 'Public', description: 'Visible in the visitor catalogue.', icon: 'globe' },
  { value: 'internal', name: 'Internal', description: 'Visible to authorized Botanists and Conservation Officers.', icon: 'users' },
  { value: 'protected', name: 'Protected', description: 'Restricted general scientific access to Conservation Officers.', icon: 'lock-keyhole' },
]
</script>

<template>
  <fieldset class="visibility-selector" data-validation-group :class="{ 'visibility-selector-horizontal': horizontal }" :disabled="disabled" :aria-describedby="`${id}-help${error ? ` ${id}-error` : ''}`" :aria-invalid="Boolean(invalid)">
    <legend class="visibility-accessible-label">Visibility{{ required ? ' *' : '' }}</legend>
    <div class="visibility-intro">
      <div class="visibility-title" aria-hidden="true"><svg v-if="horizontal" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M2 12s4-8 10-8 10 8 10 8-4 8-10 8S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>VISIBILITY{{ required ? ' *' : '' }}</div>
      <p :id="`${id}-help`">Choose who can view this species after approval.</p>
    </div>
    <div class="visibility-options">
      <label v-for="option in options" :key="option.value" class="visibility-option" :class="{ 'visibility-option-selected': modelValue === option.value }">
        <input type="radio" :name="id" :value="option.value" :checked="modelValue === option.value" :disabled="disabled" :required="required" :data-validation-field="validationField" :aria-invalid="Boolean(invalid)" :aria-describedby="`${id}-${option.value}-description${error ? ` ${id}-error` : ''}`" @change="emit('update:modelValue', option.value)" />
        <span class="visibility-option-heading"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" :data-icon="option.icon"><template v-if="option.icon === 'globe'"><circle cx="12" cy="12" r="10"/><path d="M2 12h20 M12 2a18 18 0 0 1 0 20 18 18 0 0 1 0-20Z"/></template><template v-else-if="option.icon === 'users'"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M22 21v-2a4 4 0 0 0-3-3.87 M16 3a4 4 0 0 1 0 8"/><circle cx="9" cy="7" r="4"/></template><template v-else><rect x="4" y="11" width="16" height="11" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4 M12 15v3"/></template></svg><strong>{{ option.name }}</strong><svg v-if="modelValue === option.value" class="visibility-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg></span>
        <span class="visibility-description" :id="`${id}-${option.value}-description`">{{ option.description }}</span>
      </label>
    </div>
    <small v-if="error" :id="`${id}-error`" class="visibility-error">{{ error }}</small>
  </fieldset>
</template>

<style scoped>
.visibility-selector { min-width: 0; margin: 14px 0; padding: 0; border: 0; }
.visibility-accessible-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.visibility-title { display: flex; align-items: center; gap: 7px; color: var(--forest, #173f34); font-size: 13px; font-weight: 800; }
.visibility-selector .visibility-intro p { margin: 5px 0 10px; color: #5b7065; font-size: 12px; line-height: 1.5; }
.visibility-options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; min-width: 0; }
.visibility-option { position: relative; display: flex; flex-direction: column; min-width: 0; gap: 7px; padding: 12px; border: 1px solid var(--line, #dfe7df); border-radius: 10px; background: #fff; cursor: pointer; }
.visibility-option:hover { border-color: var(--green, #33745d); }
.visibility-option-selected { border-color: var(--forest, #173f34); background: #eaf3e9; box-shadow: inset 0 0 0 1px var(--forest, #173f34); }
.visibility-option:focus-within { outline: 2px solid var(--green, #33745d); outline-offset: 3px; }
.visibility-option input { position: absolute; width: 1px; height: 1px; opacity: 0; }
.visibility-option-heading { display: flex; align-items: center; gap: 7px; min-width: 0; color: var(--forest, #173f34); font-size: 13px; }
.visibility-option-heading svg { flex: 0 0 19px; color: var(--green, #33745d); }
.visibility-option-heading strong { font-weight: 700; }
.visibility-option-heading .visibility-check { flex-basis: 16px; margin-left: auto; }
.visibility-description { color: #5b7065; font-size: 12px; line-height: 1.5; overflow-wrap: break-word; }
.visibility-selector:disabled .visibility-option { opacity: .6; cursor: not-allowed; }
.visibility-error { color: #b91c1c; font-size: 12px; }
.visibility-selector-horizontal { grid-column: 1 / -1; display: grid; grid-template-columns: minmax(150px, .8fr) minmax(0, 2.2fr); gap: 16px; align-items: start; padding: 14px; border-radius: 10px; background: var(--wash, #f3f6f2); }
.visibility-selector-horizontal .visibility-error { grid-column: 1 / -1; }
@media (max-width: 800px) { .visibility-selector-horizontal { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 620px) { .visibility-options { grid-template-columns: minmax(0, 1fr); } }
</style>
