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

export const getSpeciesImageSource = (species, imagePath) => {
  if (!imagePath && speciesImages[species?.slug]) {
    return speciesImages[species.slug];
  }

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
    localSpeciesImagePaths[species?.slug]?.[resolvedImage] ||
    { uri: resolvedImage }
  );
};
