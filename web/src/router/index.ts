import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import PlantsView from '../views/PlantsView.vue'
import PlantDetailView from '../views/PlantDetailView.vue'
import AdminDashboardView from '../views/AdminDashboardView.vue'
import ConservationOfficerLayout from '../layouts/ConservationOfficerLayout.vue'
import AdminUserManagementView from '../views/AdminUserManagementView.vue'
import AdminModuleView from '../views/AdminModuleView.vue'
import { PENDING_PASSWORD_CHANGE_KEY } from '../data/prototypeAuth'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
    },
    {
      path: '/forgot-password',
      name: 'forgot-password',
      component: () => import('../views/ForgotPasswordView.vue'),
    },//forgot password route
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
      path: '/change-password',
      name: 'change-password',
      component: () => import('../views/ChangePasswordView.vue'),
    },
    {
      path: '/admin',
      name: 'admin-dashboard',
      component: AdminDashboardView,
      meta: { requiresAdmin: true },
    },
    {
      path: '/admin/users',
      name: 'admin-users',
      component: AdminUserManagementView,
      meta: { requiresAdmin: true },
    },
    {
      path: '/admin/roles',
      name: 'admin-roles',
      component: AdminModuleView,
      props: { section: 'roles' },
      meta: { requiresAdmin: true },
    },
    {
      path: '/admin/iot',
      name: 'admin-iot',
      component: AdminModuleView,
      props: { section: 'iot' },
      meta: { requiresAdmin: true },
    },
    {
      path: '/admin/sensors',
      name: 'admin-sensors',
      component: AdminModuleView,
      props: { section: 'sensors' },
      meta: { requiresAdmin: true },
    },
    {
      path: '/admin/alerts',
      name: 'admin-alerts',
      component: AdminModuleView,
      props: { section: 'alerts' },
      meta: { requiresAdmin: true },
    },
    {
      path: '/admin/activity',
      name: 'admin-activity',
      component: AdminModuleView,
      props: { section: 'activity' },
      meta: { requiresAdmin: true },
    },
    {
      path: '/conservation-dashboard',
      redirect: '/conservation/dashboard',
    },
    {
      path: '/conservation',
      component: ConservationOfficerLayout,
      redirect: '/conservation/dashboard',
      children: [
        {
          path: 'dashboard',
          name: 'conservation-dashboard',
          component: () =>
            import('../views/conservation/ConservationDashboardView.vue'),
          meta: {
            title: 'Conservation Officer Dashboard',
            section: 'OVERVIEW',
          },
        },
        {
          path: 'species',
          name: 'conservation-species',
          component: () =>
            import('../views/conservation/PlantSpeciesView.vue'),
          meta: {
            title: 'Plant Species',
            section: 'KNOWLEDGE BASE',
          },
        },
        {
          path: 'observations',
          name: 'conservation-observations',
          component: () =>
            import('../views/conservation/ObservationsView.vue'),
          meta: {
            title: 'Observations',
            section: 'FIELD RECORDS',
          },
        },
        {
          path: 'reviews',
          name: 'conservation-reviews',
          component: () =>
            import('../views/conservation/ReviewSubmissionsView.vue'),
          meta: {
            title: 'Review Submissions',
            section: 'VERIFICATION',
          },
        },
        {
          path: 'map',
          name: 'conservation-map',
          component: () =>
            import('../views/conservation/BiodiversityMapView.vue'),
          meta: {
            title: 'Biodiversity Map',
            section: 'SPATIAL RECORDS',
          },
        },
        {
          path: 'iot',
          name: 'conservation-iot',
          component: () =>
            import('../views/conservation/IoTMonitoringView.vue'),
          meta: {
            title: 'IoT Monitoring',
            section: 'SENSOR NETWORK',
          },
        },
        {
          path: 'alerts',
          name: 'conservation-alerts',
          component: () =>
            import('../views/conservation/ThreatAlertsView.vue'),
          meta: {
            title: 'Threat Alerts',
            section: 'INCIDENT RESPONSE',
          },
        },
        {
          path: 'reports',
          name: 'conservation-reports',
          component: () =>
            import('../views/conservation/ReportsView.vue'),
          meta: {
            title: 'Reports',
            section: 'ANALYSIS & EXPORT',
          },
        },
      ],
    },
  ],
})

router.beforeEach((to) => {
  const passwordChangePending = sessionStorage.getItem(PENDING_PASSWORD_CHANGE_KEY)
  if (passwordChangePending && to.path.startsWith('/conservation')) {
    return { name: 'change-password' }
  }
})

export default router
