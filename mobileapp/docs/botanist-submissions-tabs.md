# Botanist submission tabs and stability fixes

## Result

The existing dashboard now has a My Submissions area with My Plant Records and
My Species Requests tabs. Each tab owns its All/Pending/Approved/Rejected filter.
Switching tabs changes the displayed collection without refetching or clearing it.
The dashboard header scrolls with the list so the cards remain usable on shorter
screens. Cards use rounded borders, thumbnails or icons, status badges and chevrons.
Plant and species scientific names are displayed from their separate API fields;
scientific names, common names and taxonomy values are never translated as statuses.

Species requests previously appeared as plain View elements in the plant list's
header. They had no onPress handler or detail route. They are now whole-card
TouchableOpacity elements that navigate with requestId to the read-only
BotanistSpeciesRequestDetail screen. Plant cards retain BotanistPlantDetail.

## Reads and authorization

The dashboard uses the existing authenticated client for GET /api/plants,
/api/observations and /api/species-requests. Request details use
GET /api/species-requests/:id and its /photo endpoint. The existing backend already
enforces owner/reviewer permissions for request details and photos. The new screen
also checks the returned request ID and owner against its expected signed-in account.
No new backend endpoint, database change, approval action or migration was needed.

Each read is settled independently. Failed sections are omitted from the refresh
result, retaining their last successful same-account collection. This also allows
requests to load if the plant endpoint fails on the first visit. Malformed payloads
are treated as failed reads rather than authoritative empty collections. Network
errors remain visible. Authentication/account mismatch errors clear private data.
The existing coalesced loader and visit generation prevent duplicate refreshes and
stale navigation responses. The request detail screen similarly cancels stale
updates and clears or hides data for a different account/request.

## Earlier disappearance and startup investigation in this session

Read-only raw HTTP checks reproduced an origin 304 Not Modified response becoming
502 at the gateway, followed by Cloudflare's non-JSON error response. The gateway
had treated every 3xx response as a redirect. It now rejects actual redirect codes
(301/302/303/307/308) and preserves 304. The uncached Plant API disables Express
ETags. Repeated conditional health reads returned JSON 200 locally and publicly
after restarting the Plant API and gateway. Existing error-retention logic remains;
this change repairs the protocol failure instead of masking it with fake records.

The supplied startup TypeError hid EADDRINUSE when a second Plant API was started
on occupied port 3000. Listening and error handlers are now separate, so startup
reports the conflict without dereferencing server.address() when it is null.

During device verification, login requests returned 503 because port 3001's
authentication service was stopped. It was restored with its unchanged startup
configuration. Local, gateway and public authentication health then returned 200;
the user confirmed normal login succeeded. No authentication source or security
rules were changed. The evidence establishes service unavailability, but not why
that earlier authentication process stopped.

## Files changed for the submission tabs

- screens/BotanistDashboard.js
- screens/BotanistSpeciesRequestDetail.js (new)
- App.js (detail route)
- utils/botanistRecords.js (independent reads, thumbnails, detail fetch)
- utils/plantApi.js (authenticated request-photo sources)
- translations/en.json and translations/ms.json
- scripts/botanist-records.test.mjs
- scripts/localization.test.mjs and scripts/localization-contract.json
- This report

The preceding protocol/startup fixes changed ../deploy/mobile-login-gateway.mjs,
its test, ../plant-conservation-backend/server.js and
../plant-conservation-backend/test/server-startup.test.cjs.

## Verification

57 targeted tests passed together: dashboard projection/rendering in both languages,
independent filters and correct card routes, request details and photos, ownership,
partial failures, stale reads, session restoration/logout, approval boundaries,
atomic submissions/idempotency/rollback, gateway conditional responses and occupied
port startup. Backend write tests use isolated test databases, not production rows.
Expo lint and TypeScript checking passed. The localization regression contract was
updated only for the intentionally changed dashboard filters/navigation; its new
module dependency was added to the screen test fixture.

On the connected physical iPad, normal existing handlers were exercised through the
development debugger without exporting credentials. Plant 8 and request 1 remained
in their separate lists during repeated tab switches, back navigation and refreshes.
Three consecutive request-detail/back/refresh cycles were confirmed after waiting
for navigation to mount. The request detail returned request 1, Pending Review,
all seven submitted text fields and a photo source. An actual on-device photo GET
returned HTTP 200 image/jpeg. After a full Expo reload, both records loaded again,
and request details and refreshes worked again. A loading state was observed during
the first slower post-reload detail read; later checks waited for completion.

This is physical-device runtime/navigation verification, not a screenshot-based
visual review. Smaller physical phones were not available for visual verification.
No production submissions were created for debugging. No records were deleted or
reset, no migrations were run, and no commit or push was performed.

The feature requires only the updated Expo bundle; the iPad has already reloaded it.
The Plant API/gateway were restarted for the preceding protocol fixes, and the
stopped authentication service was restored. No additional restart is currently
required. Keep the existing development services running while using the app.
