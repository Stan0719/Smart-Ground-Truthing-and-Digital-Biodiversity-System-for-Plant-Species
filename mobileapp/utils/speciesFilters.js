export function getSpeciesFamilyOptions(species) {
  return [...new Set((Array.isArray(species) ? species : [])
    .map((item) => item?.family)
    .filter((family) => typeof family === "string" && family.trim().length > 0))]
    .sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
}

export function resetMissingSpeciesFamily(family, options) {
  return family !== null && !options.includes(family) ? null : family;
}

export function filterAndSortSpecies(species, { family = null, query = "", sortOption = "default" } = {}) {
  const search = String(query).trim().toLowerCase();
  const filtered = (Array.isArray(species) ? species : []).filter((item) => {
    const matchesFamily = family === null || item.family === family;
    const matchesSearch = !search || [item.name, item.scientificName, item.genus, item.family, item.description]
      .some((value) => typeof value === "string" && value.toLowerCase().includes(search));
    return matchesFamily && matchesSearch;
  });

  const sorted = [...filtered];
  if (sortOption === "name-asc") sorted.sort((a, b) => a.name.localeCompare(b.name));
  if (sortOption === "name-desc") sorted.sort((a, b) => b.name.localeCompare(a.name));
  if (sortOption === "scientific-asc") sorted.sort((a, b) => a.scientificName.localeCompare(b.scientificName));
  return sorted;
}
