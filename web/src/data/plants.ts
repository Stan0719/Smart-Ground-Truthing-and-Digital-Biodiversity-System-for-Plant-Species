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

export const plants: Plant[] = [
  {
    speciesId: 'SP001',
    slug: 'tropical-pitcher-plant',
    name: 'Tropical Pitcher Plant',
    scientificName: 'Nepenthes rafflesiana',
    genus: 'Nepenthes',
    category: 'Climbers',
    family: 'Nepenthaceae',
    localName: 'Periuk kera',
    conservationStatus: 'Not evaluated',
    sensitivityLevel: 'Sensitive',
    description: 'A remarkable carnivorous plant whose colourful pitchers trap insects in nutrient-poor soils.',
    overview: 'The tropical pitcher plant is one of Borneo’s most distinctive carnivorous plants. Its leaves form specialised, fluid-filled pitchers that attract and capture small insects, helping the plant obtain nutrients that are scarce in the surrounding soil.',
    habitat: 'It grows in humid lowland forest, heath forest, and open areas with acidic, nutrient-poor soil. Around Niah, it may occur where sunlight reaches damp vegetation near the forest edge.',
    distribution: 'Native to Borneo, Peninsular Malaysia, Singapore, and Sumatra in suitable humid, nutrient-poor habitats.',
    ecologicalRole: 'Its pitchers capture insects and form tiny aquatic habitats for specialised organisms, contributing to the rainforest food web.',
    culturalSignificance: 'Pitcher plants are widely recognised in Borneo as symbols of the island’s extraordinary plant diversity.',
    characteristics: ['Hanging, vase-shaped pitchers', 'Red, green, or mottled colouring', 'A climbing growth habit', 'Nectar-producing pitcher rim'],
    significance: 'Pitcher plants are an important example of rainforest adaptation and support small ecological communities inside their pitchers.',
    image: commonsImage('Nepenthes rafflesiana.jpg'),
    images: [
      { path: commonsImage('Nepenthes rafflesiana.jpg'), caption: 'Mature pitcher' },
      { path: commonsImage("Raffles' Pitcher Plant (Nepenthes rafflesiana) (15589450910).jpg"), caption: 'Pitcher in natural habitat' },
      { path: commonsImage('Nepenthes rafflesiana with Dischidia.jpg'), caption: 'Climbing growth habit' },
    ],
    niahDistribution: { knownOccurrences: 12, zones: ['A', 'B', 'C'], publicNote: 'Public locations are shown by general monitoring zone to protect sensitive occurrences.' },
  },
  {
    speciesId: 'SP002',
    slug: 'wild-ginger',
    name: 'Wild Ginger',
    scientificName: 'Etlingera elatior',
    genus: 'Etlingera',
    category: 'Flowers',
    family: 'Zingiberaceae',
    localName: 'Kantan',
    conservationStatus: 'Not evaluated',
    sensitivityLevel: 'Standard',
    description: 'A striking rainforest herb recognised by its tall stems and waxy pink flower heads.',
    overview: 'Wild ginger brings vivid colour to the shaded rainforest floor. Its large flower head grows on a separate stalk close to the ground, while tall leafy shoots rise above it.',
    habitat: 'This species thrives in warm, wet forest margins, stream banks, and disturbed rainforest areas where the soil remains rich and moist.',
    distribution: 'Occurs across tropical Southeast Asia in moist lowland habitats, forest margins, and stream banks.',
    ecologicalRole: 'Its flowers provide nectar and pollen for insects, while dense growth offers cover within moist forest-edge habitats.',
    culturalSignificance: 'The aromatic flower buds and young shoots of torch ginger are used in regional cuisine and traditional practices.',
    characteristics: ['Large pink or red flower heads', 'Tall leafy stems', 'Aromatic underground rhizomes', 'Dense clumping growth'],
    significance: 'Wild ginger provides nectar and shelter for rainforest insects and has long been valued in local food and cultural traditions.',
    image: commonsImage('Etlingera elatior-0001 09.jpg'),
    images: [
      { path: commonsImage('Etlingera elatior-0001 09.jpg'), caption: 'Flower head' },
      { path: commonsImage('Etlingera elatior ( black background ).jpg'), caption: 'Flower detail' },
      { path: commonsImage('MCBG Etlingera elatior 02.JPG'), caption: 'Leaf and stem structure' },
    ],
    niahDistribution: { knownOccurrences: 8, zones: ['A', 'B'], publicNote: 'Occurrences are summarised from approved prototype records.' },
  },
  {
    speciesId: 'SP003',
    slug: 'tree-fern',
    name: 'Tree Fern',
    scientificName: 'Cyathea contaminans',
    genus: 'Cyathea',
    category: 'Ferns',
    family: 'Cyatheaceae',
    localName: 'Paku tiang',
    conservationStatus: 'Not evaluated',
    sensitivityLevel: 'Standard',
    description: 'An ancient forest plant with an elegant crown of arching fronds above a slender trunk.',
    overview: 'Tree ferns give the rainforest an ancient appearance. Unlike flowering trees, they reproduce through spores and form a crown of finely divided fronds at the top of an upright trunk.',
    habitat: 'They favour humid, shaded places with consistently moist soil, including forest slopes, gullies, and areas close to streams.',
    distribution: 'Found in humid forests across parts of Southeast Asia, particularly on moist slopes, gullies, and forest edges.',
    ecologicalRole: 'Tree ferns help maintain humid understory conditions and provide surfaces for mosses, epiphytes, and small forest organisms.',
    culturalSignificance: 'Tree ferns are familiar elements of Southeast Asian forest landscapes and are valued for their distinctive ancient form.',
    characteristics: ['Tall fibrous trunk', 'Broad arching fronds', 'Coiled young fiddleheads', 'Spore-producing leaf undersides'],
    significance: 'Their trunks and fronds create shelter for insects, mosses, and epiphytic plants within the cool forest understory.',
    image: commonsImage('Cyathea contaminans var persquamulifera Alderw nmnhbotany 2148795 NMNH-00139202-000001.jpg'),
    images: [
      { path: commonsImage('Cyathea contaminans var persquamulifera Alderw nmnhbotany 2148795 NMNH-00139202-000001.jpg'), caption: 'Tree fern specimen' },
      { path: commonsImage('Cyathea.jpg'), caption: 'Tree fern botanical form' },
      { path: commonsImage('Cyathea contaminans var persquamulifera Alderw nmnhbotany 2148795 NMNH-00139202-000001.jpg'), caption: 'Frond detail' },
    ],
    niahDistribution: { knownOccurrences: 6, zones: ['B', 'C'], publicNote: 'Occurrences are displayed at zone level only.' },
  },
  {
    speciesId: 'SP004',
    slug: 'borneo-orchid',
    name: 'Borneo Orchid',
    scientificName: 'Phalaenopsis bellina',
    genus: 'Phalaenopsis',
    category: 'Flowers',
    family: 'Orchidaceae',
    localName: 'Orkid Borneo',
    conservationStatus: 'Not evaluated',
    sensitivityLevel: 'Sensitive',
    description: 'A fragrant native orchid with delicate pale petals and vivid magenta markings.',
    overview: 'This elegant orchid is native to Borneo and is admired for its star-shaped, fragrant flowers. It grows as an epiphyte, resting on trees without taking nutrients directly from its host.',
    habitat: 'It prefers warm, humid lowland rainforest with filtered light and good air circulation, often growing on mossy branches above the forest floor.',
    distribution: 'Native to Borneo, where it grows as an epiphyte in warm, humid lowland forest.',
    ecologicalRole: 'As an epiphyte, this orchid adds diversity to the forest canopy and depends on specialised pollinators and healthy host trees.',
    culturalSignificance: 'Native orchids are valued for their beauty and are important ambassadors for responsible plant conservation.',
    characteristics: ['Cream-green petals', 'Magenta flower centre', 'Broad glossy leaves', 'Sweet floral fragrance'],
    significance: 'Borneo’s orchids demonstrate the extraordinary specialisation of rainforest plants and the importance of conserving mature forest habitat.',
    image: commonsImage('Phalaenopsis bellina Orchi 201.jpg'),
    images: [
      { path: commonsImage('Phalaenopsis bellina Orchi 201.jpg'), caption: 'Flower detail' },
      { path: commonsImage('Phalaenopsis bellina (Rchb.f.) Christenson, Brittonia 47 58 (1995) (48320280212).jpg'), caption: 'Flower and leaves' },
      { path: commonsImage("Phalaenopsis bellina '1901' (Rchb.f.) Christenson- Brittonia 47- 58 (1995). 20210706 210900.jpg"), caption: 'Mature flowering plant' },
    ],
    niahDistribution: { knownOccurrences: 5, zones: ['A', 'C'], publicNote: 'Exact locations are withheld to protect sensitive orchid occurrences.' },
  },
  {
    speciesId: 'SP005',
    slug: 'rattan-palm',
    name: 'Rattan Palm',
    scientificName: 'Calamus manan',
    genus: 'Calamus',
    category: 'Climbers',
    family: 'Arecaceae',
    localName: 'Rotan manau',
    conservationStatus: 'Not evaluated',
    sensitivityLevel: 'Standard',
    description: 'A climbing palm that winds through the rainforest canopy using long, hooked stems.',
    overview: 'Rattan is a climbing palm that uses hooked structures to pull itself upward through surrounding vegetation. Its long, flexible stem can extend for great distances beneath the canopy.',
    habitat: 'It occurs in tropical lowland and hill rainforest, especially where established trees provide support for its climbing stems.',
    distribution: 'Occurs in tropical forests of parts of Southeast Asia, climbing into surrounding vegetation in lowland and hill forest.',
    ecologicalRole: 'Climbing rattan contributes to the structure of the forest understory and its fruits can provide food for wildlife.',
    culturalSignificance: 'Its strong flexible cane has long been used for furniture, basketry, binding, and traditional handicrafts.',
    characteristics: ['Long flexible cane', 'Hooked climbing structures', 'Feather-like palm leaves', 'Clustered fruits'],
    significance: 'Rattan is ecologically valuable and has also been used for generations as a durable material for weaving and handicrafts.',
    image: commonsImage('Buah Manau.JPG'),
    images: [
      { path: commonsImage('Buah Manau.JPG'), caption: 'Rattan fruit and foliage' },
      { path: commonsImage('Buah Manau.JPG'), caption: 'Climbing palm habit' },
      { path: commonsImage('Buah Manau.JPG'), caption: 'Rattan identification detail' },
    ],
    niahDistribution: { knownOccurrences: 9, zones: ['A', 'B', 'C'], publicNote: 'Occurrences are summarised by monitoring zone.' },
  },
  {
    speciesId: 'SP006',
    slug: 'forest-shrub',
    name: 'Forest Shrub',
    scientificName: 'Syzygium grande',
    genus: 'Syzygium',
    category: 'Trees',
    family: 'Myrtaceae',
    localName: 'Kelat',
    conservationStatus: 'Not evaluated',
    sensitivityLevel: 'Standard',
    description: 'A tropical evergreen known for glossy leaves, copper-red new growth, and pale blossoms.',
    overview: 'This evergreen member of the myrtle family develops attractive copper-red new leaves that gradually turn deep green. Its small pale flowers appear in clusters and are rich in pollen.',
    habitat: 'It grows in tropical forest and coastal environments, adapting well to warm temperatures, high rainfall, and bright forest openings.',
    distribution: 'Occurs in tropical forest and coastal habitats in parts of Southeast Asia, including Borneo.',
    ecologicalRole: 'Its flowers support pollinating insects and its fleshy fruits provide food for birds and other forest animals.',
    culturalSignificance: 'Syzygium species are familiar components of regional forests and some relatives are valued for timber, shade, food, or traditional uses.',
    characteristics: ['Glossy evergreen foliage', 'Copper-red young leaves', 'Clusters of pale flowers', 'Fleshy berry-like fruits'],
    significance: 'Its flowers and fruits provide food for insects, birds, and other forest wildlife, strengthening the rainforest food web.',
    image: commonsImage('Syzygium grande bloom.jpg'),
    images: [
      { path: commonsImage('Syzygium grande bloom.jpg'), caption: 'Flower clusters' },
      { path: commonsImage('Fruits of Syzygium grande.jpg'), caption: 'Fruits and mature foliage' },
      { path: commonsImage('Syzygium grande bloom.jpg'), caption: 'Mature flowering canopy' },
    ],
    niahDistribution: { knownOccurrences: 7, zones: ['B', 'C'], publicNote: 'Occurrences are based on approved prototype records and shown at zone level.' },
  },
]
