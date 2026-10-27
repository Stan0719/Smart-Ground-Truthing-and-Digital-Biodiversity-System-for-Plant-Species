import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'
import PlantsView from '../views/PlantsView.vue'
import SpeciesDetailView from '../views/SpeciesDetailView.vue'
import SpeciesPlantsView from '../views/SpeciesPlantsView.vue'
import PlantDetailView from '../views/PlantDetailView.vue'
import AdminDashboardView from '../views/AdminDashboardView.vue'
import ConservationOfficerLayout from '../layouts/ConservationOfficerLayout.vue'
import ReviewSubmissionsView from '../views/conservation/ReviewSubmissionsView.vue'
import AdminUserManagementView from '../views/AdminUserManagementView.vue'
import AdminModuleView from '../views/AdminModuleView.vue'
import { currentUser, logout } from '../services/auth'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  scrollBehavior(to, _from, savedPosition) {
    if (savedPosition) return savedPosition
    if (to.hash) return { el: to.hash }

    return { top: 0, left: 0 }
  },
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
    }, //forgot password route
    {
      path: '/species',
      name: 'species',
      component: PlantsView,
    },
    {
      path: '/species/:slug',
      name: 'species-detail',
      component: SpeciesDetailView,
    },
    {
      path: '/species/:slug/plants',
      name: 'species-plants',
      component: SpeciesPlantsView,
    },
    {
      path: '/plant/:plantId',
      name: 'plant-detail',
      component: PlantDetailView,
    },
    {
      path: '/plants',
      redirect: '/species',
    },
    {path:'/admin/settings',name:'admin-settings',component:AdminModuleView,props:{section:'settings'},meta:{requiresAdmin:true}},
    {path:'/account',name:'account',component:()=>import('../components/AccountProfile.vue'),props:{standalone:true}},
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
      path: '/admin/profile',
      name: 'admin-profile',
      component: () => import('../views/AdminProfileView.vue'),
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
          component: () => import('../views/conservation/ConservationDashboardView.vue'),
          meta: {
            title: 'Conservation Dashboard',
            section: 'OVERVIEW',
          },
        },
        {
          path: 'profile',
          name: 'conservation-profile',
          component: () => import('../views/conservation/ConservationProfileView.vue'),
          meta: {
            titleKey: 'nav.profileSettings',
            title: 'Profile Settings',
            section: 'ACCOUNT',
          },
        },
        {
          path: 'species',
          name: 'conservation-species',
          component: () => import('../views/conservation/PlantSpeciesView.vue'),
          meta: {
            title: 'Plant Species',
            section: 'KNOWLEDGE BASE',
          },
        },
        {
          path: 'observations',
          name: 'conservation-observations',
          component: () => import('../views/conservation/ObservationsView.vue'),
          meta: {
            title: 'Observations',
            section: 'FIELD RECORDS',
          },
        },
        {
          path: 'reviews',
          name: 'conservation-reviews',
          component: ReviewSubmissionsView,
          meta: {
            title: 'Review Submissions',
            section: 'VERIFICATION',
          },
        },
        {
          path: 'map',
          name: 'conservation-map',
          component: () => import('../views/conservation/BiodiversityMapView.vue'),
          meta: {
            title: 'Biodiversity Map',
            section: 'SPATIAL RECORDS',
          },
        },
        {
          path: 'iot',
          name: 'conservation-iot',
          component: () => import('../views/conservation/IoTMonitoringView.vue'),
          meta: {
            title: 'IoT Monitoring',
            section: 'SENSOR NETWORK',
          },
        },
        {
          path: 'alerts',
          name: 'conservation-alerts',
          component: () => import('../views/conservation/ThreatAlertsView.vue'),
          meta: {
            title: 'Threat Alerts',
            section: 'INCIDENT RESPONSE',
          },
        },
        {
          path: 'reports',
          name: 'conservation-reports',
          component: () => import('../views/conservation/ReportsView.vue'),
          meta: {
            title: 'Reports',
            section: 'ANALYSIS & EXPORT',
          },
        },
      ],
    },
  ],
})

router.beforeEach(async (to) => {
  if (
    !to.path.startsWith('/admin') &&
    !to.path.startsWith('/conservation') &&
    to.name !== 'account' &&
    to.name !== 'change-password'
  )
    return
  const user = await currentUser()
  if (!user) return { name: 'home' }
  if (user.mustChangePassword && to.name !== 'change-password') return { name: 'change-password' }
  if (user.role === 'Botanist' && !user.mustChangePassword) {
    await logout()
    return { name: 'home' }
  }
  if (to.path.startsWith('/admin') && user.role !== 'Administrator') return { name: 'home' }
  if (to.path.startsWith('/conservation') && user.role !== 'Conservation Officer')
    return { name: 'home' }
})

export default router
