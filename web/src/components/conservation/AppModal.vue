<script setup lang="ts">
defineProps<{ title: string; subtitle?: string; wide?: boolean }>()
defineEmits<{ close: [] }>()
</script>
<template><div class="modal-backdrop" @click.self="$emit('close')"><section class="modal-card" :class="{ wide }" role="dialog" aria-modal="true" :aria-label="title"><header class="modal-header"><div><h2>{{ title }}</h2><p v-if="subtitle">{{ subtitle }}</p></div><button class="close-button" type="button" aria-label="Close dialog" @click="$emit('close')">×</button></header><slot /></section></div></template>
