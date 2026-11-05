"use strict";
const origins = ["initial_registration", "subsequent_observation", "unknown"];
const statuses = ["Draft", "Pending Review", "Approved", "Rejected", "Correction Required", "Flagged"];
const idPattern = /^(?:[1-9][0-9]{0,18}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i;
function queueOptions(query, fail) {
  const enabled = ["origin_type", "status", "limit", "cursor"].some(key => Object.hasOwn(query, key));
  if (!enabled) return null;
  for (const key of ["origin_type", "status", "limit", "cursor"])
    if (query[key] !== undefined && typeof query[key] !== "string") fail(400, "Invalid observation pagination arguments.");
  const origin = query.origin_type || "", status = query.status || "", scope = query.scope === "mine" ? "mine" : "";
  const limit = query.limit === undefined ? 100 : Number(query.limit);
  if ((query.origin_type !== undefined && !origins.includes(origin)) ||
      (query.status !== undefined && !statuses.includes(status)) ||
      !Number.isInteger(limit) || limit < 1 || limit > 200 ||
      (query.limit !== undefined && !/^[1-9][0-9]*$/.test(query.limit))) fail(400, "Invalid observation origin, status or page limit (1–200).");
  let cursor = null;
  if (query.cursor !== undefined) {
    try {
      if (!/^[A-Za-z0-9_-]{1,1500}$/.test(query.cursor)) throw Error();
      cursor = JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8"));
      if (!cursor || cursor.v !== 1 || cursor.origin !== origin || cursor.status !== status || cursor.scope !== scope ||
          typeof cursor.id !== "string" || !idPattern.test(cursor.id) || typeof cursor.at !== "string" ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(cursor.at) ||
          !Number.isFinite(Date.parse(cursor.at)) || new Date(cursor.at).toISOString().slice(0, 19) !== cursor.at.slice(0, 19)) throw Error();
    } catch { fail(400, "Invalid observation cursor. Reload this queue."); }
  }
  return { origin, status, scope, limit, cursor };
}
function queuePage(rows, options, hasMore) {
  const last = rows.at(-1);
  return {
    limit: options.limit, scanned_count: rows.length, has_more: hasMore,
    next_cursor: hasMore && last ? Buffer.from(JSON.stringify({ v: 1, at: last.queue_created_at, id: last.id,
      origin: options.origin, status: options.status, scope: options.scope })).toString("base64url") : null,
  };
}
module.exports = { queueOptions, queuePage };
