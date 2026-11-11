export function localDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function formatDateKey(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}

function localCalendarDate(year, month, day) {
  const date = new Date(0);
  date.setHours(12, 0, 0, 0);
  date.setFullYear(year, month, day);
  return date;
}

export function calendarWeeks(monthDate) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const offset = (localCalendarDate(year, month, 1).getDay() + 6) % 7;
  const dayCount = localCalendarDate(year, month + 1, 0).getDate();
  const weekCount = Math.ceil((offset + dayCount) / 7);
  const cells = Array(weekCount * 7).fill(null);
  for (let day = 1; day <= dayCount; day += 1)
    cells[offset + day - 1] = localDateKey(localCalendarDate(year, month, day));
  return Array.from({ length: weekCount }, (_, index) => cells.slice(index * 7, index * 7 + 7));
}

export function shiftCalendarMonth(monthDate, monthDelta) {
  const shifted = new Date(monthDate.getTime());
  shifted.setDate(1);
  shifted.setMonth(shifted.getMonth() + monthDelta);
  return shifted;
}

export function isCalendarDateSelected(dateKey, dateFilter) {
  return dateFilter?.type === "specific" && dateFilter.value === dateKey;
}

function dateMatches(scan, dateFilter, now) {
  if (!dateFilter || dateFilter.type === "all") return true;
  const scanDate = localDateKey(scan.scannedAt ?? scan.scanned_at);
  if (!scanDate) return false;
  if (dateFilter.type === "specific") return scanDate === dateFilter.value;
  const today = localDateKey(now);
  if (dateFilter.type === "today") return scanDate === today;
  if (dateFilter.type === "last7" || dateFilter.type === "last30") {
    const days = dateFilter.type === "last7" ? 7 : 30;
    const firstDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days + 1);
    return scanDate >= localDateKey(firstDay) && scanDate <= today;
  }
  return true;
}

function plantId(scan) {
  const id = scan?.plant?.plantId ?? scan?.plant?.plant_id;
  return id == null || id === "" ? null : String(id);
}

function scanTime(scan) {
  const value = new Date(scan.scannedAt ?? scan.scanned_at).getTime();
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

export function filterAndSortScanHistory(scans, {
  search = "",
  dateFilter = { type: "all" },
  favouritesOnly = false,
  favouritePlantIds = new Set(),
  uniquePlantsOnly = false,
  sortOrder = "newest",
} = {}, now = new Date()) {
  const query = String(search).trim().toLowerCase();
  let matches = (Array.isArray(scans) ? scans : []).filter((scan) => {
    const searchable = [scan?.plant?.commonName, scan?.plant?.scientificName, scan?.qrId, scan?.qr_id, scan?.qrIdentifier, scan?.qr_identifier]
      .filter(Boolean).join(" ").toLowerCase();
    if (query && !searchable.includes(query)) return false;
    if (!dateMatches(scan, dateFilter, now)) return false;
    if (favouritesOnly) {
      const id = plantId(scan);
      if (!id || !favouritePlantIds.has(id)) return false;
    }
    return true;
  });

  if (uniquePlantsOnly) {
    const newestByPlant = new Map();
    for (const scan of matches) {
      const id = plantId(scan);
      const key = id ? `plant:${id}` : `qr:${scan?.qrId ?? scan?.qr_id ?? scan?.qrIdentifier ?? scan?.qr_identifier ?? "unknown"}`;
      const current = newestByPlant.get(key);
      if (!current || scanTime(scan) > scanTime(current)) newestByPlant.set(key, scan);
    }
    matches = [...newestByPlant.values()];
  }

  const direction = sortOrder === "oldest" ? 1 : -1;
  return matches.sort((left, right) => direction * (scanTime(left) - scanTime(right)));
}
