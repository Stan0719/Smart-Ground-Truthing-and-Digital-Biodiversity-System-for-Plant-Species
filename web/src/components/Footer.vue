<script setup lang="ts">
defineOptions({ name: 'SiteFooter' })
</script>

<template>
  <footer class="site-footer">
    <div class="footer-container">
      <div class="footer-grid">
        <section class="footer-brand" aria-label="Niah Biodiversity">
          <RouterLink class="brand-link" to="/" aria-label="Niah Biodiversity home">
            <img src="/images/logo.png" alt="Niah Biodiversity" />
            <span>
              <strong>NIAH</strong>
              <small>BIODIVERSITY</small>
            </span>
          </RouterLink>
          <p>
            Smart Ground-Truthing and Digital Biodiversity System for Plant Species
            Documentation.
          </p>
        </section>

        <nav class="footer-section" aria-labelledby="footer-quick-links">
          <h2 id="footer-quick-links">Quick Links</h2>
          <RouterLink to="/">Home</RouterLink>
          <RouterLink to="/plants">Explore Plants</RouterLink>
        </nav>

        <nav class="footer-section" aria-labelledby="footer-explore-links">
          <h2 id="footer-explore-links">Explore</h2>
          <RouterLink to="/plants">Plant Database</RouterLink>
        </nav>

        <section class="footer-section footer-project">
          <h2>Project</h2>
          <strong>Smart Ground-Truthing &amp; Digital Biodiversity System</strong>
          <p>Supporting biodiversity documentation, conservation research and sustainable ecotourism.</p>
          <p>Developed in collaboration with Swinburne University of Technology Sarawak and industry partners.</p>
        </section>
      </div>

      <div class="footer-bottom">
        <p>© 2026 Niah Biodiversity System</p>
        <p>For biodiversity conservation, research and education.</p>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.site-footer {
  padding: 58px 0 24px;
  overflow: hidden;
  background: #173f34;
  color: #d7e7dd;
}

.footer-container {
  width: min(1200px, 88%);
  margin: 0 auto;
}

.footer-grid {
  display: grid;
  grid-template-columns: minmax(250px, 1.45fr) minmax(130px, 0.7fr) minmax(130px, 0.7fr) minmax(250px, 1.15fr);
  gap: 48px;
}

.footer-brand p,
.footer-section p {
  margin: 17px 0 0;
  color: #b9d0c5;
  font-size: 13px;
  line-height: 1.7;
}

.brand-link {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  color: #fff6dc;
  text-decoration: none;
}

.brand-link img {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  object-fit: cover;
}

.brand-link span {
  display: flex;
  flex-direction: column;
}

.brand-link strong {
  font-size: 20px;
  letter-spacing: 3px;
}

.brand-link small {
  margin-top: 3px;
  color: #9cdba6;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 2px;
}

.footer-section {
  display: flex;
  align-items: flex-start;
  flex-direction: column;
  gap: 11px;
}

.footer-section h2 {
  margin: 3px 0 8px;
  color: #fff6dc;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 1.8px;
  text-transform: uppercase;
}

.footer-section a {
  color: #d7e7dd;
  font-size: 13px;
  text-decoration: none;
  transition:
    color 0.2s ease,
    transform 0.2s ease;
}

.footer-section a:hover,
.footer-section a:focus-visible {
  color: #9cdba6;
  transform: translateX(3px);
}

.footer-project strong {
  color: #e5efe9;
  font-size: 13px;
  line-height: 1.55;
}

.footer-project p {
  margin-top: 1px;
  font-size: 12px;
}

.footer-bottom {
  margin-top: 42px;
  padding-top: 21px;
  display: flex;
  justify-content: space-between;
  gap: 24px;
  border-top: 1px solid rgba(255, 246, 220, 0.14);
}

.footer-bottom p {
  margin: 0;
  color: #a9c4b7;
  font-size: 11px;
  line-height: 1.5;
}

@media (max-width: 900px) {
  .footer-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 38px 48px;
  }
}

@media (max-width: 500px) {
  .site-footer {
    padding-top: 48px;
  }

  .footer-container {
    width: 86%;
  }

  .footer-grid {
    grid-template-columns: 1fr;
    gap: 32px;
  }

  .footer-bottom {
    margin-top: 35px;
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
  }
}
</style>
