<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'

const props = withDefaults(
  defineProps<{
    feedbackId: number
    variant: 'success' | 'error'
    message: string
    duration?: number
  }>(),
  {
    duration: undefined,
  },
)

const emit = defineEmits<{ dismiss: [feedbackId: number] }>()
let dismissTimer: ReturnType<typeof setTimeout> | undefined

onMounted(() => {
  const duration = props.duration ?? (props.variant === 'success' ? 3500 : 4000)
  dismissTimer = setTimeout(() => emit('dismiss', props.feedbackId), duration)
})

onBeforeUnmount(() => {
  if (dismissTimer) clearTimeout(dismissTimer)
})
</script>

<template>
  <div
    class="action-feedback"
    :class="`action-feedback--${variant}`"
    :role="variant === 'success' ? 'status' : 'alert'"
    :aria-live="variant === 'success' ? 'polite' : 'assertive'"
  >
    <svg
      v-if="variant === 'success'"
      class="action-feedback__icon"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M9 12l2 2 4-4"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" />
    </svg>
    <svg
      v-else
      class="action-feedback__icon"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" />
      <path d="M12 8v5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      <circle cx="12" cy="16.5" r="1" fill="currentColor" />
    </svg>
    <p>
      <strong>{{ variant === 'success' ? 'Success' : 'Error' }}</strong>
      <span>{{ message }}</span>
    </p>
  </div>
</template>

<style scoped>
.action-feedback {
  position: fixed;
  top: 96px;
  left: 50%;
  z-index: 1200;
  width: min(380px, calc(100vw - 32px));
  padding: 12px 14px;
  display: flex;
  align-items: center;
  gap: 10px;
  border-radius: 10px;
  transform: translateX(-50%);
}

.action-feedback--success {
  border-left: 4px solid #0c723a;
  background: #abe7bf;
  color: #245b3d;
  box-shadow: 0 10px 28px rgba(36, 91, 61, 0.15);
  animation: action-feedback-in 180ms ease-out;
}

.action-feedback--error {
  z-index: 1201;
  border-left: 4px solid #b42318;
  background: #fde8e7;
  color: #7a271a;
  box-shadow: 0 10px 28px rgba(122, 39, 26, 0.16);
  animation: action-feedback-in 180ms ease-out;
}

.action-feedback__icon {
  width: 20px;
  height: 20px;
  flex: 0 0 20px;
}

.action-feedback--success .action-feedback__icon {
  color: #2f8a5a;
}

.action-feedback--error .action-feedback__icon {
  color: #c43228;
}

.action-feedback p {
  margin: 0;
  display: grid;
  gap: 2px;
}

.action-feedback strong {
  font-size: 11px;
  font-weight: 800;
}

.action-feedback span {
  font-size: 10px;
}

@keyframes action-feedback-in {
  from {
    opacity: 0;
    transform: translate(-50%, -6px);
  }
  to {
    opacity: 1;
    transform: translate(-50%, 0);
  }
}

@media (max-width: 620px) {
  .action-feedback {
    top: 82px;
  }
}
</style>
