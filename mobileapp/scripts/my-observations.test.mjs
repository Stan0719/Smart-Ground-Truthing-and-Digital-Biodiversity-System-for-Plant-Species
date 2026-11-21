import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildObservationHistoryRows, displayObservationId, fetchMyObservations, observationHistoryRoute, observationMatchesFilter, observationMatchesSearch, observationStatusSummary, retainVisibleObservationExpansion, toggleObservationExpansion, withObservationPhotoSources } from "../utils/myObservations.js";

const dashboard = readFileSync(new URL("../screens/BotanistDashboard.js", import.meta.url), "utf8");
const app = readFileSync(new URL("../App.js", import.meta.url), "utf8");
const screen = readFileSync(new URL("../screens/BotanistMyObservations.js", import.meta.url), "utf8");
const detail = readFileSync(new URL("../screens/NotificationObservation.js", import.meta.url), "utf8");
const utility = readFileSync(new URL("../utils/myObservations.js", import.meta.url), "utf8");
const detailUtility = readFileSync(new URL("../utils/observationDetails.js", import.meta.url), "utf8");

test("observation edit capabilities and listing start while observation pages are still pending", async () => {
  let finishObservations;
  const page = new Promise((resolve) => { finishObservations = resolve; });
  const calls = [];
  const loading = fetchMyObservations("owner", "Owner", async (path) => {
    calls.push(path);
    if (path.startsWith("/observations?")) return page;
    if (path.endsWith("/capabilities")) return { available: true };
    assert.equal(path, "/observation-edits");
    return { edits: [] };
  });
  await new Promise(setImmediate);
  assert.ok(calls.some((path) => path.startsWith("/observations?")));
  assert.ok(calls.includes("/observation-edits"));
  finishObservations({ observations: [] });
  assert.deepEqual((await loading).observations, []);
});

test("verified Observation revisions keep their own statuses, reviews, and navigation targets", () => {
  const observation = { id: "field-1", status: "Approved", date: "2026-11-16T00:00:00Z", content: {} };
  const versions = [
    { id: "original-1", version_number: 1, submission_type: "original", status: "Superseded",
      verified: true, content: { notes: "Original" }, photo_ids: ["photo-1"], review_comment: "Correct this" },
    { id: "correction-2", version_number: 2, submission_type: "correction_resubmission", status: "Approved",
      verified: true, content: { notes: "Corrected" }, photo_ids: ["photo-2"], review_comment: "Accepted" },
  ];
  const rows = buildObservationHistoryRows(observation, { versions, edits: [] });
  assert.deepEqual(rows.map(row => [row.versionId, row.status, row.reviewComment]),
    [["original-1", "Superseded", "Correct this"], ["correction-2", "Approved", "Accepted"]]);
  assert.equal(rows.length, 2, "verified history must not invent another original");
  assert.equal(rows[1].current, true);
  const [originalRoute, originalParams] = observationHistoryRoute(observation, rows[0]);
  assert.equal(originalRoute, "NotificationObservation");
  assert.equal(originalParams.observationVersionId, "original-1");
  assert.equal(originalParams.editRequestId, undefined, "Original navigation never routes through an edit request");
  assert.equal(originalParams.observationVersionSnapshot.original, true);
  assert.match(detail, /selectedVersion\?\.status \|\| selectedEdit\?\.status/);
});

test("dashboard positions My Observations between submissions and drafts with its own route", () => {
  const submissions = dashboard.indexOf('testID="dashboard-submissions"');
  const observations = dashboard.indexOf('testID="dashboard-my-observations"');
  const drafts = dashboard.indexOf('testID="dashboard-my-draft"');
  assert.ok(submissions >= 0 && submissions < observations && observations < drafts);
  assert.match(dashboard, /navigate\("BotanistMyObservations", \{ botanist \}\)/);
  assert.match(app, /name="BotanistMyObservations"/);
  assert.match(screen, /navigation\.navigate\(\.\.\.observationHistoryRoute\(item, row\)\)/);
  assert.match(screen, /const observationFilters = \["all", "pending", "approved", "rejected"\]/);
  assert.match(screen, /testID=\{`observations-filter-\$\{value\}`\}/);
  assert.match(screen, /observation-group-toggle-/);
  assert.match(screen, /observation-version-/);
  assert.match(utility, /observationVersionId: row\.versionId/);
  assert.match(utility, /observationVersionSnapshot:/);
  assert.match(screen, /navigation\.navigate\(\.\.\.observationHistoryRoute\(item, row\)\)/);
  assert.match(screen, /item\.displayId \|\| item\.id/);
  assert.doesNotMatch(screen, /observationDetails|activityHistory|viewDetailsButton|styles\.feedback/);
  assert.match(detail, /ownedNotificationObservation\(accountId, observationId\)/);
  assert.match(detail, /observationVersionId/);
  assert.match(detailUtility, /selectedSnapshot\?\.content/);
});

test("only Correction Requests uses the dashboard warning palette", () => {
  assert.match(dashboard, /qrCard: \{ backgroundColor: "#E2F0E4"/);
  assert.match(dashboard, /addPlantCard: \{ backgroundColor: "#D6E9D9"/);
  assert.match(dashboard, /submissionsCard: \{ backgroundColor: "#D6E9D9"/);
  assert.match(dashboard, /observationsCard: \{ backgroundColor: "#E2F0E4"/);
  assert.match(dashboard, /myDraftCard: \{ backgroundColor: "#E8EDDA"/);
  assert.match(dashboard, /correctionsCard: \{ backgroundColor: "#F5E4D5"/);
});

test("loader uses only creator-scoped observations, including pending records on another Botanist's plant", async () => {
  const ownPending = { id: "pending-1", plant_id: 12, owner_subject: "staff:bot-a", status: "Pending Review", created_at: "2026-11-10T10:00:00Z", updated_at: "2026-11-10T10:00:00Z", common_name: "Fern", scientific_name: "Fernus example", content: { healthStatus: "Healthy" } };
  const ownDraft = { ...ownPending, id: "draft-0", status: "Draft" };
  const ownPendingOnOtherPlant = { id: "pending-2", plant_id: 99, owner_subject: "staff:bot-a", status: "Pending Review", created_at: "2026-11-10T11:00:00Z", updated_at: "2026-11-10T11:00:00Z", common_name: "Tree", scientific_name: "Arbor example", content: { healthStatus: "Good" } };
  const calls = [];
  const api = async (path, options) => {
    calls.push({ path, options });
    if (path.includes("scope=mine")) return { observations: [ownPending, ownDraft, ownPendingOnOtherPlant], page: { next_cursor: null } };
    if (path === "/observation-edits/capabilities") return { available: false };
    if (path === "/notifications") return { notifications: [
      { id: "submitted", type: "observation_submitted", observationId: "pending-1", createdAt: "2026-11-10T10:00:00Z" },
      { id: "other-owner", type: "correction_requested", observationId: "other-3", createdAt: "2026-11-10T12:00:00Z" },
    ] };
    throw new Error(`Unexpected route ${path}`);
  };

  const result = await fetchMyObservations("bot-a", "Botanist A", api);
  assert.deepEqual(result.observations.map((row) => row.id), ["pending-2", "pending-1"]);
  assert.equal(result.observations[0].plantId, "99");
  assert.equal(result.observations[0].recordedBy, "Botanist A");
  assert.equal(result.observations[1].healthStatus, "Healthy");
  assert.equal(result.observations[1].displayId, "pending-1");
  assert.equal(calls.some((call) => call.path === "/notifications"), false, "timeline remains loaded by Observation Details only");
  assert.ok(calls.every((call) => call.options.expectedAccountId === "bot-a"));
  assert.ok(calls.filter((call) => call.path.startsWith("/observations?")).every((call) => call.path.includes("scope=mine")));
});

test("withdrawn original Observations remain visible in the Botanist all-history list", async () => {
  const withdrawn = { id: "withdrawn-observation", plant_id: 24, owner_subject: "staff:bot-a", status: "Withdrawn",
    origin_type: "subsequent_observation", created_at: "2026-11-14T10:00:00Z", content: { notes: "Retained history" } };
  const api = async (path) => {
    if (path.includes("/observations?")) return { observations: [withdrawn], page: { next_cursor: null } };
    if (path === "/observation-edits/capabilities") return { available: false };
    throw Error(`Unexpected route ${path}`);
  };
  const result = await fetchMyObservations("bot-a", "Botanist A", api);
  assert.equal(result.observations.length, 1);
  assert.equal(result.observations[0].status, "Withdrawn");
  assert.equal(result.observations[0].content.notes, "Retained history");
  assert.equal(observationMatchesFilter(result.observations[0], "all"), true);
});

test("page refreshes on pull, and offers distinct loading, empty and error states", () => {
  assert.match(screen, /RefreshControl/);
  assert.match(screen, /myObservations\.loading/);
  assert.match(screen, /myObservations\.noObservations/);
  assert.match(screen, /myObservations\.loadFailed/);
  assert.match(screen, /common\.tryAgain/);
});

test("My Observations cards expand independently and retain expansion only while visible", () => {
  const observations = [
    { id: "a", status: "Approved" },
    { id: "b", status: "Pending Review" },
    { id: "c", status: "Rejected" },
  ];
  let expandedIds = new Set();
  expandedIds = toggleObservationExpansion(expandedIds, "a");
  assert.deepEqual([...expandedIds], ["a"], "opening A expands A");
  expandedIds = toggleObservationExpansion(expandedIds, "b");
  assert.deepEqual([...expandedIds], ["a", "b"], "opening B leaves A expanded");
  expandedIds = toggleObservationExpansion(expandedIds, "c");
  assert.deepEqual([...expandedIds], ["a", "b", "c"], "opening C leaves A and B expanded");
  expandedIds = toggleObservationExpansion(expandedIds, "b");
  assert.deepEqual([...expandedIds], ["a", "c"], "tapping B again collapses only B");
  assert.deepEqual([...retainVisibleObservationExpansion(expandedIds, observations, "all")], ["a", "c"], "refresh retains visible expansions");
  assert.deepEqual([...retainVisibleObservationExpansion(new Set(["a", "b", "c"]), observations, "pending")], ["b"], "filtering removes expansions for hidden cards");
  assert.deepEqual([...retainVisibleObservationExpansion(new Set(["missing", "a"]), observations, "all")], ["a"], "removed records collapse on refresh");
  assert.deepEqual([...retainVisibleObservationExpansion(new Set(["a", "b"]), observations, "all", "plant 22")], [], "search hides and collapses nonmatching cards");
  assert.equal(observationMatchesSearch({ scientificName: "Shorea leprosula", plantId: "22", id: "obs-abc", displayId: "OBS-ABC" }, "  SHOREA LEP "), true);
  assert.equal(observationMatchesSearch({ scientificName: "Shorea leprosula", plantId: "22", id: "obs-abc" }, "22"), true);
  assert.equal(observationMatchesSearch({ id: "abc-123" }, "123"), true, "Observation ID can be searched by partial match");
  assert.equal(observationMatchesSearch({ id: "abc-123" }, "missing"), false);
  assert.match(screen, /setExpandedIds\(\(currentIds\) => toggleObservationExpansion\(currentIds, item\.id\)\)/);
  assert.match(screen, /retainVisibleObservationExpansion\(currentIds, observations, filterRef\.current, searchRef\.current\)/);
  assert.match(screen, /retainVisibleObservationExpansion\(currentIds, items, value, searchRef\.current\)/);
  assert.match(screen, /observationMatchesSearch\(item, searchQuery\)/);
  assert.match(screen, /testID="observations-search"/);
  assert.equal((screen.match(/testID="observations-search"/g) || []).length, 1);
  assert.ok(screen.indexOf('testID="observations-search"') < screen.indexOf('testID={`observations-filter-${value}`}'));
  assert.match(screen, /setSearchQuery\(""\)/);
  assert.match(screen, /const expanded = expandedIds\.has\(item\.id\)/);
  assert.match(screen, /keyExtractor=\{\(item\) => item\.id\}/);
});

test("My Observations search strings are localized in English, Malay and Chinese", () => {
  for (const languageCode of ["en", "ms", "zh"]) {
    const language = JSON.parse(readFileSync(new URL(`../translations/${languageCode}.json`, import.meta.url), "utf8"));
    assert.ok(language.myObservations.searchPlaceholder);
    assert.ok(language.myObservations.noMatchingObservations);
  }
});

test("each Observation card keeps only its own ordered photos, including observations on the same Plant", async () => {
  const row = (id, assets) => ({ id, plant_id: 24, owner_subject: "staff:bot-a", status: "Approved",
    created_at: "2026-11-10T10:00:00Z", assets });
  const photo = (id) => ({ id, content_type: "image/jpeg" });
  const api = async (path) => path.startsWith("/observations?") ? { observations: [
    row("one", [photo("photo-one")]),
    row("many", [photo("photo-many-1"), { id: "not-image", content_type: "application/pdf" }, photo("photo-many-2")]),
    row("none", []),
    row("other", [photo("photo-other")]),
  ], page: { next_cursor: null } } : { available: false };
  const { observations } = await fetchMyObservations("bot-a", "Botanist A", api);
  let calls = 0;
  const resolved = await withObservationPhotoSources(observations, "bot-a", async (assets, accountId, options) => {
    calls += 1;
    assert.equal(accountId, "bot-a");
    assert.deepEqual(options, { ownSubmission: true });
    assert.deepEqual(assets.map((asset) => asset.id), observations.flatMap((item) => item.assets.map((asset) => asset.id)));
    return assets.map((asset) => ({ uri: `/api/assets/${asset.id}?scope=mine`, headers: { Authorization: "Bearer test" } }));
  });
  assert.equal(calls, 1, "all Observation photos use one authenticated source resolution");
  const byId = Object.fromEntries(resolved.map((item) => [item.id, item]));
  assert.deepEqual(byId.one.thumbnailSources.map((source) => source.uri), ["/api/assets/photo-one?scope=mine"]);
  assert.deepEqual(byId.many.thumbnailSources.map((source) => source.uri), ["/api/assets/photo-many-1?scope=mine", "/api/assets/photo-many-2?scope=mine"]);
  assert.deepEqual(byId.none.thumbnailSources, []);
  assert.deepEqual(byId.other.thumbnailSources.map((source) => source.uri), ["/api/assets/photo-other?scope=mine"]);
  assert.equal(byId.one.plantId, byId.other.plantId, "the two observations share a Plant but not a photo");
  assert.match(screen, /<ObservationThumbnail key=\{item\.thumbnailSources\?\.map\(\(source\) => source\.uri\)\.join\("\|"\) \|\| "none"\} sources=\{item\.thumbnailSources\}/);
  assert.match(screen, /onError=\{\(\) => setPhotoIndex\(\(index\) => index \+ 1\)\}/);
  assert.match(screen, /setExpandedIds\(\(currentIds\) => toggleObservationExpansion\(currentIds, item\.id\)\)/);
  assert.ok(screen.indexOf("<ObservationThumbnail") < screen.indexOf("{expanded && <View style={styles.versionList}>"),
    "the thumbnail remains in the card header when version rows expand or collapse");
  assert.match(screen, /thumbnail: \{ width: 58, height: 68, borderRadius: 12 \}/);
});

test("unavailable or invalid Observation photos leave cards with the leaf placeholder", async () => {
  const items = [{ id: "one", assets: [{ id: "bad" }] }, { id: "two", assets: [] }];
  const failed = await withObservationPhotoSources(items, "bot-a", async () => { throw new Error("offline"); });
  assert.deepEqual(failed.map((item) => item.thumbnailSources), [[], []]);
  const invalid = await withObservationPhotoSources(items, "bot-a", async () => [{ uri: "" }]);
  assert.deepEqual(invalid.map((item) => item.thumbnailSources), [[], []]);
  assert.match(screen, /name="leaf-outline"/);
});

test("pending edit stays associated with the creator's approved observation and its real history events", async () => {
  const observation = { id: "obs-7", plant_id: 45, owner_subject: "staff:bot-b", status: "Approved",
    created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-02T10:00:00Z", content: { morphology: "Approved leaves" } };
  const api = async (path) => path.startsWith("/observations?") ? { observations: [observation], page: { next_cursor: null } }
    : path === "/observation-edits/capabilities" ? { available: true }
      : path === "/observation-edits" ? { edits: [{ id: "edit-7", observation_id: "obs-7", owner_subject: "staff:bot-b",
        status: "Approved", proposed_content: { morphology: "Approved edit leaves" }, version_number: 1,
        created_at: "2026-11-03T09:00:00Z", review_comment: "Approved comment" }] }
        : path === "/observations/obs-7/edit-history" ? { versions: [
          { id: "obs-v0", observation_id: "obs-7", version_number: 0, content: { morphology: "Original leaves" }, photo_ids: [], approved_at: "2026-11-01T10:00:00Z" },
          { id: "obs-v1", observation_id: "obs-7", version_number: 1, content: { morphology: "Approved edit leaves" }, photo_ids: [], edit_request_id: "edit-7", approved_at: "2026-11-03T10:00:00Z" },
        ], edits: [{ id: "edit-7", observation_id: "obs-7", owner_subject: "staff:bot-b", status: "Approved", version_number: 1,
          proposed_content: { morphology: "Approved edit leaves" }, created_at: "2026-11-03T09:00:00Z", review_comment: "Approved comment" }] }
        : (() => { throw new Error(`Unexpected list request ${path}`); })();
  const result = await fetchMyObservations("bot-b", "Botanist B", api);
  assert.equal(result.observations.length, 1);
  assert.equal(result.observations[0].plantId, "45");
  assert.equal(result.observations[0].morphology, "Approved leaves");
  assert.equal(result.observations[0].editRequests[0].id, "edit-7");
  assert.deepEqual(result.observations[0].historyRows.map((row) => [row.original, row.status, row.current]), [
    [true, "Approved", false], [false, "Approved", true],
  ]);
  assert.equal(result.observations[0].historyRows[1].editRequestId, "edit-7");
  assert.equal(result.versionHistoryError, false);
});

test("observation version rows join by observation and edit request ID without turning review events into versions", () => {
  const makeObservation = (id) => ({ id, plantId: "24", status: "Approved", date: "2026-11-01T10:00:00Z", reviewComment: "" });
  const first = makeObservation("obs-a");
  first.editRequests = [
    { id: "a-rejected", observation_id: "obs-a", version_number: 1, status: "Rejected", created_at: "2026-11-02T00:00:00Z", proposed_content: { notes: "Rejected proposal" }, review_comment: "Fix notes" },
    { id: "a-current", observation_id: "obs-a", version_number: 2, status: "Correction Required", created_at: "2026-11-03T00:00:00Z", proposed_content: { notes: "Current proposal" }, review_comment: "Add location" },
  ];
  const firstRows = buildObservationHistoryRows(first, { versions: [
    { id: "a-v0", version_number: 0, content: { notes: "Original" }, photo_ids: [] },
  ], edits: first.editRequests, events: [{ id: "event-a", event_type: "resubmitted" }] });
  assert.deepEqual(firstRows.map((row) => [row.editRequestId, row.status, row.original]), [
    [null, "Approved", true], ["a-rejected", "Rejected", false], ["a-current", "Correction Required", false],
  ]);
  assert.equal(firstRows.length, 3, "an event does not create another version row");
  assert.equal(observationMatchesFilter({ ...first, historyRows: firstRows }, "pending"), true, "Correction Required maps to Pending filter");
  assert.equal(observationMatchesFilter({ ...first, historyRows: firstRows }, "rejected"), true);
  assert.equal(observationStatusSummary({ ...first, historyRows: firstRows }).status, "Approved");
  assert.deepEqual(observationStatusSummary({ ...first, historyRows: firstRows }), {
    status: "Approved", detailKey: "pendingEditOne", count: 1,
  }, "Correction Required remains an active edit summary on the approved observation");

  const second = makeObservation("obs-b");
  second.editRequests = [{ id: "b-edit", observation_id: "obs-b", version_number: 1, status: "Cancelled", proposed_content: {} }];
  const secondRows = buildObservationHistoryRows(second, null);
  assert.equal(secondRows.some((row) => row.editRequestId === "a-current"), false, "different observations on Plant 24 stay separate");
  assert.equal(observationMatchesFilter({ ...second, historyRows: secondRows }, "approved"), true);
  assert.equal(observationMatchesFilter({ ...second, historyRows: secondRows }, "rejected"), false);
});

test("Observation correction and resubmission reuse one edit request rather than inventing a resolved version", () => {
  const observation = { id: "obs-c", plantId: "21", status: "Approved", date: "2026-11-01T10:00:00Z" };
  const edit = { id: "edit-c", observation_id: "obs-c", version_number: 1, status: "Approved",
    review_comment: "Corrected details accepted." };
  const rows = buildObservationHistoryRows(observation, { versions: [
    { id: "original-c", version_number: 0, content: { notes: "Original" }, photo_ids: [] },
    { id: "approved-c", version_number: 1, edit_request_id: "edit-c", content: { notes: "Corrected" }, photo_ids: [] },
  ], edits: [edit], events: [{ event_type: "correction_required", request_id: "edit-c" },
    { event_type: "resubmitted", request_id: "edit-c" }, { event_type: "approved", request_id: "edit-c" }] });
  assert.deepEqual(rows.map((row) => row.status), ["Approved", "Approved"]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].superseded, true);
  assert.equal(rows[1].current, true);
  assert.equal(rows.some((row) => row.correctionResolved), false,
    "review events do not prove a separate Correction Required version was replaced");
});

test("approved snapshots and requests produce ordered edits, current and superseded badges, and exact navigation", () => {
  const observation = { id: "obs-a", plantId: "24", status: "Approved", date: "2026-11-01T10:00:00Z", editRequests: [
    { id: "edit-1", observation_id: "obs-a", version_number: 1, status: "Approved", created_at: "2026-11-02T00:00:00Z" },
    { id: "edit-2", observation_id: "obs-a", version_number: 2, status: "Approved", created_at: "2026-11-03T00:00:00Z" },
    { id: "edit-3", observation_id: "obs-a", version_number: 3, status: "Pending Review", created_at: "2026-11-04T00:00:00Z" },
    { id: "edit-4", observation_id: "obs-a", version_number: 4, status: "Rejected", created_at: "2026-11-05T00:00:00Z" },
    { id: "edit-5", observation_id: "obs-a", version_number: 5, status: "Cancelled", created_at: "2026-11-06T00:00:00Z" },
  ] };
  const rows = buildObservationHistoryRows(observation, { versions: [
    { id: "v0", observation_id: "obs-a", version_number: 0, content: { notes: "Original" }, approved_at: "2026-11-01T00:00:00Z" },
    { id: "v1", observation_id: "obs-a", version_number: 1, edit_request_id: "edit-1", content: { notes: "Edit 1" }, approved_at: "2026-11-02T00:00:00Z" },
    { id: "v2", observation_id: "obs-a", version_number: 2, edit_request_id: "edit-2", content: { notes: "Edit 2" }, approved_at: "2026-11-03T00:00:00Z" },
  ], edits: [{ id: "edit-4", observation_id: "obs-a", version_number: 4, status: "Pending Review", created_at: "2026-11-05T00:00:00Z" }] });
  assert.deepEqual(rows.map((row) => [row.original ? "Original" : `Edit ${row.editNumber}`, row.status]), [
    ["Original", "Approved"], ["Edit 1", "Approved"], ["Edit 2", "Approved"],
    ["Edit 3", "Pending Review"], ["Edit 4", "Rejected"], ["Edit 5", "Cancelled"],
  ]);
  assert.deepEqual(rows.filter((row) => row.current || row.superseded).map((row) => [row.versionId, row.current, row.superseded]), [
    ["v0", false, true], ["v1", false, true], ["v2", true, false],
  ]);
  assert.equal(rows.length, 6, "linked request rows are not duplicated");
  assert.equal(rows.find((row) => row.editRequestId === "edit-4").status, "Rejected",
    "the owner-scoped current request status overrides a stale history response for the exact request");
  const [routeName, params] = observationHistoryRoute(observation, rows[1]);
  assert.equal(routeName, "NotificationObservation");
  assert.equal(params.observationId, "obs-a");
  assert.equal(params.editRequestId, "edit-1");
  assert.equal(params.observationVersionId, "v1");
  assert.equal(params.observationVersionSnapshot.content.notes, "Edit 1");
  const [currentRoute, currentParams] = observationHistoryRoute(observation, rows.find((row) => row.current));
  assert.equal(currentRoute, "NotificationObservation");
  assert.deepEqual(currentParams, { observationId: "obs-a" }, "the current approved record keeps its existing edit action available");
});

test("owner-scoped response mismatch fails closed", async () => {
  const foreignRow = { id: "private-1", plant_id: 1, owner_subject: "staff:bot-b", status: "Pending Review" };
  await assert.rejects(
    fetchMyObservations("bot-a", "Botanist A", async (path) => path.includes("scope=mine")
      ? { observations: [foreignRow], page: { next_cursor: null } }
      : { notifications: [] }),
    /did not match this account/,
  );
});

test("My Observations labels have matching EN/MS/ZH keys", () => {
  const languages = ["en", "ms", "zh"].map((language) => JSON.parse(
    readFileSync(new URL(`../translations/${language}.json`, import.meta.url), "utf8"),
  ).myObservations);
  const keys = Object.keys(languages[0]).sort();
  assert.ok(keys.length > 0);
  for (const language of languages.slice(1)) assert.deepEqual(Object.keys(language).sort(), keys);
  for (const language of languages) for (const key of keys) assert.ok(language[key], `Missing translation ${key}`);
});

test("Observation history stays in My Observations while details ends at Officer Review", () => {
  assert.doesNotMatch(detail, /observation-section-05|observationEdits\.events\.\$\{event\.event_type\}/);
  assert.match(detail, /observation-section-04/);
  assert.match(screen, /item\.historyRows\.map\(\(row\) =>/);
  assert.doesNotMatch(screen, /item\.reviewComment|item\.recordedBy|item\.healthStatus|eventTranslationKeys/);
  const uuid = "19b902b4-1c6d-48d5-aaba-f16a8a2b6a55";
  const observation = { id: uuid, plant_id: "24", owner_subject: "staff:bot-a", status: "Approved" };
  assert.equal(displayObservationId(observation, uuid), "19b902b4…");
});
