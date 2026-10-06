<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import NavigationBar from '../components/NavigationBar.vue'
import PlantRecordCard from '../components/PlantRecordCard.vue'
import { plants as species } from '../data/plants'
import { plantRecords } from '../data/plantRecords'

const route = useRoute()
const selectedSpecies = computed(() => species.find((item) => item.slug === route.params.slug))
const primaryImage = computed(() =>
  selectedSpecies.value?.image || selectedSpecies.value?.images?.find((image) => image.path)?.path,
)
const speciesPlants = computed(() =>
  plantRecords.filter((plant) => plant.speciesSlug === selectedSpecies.value?.slug),
)
const previewPlants = computed(() => speciesPlants.value.slice(0, 3))

</script>

<template>
  <NavigationBar />

  <main v-if="selectedSpecies" class="detail-page">
    <section class="detail-hero">
      <div class="detail-container">
        <RouterLink to="/species" class="back-link">← Back to Species</RouterLink>

        <div class="hero-grid">
          <img v-if="primaryImage" class="plant-image" :src="primaryImage" :alt="selectedSpecies.name" />
          <div v-else class="plant-placeholder" role="img" :aria-label="`${selectedSpecies.name} image placeholder`">
            <svg viewBox="0 0 64 64" aria-hidden="true">
              <path d="M51 9C32 10 18 19 15 36c10-8 20-12 30-15-12 6-21 14-27 25" />
              <path d="M16 37C7 29 7 19 8 12c9 3 16 9 18 17" />
            </svg>
            <span>Plant image coming soon</span>
          </div>

          <div class="hero-copy">
            <div class="hero-badges">
              <span class="category">{{ selectedSpecies.category }}</span>
              <span v-if="selectedSpecies.conservationStatus" class="conservation-status">{{ selectedSpecies.conservationStatus }}</span>
            </div>
            <h1>{{ selectedSpecies.name }}</h1>
            <p class="scientific-name">{{ selectedSpecies.scientificName }}</p>
            <p class="summary">{{ selectedSpecies.description }}</p>
          </div>
        </div>
      </div>
    </section>

    <section class="plant-information">
      <div class="detail-container information-grid">
        <article class="main-description">
          <p class="section-label">ABOUT THIS SPECIES</p>
          <h2>About {{ selectedSpecies.name }}</h2>
          <p>{{ selectedSpecies.overview }}</p>

          <h3>Natural habitat</h3>
          <p>{{ selectedSpecies.habitat }}</p>

          <template v-if="selectedSpecies.distribution">
            <h3>Distribution</h3>
            <p>{{ selectedSpecies.distribution }}</p>
          </template>

          <h3>Ecological importance</h3>
          <p>{{ selectedSpecies.ecologicalRole || selectedSpecies.significance }}</p>

          <template v-if="selectedSpecies.culturalSignificance">
            <h3>Traditional and cultural importance</h3>
            <p>{{ selectedSpecies.culturalSignificance }}</p>
          </template>
        </article>

        <aside class="quick-facts">
          <p class="section-label">TAXONOMY &amp; QUICK FACTS</p>
          <h2>Species reference</h2>
          <h3 class="characteristics-title">Key characteristics</h3>
          <ul>
            <li v-for="characteristic in selectedSpecies.characteristics" :key="characteristic">
              <span aria-hidden="true">✓</span>
              {{ characteristic }}
            </li>
          </ul>

          <dl>
            <div>
              <dt>Common name</dt>
              <dd>{{ selectedSpecies.name }}</dd>
            </div>
            <div>
              <dt>Scientific name</dt>
              <dd>{{ selectedSpecies.scientificName }}</dd>
            </div>
            <div v-if="selectedSpecies.family">
              <dt>Family</dt>
              <dd>{{ selectedSpecies.family }}</dd>
            </div>
            <div v-if="selectedSpecies.genus">
              <dt>Genus</dt>
              <dd>{{ selectedSpecies.genus }}</dd>
            </div>
            <div>
              <dt>Plant group</dt>
              <dd>{{ selectedSpecies.category }}</dd>
            </div>
            <div v-if="selectedSpecies.localName">
              <dt>Local name</dt>
              <dd>{{ selectedSpecies.localName }}</dd>
            </div>
            <div v-if="selectedSpecies.conservationStatus">
              <dt>Conservation status</dt>
              <dd>{{ selectedSpecies.conservationStatus }}</dd>
            </div>
            <div v-if="selectedSpecies.sensitivityLevel">
              <dt>Sensitivity level</dt>
              <dd>{{ selectedSpecies.sensitivityLevel }}</dd>
            </div>
            <div v-if="selectedSpecies.niahDistribution">
              <dt>Distribution in Niah</dt>
              <dd>Zones {{ selectedSpecies.niahDistribution.zones.join(', ') }}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </section>

    <section class="individual-plants" aria-labelledby="individual-plants-title">
      <div class="detail-container">
        <div class="section-heading">
          <p class="section-label">INDIVIDUAL PLANTS OF THIS SPECIES</p>
          <h2 id="individual-plants-title">Verified plants in Niah</h2>
          <p>{{ speciesPlants.length }} tagged plant records are linked to this species in the prototype.</p>
        </div>

        <div v-if="speciesPlants.length" class="individual-plant-grid">
          <PlantRecordCard
            v-for="plant in previewPlants"
            :key="plant.plantId"
            :plant="plant"
            compact
          />
        </div>
        <p v-else class="no-records">No verified individual plant records are linked yet.</p>
        <div v-if="speciesPlants.length" class="view-all-row">
          <RouterLink :to="`/species/${selectedSpecies.slug}/plants`">View All Plants →</RouterLink>
        </div>
      </div>
    </section>

    <section class="botanical-gallery">
      <div class="detail-container">
        <div class="section-heading">
          <p class="section-label">BOTANICAL PHOTOGRAPHS</p>
          <h2>Identification from different views</h2>
          <p>Photographs support species identification by showing important botanical features and growth form.</p>
        </div>

        <div class="gallery-grid">
          <figure v-for="(image, index) in selectedSpecies.images || []" :key="`${image.caption}-${index}`">
            <img v-if="image.path" :src="image.path" :alt="image.caption || `${selectedSpecies.name} botanical photograph`" />
            <div v-else class="gallery-placeholder" role="img" :aria-label="`${image.caption || 'Botanical photograph'} placeholder`">
              <svg viewBox="0 0 64 64" aria-hidden="true"><path d="M51 9C32 10 18 19 15 36c10-8 20-12 30-15-12 6-21 14-27 25"/><path d="M16 37C7 29 7 19 8 12c9 3 16 9 18 17"/></svg>
              <span>Photograph coming soon</span>
            </div>
            <figcaption v-if="image.caption">{{ image.caption }}</figcaption>
          </figure>
        </div>
      </div>
    </section>

    <section v-if="selectedSpecies.niahDistribution" class="distribution-section">
      <div class="detail-container distribution-grid">
        <div class="distribution-copy">
          <p class="section-label">DISTRIBUTION IN NIAH NATIONAL PARK</p>
          <h2>Known species occurrence</h2>
          <p>
            This staff prototype summary represents approved species occurrence records at zone level.
            Authorized coordinates are available on each individual plant record.
          </p>
          <div class="distribution-stats">
            <div><strong>{{ selectedSpecies.niahDistribution.knownOccurrences }}</strong><span>Known verified occurrences</span></div>
            <div><strong>{{ selectedSpecies.niahDistribution.zones.join(', ') }}</strong><span>Monitoring zones</span></div>
          </div>
          <small v-if="selectedSpecies.niahDistribution.publicNote">{{ selectedSpecies.niahDistribution.publicNote }}</small>
        </div>

        <div class="distribution-map" role="img" :aria-label="`Prototype distribution map for ${selectedSpecies.name}`">
          <span v-for="zone in ['A', 'B', 'C']" :key="zone" :class="{ recorded: selectedSpecies.niahDistribution.zones.includes(zone) }">Zone {{ zone }}</span>
          <p>Prototype zone-level distribution</p>
        </div>
      </div>
    </section>

    <section class="explore-more">
      <p>Continue discovering the remarkable flora of Niah.</p>
      <RouterLink to="/species">Explore more species →</RouterLink>
    </section>
  </main>

  <main v-else class="not-found">
    <span aria-hidden="true">🌿</span>
    <h1>Species not found</h1>
    <p>The species you are looking for is not in the collection.</p>
    <RouterLink to="/species">Return to Species</RouterLink>
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

.plant-image {
  width: 100%;
  height: 500px;
  display: block;
  border: 1px solid rgba(63, 104, 77, 0.15);
  border-radius: 28px;
  box-shadow: 0 22px 50px rgba(37, 75, 58, 0.12);
  object-fit: cover;
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

.back-link:hover {
  text-decoration: underline;
}

.back-link:focus-visible {
  outline: 3px solid rgba(80, 160, 120, 0.25);
  outline-offset: 4px;
  border-radius: 4px;
}

.hero-badges {
  margin-bottom: 14px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.category,
.conservation-status {
  display: inline-flex;
  padding: 7px 13px;
  border-radius: 999px;
  background: #d4e4cf;
  color: #35652f;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
}

.conservation-status {
  background: #fff0d9;
  color: #8a651f;
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

.characteristics-title {
  margin: 0 0 16px;
  color: #315f4e;
  font-size: 15px;
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

.botanical-gallery {
  padding: 90px 0;
  background: #e8efe3;
}

.section-heading {
  max-width: 720px;
  margin-bottom: 34px;
}

.section-heading h2,
.distribution-copy h2 {
  margin: 0;
  color: #234a3c;
  font-size: clamp(30px, 4vw, 42px);
  line-height: 1.15;
}

.section-heading > p:last-child,
.distribution-copy > p:not(.section-label) {
  margin: 14px 0 0;
  color: #63776d;
  font-size: 14px;
  line-height: 1.75;
}

.gallery-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
}

.gallery-grid figure {
  margin: 0;
  overflow: hidden;
  border: 1px solid rgba(58, 96, 70, 0.12);
  border-radius: 18px;
  background: #fff;
  box-shadow: 0 10px 25px rgba(37, 75, 58, 0.07);
}

.gallery-grid img,
.gallery-placeholder {
  width: 100%;
  aspect-ratio: 4 / 3;
}

.gallery-grid img {
  display: block;
  object-fit: cover;
}

.gallery-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 11px;
  background:
    radial-gradient(circle at 70% 25%, rgba(157, 217, 166, 0.42), transparent 34%),
    linear-gradient(145deg, #e1eadb, #cbdac6);
  color: #577265;
}

.gallery-placeholder svg {
  width: 54px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2.2;
}

.gallery-placeholder span {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
}

.gallery-grid figcaption {
  padding: 14px 16px;
  color: #405f56;
  font-size: 12px;
  font-weight: 700;
}

.distribution-section {
  padding: 90px 0;
  background: #f8f6ee;
}

.individual-plants {
  padding: 90px 0;
  background: #e8efe3;
}

.individual-plant-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
}

.no-records { padding: 30px; border: 1px dashed #aebfad; border-radius: 16px; text-align: center; }
.view-all-row { margin-top: 30px; text-align: center; }
.view-all-row a { display: inline-flex; padding: 12px 22px; border-radius: 999px; background: #315b49; color: #fff; font-size: 13px; font-weight: 700; text-decoration: none; transition: background .2s ease, transform .2s ease; }
.view-all-row a:hover { background: #234a3c; transform: translateY(-2px); }

.distribution-grid {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(360px, 1.1fr);
  align-items: center;
  gap: 70px;
}

.distribution-stats {
  margin: 28px 0 18px;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.distribution-stats div {
  padding: 17px;
  border: 1px solid rgba(58, 96, 70, 0.12);
  border-radius: 13px;
  background: #fff;
}

.distribution-stats strong {
  display: block;
  color: #2f7056;
  font-size: 24px;
}

.distribution-stats span {
  display: block;
  margin-top: 4px;
  color: #75867e;
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
}

.distribution-copy > small {
  color: #83918b;
  font-size: 10px;
  line-height: 1.5;
}

.distribution-map {
  position: relative;
  min-height: 350px;
  overflow: hidden;
  border: 1px solid rgba(58, 96, 70, 0.14);
  border-radius: 24px;
  background:
    radial-gradient(circle at 25% 34%, rgba(58, 132, 91, 0.18) 0 8%, transparent 9%),
    radial-gradient(circle at 70% 28%, rgba(58, 132, 91, 0.14) 0 12%, transparent 13%),
    radial-gradient(circle at 56% 72%, rgba(58, 132, 91, 0.18) 0 15%, transparent 16%),
    repeating-linear-gradient(35deg, transparent 0 38px, rgba(72, 123, 93, 0.06) 39px 40px),
    #dfe9dc;
  box-shadow: inset 0 0 60px rgba(46, 91, 66, 0.08);
}

.distribution-map > span {
  position: absolute;
  padding: 8px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.82);
  color: #7b8982;
  font-size: 10px;
  font-weight: 800;
  box-shadow: 0 5px 14px rgba(37, 75, 58, 0.1);
}

.distribution-map > span:nth-child(1) { top: 25%; left: 18%; }
.distribution-map > span:nth-child(2) { top: 48%; right: 18%; }
.distribution-map > span:nth-child(3) { bottom: 19%; left: 38%; }

.distribution-map > span.recorded {
  background: #34785d;
  color: #fff;
}

.distribution-map > p {
  position: absolute;
  right: 18px;
  bottom: 15px;
  margin: 0;
  color: #6f8078;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.8px;
  text-transform: uppercase;
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
  .information-grid,
  .distribution-grid {
    grid-template-columns: 1fr;
    gap: 48px;
  }

  .plant-placeholder,
  .plant-image {
    min-height: 380px;
  }

  .plant-image {
    height: 380px;
  }

  .back-link {
    margin-bottom: 24px;
  }

  .gallery-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .individual-plant-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 560px) {
  .detail-hero,
  .plant-information,
  .botanical-gallery,
  .distribution-section {
    padding: 55px 0;
  }

  .plant-placeholder,
  .plant-image {
    min-height: 300px;
  }

  .plant-image {
    height: 300px;
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

  .gallery-grid,
  .distribution-stats,
  .individual-plant-grid {
    grid-template-columns: 1fr;
  }

  .distribution-map {
    min-height: 290px;
  }

  .explore-more {
    flex-direction: column;
  }
}
</style>
