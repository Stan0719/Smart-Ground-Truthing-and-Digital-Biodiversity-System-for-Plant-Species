"use strict";
function normalizeSpeciesName(value) {
  return String(value ?? "").normalize("NFC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en");
}
const sqlSpeciesName = (expression) => `lower(regexp_replace(btrim(normalize(${expression}, NFC)), '[[:space:]]+', ' ', 'g'))`;
module.exports = { normalizeSpeciesName, sqlSpeciesName };
