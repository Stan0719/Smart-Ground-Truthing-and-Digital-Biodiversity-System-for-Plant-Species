export function normalizeSpeciesName(value) {
  return String(value ?? "").normalize("NFC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en");
}
