"use strict";

const BASE = "https://api.inaturalist.org/v1/taxa/autocomplete";
const clean = (value, max = 400) => typeof value === "string" ? value.trim().slice(0, max) : "";
const lastRequestByUser = new Map();
let lastUpstreamRequest = 0;

function projectTaxa(body) {
  if (!body || !Array.isArray(body.results)) throw Object.assign(Error("Invalid biodiversity response."), { status: 502 });
  return body.results.slice(0, 10).filter((taxon) => taxon && Number.isInteger(taxon.id) && typeof taxon.name === "string").map((taxon) => ({
    id: taxon.id,
    scientificName: clean(taxon.name, 200),
    commonName: clean(taxon.preferred_common_name || taxon.english_common_name, 200),
    rank: clean(taxon.rank, 80),
    family: clean(taxon.ancestors?.find?.((item) => item.rank === "family")?.name || taxon.family, 200),
    description: clean(taxon.wikipedia_summary || taxon.description, 500),
    sourceName: "iNaturalist",
    sourceUrl: `https://www.inaturalist.org/taxa/${taxon.id}`,
  }));
}

function mountSpeciesDictionary(app, { allow, fetchImpl = fetch } = {}) {
  app.get("/api/species-dictionary", allow("plants.create"), async (req, res, next) => {
    if (req.user?.role !== "Botanist") return res.status(403).json({ error: "Botanist access required." });
    const query = clean(req.query.q);
    if (query.length < 2 || query.length > 100) return res.status(400).json({ error: "Enter between 2 and 100 characters." });
    const now = Date.now(); const previous = lastRequestByUser.get(req.user.id) || 0;
    if (now - previous < 1100 || now - lastUpstreamRequest < 1100) return res.status(429).json({ error: "Please wait before searching again." });
    if (lastRequestByUser.size > 10000) for (const [userId, requestedAt] of lastRequestByUser) if (now - requestedAt > 60000) lastRequestByUser.delete(userId);
    lastRequestByUser.set(req.user.id, now);
    lastUpstreamRequest = now;
    const url = new URL(BASE); url.searchParams.set("q", query); url.searchParams.set("per_page", "10");
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const response = await fetchImpl(url, { headers: { Accept: "application/json", "User-Agent": "BotanistMobileSpeciesDictionary/1.0" }, signal: controller.signal });
      if (response.status === 429) return res.status(429).json({ error: "Species search is temporarily rate limited." });
      if (!response.ok) return res.status(502).json({ error: "Species source is temporarily unavailable." });
      const result = projectTaxa(await response.json());
      return res.json({ sourceName: "iNaturalist", results: result });
    } catch (error) { return next(error.status ? error : Object.assign(Error("Species source is temporarily unavailable."), { status: 502 })); }
    finally { clearTimeout(timer); }
  });
}

module.exports = { mountSpeciesDictionary, projectTaxa };
