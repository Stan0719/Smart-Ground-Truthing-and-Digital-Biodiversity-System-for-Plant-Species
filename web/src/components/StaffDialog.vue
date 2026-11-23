<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
const props = defineProps<{ title: string; busy?: boolean; variant?: 'thresholds' }>()
const emit = defineEmits<{ close: [] }>()
const card = ref<HTMLElement | null>(null)
let previous: HTMLElement | null = null
let overflow = ''
const close = () => {
  if (!props.busy) emit('close')
}
function keys(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
  }
  if (event.key !== 'Tab') return
  const controls = [
    ...(card.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
    ) || []),
  ].filter((element) => element.offsetParent !== null)
  const first = controls[0],
    last = controls.at(-1)
  if (!first) {
    event.preventDefault()
    card.value?.focus()
    return
  }
  if (
    event.shiftKey &&
    (document.activeElement === first || document.activeElement === card.value)
  ) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
onMounted(async () => {
  previous = document.activeElement as HTMLElement
  overflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  document.addEventListener('keydown', keys)
  await nextTick()
  card.value?.querySelector<HTMLElement>('input, select, textarea')?.focus()
})
onBeforeUnmount(() => {
  document.body.style.overflow = overflow
  document.removeEventListener('keydown', keys)
  if (previous?.isConnected) previous.focus()
})
</script>
<template>
  <Teleport to="body">
    <div class="staff-dialog-mask" @click.self="close">
      <section
        ref="card"
        class="staff-dialog-card"
        :class="{ 'staff-dialog-card--thresholds': variant === 'thresholds' }"
        role="dialog"
        aria-modal="true"
        :aria-label="title"
        tabindex="-1"
      >
        <header>
          <h2>{{ title }}</h2>
          <button type="button" aria-label="Close dialog" :disabled="busy" @click="close">×</button>
        </header>
        <slot />
      </section>
    </div>
  </Teleport>
</template>
<style scoped>
.staff-dialog-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(12, 35, 27, 0.55);
}
.staff-dialog-card {
  box-sizing: border-box;
  width: min(100%, 620px);
  max-height: calc(100dvh - 40px);
  overflow: auto;
  background: #fff;
  color: #29483e;
  border-radius: 18px;
  padding: 26px;
  box-shadow: 0 24px 80px #102c3940;
}
header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
}
h2 {
  margin: 0;
  font-size: 22px;
  color: #204b3c;
}
header button {
  border: 1px solid #dce7df;
  border-radius: 8px;
  background: #f3f6f2;
  color: #29483e;
  padding: 4px 12px;
  font-size: 24px;
  cursor: pointer;
}
.staff-dialog-card--thresholds {
  display: flex;
  flex-direction: column;
  width: min(100%, 760px);
  padding: 0;
  overflow: hidden;
  border-radius: 24px;
}
.staff-dialog-card--thresholds > header {
  flex-shrink: 0;
  margin: 0;
  padding: 28px 30px 20px;
}
.staff-dialog-card--thresholds h2 {
  font-size: clamp(21px, 3vw, 28px);
  line-height: 1.25;
}
.staff-dialog-card--thresholds header button {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  padding: 0;
  color: #7d8981;
}
@media (max-width: 500px) {
  .staff-dialog-mask {
    padding: 12px;
  }
  .staff-dialog-card {
    padding: 18px;
    max-height: calc(100dvh - 24px);
  }
  .staff-dialog-card--thresholds {
    padding: 0;
    border-radius: 18px;
  }
  .staff-dialog-card--thresholds > header {
    padding: 20px 18px 16px;
  }
}
</style>
