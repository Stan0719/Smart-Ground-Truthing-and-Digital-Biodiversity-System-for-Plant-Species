// Species proposals never depend on individual plant fields or identifiers.
export function validateSpeciesRequest(data) {
  const names = ["scientific_name", "common_name", "genus_name", "family_name", "conservation_status"];
  for (const key of [...names, "description", "habitat"]) {
    if (typeof data[key] !== "string" || !data[key].trim()) return `speciesMissing_${key}`;
    if (data[key].trim().length > (names.includes(key) ? 200 : 4000)) return "speciesTextTooLong";
  }
  if (!data.photoUri) return "speciesMissing_photo";
  return null;
}

export function validatePlantDetails({ species, newSpecies = false, plantScientificName, height, healthStatus, growthStage, morphology }) {
  if (!newSpecies && (!species || !/^[1-9]\d*$/.test(String(species.id)))) return "chooseExistingSpecies";
  if (typeof plantScientificName !== "string" || !plantScientificName.trim()) return "plantScientificNameRequired";
  if (plantScientificName.trim().length > 200) return "plantScientificNameTooLong";
  if (!Number.isFinite(Number(height)) || Number(height) <= 0 || Number(height) > 100000) return "invalidHeight";
  if (!healthStatus.trim() || !growthStage.trim() || !morphology.trim()) return "plantFieldsRequired";
  if (healthStatus.trim().length > 100 || growthStage.trim().length > 100 || morphology.trim().length > 4000) return "plantTextTooLong";
  return null;
}
