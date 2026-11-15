import { createApp, h, nextTick, reactive, ref, type App, type ObjectDirective } from 'vue'
import ReviewFilterDropdown from './ReviewFilterDropdown.vue'

// Keep native options, form values, v-model and change handlers authoritative.
// This directive only supplies the Officer dashboard's visible selection UI.
interface DropdownState {
  refresh: () => void
  dispose: () => void
}
const states = new WeakMap<HTMLSelectElement, DropdownState>()
let sequence = 0

export const vOfficerDropdown: ObjectDirective<HTMLSelectElement> = {
  mounted(source) {
    if (source.multiple || source.size > 1) return
    const id = `officer-dropdown-${++sequence}`
    const host = source.ownerDocument.createElement('span')
    host.className = 'officer-dropdown-host'
    host.style.cssText = 'display:block;min-width:0;width:100%;'
    source.before(host)
    const oldStyle = source.getAttribute('style')
    const oldHidden = source.getAttribute('aria-hidden')
    const oldTabIndex = source.getAttribute('tabindex')
    source.style.cssText += ';position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:0!important;overflow:hidden!important;clip-path:inset(50%)!important;'
    source.setAttribute('aria-hidden', 'true')
    source.tabIndex = -1
    const label = source.labels?.[0]
    const labelSpan = label?.querySelector('span:not(.officer-dropdown-host)')
    const assignedLabel = labelSpan && !labelSpan.id ? labelSpan : null
    if (assignedLabel) assignedLabel.id = `${id}-label-source`
    const props = reactive({
      id, labelledBy: labelSpan?.id || undefined, label: '', modelValue: '', disabled: false,
      options: [] as { value: string; label: string; disabled: boolean; title: string }[],
    })
    const attributes = reactive<Record<string, string>>({})
    const dropdown = ref<{ focus: () => void } | null>(null)
    let disposed = false, queued = false
    const read = () => {
      if (disposed) return
      props.modelValue = source.value
      props.disabled = source.disabled
      props.label = source.getAttribute('aria-label') || (label ? Array.from(label.childNodes)
        .filter(node => node.nodeType === 3).map(node => node.textContent).join(' ').trim() : '')
      const options = Array.from(source.options, option => ({ value: option.value, label: option.label,
        disabled: option.disabled || (option.parentElement?.tagName === 'OPTGROUP' && (option.parentElement as HTMLOptGroupElement).disabled),
        title: option.title }))
      if (JSON.stringify(options) !== JSON.stringify(props.options)) props.options = options
      const next: Record<string, string> = {}
      for (const name of ['title', 'aria-description', 'aria-describedby', 'aria-invalid', 'aria-required', 'data-validation-field']) {
        const value = source.getAttribute(name)
        if (value !== null) next[name] = value
      }
      if (source.required) next['aria-required'] = 'true'
      for (const key of Object.keys(attributes)) if (!(key in next)) delete attributes[key]
      Object.assign(attributes, next)
    }
    read()
    const choose = (value: string) => {
      if (disposed || source.disabled || source.value === value) return
      const option = Array.from(source.options).find(item => item.value === value)
      if (!option || option.disabled || (option.parentElement?.tagName === 'OPTGROUP' && (option.parentElement as HTMLOptGroupElement).disabled)) return
      source.value = value
      source.dispatchEvent(new Event('input', { bubbles: true }))
      source.dispatchEvent(new Event('change', { bubbles: true }))
      refresh()
    }
    const app: App = createApp({ render: () => h(ReviewFilterDropdown, {
      ...props, ...attributes, ref: dropdown, 'onUpdate:modelValue': choose,
    }) })
    // A field inside a native dialog must retain its top-layer/focus context.
    app.mount(host)
    const forwardFocus = () => dropdown.value?.focus()
    const forwardActivation = (event: Event) => { event.preventDefault(); forwardFocus() }
    source.addEventListener('focus', forwardFocus)
    source.addEventListener('click', forwardActivation)
    function refresh() {
      if (queued || disposed) return
      queued = true
      void nextTick(() => { queued = false; read() })
    }
    const observer = new MutationObserver(refresh)
    observer.observe(source, { subtree: true, childList: true, characterData: true, attributes: true })
    const form = source.form
    form?.addEventListener('reset', refresh)
    const restore = (name: string, value: string | null) => value === null ? source.removeAttribute(name) : source.setAttribute(name, value)
    states.set(source, { refresh, dispose() {
      disposed = true
      observer.disconnect()
      source.removeEventListener('focus', forwardFocus)
      source.removeEventListener('click', forwardActivation)
      form?.removeEventListener('reset', refresh)
      app.unmount(); host.remove()
      restore('style', oldStyle); restore('aria-hidden', oldHidden); restore('tabindex', oldTabIndex)
      if (assignedLabel?.id === `${id}-label-source`) assignedLabel.removeAttribute('id')
    } })
  },
  updated(source) { states.get(source)?.refresh() },
  beforeUnmount(source) { states.get(source)?.dispose(); states.delete(source) },
}
