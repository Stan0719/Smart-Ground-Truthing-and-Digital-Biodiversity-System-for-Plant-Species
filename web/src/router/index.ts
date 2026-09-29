import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import PlantsView from '../views/PlantsView.vue'
import PlantDetailView from '../views/PlantDetailView.vue'
import AdminDashboardView from '../views/AdminDashboardView.vue'
import ConservationDashboardView from '../views/ConservationDashboardView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
    },
    {
      path: '/plants',
      name: 'plants',
      component: PlantsView,
    },
    {
      path: '/plants/:slug',
      name: 'plant-detail',
      component: PlantDetailView,
    },
    {
      path: '/admin',
      name: 'admin-dashboard',
      component: AdminDashboardView,
      meta: { requiresAdmin: true },
    },
    {
      path: '/conservation-dashboard',
      name: 'conservation-dashboard',
      component: ConservationDashboardView,
    },
  ],
})

export default router
