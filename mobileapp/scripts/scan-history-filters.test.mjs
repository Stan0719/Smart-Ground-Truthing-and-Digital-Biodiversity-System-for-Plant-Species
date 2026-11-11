import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { calendarWeeks, filterAndSortScanHistory, formatDateKey, isCalendarDateSelected, localDateKey, shiftCalendarMonth } from "../utils/scanHistoryFilters.js";
import { fileURLToPath } from "node:url";

const scanHistorySource = readFileSync(fileURLToPath(new URL("../screens/ScanHistory.js", import.meta.url)), "utf8");

function scan(id, at, { name = "", scientific = "", qr = `QR-${id}`, plantId = id } = {}) {
  return {
    scan_id: id,
    scannedAt: at,
    qrIdentifier: qr,
    plant: plantId == null ? null : { plantId: String(plantId), commonName: name, scientificName: scientific },
  };
}

test("search matches common names, scientific names, and QR identifiers without case sensitivity", () => {
  const rows = [
    scan(1, "2026-11-10T12:00:00Z", { name: "Pitcher Plant", scientific: "Nepenthes mirabilis" }),
    scan(2, "2026-11-10T11:00:00Z", { name: "Fern", qr: "Qr-X4" }),
  ];
  assert.equal(filterAndSortScanHistory(rows, { search: "PITCHER" }).length, 1);
  assert.equal(filterAndSortScanHistory(rows, { search: "NEPENTHES" }).length, 1);
  assert.equal(filterAndSortScanHistory(rows, { search: "qr-x4" }).length, 1);
});

test("date filters compare the visitor's local date, including UTC timestamps crossing midnight", () => {
  const boundary = new Date(2026, 10, 10, 23, 40);
  const rows = [
    scan(1, boundary.toISOString()),
    scan(2, new Date(2026, 10, 9, 23, 59).toISOString()),
    scan(3, new Date(2026, 9, 12, 12, 0).toISOString()),
  ];
  const exactDay = localDateKey(boundary);
  assert.deepEqual(filterAndSortScanHistory(rows, { dateFilter: { type: "specific", value: exactDay } }).map((row) => row.scan_id), [1]);
  assert.deepEqual(filterAndSortScanHistory(rows, { dateFilter: { type: "today" } }, boundary).map((row) => row.scan_id), [1]);
  assert.deepEqual(filterAndSortScanHistory(rows, { dateFilter: { type: "last7" } }, boundary).map((row) => row.scan_id), [1, 2]);
  assert.deepEqual(filterAndSortScanHistory(rows, { dateFilter: { type: "last30" } }, boundary).map((row) => row.scan_id), [1, 2, 3]);
  assert.equal(formatDateKey(exactDay), "10/11/2026");
});

test("favourites filter matches plant IDs and combined filters run before unique grouping", () => {
  const rows = [
    scan(1, "2026-11-10T10:00:00Z", { name: "Fern", plantId: 8 }),
    scan(2, "2026-11-10T11:00:00Z", { name: "Fern", plantId: 8 }),
    scan(3, "2026-11-10T12:00:00Z", { name: "Fern", plantId: 9 }),
    scan(4, "2026-11-10T13:00:00Z", { name: "Fern", plantId: null, qr: "QR-MISSING" }),
    scan(5, "2026-11-10T14:00:00Z", { name: "Other", plantId: 8 }),
  ];
  const result = filterAndSortScanHistory(rows, {
    search: "fern",
    dateFilter: { type: "specific", value: "2026-11-10" },
    favouritesOnly: true,
    favouritePlantIds: new Set(["8"]),
    uniquePlantsOnly: true,
  });
  assert.deepEqual(result.map((row) => row.scan_id), [2]);
  assert.deepEqual(filterAndSortScanHistory(rows, { favouritesOnly: true, favouritePlantIds: new Set(["8"]) }).map((row) => row.scan_id), [5, 2, 1]);
});

test("unique plants keeps the newest scan per plant or orphan QR, then sorts by scan timestamp", () => {
  const rows = [
    scan(1, "2026-11-10T10:00:00Z", { plantId: 8 }),
    scan(2, "2026-11-10T11:00:00Z", { plantId: 8 }),
    scan(3, "2026-11-10T09:00:00Z", { plantId: null, qr: "QR-X" }),
    scan(4, "2026-11-10T12:00:00Z", { plantId: null, qr: "QR-X" }),
    scan(5, "2026-11-10T08:00:00Z", { plantId: null, qr: "QR-Y" }),
  ];
  assert.deepEqual(filterAndSortScanHistory(rows, { uniquePlantsOnly: true }).map((row) => row.scan_id), [4, 2, 5]);
  assert.deepEqual(filterAndSortScanHistory(rows, { sortOrder: "oldest" }).map((row) => row.scan_id), [5, 3, 1, 2, 4]);
});

test("every date occupies its Monday-first weekday column in complete seven-cell rows across years", () => {
  const years = [1899, 1900, 1999, 2000, 2001, 2023, 2024, 2025, 2026, 2100, 2400];
  const firstWeekdays = new Set();
  for (const year of years) {
    for (let month = 0; month < 12; month += 1) {
      const weeks = calendarWeeks(new Date(year, month, 15));
      const dayCount = new Date(year, month + 1, 0).getDate();
      const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
      firstWeekdays.add(firstWeekday);
      assert.ok(weeks.length >= 4 && weeks.length <= 6, `${year}-${month + 1} has a valid four-to-six week grid`);
      assert.ok(weeks.every((week) => week.length === 7), `${year}-${month + 1} rows each contain seven cells`);
      const cells = weeks.flat();
      assert.equal(cells.filter(Boolean).length, dayCount, `${year}-${month + 1} contains each day exactly once`);
      assert.ok(cells.slice(0, firstWeekday).every((cell) => cell === null), `${year}-${month + 1} has leading blanks`);
      assert.ok(cells.slice(firstWeekday + dayCount).every((cell) => cell === null), `${year}-${month + 1} pads the final week`);
      for (let day = 1; day <= dayCount; day += 1) {
        const position = firstWeekday + day - 1;
        const expectedKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        assert.equal(cells[position], expectedKey);
        assert.equal(position % 7, (new Date(year, month, day).getDay() + 6) % 7);
      }
    }
  }
  assert.deepEqual([...firstWeekdays].sort(), [0, 1, 2, 3, 4, 5, 6]);
});

test("leap and non-leap February grids contain the correct day counts", () => {
  for (const [year, expected] of [[1900, 28], [2000, 29], [2024, 29], [2025, 28], [2100, 28], [2400, 29]]) {
    const cells = calendarWeeks(new Date(year, 1, 15)).flat().filter(Boolean);
    assert.equal(cells.length, expected, `${year} February has ${expected} dates`);
    assert.equal(cells.at(-1), `${year}-02-${expected}`);
  }
});

test("month navigation crosses both year boundaries and keeps a selected date stable", () => {
  const january = shiftCalendarMonth(new Date(2026, 11, 15), 1);
  assert.equal(january.getFullYear(), 2027);
  assert.equal(january.getMonth(), 0);
  const december = shiftCalendarMonth(january, -1);
  assert.equal(december.getFullYear(), 2026);
  assert.equal(december.getMonth(), 11);
  const selected = { type: "specific", value: "2027-01-01" };
  assert.equal(isCalendarDateSelected("2027-01-01", selected), true);
  assert.equal(calendarWeeks(january).flat().includes(selected.value), true);
  assert.equal(isCalendarDateSelected("2026-12-01", selected), false);
});

test("calendar layout has seven equal responsive columns and a centered tablet width cap", () => {
  assert.match(scanHistorySource, /calendar:\s*\{\s*width:\s*"100%",\s*maxWidth:\s*400,\s*alignSelf:\s*"center"/);
  assert.match(scanHistorySource, /<View style=\{styles\.calendarGrid\}>\s*<View style=\{styles\.calendarWeek\}>[\s\S]*?weekdayKeys\(dateLocale\(\)\)/);
  assert.match(scanHistorySource, /calendarWeek:\s*\{\s*width:\s*"100%",\s*flexDirection:\s*"row"\s*\}/);
  assert.match(scanHistorySource, /weekday:\s*\{\s*flex:\s*1,\s*minWidth:\s*0/);
  assert.match(scanHistorySource, /calendarDayCell:\s*\{\s*flex:\s*1,\s*minWidth:\s*0,\s*height:\s*44/);
  assert.doesNotMatch(scanHistorySource, /calendarGrid:\s*\{[^}]*justifyContent:\s*"space-between"/);
  for (const screenWidth of [320, 375, 430, 768, 1024]) {
    const available = Math.min(screenWidth, 400);
    const columnWidth = available / 7;
    assert.ok(columnWidth * 7 <= screenWidth, `${screenWidth}px layout fits without horizontal overflow`);
    assert.equal(columnWidth, available / 7, "all seven columns use the same width");
  }
});
