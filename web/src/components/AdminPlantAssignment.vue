<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { sessionSnapshot, subscribeSession } from '../services/auth'
import type { Device } from '../services/plantApi'
import { KEEP_ASSIGNMENT, currentAssignment, plantLabel, loadAssignmentPlants, findAssignmentPlant, type AssignmentPlant } from '../services/deviceAssignment'
const props = defineProps<{ modelValue: string; editing: boolean; device?: Device | null; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const { t } = useI18n()
const tr = (key: string) => t('adminDeviceAssignment.' + key)
const plants = ref<AssignmentPlant[]>([]), search = ref(''), finding = ref(false), loading = ref(false), capped = ref(false), error = ref('')
const session = ref(sessionSnapshot())
const eligible = () => { const s = sessionSnapshot(); return !s.pending && s.user?.role === 'Administrator' && s.user.status === 'Active' && !s.user.mustChangePassword }
const authorized = computed(() => !session.value.pending && session.value.user?.role === 'Administrator' && session.value.user.status === 'Active' && !session.value.user.mustChangePassword)
const options = computed(() => plants.value.filter(p => p.id === props.modelValue || p.label.toLowerCase().includes(search.value.trim().toLowerCase())))
const currentLabel = computed(() => { const a = currentAssignment(props.device); return a.state === 'assigned' ? plantLabel(a.id) : tr(a.state) })
let generation = 0, disposed = false
const account = () => JSON.stringify(sessionSnapshot())
async function load() {
  if (disposed || !eligible() || loading.value || finding.value) return
  const request = ++generation, identity = account()
  const current = () => !disposed && eligible() && generation === request && account() === identity
  loading.value = true; error.value = ''
  try {
    const result = await loadAssignmentPlants()
    if (current()) {
      // An exact-ID result can sit outside this capped batch. Keep that explicit
      // selection visible; the write endpoint revalidates its current eligibility.
      const selected = plants.value.find(p => p.id === props.modelValue)
      plants.value = selected && !result.plants.some(p => p.id === selected.id) ? [...result.plants, selected] : result.plants
      capped.value = result.capped
    }
  }
  catch { if (current()) error.value = tr('loadFailed') }
  finally { if (current()) loading.value = false }
}
async function find() {
  if (disposed || !eligible() || loading.value || finding.value || props.disabled) return
  const request = ++generation, identity = account()
  const current = () => !disposed && eligible() && generation === request && account() === identity
  finding.value = true; error.value = ''
  try {
    const plant = await findAssignmentPlant(search.value)
    if (current()) { plants.value = [...plants.value.filter(p => p.id !== plant.id), plant]; search.value = ''; emit('update:modelValue', plant.id) }
  } catch { if (current()) error.value = tr('findFailed') }
  finally { if (current()) finding.value = false }
}
const unsubscribe = subscribeSession(() => {
  generation++; session.value = sessionSnapshot(); plants.value = []; search.value = ''; error.value = ''; loading.value = false; finding.value = false; capped.value = false
  if (eligible()) void load()
})
onMounted(load)
onBeforeUnmount(() => { disposed = true; generation++; unsubscribe() })
</script>
<template>
  <div class="plant-assignment-field">
    <label>{{ tr('currentPlant') }}
      <select :value="modelValue" :disabled="disabled || !authorized || loading || finding" @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)">
        <option v-if="editing" :value="KEEP_ASSIGNMENT">{{ tr('keepCurrent') }} — {{ currentLabel }}</option>
        <option value="">{{ tr('unassigned') }}</option>
        <option v-for="plant in options" :key="plant.id" :value="plant.id">{{ plant.label }}</option>
      </select>
    </label>
    <p class="assignment-help">{{ tr('currentOnly') }}</p>
    <p v-if="loading" role="status">{{ tr('loading') }}</p>
    <p v-if="capped" class="assignment-help" role="status">{{ tr('capped') }}</p>
    <div class="assignment-search">
      <label>{{ tr('search') }}<input v-model="search" :disabled="disabled || !authorized || loading || finding" :placeholder="tr('searchHint')" @keydown.enter.prevent="find" /></label>
      <button type="button" :disabled="disabled || !authorized || loading || finding || !search.trim()" @click="find">{{ tr(finding ? 'finding' : 'find') }}</button>
    </div>
    <p v-if="error" role="alert">{{ error }} <button type="button" :disabled="disabled || !authorized || loading || finding" @click="load">{{ tr('retry') }}</button></p>
  </div>
</template>
<style scoped>
.plant-assignment-field { display: grid; gap: 8px; min-width: 0; }
.assignment-help { margin: 0; font-size: .8125rem; color: #52685f; line-height: 1.5; }
.assignment-search { display: flex; align-items: flex-end; flex-wrap: wrap; gap: 8px; }
.assignment-search label { flex: 1 1 12rem; min-width: 0; }
.assignment-search button { min-height: 40px; }
</style>
