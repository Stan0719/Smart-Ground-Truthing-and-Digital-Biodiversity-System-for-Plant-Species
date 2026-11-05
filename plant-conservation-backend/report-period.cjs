"use strict";
const timezone = "Asia/Kuala_Lumpur";
const day = 86400000;
function bad() { throw Object.assign(Error("Use a supported reporting period and valid start/end dates (maximum 100 years)."), {status: 400}); }
function date(value) {
  if (typeof value !== "string" || !/^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$/.test(value)) bad();
  const parsed = Date.parse(value + "T00:00:00Z");
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value || value.startsWith("9999")) bad();
  return parsed;
}
const nextDate = value => new Date(date(value) + day).toISOString().slice(0, 10);
// Resolve a local calendar midnight using the IANA zone, independent of host TZ.
function midnight(value) {
  const target = date(value);
  let instant = target;
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {timeZone: timezone,
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"})
      .formatToParts(new Date(instant)).map(p => [p.type, p.value]));
    const local = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    instant += target - local;
  }
  return new Date(instant).toISOString();
}
function reportPeriod(query, now = new Date()) {
  if (Object.keys(query).some(k => !["period", "start", "end"].includes(k))) bad();
  const period = query.period ?? "all-time";
  if (!["all-time", "this-month", "last-month", "custom"].includes(period)) bad();
  let startDate = null, endDate = null;
  if (period === "custom") {
    date(query.start); date(query.end);
    if (query.start > query.end || date(query.end) > Date.UTC(Number(query.start.slice(0, 4)) + 100, Number(query.start.slice(5, 7)) - 1, Number(query.start.slice(8, 10)))) bad();
    startDate = query.start; endDate = query.end;
  } else {
    if (query.start !== undefined || query.end !== undefined) bad();
    if (period !== "all-time") {
      const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {timeZone: timezone, year: "numeric", month: "2-digit"})
        .formatToParts(now).map(p => [p.type, p.value]));
      const month = Date.UTC(+parts.year, +parts.month - 1 - (period === "last-month" ? 1 : 0), 1);
      startDate = new Date(month).toISOString().slice(0, 10);
      endDate = new Date(Date.UTC(new Date(month).getUTCFullYear(), new Date(month).getUTCMonth() + 1, 1) - day).toISOString().slice(0, 10);
    }
  }
  return {period, timezone, startDate, endDate,
    startInclusive: startDate ? midnight(startDate) : null,
    endExclusive: endDate ? midnight(nextDate(endDate)) : null};
}
module.exports = {reportPeriod};
