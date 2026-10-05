<script setup lang="ts">
const currentYear = new Date().getFullYear()
</script>

<template>
  <footer class="site-footer">
    <div class="footer-accent" aria-hidden="true"></div>

    <div class="footer-container">
      <div class="footer-main">
        <div class="footer-brand">
          <RouterLink to="/" class="footer-logo" aria-label="Niah Biodiversity homepage">
            <img src="/images/logo.png" alt="" />
            <span>
              <strong>NIAH</strong>
              <small>BIODIVERSITY</small>
            </span>
          </RouterLink>

          <p>
            Discover the plants, landscapes, and extraordinary human history preserved
            within Niah National Park.
          </p>

          <span class="heritage-label">Nature · Heritage · Discovery</span>
        </div>

        <nav class="footer-column" aria-label="Footer navigation">
          <h2>Explore</h2>
          <RouterLink to="/">Home</RouterLink>
          <RouterLink to="/plants">Explore Plants</RouterLink>
          <a href="#journey-to-cave">Journey to the Cave</a>
        </nav>

        <div class="footer-column visitor-details">
          <h2>Plan Your Visit</h2>
          <p>
            <span class="detail-icon" aria-hidden="true">◷</span>
            <span><small>Opening hours</small>Daily, 8 AM–5 PM</span>
          </p>
          <p>
            <span class="detail-icon" aria-hidden="true">⌖</span>
            <span><small>Location</small>Niah, Miri Division, Sarawak</span>
          </p>
          <p>
            <span class="detail-icon" aria-hidden="true">↗</span>
            <span><small>From Miri</small>Approximately 1.5 hours</span>
          </p>
        </div>

        <div class="footer-column footer-note">
          <h2>Before You Go</h2>
          <p>
            Wear suitable footwear, carry drinking water, and bring a reliable torch for
            your cave journey.
          </p>
          <RouterLink to="/plants" class="footer-button">
            Discover Niah's Plants <span aria-hidden="true">→</span>
          </RouterLink>
        </div>
      </div>

      <div class="footer-bottom">
        <p>© {{ currentYear }} Niah Biodiversity. All rights reserved.</p>
        <p>Smart Ground-Truthing &amp; Digital Biodiversity System</p>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.site-footer {
  position: relative;
  overflow: hidden;
  background: #14382f;
  color: #dce9e1;
}

.site-footer::before {
  content: '';
  position: absolute;
  top: -180px;
  right: -140px;
  width: 430px;
  height: 430px;
  border: 1px solid rgba(156, 219, 166, 0.09);
  border-radius: 50%;
  box-shadow:
    0 0 0 55px rgba(156, 219, 166, 0.025),
    0 0 0 110px rgba(156, 219, 166, 0.018);
  pointer-events: none;
}

.footer-accent {
  height: 4px;
  background: linear-gradient(to right, #50b498, #9cdba6, #fff6dc);
}

.footer-container {
  position: relative;
  z-index: 1;
  width: min(1200px, 88%);
  margin: 0 auto;
}

.footer-main {
  padding: 72px 0 58px;
  display: grid;
  grid-template-columns: 1.35fr 0.65fr 1fr 1fr;
  gap: clamp(35px, 5vw, 72px);
}

.footer-logo {
  width: fit-content;
  display: flex;
  align-items: center;
  gap: 11px;
  color: #fff6dc;
  text-decoration: none;
}

.footer-logo img {
  width: 53px;
  height: 53px;
  border-radius: 50%;
  object-fit: cover;
  background: #fff;
}

.footer-logo > span {
  display: flex;
  flex-direction: column;
}

.footer-logo strong {
  font-size: 20px;
  letter-spacing: 2.5px;
  line-height: 1;
}

.footer-logo small {
  margin-top: 6px;
  color: #9cdba6;
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 2.2px;
}

.footer-brand > p {
  max-width: 330px;
  margin: 22px 0 18px;
  color: #b8cec3;
  font-size: 12px;
  line-height: 1.75;
}

.heritage-label {
  color: #76ad96;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 1.7px;
  text-transform: uppercase;
}

.footer-column {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.footer-column h2 {
  margin: 4px 0 21px;
  color: #fff6dc;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.3px;
}

.footer-column > a:not(.footer-button) {
  position: relative;
  margin-bottom: 12px;
  color: #b8cec3;
  font-size: 11px;
  text-decoration: none;
  transition: color 0.2s ease, transform 0.2s ease;
}

.footer-column > a:not(.footer-button):hover {
  color: #9cdba6;
  transform: translateX(3px);
}

.visitor-details > p {
  margin: 0 0 16px;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  color: #c7d9d0;
  font-size: 10px;
  line-height: 1.5;
}

.visitor-details p > span:last-child {
  display: flex;
  flex-direction: column;
}

.visitor-details small {
  margin-bottom: 2px;
  color: #75a995;
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.7px;
  text-transform: uppercase;
}

.detail-icon {
  width: 25px;
  height: 25px;
  flex: 0 0 25px;
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: rgba(156, 219, 166, 0.1);
  color: #9cdba6;
  font-size: 13px;
}

.footer-note > p {
  margin: 0;
  color: #b8cec3;
  font-size: 11px;
  line-height: 1.7;
}

.footer-button {
  margin-top: 20px;
  padding: 10px 15px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid rgba(156, 219, 166, 0.28);
  border-radius: 999px;
  background: rgba(156, 219, 166, 0.08);
  color: #d9eddd;
  font-size: 10px;
  font-weight: 700;
  text-decoration: none;
  transition: background-color 0.2s ease, transform 0.2s ease;
}

.footer-button:hover {
  transform: translateY(-2px);
  background: rgba(156, 219, 166, 0.16);
}

.footer-bottom {
  padding: 20px 0 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  border-top: 1px solid rgba(224, 235, 221, 0.12);
}

.footer-bottom p {
  margin: 0;
  color: #7fa393;
  font-size: 9px;
}

@media (max-width: 900px) {
  .footer-main {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 560px) {
  .footer-container {
    width: 86%;
  }

  .footer-main {
    padding: 58px 0 42px;
    grid-template-columns: 1fr;
    gap: 38px;
  }

  .footer-brand > p {
    max-width: none;
  }

  .footer-bottom {
    align-items: flex-start;
    flex-direction: column;
    gap: 7px;
  }
}
</style>
