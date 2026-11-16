"use strict";
const { transaction, fail } = require("./domain.cjs");
const { visibilityFor } = require("../shared/rbac.cjs");
const observationIdPattern = /^(?:[1-9][0-9]{0,18}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;

function historyPage(query, observationId) {
  if (Object.keys(query).some(key => !["limit", "cursor"].includes(key))) fail(400, "Invalid review history pagination.");
  const limit = query.limit === undefined ? 50 : Number(query.limit);
  if ((query.limit !== undefined && (typeof query.limit !== "string" || !/^[1-9][0-9]*$/.test(query.limit))) ||
      !Number.isInteger(limit) || limit < 1 || limit > 100) fail(400, "Invalid review history limit.");
  let cursor = null;
  if (query.cursor !== undefined) {
    try {
      if (typeof query.cursor !== "string" || !/^[A-Za-z0-9_-]{1,2000}$/.test(query.cursor)) throw Error();
      cursor = JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8"));
      if (cursor?.observation !== observationId || typeof cursor.id !== "string" || !cursor.id || cursor.id.length > 200 ||
          typeof cursor.at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(cursor.at) ||
          (!Number.isFinite(Date.parse(cursor.at)) || new Date(cursor.at).toISOString().slice(0,19) !== cursor.at.slice(0,19))) throw Error();
    } catch { fail(400, "Invalid review history cursor."); }
  }
  return { limit, cursor };
}

function mountObservationReviewHistory(app, { pool, allow }) {
  // The existing Officer review capability authorizes this narrow read. Self-review
  // restrictions belong to the write handler and do not hide an Officer's history.
  app.get("/api/observations/:id/reviews", allow("observations.review"), async (req, res) => {
    const observationId = req.params.id;
    if (!observationIdPattern.test(observationId)) fail(400, "Invalid observation identifier.");
    const { limit, cursor } = historyPage(req.query, observationId);
    const result = await transaction(pool, async c => {
      // Match the Officer observation read's parent joins and visibility policy.
      const parent = (await c.query(`SELECT o.id FROM plant_observation o
        JOIN plant_record p ON p.plant_id=o.plant_id JOIN species s ON s.species_id=p.species_id
        LEFT JOIN rbac_species_visibility v ON v.species_id=p.species_id
        WHERE o.id=$1 AND COALESCE(v.visibility,'protected')=ANY($2::text[])`,
      [observationId, visibilityFor(req.user)])).rows[0];
      if (!parent) fail(404, "Observation unavailable.");
      const rows = (await c.query(`SELECT id,observation_id,decision,reviewer_subject,comment,
          to_jsonb(observation_review)->>'review_origin' AS review_origin,
          to_jsonb(observation_review)->>'species_request_id' AS species_request_id,
          to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
        FROM observation_review WHERE observation_id=$1
          AND ($2::timestamptz IS NULL OR (created_at,id)<($2::timestamptz,$3::text))
        ORDER BY observation_review.created_at DESC,id DESC LIMIT $4`,
      [observationId, cursor?.at ?? null, cursor?.id ?? "", limit + 1])).rows;
      const reviews = rows.slice(0, limit).map(row => row.review_origin === null && row.species_request_id === null ? Object.fromEntries(Object.entries(row).filter(([key]) => !["review_origin", "species_request_id"].includes(key))) : row), last = reviews.at(-1), hasMore = rows.length > limit;
      return { observation_id: observationId, reviews, page: { limit, has_more: hasMore,
        next_cursor: hasMore ? Buffer.from(JSON.stringify({ observation: observationId, at: last.created_at, id: last.id })).toString("base64url") : null } };
    });
    res.json(result);
  });
}
module.exports = { mountObservationReviewHistory };
