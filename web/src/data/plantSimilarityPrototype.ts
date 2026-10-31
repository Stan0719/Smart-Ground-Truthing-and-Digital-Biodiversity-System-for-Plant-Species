export type PlantSimilarityCandidate = {
  rank: number
  plantId: string
  observationId?: string
  scientificName?: string
  commonName?: string
  similarity: number
  distanceMeters?: number
}

export type PlantSimilarityAnalysis = {
  observationId: string
  plantId: string
  highestSimilarity: number
  status: 'available' | 'unavailable'
  candidates: PlantSimilarityCandidate[]
}

export const plantSimilarityPrototype: PlantSimilarityAnalysis[] = [
  {
    observationId: 'OBS001',
    plantId: 'PL001',
    highestSimilarity: 0.94,
    status: 'available',
    candidates: [
      { rank: 1, plantId: 'PL014', observationId: 'OBS014', scientificName: 'Nepenthes ampullaria', commonName: 'Flask-shaped Pitcher Plant', similarity: 0.94, distanceMeters: 3.8 },
      { rank: 2, plantId: 'PL008', observationId: 'OBS008', scientificName: 'Nepenthes rafflesiana', commonName: "Raffles' Pitcher Plant", similarity: 0.89, distanceMeters: 8400 },
      { rank: 3, plantId: 'PL021', observationId: 'OBS021', scientificName: 'Nepenthes mirabilis', commonName: 'Common Swamp Pitcher Plant', similarity: 0.84, distanceMeters: 420 },
      { rank: 4, plantId: 'PL027', observationId: 'OBS027', scientificName: 'Nepenthes gracilis', commonName: 'Slender Pitcher Plant', similarity: 0.79, distanceMeters: 42 },
      { rank: 5, plantId: 'PL032', observationId: 'OBS032', scientificName: 'Nepenthes reinwardtiana', commonName: "Reinwardt's Pitcher Plant", similarity: 0.74 },
    ],
  },
  {
    observationId: 'OBS002',
    plantId: 'PL002',
    highestSimilarity: 0.87,
    status: 'available',
    candidates: [
      { rank: 1, plantId: 'PL018', observationId: 'OBS018', scientificName: 'Shorea parvifolia', commonName: 'Light Red Meranti', similarity: 0.87, distanceMeters: 8400 },
      { rank: 2, plantId: 'PL024', observationId: 'OBS024', scientificName: 'Shorea leprosula', commonName: 'Red Meranti', similarity: 0.83, distanceMeters: 42 },
      { rank: 3, plantId: 'PL031', observationId: 'OBS031', scientificName: 'Shorea macroptera', commonName: 'Melantai', similarity: 0.8, distanceMeters: 420 },
      { rank: 4, plantId: 'PL037', observationId: 'OBS037', scientificName: 'Shorea ovalis', commonName: 'Meranti Kepong', similarity: 0.76, distanceMeters: 7.2 },
      { rank: 5, plantId: 'PL044', observationId: 'OBS044', scientificName: 'Hopea odorata', commonName: 'Merawan Siput Jantan', similarity: 0.72, distanceMeters: 2150 },
    ],
  },
  {
    observationId: 'OBS003',
    plantId: 'PL003',
    highestSimilarity: 0.78,
    status: 'available',
    candidates: [
      { rank: 1, plantId: 'PL011', observationId: 'OBS011', scientificName: 'Dipterocarpus grandiflorus', commonName: 'Keruing Belimbing', similarity: 0.78, distanceMeters: 42 },
      { rank: 2, plantId: 'PL016', observationId: 'OBS016', scientificName: 'Dipterocarpus baudii', commonName: 'Keruing Bulu', similarity: 0.75, distanceMeters: 3.8 },
      { rank: 3, plantId: 'PL029', observationId: 'OBS029', scientificName: 'Dipterocarpus costulatus', commonName: 'Keruing Bukit', similarity: 0.71, distanceMeters: 420 },
      { rank: 4, plantId: 'PL035', observationId: 'OBS035', scientificName: 'Dipterocarpus crinitus', commonName: 'Keruing Mempening', similarity: 0.68, distanceMeters: 8400 },
      { rank: 5, plantId: 'PL041', observationId: 'OBS041', scientificName: 'Dipterocarpus verrucosus', commonName: 'Keruing Tembaga', similarity: 0.64, distanceMeters: 1250 },
    ],
  },
]

export const plantSimilarityByObservation = new Map(
  plantSimilarityPrototype.map((analysis) => [analysis.observationId, analysis]),
)
