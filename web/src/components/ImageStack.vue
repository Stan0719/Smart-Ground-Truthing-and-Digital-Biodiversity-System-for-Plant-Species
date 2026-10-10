<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'

interface Card {
  id: number
  image: string
  alt: string
}

const cards = ref<Card[]>([
  {
    id: 1,
    image: '/images/cave1.jpeg',
    alt: 'Niah Cave',
  },
  {
    id: 2,
    image: '/images/logo.png',
    alt: 'Niah rainforest',
  },
  {
    id: 3,
    image: '/images/hero.jpg',
    alt: 'Plants in Niah National Park',
  },
  {
    id: 4,
    image: '/images/hero.jpg',
    alt: 'Wildlife in Niah National Park',
  },
])

const isDragging = ref(false)
const isAnimating = ref(false)
const isResetting = ref(false)
const animationDirection = ref<'next' | 'previous' | null>(null)

const startX = ref(0)
const startY = ref(0)

const currentX = ref(0)
const currentY = ref(0)

const dragThreshold = 120
const animationDuration = 360
const exitDistance = 560

const topCard = computed(() => {
  return cards.value[cards.value.length - 1]
})

/* =========================
   Switch Image
   ========================= */

const commitNextImage = () => {
  const top = cards.value.pop()

  if (top) {
    cards.value.unshift(top)
  }

  currentX.value = 0
  currentY.value = 0
}

const commitPreviousImage = () => {
  const first = cards.value.shift()

  if (first) {
    cards.value.push(first)
  }

  currentX.value = 0
  currentY.value = 0
}

const wait = (duration: number) => new Promise((resolve) => window.setTimeout(resolve, duration))

const finishStackReset = async () => {
  await nextTick()
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  isResetting.value = false
}

const animateStep = async (direction: 'next' | 'previous') => {
  animationDirection.value = direction

  if (direction === 'next') {
    currentX.value = -exitDistance
    currentY.value = Math.min(currentY.value, 30)
  } else {
    currentX.value = 0
    currentY.value = 0
  }

  await wait(animationDuration)

  isResetting.value = true

  if (direction === 'next') {
    commitNextImage()
  } else {
    commitPreviousImage()
  }

  animationDirection.value = null
  await finishStackReset()
}

const navigate = async (direction: 'next' | 'previous', steps = 1) => {
  if (isAnimating.value || isDragging.value || steps < 1) return

  isAnimating.value = true

  try {
    for (let step = 0; step < steps; step += 1) {
      await animateStep(direction)
    }
  } finally {
    isAnimating.value = false
  }
}

const nextImage = () => navigate('next')
const previousImage = () => navigate('previous')


/* =========================
   Drag
   ========================= */

const startDrag = (event: PointerEvent) => {
  if (!topCard.value || isAnimating.value) return

  isDragging.value = true

  startX.value = event.clientX
  startY.value = event.clientY

  currentX.value = 0
  currentY.value = 0
}

const moveDrag = (event: PointerEvent) => {
  if (!isDragging.value) return

  currentX.value = event.clientX - startX.value
  currentY.value = event.clientY - startY.value
}

const endDrag = () => {
  if (!isDragging.value) return

  isDragging.value = false

  const distance = Math.sqrt(
    currentX.value * currentX.value +
    currentY.value * currentY.value
  )

  if (distance > dragThreshold) {
    if (Math.abs(currentX.value) > Math.abs(currentY.value)) {
      if (currentX.value > 0) {
        void navigate('previous')
      } else {
        void navigate('next')
      }
    } else {
      void navigate('next')
    }
  } else {
    currentX.value = 0
    currentY.value = 0
  }
}


/* =========================
   Click
   ========================= */

const handleCardClick = (index: number) => {
  if (isDragging.value || isAnimating.value) return

  const topIndex = cards.value.length - 1

  if (index === topIndex) {
    void navigate('next')
    return
  }

  const nextSteps = topIndex - index
  const previousSteps = index + 1

  if (nextSteps <= previousSteps) {
    void navigate('next', nextSteps)
  } else {
    void navigate('previous', previousSteps)
  }
}


/* =========================
   Card Style
   ========================= */

const getCardStyle = (index: number) => {
  const total = cards.value.length
  const positionFromTop = total - index - 1

  const isTop = positionFromTop === 0

  if (animationDirection.value === 'previous' && index === 0) {
    return {
      transform: 'translate(0, 0) rotate(0deg) scale(1)',
      opacity: 1,
      zIndex: total + 1,
    }
  }

  if (isTop) {
    if (animationDirection.value === 'previous') {
      return getRestingCardStyle(1, total - 1)
    }

    return {
      transform: `
        translate(${currentX.value}px, ${currentY.value}px)
        rotate(${currentX.value * 0.05}deg)
        scale(1)
      `,
      opacity: animationDirection.value === 'next' ? 0 : 1,
      zIndex: total,
    }
  }

  const targetPosition = animationDirection.value === 'next'
    ? Math.max(positionFromTop - 1, 0)
    : animationDirection.value === 'previous'
      ? positionFromTop + 1
      : positionFromTop

  return getRestingCardStyle(targetPosition, index + 1)
}

const getRestingCardStyle = (positionFromTop: number, zIndex: number) => {
  return {
    transform: `
      rotate(${positionFromTop * 4}deg)
      scale(${1 - positionFromTop * 0.06})
      translate(${positionFromTop * 8}px, ${positionFromTop * 8}px)
    `,
    opacity: 1,
    zIndex,
  }
}
</script>

<template>

  <div class="image-stack-wrapper">

    <!-- Left Arrow -->
    <button
      class="stack-arrow stack-arrow-left"
      type="button"
      aria-label="Previous image"
      :disabled="isAnimating"
      @click="previousImage"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path
          d="M9 5l7 7-7 7"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>


    <!-- Image Stack -->
    <div
      class="stack-container"
      :class="{ 'is-resetting': isResetting, 'is-animating': isAnimating }"
      @pointermove="moveDrag"
      @pointerup="endDrag"
      @pointercancel="endDrag"
      @pointerleave="endDrag"
    >

      <div
        v-for="(card, index) in cards"
        :key="card.id"
        class="stack-card"
        :class="{
          dragging: isDragging && index === cards.length - 1
        }"
        :style="getCardStyle(index)"
        @pointerdown="
          index === cards.length - 1
            ? startDrag($event)
            : undefined
        "
        @click="handleCardClick(index)"
      >

        <img
          :src="card.image"
          :alt="card.alt"
          class="stack-image"
          draggable="false"
        />

      </div>

    </div>


    <!-- Right Arrow -->
    <button
      class="stack-arrow stack-arrow-right"
      type="button"
      aria-label="Next image"
      :disabled="isAnimating"
      @click="nextImage"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path
          d="M9 5l7 7-7 7"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>

  </div>

</template>

<style scoped>

/* ==================================================
   Wrapper
   ================================================== */

.image-stack-wrapper {
  position: relative;

  width: 100%;

  display: flex;
  align-items: center;
  justify-content: center;

  padding: 0 55px;
}


/* ==================================================
   Stack
   ================================================== */

.stack-container {
  position: relative;

  width: 100%;
  max-width: 480px;

  aspect-ratio: 1 / 1;

  perspective: 800px;

  touch-action: none;

  user-select: none;
}


.stack-card {
  position: absolute;

  inset: 0;

  width: 100%;
  height: 100%;

  overflow: hidden;

  border-radius: 24px;

  background: #e0ebdd;

  box-shadow:
    0 18px 40px rgba(70, 133, 133, 0.18);

  transition:
    transform 0.36s cubic-bezier(0.22, 1, 0.36, 1),
    opacity 0.3s ease,
    box-shadow 0.35s ease;

  cursor: grab;
}


.stack-card.dragging {
  transition: none;

  cursor: grabbing;
}

.stack-container.is-resetting .stack-card {
  transition: none;
}

.stack-container.is-animating .stack-card {
  cursor: default;
}


.stack-image {
  width: 100%;
  height: 100%;

  display: block;

  object-fit: cover;

  pointer-events: none;

  user-select: none;

  -webkit-user-drag: none;
}


/* ==================================================
   Navigation Arrows
   ================================================== */

.stack-arrow {
  position: absolute;

  top: 50%;
  transform: translateY(-50%);

  width: 44px;
  height: 44px;

  display: flex;
  align-items: center;
  justify-content: center;

  border: 1px solid rgba(70, 133, 133, 0.20);

  border-radius: 50%;

  background: rgba(255, 246, 220, 0.95);

  color: #468585;

  font-family: inherit;

  font-size: 32px;
  font-weight: 400;

  line-height: 1;

  cursor: pointer;

  z-index: 20;

  box-shadow:
    0 8px 20px rgba(70, 133, 133, 0.15);

  transition:
    background 0.2s ease,
    color 0.2s ease,
    transform 0.2s ease,
    box-shadow 0.2s ease;
}


.stack-arrow:hover {
  background: #50b498;

  color: white;

  box-shadow:
    0 10px 24px rgba(70, 133, 133, 0.22);
}


.stack-arrow:active {
  transform: translateY(-50%) scale(0.94);
}

.stack-arrow:disabled {
  cursor: default;
  pointer-events: none;
}


.stack-arrow svg {
  width: 20px;
  height: 20px;

  fill: currentColor;
}


.stack-arrow-left {
  left: 0;
}


.stack-arrow-left svg {
  transform: rotate(180deg);
}


.stack-arrow-right {
  right: 0;
}


/* ==================================================
   Responsive
   ================================================== */

@media (max-width: 900px) {

  .stack-container {
    max-width: 500px;
  }

}


@media (max-width: 500px) {

  .image-stack-wrapper {
    padding: 0 45px;
  }


  .stack-container {
    max-width: 100%;
  }


  .stack-card {
    border-radius: 20px;
  }


  .stack-arrow {
    width: 38px;
    height: 38px;

    font-size: 28px;
  }

}

</style>
