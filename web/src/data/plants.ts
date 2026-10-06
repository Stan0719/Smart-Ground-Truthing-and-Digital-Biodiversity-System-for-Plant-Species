export type PlantCategory = 'Trees' | 'Flowers' | 'Ferns' | 'Climbers'

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
  slug: string
  name: string
  scientificName: string
  genus?: string
  category: PlantCategory
  family?: string
  localName?: string
  conservationStatus?: string
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

export const plants: Plant[] = [
  {
    slug: 'tropical-pitcher-plant',
    name: 'Tropical Pitcher Plant',
    scientificName: 'Nepenthes rafflesiana',
    genus: 'Nepenthes',
    category: 'Climbers',
    family: 'Nepenthaceae',
    localName: 'Periuk kera',
    conservationStatus: 'Not evaluated',
    description: 'A remarkable carnivorous plant whose colourful pitchers trap insects in nutrient-poor soils.',
    overview: 'The tropical pitcher plant is one of Borneo’s most distinctive carnivorous plants. Its leaves form specialised, fluid-filled pitchers that attract and capture small insects, helping the plant obtain nutrients that are scarce in the surrounding soil.',
    habitat: 'It grows in humid lowland forest, heath forest, and open areas with acidic, nutrient-poor soil. Around Niah, it may occur where sunlight reaches damp vegetation near the forest edge.',
    distribution: 'Native to Borneo, Peninsular Malaysia, Singapore, and Sumatra in suitable humid, nutrient-poor habitats.',
    ecologicalRole: 'Its pitchers capture insects and form tiny aquatic habitats for specialised organisms, contributing to the rainforest food web.',
    culturalSignificance: 'Pitcher plants are widely recognised in Borneo as symbols of the island’s extraordinary plant diversity.',
    characteristics: ['Hanging, vase-shaped pitchers', 'Red, green, or mottled colouring', 'A climbing growth habit', 'Nectar-producing pitcher rim'],
    significance: 'Pitcher plants are an important example of rainforest adaptation and support small ecological communities inside their pitchers.',
    images: [{ caption: 'Mature pitcher' }, { caption: 'Pitcher opening and lid' }, { caption: 'Climbing growth habit' }],
    niahDistribution: { knownOccurrences: 12, zones: ['A', 'B', 'C'], publicNote: 'Public locations are shown by general monitoring zone to protect sensitive occurrences.' },
  },
  {
    slug: 'wild-ginger',
    name: 'Wild Ginger',
    scientificName: 'Etlingera elatior',
    genus: 'Etlingera',
    category: 'Flowers',
    family: 'Zingiberaceae',
    localName: 'Kantan',
    conservationStatus: 'Not evaluated',
    description: 'A striking rainforest herb recognised by its tall stems and waxy pink flower heads.',
    overview: 'Wild ginger brings vivid colour to the shaded rainforest floor. Its large flower head grows on a separate stalk close to the ground, while tall leafy shoots rise above it.',
    habitat: 'This species thrives in warm, wet forest margins, stream banks, and disturbed rainforest areas where the soil remains rich and moist.',
    distribution: 'Occurs across tropical Southeast Asia in moist lowland habitats, forest margins, and stream banks.',
    ecologicalRole: 'Its flowers provide nectar and pollen for insects, while dense growth offers cover within moist forest-edge habitats.',
    culturalSignificance: 'The aromatic flower buds and young shoots of torch ginger are used in regional cuisine and traditional practices.',
    characteristics: ['Large pink or red flower heads', 'Tall leafy stems', 'Aromatic underground rhizomes', 'Dense clumping growth'],
    significance: 'Wild ginger provides nectar and shelter for rainforest insects and has long been valued in local food and cultural traditions.',
    images: [{ caption: 'Flower head' }, { caption: 'Leaf and stem structure' }, { caption: 'Rainforest habitat' }],
    niahDistribution: { knownOccurrences: 8, zones: ['A', 'B'], publicNote: 'Occurrences are summarised from approved prototype records.' },
  },
  {
    slug: 'tree-fern',
    name: 'Tree Fern',
    scientificName: 'Cyathea contaminans',
    genus: 'Cyathea',
    category: 'Ferns',
    family: 'Cyatheaceae',
    localName: 'Paku tiang',
    conservationStatus: 'Not evaluated',
    description: 'An ancient forest plant with an elegant crown of arching fronds above a slender trunk.',
    overview: 'Tree ferns give the rainforest an ancient appearance. Unlike flowering trees, they reproduce through spores and form a crown of finely divided fronds at the top of an upright trunk.',
    habitat: 'They favour humid, shaded places with consistently moist soil, including forest slopes, gullies, and areas close to streams.',
    distribution: 'Found in humid forests across parts of Southeast Asia, particularly on moist slopes, gullies, and forest edges.',
    ecologicalRole: 'Tree ferns help maintain humid understory conditions and provide surfaces for mosses, epiphytes, and small forest organisms.',
    culturalSignificance: 'Tree ferns are familiar elements of Southeast Asian forest landscapes and are valued for their distinctive ancient form.',
    characteristics: ['Tall fibrous trunk', 'Broad arching fronds', 'Coiled young fiddleheads', 'Spore-producing leaf undersides'],
    significance: 'Their trunks and fronds create shelter for insects, mosses, and epiphytic plants within the cool forest understory.',
    images: [{ caption: 'Mature crown of fronds' }, { caption: 'Young coiled frond' }, { caption: 'Fibrous trunk detail' }],
    niahDistribution: { knownOccurrences: 6, zones: ['B', 'C'], publicNote: 'Occurrences are displayed at zone level only.' },
  },
  {
    slug: 'borneo-orchid',
    name: 'Borneo Orchid',
    scientificName: 'Phalaenopsis bellina',
    genus: 'Phalaenopsis',
    category: 'Flowers',
    family: 'Orchidaceae',
    localName: 'Orkid Borneo',
    conservationStatus: 'Not evaluated',
    description: 'A fragrant native orchid with delicate pale petals and vivid magenta markings.',
    overview: 'This elegant orchid is native to Borneo and is admired for its star-shaped, fragrant flowers. It grows as an epiphyte, resting on trees without taking nutrients directly from its host.',
    habitat: 'It prefers warm, humid lowland rainforest with filtered light and good air circulation, often growing on mossy branches above the forest floor.',
    distribution: 'Native to Borneo, where it grows as an epiphyte in warm, humid lowland forest.',
    ecologicalRole: 'As an epiphyte, this orchid adds diversity to the forest canopy and depends on specialised pollinators and healthy host trees.',
    culturalSignificance: 'Native orchids are valued for their beauty and are important ambassadors for responsible plant conservation.',
    characteristics: ['Cream-green petals', 'Magenta flower centre', 'Broad glossy leaves', 'Sweet floral fragrance'],
    significance: 'Borneo’s orchids demonstrate the extraordinary specialisation of rainforest plants and the importance of conserving mature forest habitat.',
    images: [{ caption: 'Flower detail' }, { caption: 'Broad glossy leaves' }, { caption: 'Epiphytic growth on a host tree' }],
    niahDistribution: { knownOccurrences: 5, zones: ['A', 'C'], publicNote: 'Exact locations are withheld to protect sensitive orchid occurrences.' },
  },
  {
    slug: 'rattan-palm',
    name: 'Rattan Palm',
    scientificName: 'Calamus manan',
    genus: 'Calamus',
    category: 'Climbers',
    family: 'Arecaceae',
    localName: 'Rotan manau',
    conservationStatus: 'Not evaluated',
    description: 'A climbing palm that winds through the rainforest canopy using long, hooked stems.',
    overview: 'Rattan is a climbing palm that uses hooked structures to pull itself upward through surrounding vegetation. Its long, flexible stem can extend for great distances beneath the canopy.',
    habitat: 'It occurs in tropical lowland and hill rainforest, especially where established trees provide support for its climbing stems.',
    distribution: 'Occurs in tropical forests of parts of Southeast Asia, climbing into surrounding vegetation in lowland and hill forest.',
    ecologicalRole: 'Climbing rattan contributes to the structure of the forest understory and its fruits can provide food for wildlife.',
    culturalSignificance: 'Its strong flexible cane has long been used for furniture, basketry, binding, and traditional handicrafts.',
    characteristics: ['Long flexible cane', 'Hooked climbing structures', 'Feather-like palm leaves', 'Clustered fruits'],
    significance: 'Rattan is ecologically valuable and has also been used for generations as a durable material for weaving and handicrafts.',
    images: [{ caption: 'Climbing palm habit' }, { caption: 'Hooked climbing structures' }, { caption: 'Rattan cane and leaves' }],
    niahDistribution: { knownOccurrences: 9, zones: ['A', 'B', 'C'], publicNote: 'Occurrences are summarised by monitoring zone.' },
  },
  {
    slug: 'forest-shrub',
    name: 'Forest Shrub',
    scientificName: 'Syzygium grande',
    genus: 'Syzygium',
    category: 'Trees',
    family: 'Myrtaceae',
    localName: 'Kelat',
    conservationStatus: 'Not evaluated',
    description: 'A tropical evergreen known for glossy leaves, copper-red new growth, and pale blossoms.',
    overview: 'This evergreen member of the myrtle family develops attractive copper-red new leaves that gradually turn deep green. Its small pale flowers appear in clusters and are rich in pollen.',
    habitat: 'It grows in tropical forest and coastal environments, adapting well to warm temperatures, high rainfall, and bright forest openings.',
    distribution: 'Occurs in tropical forest and coastal habitats in parts of Southeast Asia, including Borneo.',
    ecologicalRole: 'Its flowers support pollinating insects and its fleshy fruits provide food for birds and other forest animals.',
    culturalSignificance: 'Syzygium species are familiar components of regional forests and some relatives are valued for timber, shade, food, or traditional uses.',
    characteristics: ['Glossy evergreen foliage', 'Copper-red young leaves', 'Clusters of pale flowers', 'Fleshy berry-like fruits'],
    significance: 'Its flowers and fruits provide food for insects, birds, and other forest wildlife, strengthening the rainforest food web.',
    images: [{ caption: 'Copper-red new growth' }, { caption: 'Flower clusters' }, { caption: 'Mature foliage' }],
    niahDistribution: { knownOccurrences: 7, zones: ['B', 'C'], publicNote: 'Occurrences are based on approved prototype records and shown at zone level.' },
  },
]
