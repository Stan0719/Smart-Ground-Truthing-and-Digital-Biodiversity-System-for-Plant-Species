<script setup lang="ts">
import NavigationBar from '../components/NavigationBar.vue'
</script>

<template>
  <NavigationBar />

  <main>
    <section class="hero">
      <div class="hero-overlay"></div>

      <div class="hero-content">
        <p class="eyebrow">NIAH NATIONAL PARK</p>

        <h1>Discover the Biodiversity of Niah</h1>

        <p class="hero-description">
          Explore the plants, biodiversity, and natural heritage
          of Niah National Park.
        </p>

        <RouterLink to="/plants" class="explore-button">
          Explore Plants
        </RouterLink>
      </div>
    </section>
  </main>
</template>

<style scoped>
.hero {
  position: relative;

  min-height: calc(100vh - 76px);

  display: flex;
  align-items: center;
  justify-content: center;

  padding: 60px 20px;

  background-image: url('/images/hero.jpg');
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;

  overflow: hidden;
}

/* Dark green overlay */
.hero-overlay {
  position: absolute;
  inset: 0;

  background: rgba(20, 55, 45, 0.55);
}

/* Content sits above the overlay */
.hero-content {
  position: relative;
  z-index: 1;

  max-width: 900px;

  text-align: center;

  color: white;
}

.eyebrow {
  margin: 0 0 16px;

  font-size: 14px;
  font-weight: 700;
  letter-spacing: 3px;

  color: #def9c4;
}

.hero h1 {
  margin: 0;

  font-size: clamp(42px, 7vw, 80px);
  line-height: 1.05;
  font-weight: 800;
}

.hero-description {
  max-width: 650px;

  margin: 24px auto 34px;

  font-size: 18px;
  line-height: 1.7;

  color: #e0ebdd;
}

.explore-button {
  display: inline-block;

  padding: 14px 30px;

  border-radius: 30px;

  background: #def9c4;
  color: #468585;

  text-decoration: none;

  font-weight: 700;

  transition: 0.2s ease;
}

.explore-button:hover {
  background: #9cdbA6;

  transform: translateY(-2px);
}
</style>