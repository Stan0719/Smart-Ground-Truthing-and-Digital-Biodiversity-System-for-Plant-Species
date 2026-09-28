<script setup lang="ts">
import NavigationBar from '../components/NavigationBar.vue'
</script>

<template>
  <NavigationBar />

  <main>
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
  </main>
</template>

<style scoped>
/* =========================
   Hero
   ========================= */

.hero {
  position: relative;

  min-height: calc(100vh - 76px);

  display: grid;
  grid-template-columns: 50% 50%;

  background-image: url('/images/hero.jpg');
  background-size: cover;
  background-position: center;

  overflow: hidden;
}


/* =========================
   Left Side
   ========================= */

.hero-left {
  display: flex;
  align-items: center;

  padding: 80px 7%;

  background: rgba(49, 56, 54, 0.521);

  backdrop-filter: blur(3px);

  z-index: 1;
}


/* =========================
   Content
   ========================= */

.hero-content {
  max-width: 620px;

  color: white;
}


/* Small heading */

.eyebrow {
  margin: 0 0 20px;

  color: #9cdbA6;

  font-size: 14px;
  font-weight: 700;

  letter-spacing: 4px;
}


/* Main heading */

.hero h1 {
  margin: 0;

  color: #FFF6DC;

  font-size: clamp(44px, 5vw, 76px);
  line-height: 1.05;

  font-weight: 800;

  letter-spacing: -1.5px;
}


/* Green highlighted word */

.highlight {
  color: #50b498;
}


/* Description */

.hero-description {
  max-width: 560px;

  margin: 28px 0 36px;

  color: #e0ebdd;

  font-size: 17px;
  line-height: 1.8;
}


/* =========================
   Buttons
   ========================= */

.hero-actions {
  display: flex;
  align-items: center;

  gap: 14px;

  flex-wrap: wrap;
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
   Right Side
   ========================= */

.hero-right {
  min-height: 100%;
}


/* =========================
   Responsive
   ========================= */

@media (max-width: 900px) {

  .hero {
    grid-template-columns: 1fr;

    min-height: calc(100vh - 76px);

    background-position: center;
  }


  .hero-left {
    min-height: calc(100vh - 76px);

    padding: 70px 8%;

    background: rgba(49, 56, 54, 0.521);
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
}


/* =========================
   Small Mobile
   ========================= */

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
}
</style>