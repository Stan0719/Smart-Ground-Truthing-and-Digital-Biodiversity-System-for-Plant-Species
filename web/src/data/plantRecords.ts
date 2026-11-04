import {reactive} from 'vue'
export type ObservationStatus = 'Approved' | 'Pending' | 'Rejected'

export interface PlantObservation {
  observationId: string
  date: string
  recordedBy: string
  status: ObservationStatus
  heightCm: number
  healthStatus: string
  lifeStage: string
  morphology: string
  notes: string
  images?: { path?: string; caption?: string }[]
}

export interface PlantRecord {
  plantId: string
  speciesSlug: string
  speciesId: string
  speciesName: string
  commonName: string
  latestApproved: Omit<PlantObservation, 'observationId' | 'recordedBy' | 'status'>
  location: { zone: string; latitude: number; longitude: number; altitudeM: number; accuracyM: number }
  qr: { code: string; status: string }
  registeredBy: string
  registeredAt: string
  images: { path?: string; caption?: string }[]
  observations: PlantObservation[]
}

const commonsImage = (fileName: string) =>
  `https://commons.wikimedia.org/wiki/Special:Redirect/file/${encodeURIComponent(fileName)}?width=1200`

const prototypeImages: Record<string, string[]> = {
  'tropical-pitcher-plant': [
    commonsImage('Nepenthes rafflesiana.jpg'),
    commonsImage("Raffles' Pitcher Plant (Nepenthes rafflesiana) (15589450910).jpg"),
  ],
  'wild-ginger': [
    commonsImage('Etlingera elatior-0001 09.jpg'),
    commonsImage('MCBG Etlingera elatior 02.JPG'),
  ],
  'tree-fern': [
    '/images/treefern.png',
    '/images/treefern.png',
  ],
  'borneo-orchid': [
    commonsImage('Phalaenopsis bellina Orchi 201.jpg'),
    commonsImage('Phalaenopsis bellina (Rchb.f.) Christenson, Brittonia 47 58 (1995) (48320280212).jpg'),
  ],
  'rattan-palm': [commonsImage('Buah Manau.JPG')],
  'forest-shrub': [
    commonsImage('Syzygium grande bloom.jpg'),
    commonsImage('Fruits of Syzygium grande.jpg'),
  ],
}

const record = (
  plantId: string,
  speciesSlug: string,
  speciesId: string,
  commonName: string,
  speciesName: string,
  zone: string,
  heightCm: number,
  healthStatus: string,
  lifeStage: string,
  offset: number,
): PlantRecord => {
  const speciesImages = prototypeImages[speciesSlug] ?? []
  const morphology = `${lifeStage} specimen with field characteristics consistent with ${speciesName}.`
  const approvedDate = `2026-09-${String(12 + offset).padStart(2, '0')}`
  const latestDate = `2026-10-${String(3 + offset).padStart(2, '0')}`

  return {
    plantId,
    speciesSlug,
    speciesId,
    speciesName,
    commonName,
    latestApproved: {
      date: latestDate,
      heightCm,
      healthStatus,
      lifeStage,
      morphology,
      notes: 'Verified during routine zone monitoring; no immediate intervention required.',
    },
    location: {
      zone: `Zone ${zone}`,
      latitude: 3.8162 + offset * 0.0017,
      longitude: 113.7814 + offset * 0.0013,
      altitudeM: 34 + offset * 3,
      accuracyM: 4 + (offset % 3),
    },
    qr: { code: `QR-${plantId.slice(2).padStart(6, '0')}`, status: 'Active' },
    registeredBy: offset % 2 ? 'Botanist02' : 'Botanist01',
    registeredAt: `2026-08-${String(10 + offset).padStart(2, '0')}`,
    images: [
      { path: speciesImages[offset % speciesImages.length], caption: 'Whole plant field record' },
      { path: speciesImages[(offset + 1) % speciesImages.length], caption: 'Identification detail' },
    ],
    observations: [
      {
        observationId: `OBS-${plantId}-01`, date: approvedDate, recordedBy: 'Botanist01', status: 'Approved',
        heightCm: Math.max(heightCm - 5, 8), healthStatus: 'Healthy', lifeStage, morphology,
        notes: 'Initial approved monitoring observation.',
      },
      {
        observationId: `OBS-${plantId}-02`, date: latestDate, recordedBy: 'Botanist02', status: 'Approved',
        heightCm, healthStatus, lifeStage, morphology,
        notes: 'Verified during routine zone monitoring; no immediate intervention required.',
      },
      {
        observationId: `OBS-${plantId}-03`, date: '2026-10-30', recordedBy: 'Botanist01', status: 'Pending',
        heightCm: heightCm + 2, healthStatus, lifeStage, morphology,
        notes: 'Awaiting officer verification; not used as the official latest record.',
      },
    ],
  }
}

export const plantRecords: PlantRecord[] = reactive([])
