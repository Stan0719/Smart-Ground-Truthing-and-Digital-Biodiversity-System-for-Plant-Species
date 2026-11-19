# Officer IoT environmental report — Phase 2

The IoT Environmental Report (`iot-summary`) category uses the summary component.
The separate operational IoT report retains its existing implementation. Other categories
retain their existing service, chart and export paths. Device discovery uses
the authorized canonical device API. Summary requests use contract v1 at
`/api/data/reports/iot-summary` and the existing applied period filters.

The page displays the response's overall statistics, ordered buckets, units,
observed span and limitation explanations. It does not aggregate raw readings,
infer uptime, classify threats or calibrate raw units. Missing counts describe
unavailable measurements in received rows, not packets that never arrived.

PDF export uses only the loaded bounded response and its chart. Four-card layout
and post-table quality notes are optional PDF model extensions; existing callers
retain the original defaults. Device, metric, applied-period and language changes
invalidate stale exports. CSV downloads the same bounded authoritative buckets as a spreadsheet table;
PDF retains the formatted cards, chart, table and quality notes. No raw individual
IoT readings are exported or fetched. Continuous columns are Date / Time Period,
Device, Average (unit), Minimum (unit), Maximum (unit), Valid Measurements and
Missing Measurements. Movement columns are Date / Time Period, Device, Movement
Detected, Valid Readings and Missing Measurements. Detected counts come directly
from detectedSampleCount (valid numeric-1 readings, not unique events).

CSV periods show both full Malaysia-local dates and 24-hour times, with the end
explicitly exclusive, including partial and multiweek buckets. Numeric values
retain API precision with dot decimals and no grouping; null aggregates are empty
cells, valid zeros remain zero, and missing-only buckets remain present. CSV uses
UTF-8 BOM, CRLF, quoted fields and doubled quotes; formula-prefixed device text
is apostrophe-escaped without changing numeric values. Headers follow the selected
language and retain actual units, including raw units.

There are no metadata/prose rows. The filename contains NIAH, IoT environmental
report, metric, unit, safe device identifier, aggregation step/interval, selected
period and generated date. Filter mismatches, loading, failures and concurrent
exports block downloads; a response arriving for a changed selection is discarded.
Empty bucket lists disable CSV; missing-only buckets can still be exported.
There is no fallback to the old unbounded IoT report endpoint.

Requires the Phase 1 summary backend and an authenticated `/api/data` proxy.
All Time can still be expensive on the backend; the UI reports failures instead
of presenting fabricated successful zero totals. Browser PDF verification with
synthetic data remains a separate manual check; automated PDF tests mock canvas
and image rendering. No live Supabase data is required for frontend tests.


The Officer metric selector offers Temperature, Humidity, Soil Moisture, Rain and
Movement, in that order. Sound remains in the shared sensor contract but is not
an Officer reporting choice; legacy Sound selections fall back to Temperature
before requesting data, and a selection mismatch blocks CSV/PDF export.

Continuous charts use floating tooltips without a duplicate bottom details line.
Keyboard users retain arrow/Home/End inspection with a visually hidden live
announcement, and the complete report table remains available. The concise note
reads: "Each point represents a reporting period. See the table for exact dates."
Movement keeps its existing bar-specific note and interaction. PDF chart rendering
does not include the DOM hover-details line.
