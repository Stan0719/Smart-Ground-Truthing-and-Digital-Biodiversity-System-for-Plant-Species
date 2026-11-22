# Mobile/backend performance test report

**Status:** NOT EXECUTED on 2026-11-22. No p50, p95, throughput, error rate, device rendering time or database timing is claimed.

## Proposed isolated scenarios

Measure mobile health, public Plant/Species first page and next page, scoped My Observations, notifications, QR lookup and GPS duplicate screening on a locally isolated backend with synthetic records. Login and mutation workflows need a dedicated disposable environment; never load-test shared Supabase. Proposed load levels are 1, 5, 10 and 20 clients with a capped request count and predeclared provisional thresholds. Formal partner thresholds were not found in the authorized directories and should be set before execution.

Record OS, CPU/memory, backend version, dataset size, record/photo counts, endpoint, concurrency, duration, request count, mean/p50/p95, throughput, errors and database query timings where available. Separate API latency from mobile first visible content and image decode time. Repeat on Android and iOS devices for UI measurements.

## Blocker

**Phase 1 limitation:** the historical backend database fixture imported a prohibited cross-directory module, so no safe API load run was made in Phase 1. Phase 2 introduced a backend-local disposable PostgreSQL fixture and measured the narrower query workload below. A full isolated HTTP backend composition and device workload remain unavailable, so no production bottleneck or improvement can be quantified.

## Phase 2 measured microbenchmark

An independent in-memory PGlite fixture is now available. `node scripts/benchmark-mobile-plant-counts.cjs` seeded **500 synthetic approved Plants and 1 public Species** and measured **30 sequential Plant-count queries** after 5 warmups on Windows, 16 logical CPUs and approximately 16.23 GB system memory. One local run reported **mean 2.50 ms, median 2.41 ms, p95 3.10 ms, throughput 399.21 queries/s, 0 errors**. Concurrency was 1. These numbers measure only `readPlantSpeciesCounts()` and in-process PGlite on this workstation. They do **not** measure an HTTP endpoint, authentication, shared PostgreSQL, tunnel latency, mobile rendering or images. No before/after improvement or production bottleneck is inferred. Broader scenarios above remain not executed.
