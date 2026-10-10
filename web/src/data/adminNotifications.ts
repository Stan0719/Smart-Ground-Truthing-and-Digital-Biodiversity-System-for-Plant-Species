import { computed, ref } from 'vue'

export interface AdminNotification {
  id: string
  type: 'threat' | 'sensor' | 'system'
  title: string
  message: string
  time: string
  read: boolean
  route?: string
}

export const adminNotifications = ref<AdminNotification[]>([
  {
    id: 'N001',
    type: 'threat',
    title: 'High-severity threat alert',
    message: 'Movement detected near PL002.',
    time: '2 mins ago',
    read: false,
    route: '/admin/alerts',
  },
  {
    id: 'N002',
    type: 'sensor',
    title: 'Sensor offline',
    message: 'Sensor S003 stopped reporting readings.',
    time: '8 mins ago',
    read: false,
    route: '/admin/sensors',
  },
  {
    id: 'N003',
    type: 'threat',
    title: 'Threat alert needs review',
    message: 'High temperature detected near PL010.',
    time: '15 mins ago',
    read: false,
    route: '/admin/alerts',
  },
  {
    id: 'N004',
    type: 'system',
    title: 'System warning',
    message: 'Sensor network reported a connectivity warning.',
    time: '25 mins ago',
    read: true,
    route: '/admin/iot',
  },
])

export const unreadAdminNotificationCount = computed(
  () => adminNotifications.value.filter((notification) => !notification.read).length,
)

export const markAllAdminNotificationsRead = () => {
  adminNotifications.value.forEach((notification) => {
    notification.read = true
  })
}
