import { submissionStatus } from "./botanistRecords";

function statusOrder(status) {
  const normalized = submissionStatus(status);
  if (normalized === "approved") return 0;
  if (normalized === "pending" || normalized === "correction required") return 1;
  if (normalized === "rejected") return 2;
  return 3;
}

function recordTime(record) {
  const value = record?.registeredAt ?? record?.registered_at ?? record?.createdAt ?? record?.created_at ??
    record?.submittedAt ?? record?.submitted_at ?? record?.date ?? null;
  if (value == null || String(value).trim() === "") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function orderSpeciesPlantRecords(records) {
  return (Array.isArray(records) ? records : [])
    .map((record, index) => ({ record, index, rank: statusOrder(record?.currentStatus ?? record?.status), time: recordTime(record) }))
    .sort((left, right) => {
      if (left.rank !== right.rank) return left.rank - right.rank;
      if (left.time != null && right.time != null && left.time !== right.time) return right.time - left.time;
      if (left.time != null && right.time == null) return -1;
      if (left.time == null && right.time != null) return 1;
      if (left.time != null && right.time != null) {
        const leftId = String(left.record?.plantId ?? left.record?.id ?? "");
        const rightId = String(right.record?.plantId ?? right.record?.id ?? "");
        const idOrder = leftId.localeCompare(rightId, undefined, { numeric: true });
        if (idOrder) return idOrder;
      }
      return left.index - right.index;
    })
    .map(({ record }) => record);
}
