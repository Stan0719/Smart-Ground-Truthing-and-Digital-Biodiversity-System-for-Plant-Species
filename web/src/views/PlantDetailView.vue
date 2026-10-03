<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import NavigationBar from '../components/NavigationBar.vue'
import { plants } from '../data/plants'

const route = useRoute()
const plant = computed(() => plants.find((item) => item.slug === route.params.slug))
</script>

<template>
  <NavigationBar />

  <main v-if="plant" class="detail-page">
    <section class="detail-hero">
      <div class="detail-container hero-grid">
        <div class="plant-placeholder" role="img" :aria-label="`${plant.name} image placeholder`">
          <svg viewBox="0 0 64 64" aria-hidden="true">
            <path d="M51 9C32 10 18 19 15 36c10-8 20-12 30-15-12 6-21 14-27 25" />
            <path d="M16 37C7 29 7 19 8 12c9 3 16 9 18 17" />
          </svg>
          <span>Plant image coming soon</span>
        </div>

        <div class="hero-copy">
          <RouterLink to="/plants" class="back-link">← Back to all plants</RouterLink>
          <span class="category">{{ plant.category }}</span>
          <h1>{{ plant.name }}</h1>
          <p class="scientific-name">{{ plant.scientificName }}</p>
          <p class="summary">{{ plant.description }}</p>
        </div>
      </div>
    </section>

    <section class="plant-information">
      <div class="detail-container information-grid">
        <article class="main-description">
          <p class="section-label">ABOUT THIS PLANT</p>
          <h2>A remarkable rainforest species</h2>
          <p>{{ plant.overview }}</p>

          <h3>Natural habitat</h3>
          <p>{{ plant.habitat }}</p>

          <h3>Ecological and cultural importance</h3>
          <p>{{ plant.significance }}</p>
        </article>

        <aside class="quick-facts">
          <p class="section-label">QUICK IDENTIFICATION</p>
          <h2>Key characteristics</h2>
          <ul>
            <li v-for="characteristic in plant.characteristics" :key="characteristic">
              <span aria-hidden="true">✓</span>
              {{ characteristic }}
            </li>
          </ul>

          <dl>
            <div>
              <dt>Scientific name</dt>
              <dd>{{ plant.scientificName }}</dd>
            </div>
            <div>
              <dt>Plant group</dt>
              <dd>{{ plant.category }}</dd>
            </div>
            <div>
              <dt>Location</dt>
              <dd>Niah National Park, Sarawak</dd>
            </div>
          </dl>
        </aside>
      </div>
    </section>

    <section class="explore-more">
      <p>Continue discovering the remarkable flora of Niah.</p>
      <RouterLink to="/plants">Explore more plants →</RouterLink>
    </section>
  </main>

  <main v-else class="not-found">
    <span aria-hidden="true">🌿</span>
    <h1>Plant not found</h1>
    <p>The plant you are looking for is not in the collection.</p>
    <RouterLink to="/plants">Return to Explore Plants</RouterLink>
  </main>
</template>

<style scoped>
.detail-page {
  background: #f8f6ee;
  color: #405f56;
}

.detail-container {
  width: min(1160px, 88%);
  margin: 0 auto;
}

.detail-hero {
  padding: 70px 0;
  background: linear-gradient(135deg, #e1eadb, #f7f3e8);
}

.hero-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
  align-items: center;
  gap: 72px;
}

.plant-placeholder {
  min-height: 500px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  border: 1px solid rgba(63, 104, 77, 0.15);
  border-radius: 28px;
  background:
    radial-gradient(circle at 70% 28%, rgba(157, 217, 166, 0.48), transparent 35%),
    linear-gradient(145deg, #dce8d6, #c8d8c2);
  box-shadow: 0 22px 50px rgba(37, 75, 58, 0.12);
  color: #4e7060;
}

.plant-placeholder svg {
  width: 82px;
  fill: none;
  stroke: #537b5d;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;
}

.plant-placeholder span {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 1.5px;
  text-transform: uppercase;
}

.back-link {
  display: inline-block;
  margin-bottom: 36px;
  color: #477462;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
}

.category {
  display: table;
  margin-bottom: 14px;
  padding: 7px 13px;
  border-radius: 999px;
  background: #d4e4cf;
  color: #35652f;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
}

.hero-copy h1 {
  margin: 0;
  color: #234a3c;
  font-size: clamp(46px, 5vw, 68px);
  font-weight: 600;
  line-height: 1.04;
}

.scientific-name {
  margin: 14px 0 26px;
  color: #7c6955;
  font-size: 23px;
  font-style: italic;
}

.summary {
  margin: 0;
  color: #50675d;
  font-size: 17px;
  line-height: 1.8;
}

.plant-information {
  padding: 90px 0;
}

.information-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(290px, 0.75fr);
  align-items: start;
  gap: 80px;
}

.section-label {
  margin: 0 0 12px;
  color: #50a078;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 2.5px;
}

.main-description h2,
.quick-facts h2 {
  margin: 0 0 24px;
  color: #234a3c;
  font-size: 36px;
  font-weight: 600;
  line-height: 1.2;
}

.main-description h3 {
  margin: 38px 0 10px;
  color: #315f4e;
  font-size: 24px;
}

.main-description p:not(.section-label) {
  margin: 0;
  font-size: 16px;
  line-height: 1.9;
}

.quick-facts {
  padding: 30px;
  border: 1px solid rgba(58, 96, 70, 0.12);
  border-radius: 22px;
  background: #fff;
  box-shadow: 0 14px 40px rgba(37, 75, 58, 0.08);
}

.quick-facts h2 {
  font-size: 28px;
}

.quick-facts ul {
  margin: 0;
  padding: 0;
  display: grid;
  gap: 13px;
  list-style: none;
}

.quick-facts li {
  display: flex;
  gap: 11px;
  font-size: 14px;
  line-height: 1.5;
}

.quick-facts li span {
  color: #50a078;
  font-weight: 800;
}

.quick-facts dl {
  margin: 28px 0 0;
  padding-top: 24px;
  border-top: 1px solid #e7e8e1;
}

.quick-facts dl div + div {
  margin-top: 17px;
}

.quick-facts dt {
  margin-bottom: 4px;
  color: #7c8982;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.8px;
  text-transform: uppercase;
}

.quick-facts dd {
  margin: 0;
  color: #315447;
  font-size: 14px;
  font-weight: 600;
}

.explore-more {
  padding: 54px 6%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 30px;
  background: #214638;
  color: #fff;
  text-align: center;
}

.explore-more p {
  margin: 0;
  font-size: 23px;
}

.explore-more a,
.not-found a {
  padding: 12px 20px;
  border-radius: 999px;
  background: #fff4d8;
  color: #315b49;
  font-size: 14px;
  font-weight: 700;
  text-decoration: none;
}

.not-found {
  min-height: calc(100vh - 76px);
  padding: 60px 20px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #f4f3e9;
  color: #50675d;
  text-align: center;
}

.not-found span {
  font-size: 50px;
}

.not-found h1 {
  margin: 16px 0 8px;
  color: #234a3c;
}

.not-found p {
  margin: 0 0 24px;
}

@media (max-width: 850px) {
  .hero-grid,
  .information-grid {
    grid-template-columns: 1fr;
    gap: 48px;
  }

  .plant-placeholder {
    min-height: 380px;
  }

  .back-link {
    margin-bottom: 24px;
  }
}

@media (max-width: 560px) {
  .detail-hero,
  .plant-information {
    padding: 55px 0;
  }

  .plant-placeholder {
    min-height: 300px;
  }

  .hero-copy h1 {
    font-size: 42px;
  }

  .information-grid {
    gap: 42px;
  }

  .main-description h2 {
    font-size: 31px;
  }

  .quick-facts {
    padding: 25px;
  }

  .explore-more {
    flex-direction: column;
  }
}
</style>
