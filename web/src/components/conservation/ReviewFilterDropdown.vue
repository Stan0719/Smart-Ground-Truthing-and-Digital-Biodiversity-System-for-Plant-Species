<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

defineOptions({ inheritAttrs: false })
const props = defineProps<{
  id: string
  labelledBy?: string
  label?: string
  disabled?: boolean
  modelValue: string
  options: { value: string; label: string; disabled?: boolean; title?: string }[]
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const trigger = ref<HTMLButtonElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const expanded = ref(false)
const teleportTarget = ref<HTMLElement | string>('body')
function focus() { trigger.value?.focus({ preventScroll: true }) }
defineExpose({ focus })
const active = ref(0)
const menuStyle = ref({ top: '0px', left: '0px', width: '0px', maxHeight: '320px' })
const selectedIndex = computed(() => props.options.findIndex(option => option.value === props.modelValue))
const selectedLabel = computed(() => props.options[selectedIndex.value]?.label || '')
let typed = ''
let typedTimer: ReturnType<typeof setTimeout> | undefined
let observer: ResizeObserver | undefined

function close() {
  expanded.value = false
  typed = ''
  clearTimeout(typedTimer)
}
function position() {
  if (!expanded.value || !trigger.value) return
  const rect = trigger.value.getBoundingClientRect()
  const viewport = window.visualViewport
  const leftEdge = viewport?.offsetLeft || 0
  const topEdge = viewport?.offsetTop || 0
  const width = viewport?.width || window.innerWidth
  const height = viewport?.height || window.innerHeight
  if (rect.bottom < topEdge || rect.top > topEdge + height) { close(); return }
  const below = Math.max(0, topEdge + height - rect.bottom - 14)
  const above = Math.max(0, rect.top - topEdge - 14)
  const desired = Math.min(320, menu.value?.scrollHeight || props.options.length * 42 + 12)
  const upward = below < desired && above > below
  const maxHeight = Math.min(320, upward ? above : below)
  const actualHeight = Math.min(desired, maxHeight)
  const menuWidth = Math.min(rect.width, Math.max(0, width - 16))
  menuStyle.value = {
    top: `${upward ? rect.top - actualHeight - 6 : rect.bottom + 6}px`,
    left: `${Math.max(leftEdge + 8, Math.min(rect.left, leftEdge + width - menuWidth - 8))}px`,
    width: `${menuWidth}px`, maxHeight: `${maxHeight}px`,
  }
}
async function revealActive() {
  await nextTick()
  menu.value?.children[active.value]?.scrollIntoView?.({ block: 'nearest' })
}
async function open(index = selectedIndex.value >= 0 ? selectedIndex.value : 0) {
  if (props.disabled) return
  teleportTarget.value = trigger.value?.closest('dialog[open]') as HTMLElement || 'body'
  active.value = props.options[index]?.disabled ? (index === props.options.length - 1 ? props.options.map((option, position) => option.disabled ? -1 : position).filter(position => position >= 0).at(-1) ?? -1 : props.options.findIndex(option => !option.disabled)) : index
  if (active.value < 0) return
  expanded.value = true
  position()
  await nextTick()
  position()
  await revealActive()
}
function toggle() { if (expanded.value) close(); else void open() }
function select(index: number) {
  const option = props.options[index]
  if (!option || option.disabled || props.disabled) return
  emit('update:modelValue', option.value)
  close()
  trigger.value?.focus({ preventScroll: true })
}
function keyboard(event: KeyboardEvent) {
  if (props.disabled) return
  if (event.key === 'Tab') { close(); return }
  if (event.key === 'Escape') {
    if (expanded.value) { event.preventDefault(); event.stopPropagation(); close() }
    return
  }
  if (['Enter', ' ', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault()
    if (event.key === 'Enter' || event.key === ' ') {
      if (expanded.value) select(active.value); else void open()
    } else if (!expanded.value) {
      void open(event.key === 'Home' ? 0 : event.key === 'End' ? props.options.length - 1 : undefined)
    } else {
      const direction = event.key === 'ArrowUp' || event.key === 'End' ? -1 : 1
      let next = event.key === 'Home' ? 0 : event.key === 'End' ? props.options.length - 1 : active.value + direction
      while (next >= 0 && next < props.options.length && props.options[next]?.disabled) next += direction
      if (next >= 0 && next < props.options.length) active.value = next
      void revealActive()
    }
    return
  }
  if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return
  event.preventDefault()
  clearTimeout(typedTimer)
  typed += event.key.toLocaleLowerCase()
  typedTimer = setTimeout(() => { typed = '' }, 700)
  const start = expanded.value ? active.value + 1 : 0
  const indices = props.options.map((_, index) => (start + index) % props.options.length)
  const match = indices.find(index => !props.options[index]!.disabled && props.options[index]!.label.toLocaleLowerCase().startsWith(typed))
  if (match !== undefined) { if (!expanded.value) void open(match); else { active.value = match; void revealActive() } }
}
function outside(event: Event) {
  const target = event.target as Node | null
  if (target && !trigger.value?.contains(target) && !menu.value?.contains(target)) close()
}
watch(() => props.disabled, disabled => { if (disabled) close() })
watch(() => props.modelValue, () => { if (expanded.value) { active.value = Math.max(0, selectedIndex.value); void revealActive() } })
watch(() => props.options, async () => {
  if (!expanded.value) return
  active.value = Math.max(0, selectedIndex.value)
  await nextTick(); position(); void revealActive()
})
onMounted(() => {
  document.addEventListener('pointerdown', outside, true)
  document.addEventListener('focusin', outside)
  window.addEventListener('resize', position)
  window.addEventListener('scroll', position, true)
  window.visualViewport?.addEventListener('resize', position)
  window.visualViewport?.addEventListener('scroll', position)
  if (typeof ResizeObserver !== 'undefined' && trigger.value) {
    observer = new ResizeObserver(position); observer.observe(trigger.value)
  }
})
onBeforeUnmount(() => {
  close(); observer?.disconnect()
  document.removeEventListener('pointerdown', outside, true)
  document.removeEventListener('focusin', outside)
  window.removeEventListener('resize', position)
  window.removeEventListener('scroll', position, true)
  window.visualViewport?.removeEventListener('resize', position)
  window.visualViewport?.removeEventListener('scroll', position)
})
</script>

<template>
  <span v-if="!labelledBy" :id="`${id}-label`" class="review-filter-sr-label">{{ label }}</span>
  <button v-bind="$attrs" :id="id" ref="trigger" :disabled="disabled" type="button" class="review-filter-trigger" :class="{ 'is-open': expanded }"
    role="combobox" aria-haspopup="listbox" :aria-expanded="expanded" :aria-controls="`${id}-list`"
    :aria-labelledby="`${labelledBy || `${id}-label`} ${id}-value`" :aria-activedescendant="expanded ? `${id}-option-${active}` : undefined"
    @click="toggle" @keydown="keyboard">
    <span :id="`${id}-value`" class="review-filter-value" :title="selectedLabel">{{ selectedLabel }}</span>
    <svg class="review-filter-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
  </button>
  <Teleport :to="teleportTarget">
    <ul v-if="expanded" :id="`${id}-list`" ref="menu" class="review-filter-menu" role="listbox" :aria-labelledby="labelledBy || `${id}-label`" :style="menuStyle">
      <li v-for="(option, index) in options" :id="`${id}-option-${index}`" :key="option.value"
        role="option" :aria-selected="option.value === modelValue" :aria-disabled="option.disabled || undefined" :title="option.title" class="review-filter-option"
        :class="{ 'is-selected': option.value === modelValue, 'is-active': index === active, 'is-disabled': option.disabled }"
        @pointerdown.prevent @mouseenter="!option.disabled && (active = index)" @click="select(index)">
        <span>{{ option.label }}</span>
        <svg v-if="option.value === modelValue" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4 10-10" /></svg>
      </li>
    </ul>
  </Teleport>
</template>

<style scoped>
.review-filter-sr-label { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.review-filter-trigger:disabled { opacity: .55; cursor: not-allowed; }
.review-filter-option.is-disabled { opacity: .5; cursor: not-allowed; }
.review-filter-trigger { width: 100%; min-width: 0; height: 44px; display: flex; align-items: center; justify-content: space-between; gap: 10px; box-sizing: border-box; padding: 9px 12px; border: 1px solid var(--line, #dfe7df); border-radius: 10px; background: #f9fbf9; color: var(--forest, #205342); font: inherit; font-size: 14px; font-weight: 400; text-align: left; cursor: pointer; }
.review-filter-value { font: inherit; color: inherit; text-transform: none; letter-spacing: normal; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.review-filter-chevron { flex: 0 0 18px; transition: transform 140ms ease; }
.review-filter-trigger.is-open, .review-filter-trigger:focus-visible { border-color: #6d927b; outline: 2px solid #dce8de; outline-offset: 1px; }
.review-filter-trigger.is-open .review-filter-chevron { transform: rotate(180deg); }
.review-filter-menu { position: fixed; z-index: 1100; box-sizing: border-box; margin: 0; padding: 6px; overflow-y: auto; overscroll-behavior: contain; list-style: none; border: 1px solid #b8cbbd; border-radius: 12px; background: #fff; color: #205342; box-shadow: 0 8px 22px rgb(23 63 52 / 15%); font-family: Poppins, sans-serif; font-size: 14px; }
.review-filter-option { min-height: 40px; box-sizing: border-box; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 12px; border-radius: 8px; overflow-wrap: anywhere; cursor: pointer; transition: background-color 120ms ease; }
.review-filter-option + .review-filter-option { margin-top: 4px; }
.review-filter-option > svg { flex: 0 0 16px; }
.review-filter-option.is-selected { background: #d3e2d5; font-weight: 400; }
.review-filter-option.is-active, .review-filter-option:not(.is-disabled):hover { background: #e6efe7; }
.review-filter-option.is-selected.is-active { background: #cbdccf; }
@media (prefers-reduced-motion: reduce) { .review-filter-chevron, .review-filter-option { transition: none; } }
</style>
