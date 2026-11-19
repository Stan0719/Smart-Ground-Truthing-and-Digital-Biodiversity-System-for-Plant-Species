<script setup lang="ts">
import { useRoute } from 'vue-router'
import ObservationEditReview from './ObservationEditReview.vue'
const route = useRoute()
</script>

<template>
  <ObservationEditReview v-if="typeof route.query.observationEdit === 'string' && route.query.observationEdit.trim()" />
</template>
