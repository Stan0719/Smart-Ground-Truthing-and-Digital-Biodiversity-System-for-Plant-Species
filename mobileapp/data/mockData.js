export const plants = [
  {
    id: "PLANT001",
    scientificName: "Nepenthes ampullaria",
    commonName: "Common Pitcher Plant",
    family: "Nepenthaceae",
    genus: "Nepenthes",
    species: "N. ampullaria",
    height: "45 cm",

    description:
      "Nepenthes ampullaria is a tropical pitcher plant commonly found in lowland forests. It produces ground-level pitchers that collect insects and other organic material.",

    morphology:
      "The plant has rosette leaves with short pitchers growing close to the ground. The pitchers are usually green with reddish markings.",

    conservationStatus: "Least Concern",

    culturalSignificance:
      "Pitcher plants are an important part of the biodiversity and natural heritage of Borneo.",

    latitude: 3.8196,
    longitude: 113.7673,

    image: require("../assets/plant1.png"),

    botanist: "Alice",
    syncStatus: "Synced",
  },

  {
    id: "PLANT002",
    scientificName: "Shorea parvifolia",
    commonName: "Meranti",
    family: "Dipterocarpaceae",
    genus: "Shorea",
    species: "S. parvifolia",
    height: "2.4 m",

    description:
      "Shorea parvifolia is a tropical forest tree species found in Southeast Asian forests.",

    morphology:
      "The species has a tall trunk, broad leaves and a spreading crown.",

    conservationStatus: "Vulnerable",

    culturalSignificance:
      "Dipterocarp trees are important components of Bornean rainforest ecosystems.",

    latitude: 3.8201,
    longitude: 113.7681,

    image: require("../assets/plant2.png"),

    botanist: "Alice",
    syncStatus: "Pending Sync",
  },

  {
    id: "PLANT003",
    scientificName: "Ficus variegata",
    commonName: "Common Red-Stem Fig",
    family: "Moraceae",
    genus: "Ficus",
    species: "F. variegata",
    height: "3.1 m",

    description:
      "Ficus variegata is a tropical fig tree that provides food for many forest animals.",

    morphology:
      "The tree has large green leaves and distinctive fruits that develop directly on the trunk and branches.",

    conservationStatus: "Least Concern",

    culturalSignificance:
      "Fig trees play an important ecological role by providing food for wildlife.",

    latitude: 3.821,
    longitude: 113.7692,

    image: require("../assets/plant3.png"),

    botanist: "Bob",
    syncStatus: "Synced",
  },
];

export const botanists = [
  {
    username: "alice",
    password: "123456",
    name: "Alice",
  },

  {
    username: "bob",
    password: "123456",
    name: "Bob",
  },
];