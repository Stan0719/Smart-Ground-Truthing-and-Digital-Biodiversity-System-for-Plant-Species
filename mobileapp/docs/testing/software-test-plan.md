# Mobile and supporting backend software test plan

**Date:** 2026-11-22. **Scope:** `mobileapp/` and mobile-supporting `plant-conservation-backend/` only. Officer/Admin web, IoT, AI, shared Supabase, production accounts and teammate report code are excluded. This plan records work performed as well as remaining gates; a plan is not execution evidence.

## Objectives and approach

Verify Guest, Visitor and Botanist mobile behavior; mobile API contracts; plant, species, Observation, QR, GPS, photo, draft, correction and notification workflows; functional data isolation, invalid input and failure handling. Use positive and negative cases, unit and controlled integration tests, black-box behavior assertions and white-box branch assertions. Manual system and acceptance testing require physical devices and participants. Cybersecurity assessment is outside this contributor's individual scope.

## Environment and tools

The frontend is Expo/React Native with Node `node:test` scripts in `mobileapp/scripts/`. The backend is Express with Node `node:test` files in `plant-conservation-backend/test/`. TypeScript uses `tsc --noEmit`; lint uses `expo lint`. No mobile Playwright configuration was found. The authorized test run uses local fixtures and mocks, not shared Supabase. Most backend database tests import a fixture from `web/`; these are blocked by the current directory restriction and were not run.

## Entry, exit and sequence

Entry: cleanly identify existing edits, inspect each test's imports and write target, use synthetic accounts, and exclude any prohibited path. Sequence: inventory requirements and suites; run baseline; repair confirmed harness faults; add a meaningful regression; rerun focused then broad permitted tests; type/lint/diff checks; prepare manual/UAT cases. A case passes only when its observed result matches its assertion. Failure, skip, blocked and not executed are recorded separately.

Phase 2 added a backend-local PGlite fixture and a backend-only development dependency to make in-memory database testing reproducible without the prohibited cross-directory fixture. Database tests operate on a fresh instance per case and close it in teardown. A mobile-to-backend loopback test exercises the actual mobile Species search client and mounted backend route with synthetic identity and mocked upstream data. These additions expand integration evidence but do not replace device, full authentication or complete submission journeys.

Exit for automated scope: all permitted mobile functional tests and selected safe backend tests pass with no failures. Full mobile contribution closure additionally requires isolated database integration, mobile-to-backend end-to-end runs, Android/iOS usability, accessibility, UAT and performance measurements. Project cybersecurity assessment belongs to the responsible teammate and is not counted here. These gates are not waived by a green unit suite.

## Responsibilities and risks

The mobile/backend contributor owns scoped tests and evidence. Botanist/Visitor participants must perform UAT. Teammates own excluded systems. Key risks are shared-data writes, test fixtures crossing into prohibited `web/`, VM mocks diverging from current imports, and treating static assertions as device evidence. Review imports before expanding the backend suite. Do not point any automated test at production or shared Supabase.
