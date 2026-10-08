import { reactive } from 'vue'

export type ObservationStatus =
  'Draft' | 'Pending Review' | 'Approved' | 'Rejected' | 'Correction Required' | 'Flagged'
export type ConservationStatus =
  | 'Not Assessed'
  | 'Least Concern'
  | 'Near Threatened'
  | 'Vulnerable'
  | 'Endangered'
  | 'Critically Endangered'
export type SpeciesRequestStatus =
  'Pending Review' | 'Approved' | 'Rejected' | 'Correction Required'

export interface SpeciesRecord {
  id: string
  scientificName: string
  commonName: string
  genus: string
  family: string
  status: ConservationStatus
  plantCount: number
  updated: string
  description: string
  habitat: string
  image: string
}
export interface SpeciesRequest {
  id: string
  requestedBy: string
  proposedScientificName: string
  proposedCommonName: string
  genus: string
  family: string
  description: string
  habitat: string
  identificationNotes: string
  submittedAt: string
  status: SpeciesRequestStatus
  photos: string[]
  reviewedBy?: string
  reviewedAt?: string
  reviewComment?: string
  approvedSpeciesId?: string
}
export interface PlantRecord {
  id: string
  speciesId: string
  speciesRequestId?: string
  zone: string
  location: string
  latitude: number
  longitude: number
  registeredBy: string
  registeredAt: string
  status: string
  health: string
  lastObservation: string
  x: number
  y: number
}
export interface Observation {
  id: string
  plantId: string
  recordedBy: string
  height: string
  growthStage: string
  health: string
  location: string
  observedAt: string
  submittedAt: string
  status: ObservationStatus
  morphology: string
  notes: string
  gpsAccuracy: string
  reviewedBy?: string
  reviewedAt?: string
  reviewComment?: string
  photos: string[]
}
export interface SensorDevice {
  id: string
  name: string
  type: string
  plantId: string
  zone: string
  status: 'Online' | 'Offline' | 'Maintenance'
  installedAt: string
  lastReading: string
}
export interface SensorReading {
  id: string
  sensorId: string
  plantId: string
  temperature: string
  humidity: string
  soilMoisture: string
  rainfall: string
  light: string
  motion: 'Detected' | 'No Movement'
  gps: string
  recordedAt: string
}
export interface ThreatAlert {
  id: string
  type: string
  plantId: string
  sensorId: string
  zone: string
  severity: 'Low' | 'Medium' | 'High'
  status: 'New' | 'Reviewing' | 'Resolved'
  detectedAt: string
  reading: string
  notes: string[]
}

export const conservationStore = reactive({
  species: [
    {
      id: 'SP001',
      scientificName: 'Nepenthes ampullaria',
      commonName: 'Common Swamp Pitcher Plant',
      genus: 'Nepenthes',
      family: 'Nepenthaceae',
      status: 'Vulnerable',
      plantCount: 42,
      updated: '29 Sep 2026',
      description: 'A distinctive pitcher plant with clustered ground pitchers.',
      habitat: 'Shaded kerangas and peat swamp forest.',
      image: '/images/hero.jpg',
    },
    {
      id: 'SP002',
      scientificName: 'Shorea parvifolia',
      commonName: 'White Meranti',
      genus: 'Shorea',
      family: 'Dipterocarpaceae',
      status: 'Endangered',
      plantCount: 31,
      updated: '28 Sep 2026',
      description: 'A tall emergent dipterocarp tree.',
      habitat: 'Lowland mixed dipterocarp forest.',
      image: '/images/hero.jpg',
    },
    {
      id: 'SP003',
      scientificName: 'Dipterocarpus grandiflorus',
      commonName: 'Keruing Belimbing',
      genus: 'Dipterocarpus',
      family: 'Dipterocarpaceae',
      status: 'Endangered',
      plantCount: 18,
      updated: '27 Sep 2026',
      description: 'Large canopy tree with winged fruit.',
      habitat: 'Well-drained lowland rainforest.',
      image: '/images/hero.jpg',
    },
    {
      id: 'SP004',
      scientificName: 'Calamus caesius',
      commonName: 'Rotan Sega',
      genus: 'Calamus',
      family: 'Arecaceae',
      status: 'Least Concern',
      plantCount: 56,
      updated: '24 Sep 2026',
      description: 'Clustering rattan palm native to Southeast Asia.',
      habitat: 'Lowland tropical forest.',
      image: '/images/hero.jpg',
    },
    {
      id: 'SP005',
      scientificName: 'Vatica mangachapoi',
      commonName: 'Resak',
      genus: 'Vatica',
      family: 'Dipterocarpaceae',
      status: 'Critically Endangered',
      plantCount: 8,
      updated: '20 Sep 2026',
      description: 'Rare evergreen dipterocarp.',
      habitat: 'Undisturbed lowland forest.',
      image: '/images/hero.jpg',
    },
  ] as SpeciesRecord[],
  speciesRequests: [
    {
      id: 'SR001',
      requestedBy: 'Botanist02',
      proposedScientificName: 'Shorea niahensis',
      proposedCommonName: 'Niah Meranti',
      genus: 'Shorea',
      family: 'Dipterocarpaceae',
      description: 'Large dipterocarp tree observed during a lowland field survey.',
      habitat: 'Lowland mixed dipterocarp forest near a limestone buffer.',
      identificationNotes:
        'Leaf venation, bark texture and fruit characteristics differ from currently recorded Shorea species.',
      submittedAt: '3 Oct 2026',
      status: 'Pending Review',
      photos: ['Whole Plant', 'Leaf', 'Bark', 'Fruit'],
    },
  ] as SpeciesRequest[],
  plants: [
    {
      id: 'PL001',
      speciesId: 'SP001',
      zone: 'Zone A',
      location: 'Moon Cave Trail',
      latitude: 3.81248,
      longitude: 113.78142,
      registeredBy: 'Botanist01',
      registeredAt: '1 Sep 2026',
      status: 'Protected',
      health: 'At Risk',
      lastObservation: '30 Sep 2026',
      x: 23,
      y: 36,
    },
    {
      id: 'PL002',
      speciesId: 'SP002',
      zone: 'Zone A',
      location: 'Painted Cave Buffer',
      latitude: 3.81092,
      longitude: 113.77983,
      registeredBy: 'Botanist03',
      registeredAt: '3 Sep 2026',
      status: 'Protected',
      health: 'Healthy',
      lastObservation: '29 Sep 2026',
      x: 38,
      y: 70,
    },
    {
      id: 'PL003',
      speciesId: 'SP003',
      zone: 'Zone B',
      location: 'Bukit Kasut Transect',
      latitude: 3.80674,
      longitude: 113.78711,
      registeredBy: 'Botanist02',
      registeredAt: '7 Sep 2026',
      status: 'Monitored',
      health: 'Healthy',
      lastObservation: '28 Sep 2026',
      x: 54,
      y: 25,
    },
    {
      id: 'PL004',
      speciesId: 'SP004',
      zone: 'Zone B',
      location: 'Sungai Subis Plot',
      latitude: 3.80318,
      longitude: 113.79034,
      registeredBy: 'Botanist01',
      registeredAt: '10 Sep 2026',
      status: 'Stable',
      health: 'Healthy',
      lastObservation: '26 Sep 2026',
      x: 71,
      y: 61,
    },
    {
      id: 'PL005',
      speciesId: 'SP005',
      zone: 'Zone C',
      location: 'Restricted Plot C4',
      latitude: 3.79886,
      longitude: 113.79502,
      registeredBy: 'Botanist03',
      registeredAt: '14 Sep 2026',
      status: 'Protected',
      health: 'At Risk',
      lastObservation: '29 Sep 2026',
      x: 81,
      y: 38,
    },
    {
      id: 'PL006',
      speciesId: undefined!,
      speciesRequestId: 'SR001',
      zone: 'Zone B',
      location: 'Limestone Buffer Transect',
      latitude: 3.80792,
      longitude: 113.78864,
      registeredBy: 'Botanist02',
      registeredAt: '3 Oct 2026',
      status: 'Monitored',
      health: 'Healthy',
      lastObservation: '3 Oct 2026',
      x: 62,
      y: 44,
    },
  ] as PlantRecord[],
  observations: [
    {
      id: 'OBS001',
      plantId: 'PL001',
      recordedBy: 'Botanist01',
      height: '80 cm',
      growthStage: 'Mature',
      health: 'Healthy',
      location: 'Moon Cave Trail',
      observedAt: '1 Oct 2026, 09:20',
      submittedAt: '1 Oct 2026',
      status: 'Approved',
      morphology: 'Ground pitchers well formed; leaves intact.',
      notes: 'No signs of trampling.',
      gpsAccuracy: '± 3 m',
      reviewedBy: 'Officer01',
      reviewedAt: '1 Oct 2026, 14:10',
      reviewComment: 'Location and identification verified.',
      photos: ['Whole plant', 'Leaf', 'Habitat'],
    },
    {
      id: 'OBS002',
      plantId: 'PL001',
      recordedBy: 'Botanist01',
      height: '87 cm',
      growthStage: 'Mature',
      health: 'Healthy',
      location: 'Moon Cave Trail',
      observedAt: '15 Oct 2026, 08:45',
      submittedAt: '15 Oct 2026',
      status: 'Pending Review',
      morphology: 'New basal pitchers recorded.',
      notes: 'Growth since previous visit.',
      gpsAccuracy: '± 4 m',
      photos: ['Whole plant', 'Pitcher', 'Habitat'],
    },
    {
      id: 'OBS003',
      plantId: 'PL001',
      recordedBy: 'Botanist02',
      height: '90 cm',
      growthStage: 'Mature',
      health: 'At Risk',
      location: 'Moon Cave Trail',
      observedAt: '30 Oct 2026, 10:05',
      submittedAt: '30 Oct 2026',
      status: 'Flagged',
      morphology: 'Two damaged pitchers and leaf discoloration.',
      notes: 'Possible visitor disturbance.',
      gpsAccuracy: '± 5 m',
      reviewedBy: 'Officer01',
      reviewedAt: '30 Oct 2026, 15:00',
      reviewComment: 'Requires site investigation.',
      photos: ['Whole plant', 'Leaf'],
    },
    {
      id: 'OBS004',
      plantId: 'PL002',
      recordedBy: 'Botanist03',
      height: '18.4 m',
      growthStage: 'Mature',
      health: 'Healthy',
      location: 'Painted Cave Buffer',
      observedAt: '29 Sep 2026, 11:30',
      submittedAt: '29 Sep 2026',
      status: 'Pending Review',
      morphology: 'Crown condition good; diameter recorded.',
      notes: 'Reference tag visible.',
      gpsAccuracy: '± 3 m',
      photos: ['Whole plant', 'Bark', 'Leaf'],
    },
    {
      id: 'OBS005',
      plantId: 'PL003',
      recordedBy: 'Botanist02',
      height: '21.1 m',
      growthStage: 'Mature',
      health: 'Healthy',
      location: 'Bukit Kasut Transect',
      observedAt: '28 Sep 2026, 15:10',
      submittedAt: '28 Sep 2026',
      status: 'Correction Required',
      morphology: 'Fruit observed beneath crown.',
      notes: 'GPS reading needs reconfirmation.',
      gpsAccuracy: '± 18 m',
      reviewedBy: 'Officer01',
      reviewedAt: '29 Sep 2026',
      reviewComment: 'Please recapture coordinates with accuracy under 10 m.',
      photos: ['Whole plant', 'Fruit'],
    },
    {
      id: 'OBS006',
      plantId: 'PL005',
      recordedBy: 'Botanist03',
      height: '9.6 m',
      growthStage: 'Juvenile',
      health: 'At Risk',
      location: 'Restricted Plot C4',
      observedAt: '29 Sep 2026, 07:50',
      submittedAt: '29 Sep 2026',
      status: 'Pending Review',
      morphology: 'Sparse foliage on eastern crown.',
      notes: 'Soil appears unusually dry.',
      gpsAccuracy: '± 4 m',
      photos: ['Whole plant', 'Leaf', 'Habitat'],
    },
    {
      id: 'OBS007',
      plantId: 'PL006',
      recordedBy: 'Botanist02',
      height: '16.8 m',
      growthStage: 'Mature',
      health: 'Healthy',
      location: 'Limestone Buffer Transect',
      observedAt: '3 Oct 2026, 09:35',
      submittedAt: '3 Oct 2026',
      status: 'Pending Review',
      morphology: 'Straight bole with fissured bark; elliptic leaves and winged fruit recorded.',
      notes: 'Submitted with a linked request for a proposed new Shorea species.',
      gpsAccuracy: '± 4 m',
      photos: ['Whole Plant', 'Leaf', 'Bark', 'Fruit', 'Habitat'],
    },
  ] as Observation[],
  devices: [
    {
      id: 'SEN001',
      name: 'Canopy Climate A1',
      type: 'Environmental',
      plantId: 'PL001',
      zone: 'Zone A',
      status: 'Online',
      installedAt: '12 Aug 2026',
      lastReading: '3 Oct 2026, 10:15',
    },
    {
      id: 'SEN002',
      name: 'Motion Guard A2',
      type: 'Motion',
      plantId: 'PL002',
      zone: 'Zone A',
      status: 'Online',
      installedAt: '15 Aug 2026',
      lastReading: '3 Oct 2026, 10:12',
    },
    {
      id: 'SEN003',
      name: 'Soil Node B1',
      type: 'Soil & Climate',
      plantId: 'PL003',
      zone: 'Zone B',
      status: 'Maintenance',
      installedAt: '20 Aug 2026',
      lastReading: '2 Oct 2026, 16:40',
    },
    {
      id: 'SEN004',
      name: 'Climate Station C4',
      type: 'Environmental',
      plantId: 'PL005',
      zone: 'Zone C',
      status: 'Offline',
      installedAt: '25 Aug 2026',
      lastReading: '2 Oct 2026, 03:22',
    },
  ] as SensorDevice[],
  readings: [
    {
      id: 'READ001',
      sensorId: 'SEN001',
      plantId: 'PL001',
      temperature: '27.4°C',
      humidity: '86%',
      soilMoisture: '64%',
      rainfall: '2.1 mm',
      light: '410 lux',
      motion: 'No Movement',
      gps: '3.81248, 113.78142',
      recordedAt: '3 Oct 2026, 10:15',
    },
    {
      id: 'READ002',
      sensorId: 'SEN002',
      plantId: 'PL002',
      temperature: '28.1°C',
      humidity: '82%',
      soilMoisture: '—',
      rainfall: '—',
      light: '—',
      motion: 'Detected',
      gps: '3.81092, 113.77983',
      recordedAt: '3 Oct 2026, 10:12',
    },
    {
      id: 'READ003',
      sensorId: 'SEN003',
      plantId: 'PL003',
      temperature: '29.3°C',
      humidity: '79%',
      soilMoisture: '48%',
      rainfall: '0 mm',
      light: '680 lux',
      motion: 'No Movement',
      gps: '3.80674, 113.78711',
      recordedAt: '2 Oct 2026, 16:40',
    },
    {
      id: 'READ004',
      sensorId: 'SEN004',
      plantId: 'PL005',
      temperature: '34.8°C',
      humidity: '62%',
      soilMoisture: '31%',
      rainfall: '0 mm',
      light: '920 lux',
      motion: 'No Movement',
      gps: '3.79886, 113.79502',
      recordedAt: '2 Oct 2026, 03:22',
    },
  ] as SensorReading[],
  alerts: [
    {
      id: 'A001',
      type: 'Movement Detected',
      plantId: 'PL002',
      sensorId: 'SEN002',
      zone: 'Zone A',
      severity: 'High',
      status: 'New',
      detectedAt: '3 Oct 2026, 10:12',
      reading: 'Motion detected for 48 seconds near protected buffer.',
      notes: [],
    },
    {
      id: 'A002',
      type: 'High Temperature',
      plantId: 'PL005',
      sensorId: 'SEN004',
      zone: 'Zone C',
      severity: 'High',
      status: 'Reviewing',
      detectedAt: '2 Oct 2026, 03:22',
      reading: '34.8°C; threshold 32°C. Soil moisture 31%.',
      notes: ['Ranger patrol requested by Officer01.'],
    },
    {
      id: 'A003',
      type: 'Sensor Offline',
      plantId: 'PL005',
      sensorId: 'SEN004',
      zone: 'Zone C',
      severity: 'Medium',
      status: 'New',
      detectedAt: '2 Oct 2026, 04:00',
      reading: 'No telemetry received after 03:22.',
      notes: [],
    },
    {
      id: 'A004',
      type: 'Low Soil Moisture',
      plantId: 'PL003',
      sensorId: 'SEN003',
      zone: 'Zone B',
      severity: 'Low',
      status: 'Resolved',
      detectedAt: '30 Sep 2026, 13:40',
      reading: 'Soil moisture fell below 45%.',
      notes: ['Checked after rainfall; reading returned to normal.'],
    },
  ] as ThreatAlert[],
})

export const speciesForPlant = (plantId: string) => {
  const plant = conservationStore.plants.find((item) => item.id === plantId)
  if (!plant?.speciesId) return undefined
  return conservationStore.species.find((item) => item.id === plant.speciesId)
}

export const speciesRequestForPlant = (plantId: string) => {
  const plant = conservationStore.plants.find((item) => item.id === plantId)
  if (!plant?.speciesRequestId) return undefined
  return conservationStore.speciesRequests.find((request) => request.id === plant.speciesRequestId)
}

export const plantFor = (plantId: string) =>
  conservationStore.plants.find((item) => item.id === plantId)
