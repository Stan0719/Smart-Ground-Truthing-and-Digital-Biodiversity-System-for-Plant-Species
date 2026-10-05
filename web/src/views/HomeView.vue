<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import NavigationBar from '../components/NavigationBar.vue'
import ImageStack from '../components/ImageStack.vue'
import { plants } from '../data/plants'

let revealObserver: IntersectionObserver | null = null
const plantCarousel = ref<HTMLElement | null>(null)
const plantTrack = ref<HTMLElement | null>(null)

let carouselFrame = 0
let carouselResizeObserver: ResizeObserver | null = null
let carouselOffset = 0
let carouselSetWidth = 0
let carouselLastTime = 0
let carouselDragged = false
let carouselSuppressClickUntil = 0
let dragStartX = 0
let dragStartOffset = 0
type CarouselMode = 'auto' | 'tween' | 'drag' | 'hover' | 'waiting'
let carouselMode: CarouselMode = 'auto'
let carouselPointerOver = false
let carouselResumeTimer: number | null = null
let carouselTween: {
  start: number
  end: number
  startedAt: number
  duration: number
} | null = null

const carouselResumeDelay = 500
const dragThreshold = 6
const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

const setCarouselMode = (nextMode: CarouselMode) => {
  carouselMode = nextMode
}

const clearCarouselResumeTimer = () => {
  if (carouselResumeTimer === null) return
  window.clearTimeout(carouselResumeTimer)
  carouselResumeTimer = null
}

const scheduleCarouselResume = () => {
  clearCarouselResumeTimer()
  setCarouselMode('waiting')

  carouselResumeTimer = window.setTimeout(() => {
    carouselResumeTimer = null
    setCarouselMode(carouselPointerOver ? 'hover' : 'auto')
    carouselLastTime = performance.now()
  }, carouselResumeDelay)
}

const normalizeCarouselOffset = (offset: number) => {
  if (!carouselSetWidth) return offset
  return ((offset % carouselSetWidth) + carouselSetWidth) % carouselSetWidth
}

const renderCarousel = () => {
  if (!plantTrack.value) return
  plantTrack.value.style.transform = `translate3d(${-normalizeCarouselOffset(carouselOffset)}px, 0, 0)`
}

const measureCarousel = () => {
  const cards = plantTrack.value?.querySelectorAll<HTMLElement>('.home-plant-card')
  if (!cards || cards.length < 2) return

  const firstCard = cards[0]
  const duplicateStart = cards[Math.floor(cards.length / 2)]
  if (!firstCard || !duplicateStart) return

  carouselSetWidth = duplicateStart.offsetLeft - firstCard.offsetLeft
  carouselOffset = normalizeCarouselOffset(carouselOffset)
  renderCarousel()
}

const runCarousel = () => {
  const now = performance.now()
  const elapsed = carouselLastTime ? Math.min(now - carouselLastTime, 50) : 0
  carouselLastTime = now

  if (carouselMode === 'tween' && carouselTween) {
    const progress = Math.min((now - carouselTween.startedAt) / carouselTween.duration, 1)
    const eased = 1 - Math.pow(1 - progress, 3)
    carouselOffset = carouselTween.start + (carouselTween.end - carouselTween.start) * eased

    if (progress >= 1) {
      carouselOffset = normalizeCarouselOffset(carouselTween.end)
      carouselTween = null
      carouselLastTime = now
      scheduleCarouselResume()
    }
  } else if (carouselMode === 'auto' && !prefersReducedMotion()) {
    carouselOffset += (carouselSetWidth / 40000) * elapsed
    carouselOffset = normalizeCarouselOffset(carouselOffset)
  }

  renderCarousel()
  carouselFrame = requestAnimationFrame(runCarousel)
}

const moveCarousel = (direction: -1 | 1) => {
  const firstCard = plantTrack.value?.querySelector<HTMLElement>('.home-plant-card')
  if (!firstCard) return

  const gap = Number.parseFloat(getComputedStyle(plantTrack.value!).columnGap) || 0
  const distance = firstCard.offsetWidth + gap
  const now = performance.now()
  clearCarouselResumeTimer()

  if (prefersReducedMotion()) {
    carouselTween = null
    carouselOffset = normalizeCarouselOffset(carouselOffset + direction * distance)
    renderCarousel()
    scheduleCarouselResume()
    return
  }

  carouselTween = {
    start: carouselOffset,
    end: carouselOffset + direction * distance,
    startedAt: now,
    duration: 420,
  }
  setCarouselMode('tween')
}

const startCarouselDrag = (event: PointerEvent) => {
  if (event.pointerType === 'mouse' && event.button !== 0) return

  clearCarouselResumeTimer()
  carouselTween = null
  carouselDragged = false
  dragStartX = event.clientX
  dragStartOffset = carouselOffset
  setCarouselMode('drag')
  plantCarousel.value?.setPointerCapture(event.pointerId)
}

const dragCarousel = (event: PointerEvent) => {
  if (carouselMode !== 'drag') return

  const distance = event.clientX - dragStartX
  if (Math.abs(distance) >= dragThreshold) carouselDragged = true
  if (!carouselDragged) return

  if (event.cancelable) event.preventDefault()
  carouselOffset = dragStartOffset - distance
  renderCarousel()
}

const stopCarouselDrag = (event: PointerEvent) => {
  if (carouselMode !== 'drag') return

  if (plantCarousel.value?.hasPointerCapture(event.pointerId)) {
    plantCarousel.value.releasePointerCapture(event.pointerId)
  }

  if (carouselDragged) {
    carouselSuppressClickUntil = performance.now() + 250
  }

  carouselOffset = normalizeCarouselOffset(carouselOffset)
  scheduleCarouselResume()
}

const preventCarouselClick = (event: MouseEvent) => {
  if (performance.now() > carouselSuppressClickUntil) return
  event.preventDefault()
  event.stopPropagation()
  carouselSuppressClickUntil = 0
}

const setCarouselHover = (hovered: boolean, event: PointerEvent) => {
  if (event.pointerType !== 'mouse') return

  carouselPointerOver = hovered

  if (hovered && (carouselMode === 'auto' || carouselMode === 'waiting')) {
    clearCarouselResumeTimer()
    setCarouselMode('hover')
  } else if (!hovered && carouselMode === 'hover') {
    scheduleCarouselResume()
  }
}

onMounted(() => {
  const revealElements = document.querySelectorAll<HTMLElement>('.reveal')

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    revealElements.forEach((element) => element.classList.add('is-visible'))
  } else {
    revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return

          entry.target.classList.add('is-visible')
          revealObserver?.unobserve(entry.target)
        })
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    )

    revealElements.forEach((element) => revealObserver?.observe(element))
  }

  nextTick(() => {
    measureCarousel()
    carouselResizeObserver = new ResizeObserver(measureCarousel)
    if (plantCarousel.value) carouselResizeObserver.observe(plantCarousel.value)
    carouselFrame = requestAnimationFrame(runCarousel)
  })
})

onBeforeUnmount(() => {
  revealObserver?.disconnect()
  carouselResizeObserver?.disconnect()
  clearCarouselResumeTimer()
  cancelAnimationFrame(carouselFrame)
})
</script>

<template>
  <NavigationBar />

  <main>

    <!-- =========================
         Hero Section
    ========================= -->

    <section class="hero">

      <!-- Left Content Panel -->
      <div class="hero-left">
        <div class="hero-content">

          <p class="eyebrow">
            NIAH NATIONAL PARK
          </p>

          <h1>
            Discover the
            <span class="highlight">Biodiversity</span>
            of Niah
          </h1>

          <p class="hero-description">
            Explore the plants, biodiversity, and natural heritage
            of one of Sarawak's most remarkable national parks.
          </p>

          <div class="hero-actions">

            <RouterLink to="/plants" class="explore-button">
              Explore Plants
            </RouterLink>

            <RouterLink to="/about" class="learn-button">
              Learn About Niah
            </RouterLink>

          </div>

        </div>
      </div>

      <!-- Right Image Area -->
      <div class="hero-right"></div>

    </section>


    <!-- =========================
         About Niah Section
         ========================= -->

    <section class="about-niah">

      <div class="about-container">

        <!-- Image -->
        <div class="about-image-wrapper reveal reveal-left">
          <ImageStack />
        </div>


        <!-- Content -->
        <div class="about-content reveal reveal-right reveal-delay-1">

          <p class="section-label">
            ABOUT NIAH
          </p>

          <h2>
            Niah National Park
          </h2>

          <p class="about-description">
            Niah National Park is a UNESCO World Heritage Site
            known for its remarkable archaeological significance,
            extensive cave systems, prehistoric remains, rock art,
            and rich biodiversity.
          </p>

          <p class="about-description">
            The park is home to the famous Niah Caves, where
            evidence of prehistoric human settlement provides
            valuable insight into the early history of Borneo.
          </p>


          <!-- Key Facts -->
          <div class="about-facts">

            <div class="fact-card reveal">
              <span class="fact-number">40,000+</span>
              <span class="fact-label">
                Years of Human History
              </span>
            </div>

            <div class="fact-card reveal reveal-delay-1">
              <span class="fact-number">UNESCO</span>
              <span class="fact-label">
                World Heritage Site
              </span>
            </div>

            <div class="fact-card reveal reveal-delay-2">
              <span class="fact-number">Rich</span>
              <span class="fact-label">
                Natural Biodiversity
              </span>
            </div>

          </div>

        </div>

      </div>

      <div class="visitor-overview">
        <div class="why-niah">
          <p class="section-label reveal">WHY NIAH?</p>

          <h3 class="reveal reveal-delay-1">Where nature meets human history</h3>

          <p class="reveal reveal-delay-2">
            Hidden within the rainforests of northern Sarawak, Niah National Park is a
            remarkable meeting point of nature and human history. Its vast limestone caves
            preserve archaeological discoveries, prehistoric paintings, and evidence of
            people who lived here thousands of years ago.
          </p>
        </div>

        <div class="visitor-info">
          <h3 class="reveal">Plan your visit</h3>

          <div class="visitor-cards">
            <article class="visitor-card reveal">
              <span class="visitor-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="8.5" />
                  <path d="M12 7.5V12l3 2" />
                </svg>
              </span>
              <span class="visitor-label">Opening hours</span>
              <strong>Daily, 8 AM–5 PM</strong>
            </article>

            <article class="visitor-card reveal reveal-delay-visitor-1">
              <span class="visitor-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M19 10c0 5.25-7 10-7 10S5 15.25 5 10a7 7 0 1 1 14 0Z" />
                  <circle cx="12" cy="10" r="2.25" />
                </svg>
              </span>
              <span class="visitor-label">Location</span>
              <strong>Niah, Miri Division</strong>
              <a
                class="visitor-map-link"
                href="https://www.google.com/maps/search/?api=1&amp;query=Niah+National+Park%2C+Sarawak%2C+Malaysia"
                target="_blank"
                rel="noopener noreferrer"
              >
                View on Google Maps →
              </a>
            </article>

            <article class="visitor-card reveal reveal-delay-visitor-2">
              <span class="visitor-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="m3.5 18.5 5.3-8 3.3 4.2 2.2-2.8 6.2 6.6" />
                  <path d="M3.5 18.5h17M8.8 10.5 10.5 8l1.8 2.3" />
                </svg>
              </span>
              <span class="visitor-label">Main experience</span>
              <strong>Cave &amp; rainforest trekking</strong>
            </article>

            <article class="visitor-card reveal reveal-delay-visitor-3">
              <span class="visitor-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="3.5" />
                  <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4" />
                </svg>
              </span>
              <span class="visitor-label">Best period</span>
              <strong>March–September</strong>
            </article>

            <article class="visitor-card reveal reveal-delay-visitor-4">
              <span class="visitor-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none">
                  <circle cx="6.5" cy="17.5" r="2.5" />
                  <circle cx="17.5" cy="6.5" r="2.5" />
                  <path d="M8.5 16c2-1.25 1.5-3.75 3.5-5s2.5 1.25 4.5-3M6.5 12.5v-2M17.5 13.5v2" />
                </svg>
              </span>
              <span class="visitor-label">From Miri</span>
              <strong>About 1.5 hours</strong>
            </article>
          </div>
        </div>
      </div>

    </section>

    <section class="explore-plants">

      <div class="explore-plants-container">

        <div class="explore-plants-header">

          <div class="explore-plants-heading">

            <p class="section-label reveal">
              EXPLORE THE FLORA
            </p>

            <h2 class="reveal reveal-delay-1">
              Plants of Niah
            </h2>

            <p class="explore-plants-description reveal reveal-delay-2">
              Discover the remarkable plants found throughout
              Niah National Park.
            </p>

          </div>

          <RouterLink
            to="/plants"
            class="explore-more-button reveal reveal-delay-3"
          >
            <span>Explore More Plants</span>
            <span class="button-arrow">→</span>
          </RouterLink>

        </div>


        <div
          ref="plantCarousel"
          class="plant-carousel"
          @pointerenter="setCarouselHover(true, $event)"
          @pointerleave="setCarouselHover(false, $event)"
          @pointerdown="startCarouselDrag"
          @pointermove="dragCarousel"
          @pointerup="stopCarouselDrag"
          @pointercancel="stopCarouselDrag"
          @click.capture="preventCarouselClick"
          @dragstart.prevent
        >

          <div ref="plantTrack" class="plant-track">

            <!-- First set -->
            <RouterLink
              v-for="plant in plants"
              :key="`first-${plant.slug}`"
              :to="`/plants/${plant.slug}`"
              class="home-plant-card"
              draggable="false"
            >

              <div class="home-plant-image">

                <!-- Temporary image area -->
                <div class="plant-image-placeholder">
                  <span>🌿</span>
                </div>

                <span class="home-plant-category">
                  {{ plant.category }}
                </span>

              </div>


              <div class="home-plant-info">

                <h3>
                  {{ plant.name }}
                </h3>

                <p class="home-plant-scientific">
                  {{ plant.scientificName }}
                </p>

                <span class="view-plant">
                  View plant →
                </span>

              </div>

            </RouterLink>


            <!-- Duplicate set for continuous loop -->
            <RouterLink
              v-for="plant in plants"
              :key="`second-${plant.slug}`"
              :to="`/plants/${plant.slug}`"
              class="home-plant-card"
              aria-hidden="true"
              tabindex="-1"
              draggable="false"
            >

              <div class="home-plant-image">

                <div class="plant-image-placeholder">
                  <span>🌿</span>
                </div>

                <span class="home-plant-category">
                  {{ plant.category }}
                </span>

              </div>


              <div class="home-plant-info">

                <h3>
                  {{ plant.name }}
                </h3>

                <p class="home-plant-scientific">
                  {{ plant.scientificName }}
                </p>

                <span class="view-plant">
                  View plant →
                </span>

              </div>

            </RouterLink>

          </div>

        </div>

        <div class="carousel-controls" aria-label="Plant carousel controls">
          <button
            type="button"
            class="carousel-control"
            aria-label="Previous plants"
            @click="moveCarousel(-1)"
          >
            <span aria-hidden="true">←</span>
          </button>

          <button
            type="button"
            class="carousel-control"
            aria-label="Next plants"
            @click="moveCarousel(1)"
          >
            <span aria-hidden="true">→</span>
          </button>
        </div>

      </div>

    </section>

  </main>
</template>

<style scoped>

/* ==================================================
   HERO
   ================================================== */

.hero {
  position: relative;

  min-height: calc(100vh - 76px);

  display: grid;
  grid-template-columns: 50% 50%;

  background-image: url('/images/hero.jpg');
  background-size: cover;
  background-position: center;

  overflow: hidden;

  animation: hero-image-zoom 12s ease-out forwards;
}

@keyframes hero-image-zoom {
  from { background-size: 100%; }
  to { background-size: 106%; }
}

@keyframes hero-image-scale {
  from { transform: scale(1); }
  to { transform: scale(1.06); }
}

@keyframes hero-content-enter {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}


/* =========================
   Hero Left Side
   ========================= */

.hero-left {
  position: relative;
  display: flex;
  align-items: center;

  padding: 80px 7%;

  background: transparent;

  z-index: 1;
}

.hero::before {
  content: '';

  position: absolute;
  inset: 0;

  background: linear-gradient(
    to right,
    rgba(30, 45, 40, 0.82) 0%,
    rgba(30, 45, 40, 0.72) 25%,
    rgba(30, 45, 40, 0.55) 40%,
    rgba(30, 45, 40, 0.30) 55%,
    rgba(30, 45, 40, 0.10) 68%,
    rgba(30, 45, 40, 0.00) 80%
  );

  z-index: 0;

  pointer-events: none;
}


/* =========================
   Hero Content
   ========================= */

.hero-content {
  max-width: 620px;

  color: white;
}


/* Eyebrow */

.eyebrow {
  margin: 0 0 20px;

  color: #DEF9C4;

  font-size: 14px;
  font-weight: 700;

  letter-spacing: 4px;

  opacity: 0;
  animation: hero-content-enter 0.65s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}


/* Main Heading */

.hero h1 {
  margin: 0;

  color: #FFF6DC;

  font-size: clamp(44px, 5vw, 76px);
  line-height: 1.05;

  font-weight: 800;

  letter-spacing: -1.5px;

  opacity: 0;
  animation: hero-content-enter 0.65s 0.12s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}


/* Highlight */

.highlight {
  color: #7dd1b9;
}


/* Description */

.hero-description {
  max-width: 560px;

  margin: 28px 0 36px;

  color: #e0ebdd;

  font-size: 17px;
  line-height: 1.8;

  opacity: 0;
  animation: hero-content-enter 0.65s 0.24s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}


/* =========================
   Hero Buttons
   ========================= */

.hero-actions {
  display: flex;
  align-items: center;

  gap: 14px;

  flex-wrap: wrap;

  opacity: 0;
  animation: hero-content-enter 0.65s 0.36s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}


.explore-button {
  display: inline-block;

  padding: 14px 28px;

  border-radius: 30px;

  background: #FFF6DC;
  color: #468585;

  text-decoration: none;

  font-size: 14px;
  font-weight: 700;

  transition: 0.25s ease;
}


.explore-button:hover {
  background: #9cdbA6;

  transform: translateY(-2px);
}


.learn-button {
  display: inline-block;

  padding: 13px 26px;

  border: 1px solid rgba(224, 235, 221, 0.6);

  border-radius: 30px;

  background: transparent;

  color: white;

  text-decoration: none;

  font-size: 14px;
  font-weight: 600;

  transition: 0.25s ease;
}


.learn-button:hover {
  background: rgba(224, 235, 221, 0.12);

  border-color: #9cdbA6;

  color: #9cdbA6;

  transform: translateY(-2px);
}


/* =========================
   Hero Right Side
   ========================= */

.hero-right {
  min-height: 100%;
  z-index: 1;
}


/* ==================================================
   ABOUT NIAH
   ================================================== */

.about-niah {
  padding: 120px 0;

  background: #E0EBDD;
}


.about-container {
  width: min(1200px, 88%);

  margin: 0 auto;

  display: grid;
  grid-template-columns: 1fr 1fr;

  align-items: center;

  gap: 80px;
}


/* =========================
   About Image
   ========================= */
.about-image-wrapper {
  width: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
}


.about-image {
  width: 100%;

  aspect-ratio: 4 / 5;

  display: block;

  object-fit: cover;

  transition: transform 0.5s ease;
}


.about-image-wrapper:hover .about-image {
  transform: scale(1.03);
}


/* =========================
   About Content
   ========================= */

.about-content {
  max-width: 560px;
}


.section-label {
  margin: 0 0 14px;

  color: #50B498;

  font-size: 13px;
  font-weight: 700;

  letter-spacing: 3px;
}


.about-content h2 {
  margin: 0 0 24px;

  color: #468585;

  font-size: clamp(36px, 4vw, 54px);

  line-height: 1.1;

  font-weight: 800;
}


.about-description {
  margin: 0 0 18px;

  color: #405f5b;

  font-size: 16px;

  line-height: 1.8;
}


/* =========================
   Key Facts
   ========================= */

.about-facts {
  display: grid;

  grid-template-columns: repeat(3, 1fr);

  gap: 12px;

  margin-top: 35px;
}


.fact-card {
  padding: 18px 14px;

  border-radius: 14px;

  background: rgba(255, 246, 220, 0.7);

  border: 1px solid rgba(70, 133, 133, 0.12);
}


.fact-number {
  display: block;

  margin-bottom: 6px;

  color: #468585;

  font-size: 20px;
  font-weight: 800;
}


.fact-label {
  display: block;

  color: #55716d;

  font-size: 11px;

  line-height: 1.4;
}


/* =========================
   Visitor Overview
   ========================= */

.visitor-overview {
  position: relative;

  width: min(1200px, 88%);
  box-sizing: border-box;

  margin: 90px auto 0;

  padding: 48px;

  overflow: hidden;

  border: 1px solid rgba(70, 133, 133, 0.16);
  border-radius: 28px;

  background: #173f34;

  box-shadow: 0 18px 45px rgba(31, 65, 50, 0.16);
}


.visitor-overview::before,
.visitor-overview::after {
  content: '';

  position: absolute;

  pointer-events: none;
}


.visitor-overview::before {
  inset: 0;

  border-radius: inherit;

  background:
    linear-gradient(110deg, rgba(15, 51, 40, 0.88), rgba(22, 65, 51, 0.7)),
    linear-gradient(to bottom, rgba(18, 51, 41, 0.08), rgba(12, 39, 31, 0.28)),
    url('/images/b1.jpg') center 46% / cover no-repeat;

  z-index: 0;
}


.visitor-overview::after {
  display: none;
}


.visitor-overview > * {
  position: relative;
  z-index: 1;
}


.why-niah {
  display: grid;
  grid-template-columns: minmax(280px, 0.8fr) minmax(360px, 1.2fr);
  grid-template-rows: auto 1fr;

  column-gap: 64px;
}


.why-niah .section-label {
  grid-column: 1;

  margin-bottom: 12px;

  color: #a9e7c4;
}


.why-niah h3,
.visitor-info h3 {
  margin: 0;

  color: #fff6dc;

  font-size: clamp(26px, 3vw, 36px);
  line-height: 1.2;
}


.why-niah p:last-child {
  grid-column: 2;
  grid-row: 1 / span 2;

  align-self: center;

  margin: 0;

  padding-left: 32px;

  color: #e0ebdd;

  font-size: 16px;
  line-height: 1.8;

  border-left: 1px solid rgba(224, 235, 221, 0.3);
}


.visitor-info {
  margin-top: 38px;

  padding-top: 30px;

  border-top: 1px solid rgba(224, 235, 221, 0.2);
}


.visitor-info h3 {
  display: flex;
  align-items: center;

  gap: 16px;
}


.visitor-info h3::after {
  content: '';

  width: 58px;
  height: 2px;

  border-radius: 999px;

  background: #9cdba6;
}


.visitor-cards {
  margin-top: 22px;

  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));

  gap: 15px;
}


.visitor-card {
  min-height: 168px;

  padding: 22px 20px 20px;

  display: flex;
  flex-direction: column;

  border: 1px solid rgba(214, 229, 209, 0.72);
  border-radius: 18px;

  background: rgba(255, 250, 235, 0.94);

  box-shadow: 0 7px 18px rgba(10, 36, 28, 0.11);

  transition:
    transform 0.3s ease,
    box-shadow 0.3s ease,
    border-color 0.3s ease;
}

.visitor-card.reveal.is-visible:hover {
  transform: translateY(-3px);
  border-color: rgba(80, 180, 152, 0.48);
  box-shadow: 0 12px 24px rgba(10, 36, 28, 0.17);
}


.visitor-icon {
  width: 44px;
  height: 44px;

  margin-bottom: 19px;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  border: 1px solid rgba(70, 133, 133, 0.2);
  border-radius: 14px;

  background: #e6eee1;

  color: #3f786b;
}


.visitor-icon svg {
  width: 22px;
  height: 22px;

  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}


.visitor-label {
  margin-bottom: 7px;

  color: #607c75;

  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.7px;
  text-transform: uppercase;
}


.visitor-card strong {
  color: #294f47;

  font-size: 15px;
  font-weight: 700;
  line-height: 1.5;
}


.visitor-map-link {
  margin-top: auto;

  padding-top: 12px;

  color: #4b7f70;

  font-size: 11px;
  font-weight: 700;
  line-height: 1.4;

  text-decoration: none;

  transition: color 0.2s ease;
}


.visitor-map-link:hover {
  color: #285f52;
}













/* ==================================================
   EXPLORE PLANTS
   ================================================== */

.explore-plants {
  padding: 110px 0 120px;
  background: #f8f6ee;
  overflow: hidden;
}

.explore-plants-container {
  width: min(1200px, 88%);
  margin: 0 auto;
}

.explore-plants-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 40px;
  margin-bottom: 48px;
}

.explore-plants-heading {
  max-width: 650px;
}

.explore-plants-heading .section-label {
  margin-bottom: 12px;
  color: #50b498;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 3px;
}

.explore-plants-heading h2 {
  margin: 0;
  color: #315f5f;
  font-size: clamp(38px, 4vw, 54px);
  line-height: 1.1;
  font-weight: 800;
}

.explore-plants-description {
  max-width: 560px;
  margin: 18px 0 0;
  color: #60756f;
  font-size: 16px;
  line-height: 1.7;
}


/* Explore More Button */

.explore-more-button {
  display: inline-flex;
  align-items: center;
  gap: 14px;
  padding: 14px 22px;

  border: 1px solid rgba(70, 133, 133, 0.25);
  border-radius: 999px;

  background: #FFF6DC;
  color: #468585;

  text-decoration: none;
  font-size: 13px;
  font-weight: 700;

  white-space: nowrap;

  transition: 0.25s ease;
}

.explore-more-button:hover {
  transform: translateY(-3px);
  background: #ffffff;
  box-shadow: 0 10px 25px rgba(50, 90, 70, 0.12);
}

.button-arrow {
  font-size: 18px;
  transition: transform 0.25s ease;
}

.explore-more-button:hover .button-arrow {
  transform: translateX(4px);
}


/* Carousel */

.plant-carousel {
  width: 100%;

  margin: -10px 0 -14px;
  padding: 10px 0 14px;

  overflow: hidden;

  cursor: grab;
  touch-action: pan-y;
  user-select: none;
}

.plant-carousel:active {
  cursor: grabbing;
}

.plant-track {
  width: max-content;

  display: flex;
  gap: 22px;

  transform: translate3d(0, 0, 0);
  will-change: transform;
}


.carousel-controls {
  margin-top: 22px;

  display: flex;
  justify-content: center;

  gap: 9px;
}


.carousel-control {
  width: 38px;
  height: 38px;

  padding: 0;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  border: 1px solid rgba(70, 133, 133, 0.24);
  border-radius: 12px;

  background: #fff6dc;
  color: #468585;

  cursor: pointer;

  font-size: 18px;
  line-height: 1;

  transition:
    transform 0.2s ease,
    background-color 0.2s ease,
    border-color 0.2s ease;
}


.carousel-control:hover {
  transform: translateY(-2px);
  border-color: rgba(70, 133, 133, 0.42);
  background: #9cdba6;
}


.carousel-control:focus-visible {
  outline: 3px solid rgba(80, 180, 152, 0.3);
  outline-offset: 3px;
}


/* Plant Card */

.home-plant-card {
  width: 280px;
  flex: 0 0 280px;

  overflow: hidden;

  border: 1px solid rgba(49, 91, 70, 0.1);
  border-radius: 20px;

  background: #ffffff;

  box-shadow: 0 10px 30px rgba(33, 57, 44, 0.08);

  color: inherit;
  text-decoration: none;

  transition:
    transform 0.3s ease,
    box-shadow 0.3s ease;
}

.home-plant-card:hover {
  transform: translateY(-8px);
  box-shadow: 0 18px 40px rgba(33, 57, 44, 0.15);
}


/* Image */

.home-plant-image {
  position: relative;

  width: 100%;
  aspect-ratio: 4 / 3;

  overflow: hidden;

  background: #dce8d6;
}

.plant-image-placeholder {
  width: 100%;
  height: 100%;

  display: flex;
  align-items: center;
  justify-content: center;

  background:
    linear-gradient(
      135deg,
      #dce8d6,
      #b9d4bd
    );

  transition: transform 0.45s ease;
}

.home-plant-card:hover .plant-image-placeholder {
  transform: scale(1.05);
}

.plant-image-placeholder span {
  font-size: 55px;
}


/* Category */

.home-plant-category {
  position: absolute;

  top: 14px;
  right: 14px;

  padding: 7px 11px;

  border-radius: 999px;

  background: rgba(20, 54, 37, 0.86);

  color: #ffffff;

  font-size: 10px;
  font-weight: 700;

  letter-spacing: 0.5px;
  text-transform: uppercase;
}


/* Information */

.home-plant-info {
  min-height: 115px;

  padding: 20px 20px 22px;

  display: flex;
  flex-direction: column;
}


.home-plant-info h3 {
  margin: 0;

  color: #254b42;


  font-size: 22px;
  font-weight: 600;
  line-height: 1.2;
}


.home-plant-scientific {
  margin: 7px 0 0;

  color: #88735d;


  font-size: 14px;
  font-style: italic;
}


/* Always stay at the bottom */

.view-plant {
  margin-top: auto;

  padding-top: 18px;

  color: #508a6a;

  font-size: 12px;

  font-weight: 700;

  letter-spacing: 0.7px;

  text-transform: uppercase;
}


/* ==================================================
   SCROLL REVEALS
   ================================================== */

.reveal {
  opacity: 0;
  transform: translateY(22px);
  transition:
    opacity 0.62s cubic-bezier(0.22, 1, 0.36, 1),
    transform 0.62s cubic-bezier(0.22, 1, 0.36, 1);
  transition-delay: 0s;
  will-change: opacity, transform;
}

.reveal-left { transform: translateX(-24px); }
.reveal-right { transform: translateX(24px); }

.reveal.is-visible {
  opacity: 1;
  transform: translate(0, 0);
}

.reveal-delay-1 { transition-delay: 0.1s; }
.reveal-delay-2 { transition-delay: 0.2s; }
.reveal-delay-3 { transition-delay: 0.3s; }
.reveal-delay-visitor-1 { transition-delay: 0.08s; }
.reveal-delay-visitor-2 { transition-delay: 0.16s; }
.reveal-delay-visitor-3 { transition-delay: 0.24s; }
.reveal-delay-visitor-4 { transition-delay: 0.32s; }

.visitor-card.reveal {
  transition:
    opacity 0.62s cubic-bezier(0.22, 1, 0.36, 1),
    transform 0.62s cubic-bezier(0.22, 1, 0.36, 1),
    box-shadow 0.3s ease,
    border-color 0.3s ease;
}


/* Responsive */

@media (max-width: 900px) {

  .explore-plants {
    padding: 85px 0 95px;
  }

  .explore-plants-header {
    align-items: flex-start;
    flex-direction: column;
    margin-bottom: 36px;
  }

  .home-plant-card {
    width: 260px;
    flex-basis: 260px;
  }

}


@media (max-width: 500px) {

  .explore-plants {
    padding: 70px 0 80px;
  }

  .explore-plants-container {
    width: 86%;
  }

  .explore-plants-heading h2 {
    font-size: 38px;
  }

  .explore-plants-description {
    font-size: 14px;
  }

  .home-plant-card {
    width: 235px;
    flex-basis: 235px;
  }

  .home-plant-info {
    padding: 18px;
  }

  .home-plant-info h3 {
    font-size: 20px;
  }

}














/* ==================================================
   RESPONSIVE
   ================================================== */

@media (max-width: 900px) {

  /* Hero */

  .hero {
    grid-template-columns: 1fr;

    min-height: calc(100vh - 76px);

    background: none;

    animation: none;
  }


  .hero::after {
    content: '';

    position: absolute;
    inset: -1px;

    background-image: url('/images/hero.jpg');
    background-size: cover;
    background-position: center;

    transform-origin: center;
    animation: hero-image-scale 12s ease-out forwards;

    z-index: 0;
    pointer-events: none;
  }


  .hero::before {
    background: linear-gradient(
      to top,
      rgba(30, 45, 40, 0.78) 0%,
      rgba(30, 45, 40, 0.55) 45%,
      rgba(30, 45, 40, 0.10) 80%,
      rgba(30, 45, 40, 0.00) 100%
    );

    z-index: 1;
  }


  .hero-left,
  .hero-right {
    z-index: 2;
  }


  .hero-right {
    display: none;
  }


  .hero h1 {
    font-size: clamp(42px, 10vw, 64px);
  }


  .hero-description {
    font-size: 16px;
  }


  /* About */

  .about-niah {
    padding: 80px 0;
  }


  .about-container {
    grid-template-columns: 1fr;

    gap: 50px;
  }


  .about-content {
    max-width: none;
  }


  .about-image {
    aspect-ratio: 16 / 10;
  }


  .visitor-overview {
    margin-top: 70px;

    padding: 38px;
  }


  .why-niah {
    grid-template-columns: 1fr;
    grid-template-rows: auto;
  }


  .why-niah .section-label,
  .why-niah p:last-child {
    grid-column: 1;
    grid-row: auto;
  }


  .why-niah p:last-child {
    margin-top: 22px;

    padding: 20px 0 0;

    border-top: 1px solid rgba(224, 235, 221, 0.24);
    border-left: 0;
  }


  .visitor-cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

}


@media (max-width: 500px) {

  .hero-left {
    padding: 60px 7%;
  }


  .eyebrow {
    font-size: 12px;

    letter-spacing: 3px;
  }


  .hero h1 {
    font-size: 42px;
  }


  .hero-actions {
    flex-direction: column;

    align-items: stretch;
  }


  .explore-button,
  .learn-button {
    text-align: center;
  }


  /* About */

  .about-niah {
    padding: 70px 0;
  }


  .about-container {
    width: 86%;
  }


  .about-content h2 {
    font-size: 38px;
  }


  .about-facts {
    grid-template-columns: 1fr;
  }


  .visitor-overview {
    width: 86%;

    margin-top: 60px;

    padding: 30px 20px;

    border-radius: 22px;
  }


  .visitor-overview::before {
    background-position: 56% center;
  }


  .visitor-info {
    margin-top: 32px;

    padding-top: 26px;
  }


  .visitor-cards {
    grid-template-columns: 1fr;
  }


  .visitor-card {
    min-height: 0;

    padding: 19px;
  }

}

@media (prefers-reduced-motion: reduce) {

  .hero,
  .hero::after,
  .eyebrow,
  .hero h1,
  .hero-description,
  .hero-actions,
  .plant-track {
    animation: none;
  }

  .eyebrow,
  .hero h1,
  .hero-description,
  .hero-actions,
  .reveal,
  .reveal-left,
  .reveal-right {
    opacity: 1;
    transform: none;
    transition: none;
  }

  .explore-button,
  .learn-button,
  .visitor-card,
  .explore-more-button,
  .button-arrow,
  .home-plant-card,
  .plant-image-placeholder,
  .about-image {
    transition: none;
  }

}

</style>
