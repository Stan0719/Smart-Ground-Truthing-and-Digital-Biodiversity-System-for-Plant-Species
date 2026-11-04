# Dashboard session and record-loading fix

## Confirmed root cause

The exact message came from `faceSessionLifecycle.js` in `withToken`, not from a
business-account requirement or a database ownership filter. My Plant Records
reuses the standard authenticated Plant API client, which correctly requires an
online, server-verified session.

Safe inspection of the connected iPad showed a visible dashboard but:

- `faceSession.hasSession()` was false.
- SecureStore was available, but no saved session existed.
- The record request was rejected on-device before a Plant API request was sent.

The App retained a user profile in React state and skipped revalidation whenever
`hasSession()` was false. It also did not subscribe to session invalidation. This
allowed the authenticated-looking dashboard to remain visible after credentials
were missing. The earlier reason the saved credential was removed was not retained
in historical diagnostics, so no claim is made about that prior event.

## Changes

App now attempts secure-session restoration even when its in-memory token is empty.
Missing/rejected sessions clear the stale UI identity and return to the existing
Login screen. The existing session manager publishes state invalidation events;
App subscribes and removes private access promptly. No alternate login or role
source was introduced. Normal login still verifies `/api/mobile/me` before publishing
the authenticated account. Password, face login, backend-origin binding, role checks
and expiry/revocation validation remain in force.

Parallel dashboard requests share one in-flight server verification. Session
restoration checks the generation before and after reading secure storage, and
cannot reload a token while logout is clearing it. Network failures remain typed
transient errors rather than forcing a false sign-out. Missing credentials have a
typed session-required error instead of the misleading business-request wording.

The actual iPad also exposed a separate temporary 502 on `/api/observations`.
The previous Promise.all loader discarded a successful plants response whenever
one related list failed. Plants, observations and species requests now settle
independently: owned plants and successful requests remain visible, with localized
warnings and retry for unavailable sections. Authentication/account-change failures
clear private cached records; temporary network failures can retain already-loaded
records. Both English and Bahasa Melayu remain supported.

Development diagnostics print only public request URLs, methods, HTTP status,
credential-presence booleans, account-match booleans and record counts. They never
print request bodies, passwords, bearer tokens or secure-storage values. Tokens
remained on the iPad during live verification.

## Actual iPad verification

After the user completed normal sign-in on the connected iPad:

- POST `/api/mobile/me` returned 200.
- GET `/api/plants` returned 200 with credentials included, an available account ID,
  and an identity matching the requested owner.
- The response contained one owned record, including plant 8.
- An independent on-device owner check matched plant 8's actual submitter.
- GET `/api/species-requests` returned 200.
- GET `/api/observations` initially returned a gateway 502; a later actual on-device
  check succeeded with one observation. Its read-only SQL also succeeded against
  the live database. No backend or database change was needed for this task.
- Following the normal dashboard refresh, the user confirmed that plant 8 appears.

The debugger disconnected after these checks, so the final post-refresh rendered
state was confirmed by the user rather than an additional debugger snapshot.

## Modified files

- mobileapp/App.js
- mobileapp/utils/faceSessionLifecycle.js
- mobileapp/utils/faceSession.js
- mobileapp/utils/plantApi.js
- mobileapp/utils/botanistRecords.js
- mobileapp/screens/BotanistDashboard.js (localized multi-section warnings only)
- mobileapp/translations/en.json and ms.json
- mobileapp/scripts/session-dashboard.test.mjs (new)
- mobileapp/scripts/botanist-records.test.mjs
- mobileapp/scripts/first-login-screen.test.mjs (existing SafeAreaView dependency stub)
- mobileapp/scripts/localization.test.mjs and localization-contract.json
- This report.

## Tests and restart requirements

113 targeted session, login, account routing, network classification, dashboard,
localization, notifications, Add Plant and offline/revocation regression tests pass.
Expo lint and TypeScript checking pass. Tests cover cold secure restore, stale UI
identity removal, correct bearer/owner handling, duplicate verification prevention,
logout races, private-cache clearing, independent list loading, network warnings and
retries. The initial login test run exposed an outdated SafeAreaView mock; correcting
that test dependency made the real Login screen regression tests pass.

No backend files, schema or existing plant/species records were changed. No migration,
backend restart, commit or push was performed. The iPad loaded the updated code
through Expo refresh; no further restart is needed for the verified session.
