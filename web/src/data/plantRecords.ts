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
    commonsImage('Cyathea contaminans var persquamulifera Alderw nmnhbotany 2148795 NMNH-00139202-000001.jpg'),
    commonsImage('Cyathea.jpg'),
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

export const plantRecords: PlantRecord[] = [
  record('PL001', 'tropical-pitcher-plant', 'SP001', 'Tropical Pitcher Plant', 'Nepenthes rafflesiana', 'A', 80, 'Healthy', 'Mature', 1),
  record('PL014', 'tropical-pitcher-plant', 'SP001', 'Tropical Pitcher Plant', 'Nepenthes rafflesiana', 'B', 64, 'Healthy', 'Juvenile', 2),
  record('PL026', 'tropical-pitcher-plant', 'SP001', 'Tropical Pitcher Plant', 'Nepenthes rafflesiana', 'C', 91, 'Monitoring', 'Mature', 3),
  record('PL032', 'wild-ginger', 'SP002', 'Wild Ginger', 'Etlingera elatior', 'A', 178, 'Healthy', 'Flowering', 4),
  record('PL041', 'wild-ginger', 'SP002', 'Wild Ginger', 'Etlingera elatior', 'B', 152, 'Healthy', 'Mature', 5),
  record('PL053', 'tree-fern', 'SP003', 'Tree Fern', 'Cyathea contaminans', 'B', 320, 'Healthy', 'Mature', 6),
  record('PL061', 'tree-fern', 'SP003', 'Tree Fern', 'Cyathea contaminans', 'C', 245, 'Healthy', 'Juvenile', 7),
  record('PL074', 'borneo-orchid', 'SP004', 'Borneo Orchid', 'Phalaenopsis bellina', 'A', 34, 'Healthy', 'Flowering', 8),
  record('PL082', 'borneo-orchid', 'SP004', 'Borneo Orchid', 'Phalaenopsis bellina', 'C', 29, 'Monitoring', 'Mature', 9),
  record('PL093', 'rattan-palm', 'SP005', 'Rattan Palm', 'Calamus manan', 'A', 410, 'Healthy', 'Mature', 10),
  record('PL107', 'rattan-palm', 'SP005', 'Rattan Palm', 'Calamus manan', 'B', 285, 'Healthy', 'Juvenile', 11),
  record('PL118', 'forest-shrub', 'SP006', 'Forest Shrub', 'Syzygium grande', 'B', 196, 'Healthy', 'Mature', 12),
  record('PL126', 'forest-shrub', 'SP006', 'Forest Shrub', 'Syzygium grande', 'C', 143, 'Healthy', 'Juvenile', 13),
]
