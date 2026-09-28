<script setup lang="ts">
import NavigationBar from '../components/NavigationBar.vue'
import ImageStack from '../components/ImageStack.vue'
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
        <div class="about-image-wrapper">
          <ImageStack />
        </div>


        <!-- Content -->
        <div class="about-content">

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

            <div class="fact-card">
              <span class="fact-number">40,000+</span>
              <span class="fact-label">
                Years of Human History
              </span>
            </div>

            <div class="fact-card">
              <span class="fact-number">UNESCO</span>
              <span class="fact-label">
                World Heritage Site
              </span>
            </div>

            <div class="fact-card">
              <span class="fact-number">Rich</span>
              <span class="fact-label">
                Natural Biodiversity
              </span>
            </div>

          </div>

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
}


/* Main Heading */

.hero h1 {
  margin: 0;

  color: #FFF6DC;

  font-size: clamp(44px, 5vw, 76px);
  line-height: 1.05;

  font-weight: 800;

  letter-spacing: -1.5px;
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
}


/* =========================
   Hero Buttons
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


/* ==================================================
   RESPONSIVE
   ================================================== */

@media (max-width: 900px) {

  /* Hero */

  .hero {
    grid-template-columns: 1fr;

    min-height: calc(100vh - 76px);

    background-position: center;
  }


  .hero::before {
    background: linear-gradient(
      to top,
      rgba(30, 45, 40, 0.78) 0%,
      rgba(30, 45, 40, 0.55) 45%,
      rgba(30, 45, 40, 0.10) 80%,
      rgba(30, 45, 40, 0.00) 100%
    );
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

}

</style>