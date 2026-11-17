function normalizedQuery(value) {
  return String(value ?? "").trim().toLowerCase();
}

function includesQuery(query, values) {
  return values.some((value) => normalizedQuery(value).includes(query));
}

export function submissionGroupMatchesSearch(group, tab, searchText) {
  const query = normalizedQuery(searchText);
  if (!query) return true;
  const record = group?.record || {};
  const versions = Array.isArray(group?.versions) ? group.versions : [];

  if (tab === "plants") {
    const species = record.speciesDetails || record.species || {};
    const values = [record.plantScientificName, record.scientificName, record.plantCommonName,
      record.commonName, record.name, record.id, record.plantId, record.zone,
      record.location?.zone, species.scientificName, species.commonName, species.name];
    for (const version of versions) {
      const snapshot = version.snapshot || {};
      values.push(version.title, version.commonName, snapshot.scientific_name, snapshot.scientificName,
        snapshot.common_name, snapshot.commonName, snapshot.content?.zone, snapshot.zone);
    }
    return includesQuery(query, values);
  }

  const values = [record.scientific_name, record.scientificName, record.family_name, record.family,
    record.genus_name, record.genus, record.request_id];
  for (const version of versions) {
    const snapshot = version.snapshot || {};
    values.push(version.title, snapshot.scientific_name, snapshot.scientificName,
      snapshot.family_name, snapshot.family, snapshot.genus_name, snapshot.genus);
  }
  return includesQuery(query, values);
}
