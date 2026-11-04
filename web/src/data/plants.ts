import {reactive} from 'vue'
export type PlantCategory = 'Trees' | 'Flowers' | 'Ferns' | 'Climbers' | 'Uncategorized'

export interface SpeciesImage {
  path?: string
  caption?: string
}

export interface NiahDistribution {
  knownOccurrences: number
  zones: string[]
  publicNote?: string
}

export interface Plant {
  speciesId?: string
  slug: string
  name: string
  scientificName: string
  genus?: string
  category: PlantCategory
  family?: string
  localName?: string
  conservationStatus?: string
  sensitivityLevel?: string
  description: string
  overview: string
  habitat: string
  distribution?: string
  ecologicalRole?: string
  culturalSignificance?: string
  characteristics: string[]
  significance: string
  image?: string
  images?: SpeciesImage[]
  niahDistribution?: NiahDistribution
}

const commonsImage = (fileName: string) =>
  `https://commons.wikimedia.org/wiki/Special:Redirect/file/${encodeURIComponent(fileName)}?width=1200`

export const plants: Plant[] = reactive([])
