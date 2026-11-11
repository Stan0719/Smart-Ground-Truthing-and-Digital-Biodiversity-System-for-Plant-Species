export const speciesImages = {
  "tropical-pitcher-plant": require("../assets/species/tropical-pitcher-plant.jpg"),
  "wild-ginger": require("../assets/species/wild-ginger.jpg"),
  "tree-fern": require("../assets/species/treefern.png"),
  "borneo-orchid": require("../assets/species/borneo-orchid.jpg"),
  "rattan-palm": require("../assets/species/rattan-palm.jpg"),
  "forest-shrub": require("../assets/species/forest-shrub.jpg"),
};

const localSpeciesImagePaths = {
  "tree-fern": {
    "/images/treefern.png": speciesImages["tree-fern"],
  },
};

const localSpeciesByScientificName = {
  "nepenthes rafflesiana": "tropical-pitcher-plant",
  "etlingera elatior": "wild-ginger",
  "cyathea contaminans": "tree-fern",
  "phalaenopsis bellina": "borneo-orchid",
  "calamus manan": "rattan-palm",
  "syzygium grande": "forest-shrub",
};

const speciesImageKey = (value) => typeof value === "string"
  ? value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  : "";

function localSpeciesKey(species) {
  const slug = speciesImageKey(species?.slug);
  if (Object.hasOwn(speciesImages, slug)) return slug;
  const scientificName = typeof species?.scientificName === "string"
    ? species.scientificName.trim().toLowerCase()
    : typeof species?.scientific_name === "string"
      ? species.scientific_name.trim().toLowerCase()
      : "";
  return localSpeciesByScientificName[scientificName] || null;
}

export const getSpeciesImageSource = (species, imagePath, {
  allowUnmappedRemote = true,
  preferVerifiedBackend = true,
} = {}) => {
  if (!imagePath && preferVerifiedBackend && species?.speciesImageVerified && species.image) {
    return species.image;
  }

  const localKey = localSpeciesKey(species);
  if (!imagePath && localKey) {
    return speciesImages[localKey];
  }

  // Callers can require a verified backend image or explicit local mapping;
  // arbitrary remote paths are not accepted in that mode.
  if (allowUnmappedRemote === false) return null;

  const resolvedImage =
    imagePath ||
    species?.image ||
    species?.images?.find((image) => image?.path)?.path ||
    null;

  if (!resolvedImage) return null;

  if (typeof resolvedImage === "number") {
    return resolvedImage;
  }

  if (typeof resolvedImage === "object") {
    return resolvedImage;
  }

  return (
    localSpeciesImagePaths[localKey]?.[resolvedImage] ||
    { uri: resolvedImage }
  );
};
