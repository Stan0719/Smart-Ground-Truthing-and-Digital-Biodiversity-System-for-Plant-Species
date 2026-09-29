export type PlantCategory = 'Trees' | 'Flowers' | 'Ferns' | 'Climbers'

export interface Plant {
  slug: string
  name: string
  scientificName: string
  category: PlantCategory
  description: string
  overview: string
  habitat: string
  characteristics: string[]
  significance: string
}

export const plants: Plant[] = [
  {
    slug: 'tropical-pitcher-plant',
    name: 'Tropical Pitcher Plant',
    scientificName: 'Nepenthes rafflesiana',
    category: 'Climbers',
    description: 'A remarkable carnivorous plant whose colourful pitchers trap insects in nutrient-poor soils.',
    overview: 'The tropical pitcher plant is one of Borneo’s most distinctive carnivorous plants. Its leaves form specialised, fluid-filled pitchers that attract and capture small insects, helping the plant obtain nutrients that are scarce in the surrounding soil.',
    habitat: 'It grows in humid lowland forest, heath forest, and open areas with acidic, nutrient-poor soil. Around Niah, it may be found where sunlight reaches damp vegetation near the forest edge.',
    characteristics: ['Hanging, vase-shaped pitchers', 'Red, green, or mottled colouring', 'A climbing growth habit', 'Nectar-producing pitcher rim'],
    significance: 'Pitcher plants are an important example of rainforest adaptation and support small ecological communities inside their pitchers.',
  },
  {
    slug: 'wild-ginger',
    name: 'Wild Ginger',
    scientificName: 'Etlingera elatior',
    category: 'Flowers',
    description: 'A striking rainforest herb recognised by its tall stems and waxy pink flower heads.',
    overview: 'Wild ginger brings vivid colour to the shaded rainforest floor. Its large flower head grows on a separate stalk close to the ground, while tall leafy shoots rise above it.',
    habitat: 'This species thrives in warm, wet forest margins, stream banks, and disturbed rainforest areas where the soil remains rich and moist.',
    characteristics: ['Large pink or red flower heads', 'Tall leafy stems', 'Aromatic underground rhizomes', 'Dense clumping growth'],
    significance: 'Wild ginger provides nectar and shelter for rainforest insects, while related ginger species have long been valued in local food and cultural traditions.',
  },
  {
    slug: 'tree-fern',
    name: 'Tree Fern',
    scientificName: 'Cyathea contaminans',
    category: 'Ferns',
    description: 'An ancient forest plant with an elegant crown of arching fronds above a slender trunk.',
    overview: 'Tree ferns give the rainforest an ancient appearance. Unlike flowering trees, they reproduce through spores and form a crown of finely divided fronds at the top of an upright trunk.',
    habitat: 'They favour humid, shaded places with consistently moist soil, including forest slopes, gullies, and areas close to streams.',
    characteristics: ['Tall fibrous trunk', 'Broad arching fronds', 'Coiled young fiddleheads', 'Spore-producing leaf undersides'],
    significance: 'Their trunks and fronds create shelter for insects, mosses, and epiphytic plants while contributing to the cool, moist forest understory.',
  },
  {
    slug: 'borneo-orchid',
    name: 'Borneo Orchid',
    scientificName: 'Phalaenopsis bellina',
    category: 'Flowers',
    description: 'A fragrant native orchid with delicate pale petals and vivid magenta markings.',
    overview: 'This elegant orchid is native to Borneo and is admired for its star-shaped, fragrant flowers. It grows as an epiphyte, resting on trees without taking nutrients directly from its host.',
    habitat: 'It prefers warm, humid lowland rainforest with filtered light and good air circulation, often growing on mossy branches above the forest floor.',
    characteristics: ['Cream-green petals', 'Magenta flower centre', 'Broad glossy leaves', 'Sweet floral fragrance'],
    significance: 'Borneo’s orchids demonstrate the extraordinary specialisation of rainforest plants and the importance of conserving mature forest habitat.',
  },
  {
    slug: 'rattan-palm',
    name: 'Rattan Palm',
    scientificName: 'Calamus manan',
    category: 'Climbers',
    description: 'A climbing palm that winds through the rainforest canopy using long, hooked stems.',
    overview: 'Rattan is a climbing palm that uses hooked structures to pull itself upward through surrounding vegetation. Its long, flexible stem can extend for great distances beneath the canopy.',
    habitat: 'It occurs in tropical lowland and hill rainforest, especially where established trees provide support for its climbing stems.',
    characteristics: ['Long flexible cane', 'Hooked climbing structures', 'Feather-like palm leaves', 'Clustered fruits'],
    significance: 'Rattan is ecologically valuable and has also been used for generations as a durable material for weaving, furniture, and handicrafts.',
  },
  {
    slug: 'forest-shrub',
    name: 'Forest Shrub',
    scientificName: 'Syzygium grande',
    category: 'Trees',
    description: 'A tropical evergreen known for glossy leaves, copper-red new growth, and pale blossoms.',
    overview: 'This evergreen member of the myrtle family develops attractive copper-red new leaves that gradually turn deep green. Its small pale flowers appear in clusters and are rich in pollen.',
    habitat: 'It grows in tropical forest and coastal environments, adapting well to warm temperatures, high rainfall, and bright forest openings.',
    characteristics: ['Glossy evergreen foliage', 'Copper-red young leaves', 'Clusters of pale flowers', 'Fleshy berry-like fruits'],
    significance: 'Its flowers and fruits provide food for insects, birds, and other forest wildlife, strengthening the rainforest food web.',
  },
]
