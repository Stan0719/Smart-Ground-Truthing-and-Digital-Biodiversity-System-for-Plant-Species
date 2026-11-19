<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { sessionSnapshot, subscribeSession } from '../services/auth'
import type { Device } from '../services/plantApi'
import { KEEP_ASSIGNMENT, currentAssignment, plantId, plantLabel, loadAssignmentPlants, findAssignmentPlant, type AssignmentPlant } from '../services/deviceAssignment'
const props = defineProps<{ modelValue: string; editing: boolean; device?: Device | null; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const { t } = useI18n()
const tr = (key: string) => t('adminDeviceAssignment.' + key)
const id = useId(), labelId = `${id}-label`, valueId = `${id}-value`, listId = `${id}-plants`, statusId = `${id}-status`
const root = ref<HTMLElement | null>(null), trigger = ref<HTMLButtonElement | null>(null), searchInput = ref<HTMLInputElement | null>(null)
const plants = ref<AssignmentPlant[]>([]), search = ref(''), finding = ref(false), loading = ref(false), capped = ref(false)
const retainedChoice = ref<AssignmentPlant | null>(null), unavailableIds = ref(new Set<string>())
const isOpen = ref(false), activeIndex = ref(-1), loadError = ref(''), lookupError = ref('')
const error = computed(() => lookupError.value || loadError.value)
const session = ref(sessionSnapshot())
const eligible = () => { const s = sessionSnapshot(); return !s.pending && s.user?.role === 'Administrator' && s.user.status === 'Active' && !s.user.mustChangePassword }
const authorized = computed(() => !session.value.pending && session.value.user?.role === 'Administrator' && session.value.user.status === 'Active' && !session.value.user.mustChangePassword)
const exactId = computed(() => { const value = search.value.trim().replace(/^PL/i, ''); return /^\d+$/.test(value) ? plantId(Number(value)) : null })
const options = computed(() => plants.value.filter(p => {
  if (unavailableIds.value.has(p.id)) return false
  if (exactId.value) return p.id === exactId.value && !finding.value && !lookupError.value
  return p.label.toLowerCase().includes(search.value.trim().toLowerCase())
}))
const currentLabel = computed(() => { const a = currentAssignment(props.device); return a.state === 'assigned' ? plantLabel(a.id) : tr(a.state === 'notLinked' ? 'unassigned' : 'unavailable') })
const chosenLabel = computed(() => {
  if (!authorized.value) return tr('unavailable')
  if (props.editing && props.modelValue === KEEP_ASSIGNMENT) return currentLabel.value
  if (props.modelValue === '') return tr('unassigned')
  const chosen = plants.value.find(p => p.id === props.modelValue) || (retainedChoice.value?.id === props.modelValue ? retainedChoice.value : null)
  return chosen ? plantLabel(chosen.id) : tr('unavailable')
})
const choices = computed(() => [
  ...(props.editing ? [{ value: KEEP_ASSIGNMENT, label: `${tr('keepCurrent')} \u2014 ${currentLabel.value}` }] : []),
  { value: '', label: tr('unassigned') },
  ...options.value.map(p => ({ value: p.id, label: p.label })),
])
const activeId = computed(() => activeIndex.value >= 0 && choices.value[activeIndex.value] ? `${id}-option-${activeIndex.value}` : undefined)
let generation = 0, catalogueRequest = 0, lookupRequest = 0, disposed = false
let lookupTimer: ReturnType<typeof setTimeout> | undefined
const account = () => JSON.stringify(sessionSnapshot())
function cancelLookup() {
  lookupRequest++; if (lookupTimer !== undefined) clearTimeout(lookupTimer)
  lookupTimer = undefined; finding.value = false
}
function close(restoreFocus = false) {
  isOpen.value = false; activeIndex.value = -1; cancelLookup()
  if (restoreFocus) trigger.value?.focus({ preventScroll: true })
}
async function open() {
  if (disposed || props.disabled || !eligible()) return
  isOpen.value = true; search.value = ''; lookupError.value = ''; activeIndex.value = -1
  await nextTick(); if (isOpen.value) searchInput.value?.focus({ preventScroll: true })
}
function scheduleLookup() {
  if (!isOpen.value || !exactId.value || loading.value || !eligible() || props.disabled) return
  if (lookupTimer !== undefined) clearTimeout(lookupTimer)
  lookupTimer = setTimeout(() => { lookupTimer = undefined; void find() }, 300)
}
watch(search, () => { cancelLookup(); lookupError.value = ''; activeIndex.value = -1; scheduleLookup() })
watch(() => props.disabled, value => { if (value) close() })
async function load() {
  if (disposed || !eligible() || loading.value) return
  const request = ++catalogueRequest, token = generation, identity = account()
  const current = () => !disposed && eligible() && generation === token && catalogueRequest === request && account() === identity
  loading.value = true; loadError.value = ''
  try {
    const result = await loadAssignmentPlants()
    if (current()) {
      const selected = plants.value.find(p => p.id === props.modelValue)
      if (selected) retainedChoice.value = selected
      plants.value = result.plants
      for (const plant of result.plants) unavailableIds.value.delete(plant.id)
      capped.value = result.capped
    }
  } catch { if (current()) loadError.value = tr('loadFailed') }
  finally { if (current()) { loading.value = false; scheduleLookup() } }
}
async function find() {
  if (disposed || !isOpen.value || !exactId.value || !eligible() || loading.value || props.disabled) return
  cancelLookup()
  const request = lookupRequest, token = generation, identity = account(), query = search.value, requestedId = exactId.value
  const current = () => !disposed && isOpen.value && eligible() && generation === token && lookupRequest === request && search.value === query && account() === identity
  finding.value = true; lookupError.value = ''; activeIndex.value = -1
  try {
    const plant = await findAssignmentPlant(query)
    if (current()) { unavailableIds.value.delete(plant.id); plants.value = [...plants.value.filter(p => p.id !== plant.id), plant] }
  } catch { if (current()) { if (requestedId) unavailableIds.value.add(requestedId); lookupError.value = tr('findFailed') } }
  finally { if (current()) finding.value = false }
}
function choose(value: string) {
  if (!isOpen.value || !eligible() || props.disabled || !choices.value.some(p => p.value === value)) return
  retainedChoice.value = plants.value.find(p => p.id === value) || null
  emit('update:modelValue', value); close(true)
}
function move(step: number) {
  activeIndex.value = activeIndex.value < 0 ? (step > 0 ? 0 : choices.value.length - 1) : (activeIndex.value + step + choices.value.length) % choices.value.length
  void nextTick(() => { if (activeId.value) root.value?.querySelector(`[id="${activeId.value}"]`)?.scrollIntoView({ block: 'nearest' }) })
}
function escape(event: KeyboardEvent) {
  if (isOpen.value) { event.preventDefault(); event.stopPropagation(); close(true) }
}
function searchKey(event: KeyboardEvent) {
  if (event.isComposing) return
  if (event.key === 'Escape') escape(event)
  else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); move(event.key === 'ArrowDown' ? 1 : -1) }
  else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); activeIndex.value = event.key === 'Home' ? 0 : choices.value.length - 1 }
  else if (event.key === 'Enter') {
    event.preventDefault()
    const choice = choices.value[activeIndex.value]
    if (choice) choose(choice.value)
    else if (exactId.value) void find()
  }
}
async function triggerKey(event: KeyboardEvent) {
  if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return
  event.preventDefault(); await open()
  if (isOpen.value) activeIndex.value = event.key === 'ArrowDown' ? 0 : choices.value.length - 1
}
function outside(event: PointerEvent) { if (isOpen.value && !root.value?.contains(event.target as Node)) close() }
function focusOut(event: FocusEvent) { if (!root.value?.contains(event.relatedTarget as Node)) close() }
const unsubscribe = subscribeSession(() => {
  generation++; close(); session.value = sessionSnapshot(); plants.value = []; retainedChoice.value = null; unavailableIds.value.clear(); search.value = ''; loadError.value = ''; lookupError.value = ''; loading.value = false; capped.value = false
  if (eligible()) void load()
})
onMounted(() => { void load(); document.addEventListener('pointerdown', outside) })
onBeforeUnmount(() => { disposed = true; generation++; close(); document.removeEventListener('pointerdown', outside); unsubscribe() })
</script>
<template>
  <div ref="root" class="plant-assignment-field" @focusout="focusOut" @keydown.esc="escape">
    <span :id="labelId" class="assignment-label">{{ tr('assignedPlantOptional') }}</span>
    <button ref="trigger" class="assignment-trigger" type="button" :disabled="disabled || !authorized" :aria-labelledby="`${labelId} ${valueId}`" aria-haspopup="listbox" :aria-expanded="isOpen" :aria-controls="isOpen ? listId : undefined" @click="isOpen ? close() : open()" @keydown="triggerKey">
      <span :id="valueId">{{ chosenLabel }}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    <div v-if="isOpen" class="assignment-popup">
      <input ref="searchInput" v-model="search" class="assignment-query" type="search" role="combobox" autocomplete="off" :placeholder="tr('searchPlants')" :aria-label="tr('searchPlants')" aria-autocomplete="list" :aria-expanded="true" :aria-controls="listId" :aria-activedescendant="activeId" :aria-describedby="statusId" :disabled="disabled || !authorized" @keydown="searchKey" />
      <div :id="statusId" class="assignment-status" aria-live="polite" aria-atomic="true">
        <p v-if="loading || finding" role="status">{{ tr(finding ? 'finding' : 'loading') }}</p>
        <p v-else-if="error" role="alert">{{ error }}</p>
        <p v-else-if="!options.length">{{ tr('noMatches') }}</p>
        <p v-if="capped">{{ tr('capped') }}</p>
      </div>
      <ul :id="listId" class="assignment-options" role="listbox" :aria-labelledby="labelId" :aria-busy="loading || finding">
        <li v-for="(choice, index) in choices" :id="`${id}-option-${index}`" :key="choice.value" role="option" :aria-selected="modelValue === choice.value" :class="{ active: index === activeIndex, selected: modelValue === choice.value }" @mousedown.prevent @click="choose(choice.value)">
          <span>{{ choice.label }}</span><span v-if="modelValue === choice.value" aria-hidden="true">&#10003;</span>
        </li>
      </ul>
      <button v-if="error" class="assignment-retry" type="button" :disabled="disabled || !authorized || loading || finding" @click="lookupError ? find() : load()">{{ tr('retry') }}</button>
    </div>
  </div>
</template>
<style scoped>
.plant-assignment-field { display: grid; gap: 6px; min-width: 0; }
.assignment-label { color: #29483e; font-size: .875rem; font-weight: 600; }
.assignment-trigger { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; min-height: 44px; padding: 10px 12px; border: 1px solid #b8cdbf; border-radius: 8px; background: #f8faf5; color: #245a46; font: inherit; text-align: left; cursor: pointer; }
.assignment-trigger:hover:not(:disabled) { border-color: #33745d; background: #f0f5eb; }
.assignment-trigger svg { width: 18px; height: 18px; flex-shrink: 0; fill: none; stroke: currentColor; stroke-width: 1.8; }
.assignment-popup { min-width: 0; padding: 8px; border: 1px solid #b8cdbf; border-radius: 9px; background: #fffefa; box-shadow: 0 5px 16px #173f3412; }
.assignment-query { width: 100%; box-sizing: border-box; min-height: 44px; padding: 10px 12px; border: 1px solid #b8cdbf; border-radius: 6px; background: white; color: #29483e; font: inherit; }
.assignment-status:empty { display: none; }
.assignment-status p { margin: 8px 4px; color: #52685f; font-size: .8125rem; line-height: 1.5; }
.assignment-status [role='alert'] { color: #8c382c; }
.assignment-options { max-height: min(260px, 35dvh); margin: 6px 0 0; padding: 0; list-style: none; overflow-y: auto; overscroll-behavior: contain; }
.assignment-options li { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 44px; padding: 9px 10px; box-sizing: border-box; border-radius: 5px; color: #29483e; font-size: .875rem; line-height: 1.5; overflow-wrap: anywhere; cursor: pointer; }
.assignment-options li:hover, .assignment-options li.active { background: #e6f0df; color: #173f34; }
.assignment-options li.selected { font-weight: 700; }
.assignment-retry { margin-top: 8px; min-height: 40px; }
.assignment-trigger:focus-visible, .assignment-query:focus-visible, .assignment-retry:focus-visible { outline: 3px solid #33745d; outline-offset: 2px; }
.assignment-trigger:disabled, .assignment-query:disabled { opacity: .6; cursor: not-allowed; }
</style>
