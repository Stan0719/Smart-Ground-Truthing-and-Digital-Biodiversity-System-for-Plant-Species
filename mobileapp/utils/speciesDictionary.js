import { plantApi } from "./plantApi";

export function normalizeSpeciesSuggestions(payload) {
  if (!payload || !Array.isArray(payload.results)) throw new Error("Invalid species search response.");
  return payload.results.filter((row) => row && typeof row.scientificName === "string" && typeof row.sourceUrl === "string")
    .map((row) => ({ ...row, commonName: row.commonName || "", family: row.family || "", rank: row.rank || "", description: row.description || "" }));
}

export async function searchSpeciesDictionary(query) {
  const value = String(query || "").trim();
  if (value.length < 2 || value.length > 100) throw new Error("Invalid search text.");
  return normalizeSpeciesSuggestions(await plantApi(`/species-dictionary?q=${encodeURIComponent(value)}`));
}

export function planSpeciesFieldUpdates(suggestion, fields) {
  const scientificName = suggestion.scientificName;
  const commonName = suggestion.commonName;
  const genus = scientificName.split(/\s+/)[0];
  const values = {
    scientificName, commonName, genus, family: suggestion.family, description: suggestion.description,
    plantScientificName: scientificName,
    speciesScientificName: scientificName,
    speciesCommonName: commonName,
    speciesGenus: genus,
    speciesFamily: suggestion.family,
  };
  return Object.entries(fields).flatMap(([key, field]) => {
    const value = values[key];
    return typeof value === "string" && value.trim() ? [{ key, label: field.label, value: value.trim(), current: field.value || "" }] : [];
  });
}

export function applySpeciesFieldUpdates(updates, fields, replace = false) {
  const applied = [];
  for (const update of updates) {
    const field = fields[update.key];
    if (!field || typeof field.setValue !== "function" || (!replace && String(field.value || "").trim())) continue;
    field.setValue(update.value); applied.push(update.key);
  }
  return applied;
}

export function commitSpeciesReview(updates, fields, { confirmed = false, replace = false } = {}) {
  if (!confirmed) return [];
  return applySpeciesFieldUpdates(updates, fields, replace);
}

export function speciesReviewRows(updates) {
  return updates.map(({ key, label, value, current }) => ({
    key,
    label: label || key,
    value,
    current,
    italic: ["scientificName", "genus", "plantScientificName", "speciesScientificName", "speciesGenus"].includes(key),
  }));
}
