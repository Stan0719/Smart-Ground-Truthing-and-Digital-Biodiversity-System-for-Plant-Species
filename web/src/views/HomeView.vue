<script setup lang="ts">
import NavigationBar from '../components/NavigationBar.vue'
</script>

<template>
  <NavigationBar />

  <main>
    <section class="hero">
      <h1>Discover Niah National Park</h1>

      <p>
        Explore the plants, biodiversity, and natural heritage of Niah National Park.
      </p>

      <RouterLink to="/plants" class="explore-button">
        Explore Plants
      </RouterLink>
    </section>
  </main>
</template>

<style scoped>
.hero {
  min-height: calc(100vh - 76px);

  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;

  text-align: center;

  padding: 40px 20px;

  background: #E0EBDD;
}

.hero h1 {
  margin: 0;

  color: #468585;

  font-size: clamp(40px, 6vw, 72px);
  font-weight: 800;
}

.hero p {
  max-width: 650px;

  margin: 20px 0 30px;

  color: #468585;

  font-size: 18px;
  line-height: 1.6;
}

.explore-button {
  padding: 14px 28px;

  border-radius: 30px;

  background: #468585;
  color: white;

  text-decoration: none;

  font-weight: 600;

  transition: 0.2s ease;
}

.explore-button:hover {
  background: #50B498;

  transform: translateY(-2px);
}
</style>