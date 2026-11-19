import { computed, ref, shallowRef } from 'vue'

// Coordinate only copy feedback. Clipboard values and permissions stay with callers.
const activeToast = shallowRef<{ owner: symbol; key: string } | null>(null)
export function useOfficerCopyConfirmation(timers: { schedule: (fn: () => void, ms: number) => unknown; cancel: (id: unknown) => void }) {
  const owner = Symbol('officer-copy')
  const copied = ref<Record<string, boolean>>({})
  const entries = new Map<string, { timer?: unknown }>()
  const toastKey = computed(() => activeToast.value?.owner === owner ? activeToast.value.key : '')
  function activate(key: string) { activeToast.value = { owner, key } }
  function dismiss(key?: string) {
    if (activeToast.value?.owner === owner && (key === undefined || activeToast.value.key === key)) activeToast.value = null
  }
  function reset(key: string) {
    const entry = entries.get(key)
    if (entry?.timer !== undefined) timers.cancel(entry.timer)
    entries.delete(key); delete copied.value[key]; dismiss(key)
  }
  function clear() { for (const key of entries.keys()) reset(key); dismiss() }
  function confirm(key: string) {
    reset(key); copied.value[key] = true; activate(key)
    const entry: { timer?: unknown } = {}
    entries.set(key, entry)
    entry.timer = timers.schedule(() => { if (entries.get(key) === entry) reset(key) }, 2000)
  }
  return { copied, toastKey, activate, dismiss, confirm, reset, clear }
}
