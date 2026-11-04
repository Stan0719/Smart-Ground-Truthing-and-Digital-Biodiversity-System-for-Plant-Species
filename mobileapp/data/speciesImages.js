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

export const getSpeciesImageSource = (species, imagePath, {
  allowUnmappedRemote = true,
  preferVerifiedBackend = true,
} = {}) => {
  if (!imagePath && preferVerifiedBackend && species?.speciesImageVerified && species.image) {
    return species.image;
  }

  if (!imagePath && speciesImages[species?.slug]) {
    return speciesImages[species.slug];
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
    localSpeciesImagePaths[species?.slug]?.[resolvedImage] ||
    { uri: resolvedImage }
  );
};
