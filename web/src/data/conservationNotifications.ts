import { computed, reactive } from 'vue'

export type ConservationNotificationType = 'review' | 'species' | 'threat' | 'sensor' | 'system'

export interface ConservationNotification {
  id: string
  type: ConservationNotificationType
  title: string
  message: string
  time: string
  read: boolean
  route?: string
}

export const conservationNotifications = reactive<ConservationNotification[]>([
  {
    id: 'CN-001',
    type: 'review',
    title: 'New observation submitted',
    message: 'OBS004 is waiting for Conservation Officer review.',
    time: '5 mins ago',
    read: false,
    route: '/conservation/reviews?review=OBS004',
  },
  {
    id: 'CN-002',
    type: 'species',
    title: 'Species request pending',
    message: 'SR001 contains a proposed species record awaiting verification.',
    time: '15 mins ago',
    read: false,
    route: '/conservation/reviews',
  },
  {
    id: 'CN-003',
    type: 'threat',
    title: 'High-severity threat detected',
    message: 'Movement was detected near protected plant PL002.',
    time: '25 mins ago',
    read: false,
    route: '/conservation/alerts?alert=A001',
  },
  {
    id: 'CN-004',
    type: 'sensor',
    title: 'Sensor offline',
    message: 'Climate Station C4 stopped reporting readings.',
    time: '40 mins ago',
    read: false,
    route: '/conservation/iot?sensor=SEN004',
  },
  {
    id: 'CN-005',
    type: 'system',
    title: 'Observation requires correction',
    message: 'OBS005 requires updated coordinates before it can be approved.',
    time: '1 hr ago',
    read: true,
    route: '/conservation/reviews?review=OBS005',
  },
])

export const unreadConservationNotificationCount = computed(
  () => conservationNotifications.filter((notification) => !notification.read).length,
)

export const markAllConservationNotificationsRead = () => {
  conservationNotifications.forEach((notification) => {
    notification.read = true
  })
}
