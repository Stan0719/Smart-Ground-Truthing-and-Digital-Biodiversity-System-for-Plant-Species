import { createApp } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import Recovery from '../../web/src/views/ForgotPasswordView.vue';
import '../../web/src/style.css';

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/forgot-password', component: Recovery },
    { path: '/', component: { template: '<div />' } },
  ],
});
router.afterEach((to) => {
  if (to.path === '/') {
    window.ReactNativeWebView.postMessage(JSON.stringify({ action: 'home' }));
  }
});
await router.push('/forgot-password');
await router.isReady();
createApp(Recovery).use(router).mount('#app');
