import LanguageSelector from "../components/LanguageSelector";
import { useAppTranslation, t, translateLabel, translateUIMessage } from "../translations/i18n";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, FlatList, ScrollView, StyleSheet, Image, ActivityIndicator, Alert, useWindowDimensions, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { submissionStatus, fetchBotanistRecordChange } from "../utils/botanistRecords";
import { useBotanistRecords } from "../utils/useBotanistRecords";
import { plantApi } from "../utils/plantApi";
import { mobileApiUrl } from "../utils/apiConfiguration";
import { faceSession } from "../utils/faceSession";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useBotanistNotifications } from "../utils/useBotanistNotifications";
import { CardListSkeleton } from "../components/BotanicalSkeleton";
import { ownedNotificationObservation } from "../utils/botanistNotifications";
import { fieldFormStyles } from "../components/fieldFormStyles";

export function correctionTasks(plants, observations, requests, botanistId, edits = [], recordChanges = []) {
  if (!botanistId) return [];
  const owner = `staff:${botanistId}`;
  const plantById = new Map(plants.map((plant) => [String(plant.id), plant]));
  const observationTasks = observations.filter((row) => row.owner_subject === owner && row.status === "Correction Required").map((row) => {
    const plant = plantById.get(String(row.plant_id));
    const initial = row.origin_type === "initial_registration" || (plant?.status !== "Approved" && row.origin_type !== "subsequent_observation" && !!plant);
    return { key: `observation:${row.id}`, kind: initial ? "plant" : "observation", id: String(row.id), plantId: String(row.plant_id), plant,
      name: plant?.commonName || plant?.scientificName || "", feedback: row.review_comment || "", status: row.status, at: row.updated_at || row.created_at };
  });
  const speciesTasks = requests.filter((row) => (row.requested_by ?? row.owner_subject) === owner && row.request_status === "Correction Required")
    .map((row) => ({ key: `species:${row.request_id}`, kind: "species", id: String(row.request_id), name: row.scientific_name || "",
      feedback: row.review_comment || "", status: row.request_status, at: row.reviewed_at || row.submitted_at }));
  const editTasks = edits.filter((row) => row.owner_subject === owner && row.status === "Correction Required")
    .map((row) => ({ key: `observation-edit:${row.id}`, kind: "observationEdit", id: String(row.id),
      observationId: String(row.observation_id), plantId: String(observations.find((item) => String(item.id) === String(row.observation_id))?.plant_id || ""),
      feedback: row.review_comment || "", status: row.status, at: row.updated_at || row.created_at }));
  const recordChangeTasks = recordChanges.filter((row) => row.owner_subject === owner && row.status === "Correction Required")
    .map((row) => row.plant_id != null
      ? { key: `plant-edit:${row.id}`, kind: "plantEdit", id: String(row.id), proposalId: String(row.id), plantId: String(row.plant_id),
        name: row.proposed_snapshot?.scientific_name || row.proposed_snapshot?.common_name || "", feedback: row.review_comment || "", status: row.status, at: row.updated_at || row.created_at }
      : { key: `species-edit:${row.id}`, kind: "speciesEdit", id: String(row.id), proposalId: String(row.id),
        requestId: String(row.base_snapshot?.request_id || ""), name: row.proposed_snapshot?.scientific_name || "", feedback: row.review_comment || "", status: row.status, at: row.updated_at || row.created_at });
  return [...observationTasks, ...speciesTasks, ...editTasks, ...recordChangeTasks].sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0));
}

function statusBadge(status, correctionResolved = false) {
  const kind = submissionStatus(status);
  const superseded = status === "Superseded";
  return <View style={[styles.badge, correctionResolved ? styles.resolvedBadge : superseded ? styles.supersededVersionBadge : kind === "approved" ? styles.approvedBadge : kind === "rejected" ? styles.rejectedBadge : kind === "withdrawn" ? styles.withdrawnBadge : styles.pendingBadge]}>
    <Text style={correctionResolved ? styles.resolvedText : superseded ? styles.supersededVersionText : kind === "approved" ? styles.approvedText : kind === "rejected" ? styles.rejectedText : kind === "withdrawn" ? styles.withdrawnText : styles.pendingText}>{correctionResolved ? t("recordEdits.correctionResolvedLabel") : translateLabel(status)}</Text>
  </View>;
}

function stableSnapshot(value) {
  if (Array.isArray(value)) return value.map(stableSnapshot);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableSnapshot(value[key])]));
  return value;
}

function markResolvedCorrections(rows, kind) {
  for (const original of rows.filter((row) => row.original && row.versionNumber === 1 && row.status === "Correction Required" && row.versionId)) {
    const corrected = rows.find((row) => row.versionNumber === 2 && row.versionId && row.status === "Approved" &&
      row.raw?.change_id == null && row.raw?.previous_snapshot && row.raw?.owner_subject &&
      row.raw.owner_subject === original.raw?.owner_subject && row.raw.edited_by === original.raw.owner_subject);
    const recordKey = kind === "plant" ? "observation_id" : "request_id";
    if (!corrected || original.snapshot?.[recordKey] == null ||
        String(original.snapshot[recordKey]) !== String(corrected.snapshot?.[recordKey]) ||
        JSON.stringify(stableSnapshot(original.snapshot)) !== JSON.stringify(stableSnapshot(corrected.raw.previous_snapshot))) continue;
    original.correctionResolved = true;
  }
}

export function versionCardItems(kind, targetId, response) {
  if (!response?.history_available) return [];
  const byKey = new Map();
  const versions = Array.isArray(response.versions) ? response.versions : [];
  for (const version of versions) {
    if (version?.id == null) continue;
    const versionNumber = Number.isFinite(Number(version.version_number)) && Number(version.version_number) > 0
      ? Number(version.version_number) : undefined;
    byKey.set(`version:${version.id}`, { key: `version:${version.id}`, kind, targetId, versionId: version.id,
      ...(version.change_id != null ? { priorChangeId: String(version.change_id) } : {}), versionNumber,
      snapshot: version.snapshot || {}, title: version.snapshot?.scientific_name,
      commonName: version.snapshot?.common_name ?? version.snapshot?.content?.commonName,
      status: version.status, edited: Boolean(versionNumber && versionNumber > 1), original: versionNumber === 1,
      createdAt: version.created_at, raw: version });
  }
  for (const change of Array.isArray(response.prior_changes) ? response.prior_changes : []) {
    if (change?.id == null) continue;
    const key = `change:${change.id}`;
    if (byKey.has(key)) continue;
    byKey.set(key, { key, kind, targetId, priorChangeId: change.id,
      snapshot: change.proposed_snapshot || {}, title: change.proposed_snapshot?.scientific_name,
      commonName: change.proposed_snapshot?.common_name, status: change.status, edited: true,
      createdAt: change.created_at, raw: change, detailSnapshot: kind === "plant"
        ? { ...(change.base_snapshot || {}), ...(change.proposed_snapshot || {}),
          content: { ...(change.base_snapshot?.content || {}), ...(change.proposed_snapshot?.content || {}) },
          photo_refs: [
            ...((change.proposed_snapshot?.photo_ids ?? (Number(change.proposal_photo_count) ? [] : change.base_snapshot?.photo_ids || [])).map((asset_id) => ({ asset_id }))),
            ...Array.from({ length: Number(change.proposal_photo_count) || 0 }, (_, change_photo_index) => ({ change_id: change.id, change_photo_index })),
          ] }
        : { ...(change.base_snapshot || {}), ...(change.proposed_snapshot || {}) } });
  }
  const rows = [...byKey.values()];
  const compareChronological = (left, right) => {
    if (left.versionNumber && right.versionNumber && left.versionNumber !== right.versionNumber)
      return left.versionNumber - right.versionNumber;
    const leftTime = Date.parse(left.createdAt || ""), rightTime = Date.parse(right.createdAt || "");
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) return leftTime - rightTime;
    return (left.versionNumber || 0) - (right.versionNumber || 0);
  };
  const approvedRows = rows.filter((row) => submissionStatus(row.status) === "approved").sort((left, right) =>
    compareChronological(left, right));
  const latestApproved = approvedRows[approvedRows.length - 1];
  for (const row of rows) {
    row.current = row === latestApproved;
    row.superseded = Boolean(latestApproved && submissionStatus(row.status) === "approved" && row !== latestApproved);
  }
  return rows.sort(compareChronological);
}

export function mergeRecordChangeSubmissions(kind, targetId, response, recordChanges = []) {
  const versions = Array.isArray(response?.versions) ? response.versions : [];
  const priorChanges = Array.isArray(response?.prior_changes) ? response.prior_changes : [];
  const target = String(targetId);
  const matchesTarget = (change) => kind === "plant"
    ? change?.plant_id != null && String(change.plant_id) === target
    : change?.base_snapshot?.request_id != null && String(change.base_snapshot.request_id) === target;
  const currentById = new Map(recordChanges.filter(matchesTarget)
    .filter((change) => change?.id != null).map((change) => [String(change.id), change]));
  const currentReviewFields = (row, change) => {
    const current = { ...row, status: change.status };
    for (const field of ["review_comment", "reviewed_by", "reviewed_at", "owner_subject"])
      if (Object.prototype.hasOwnProperty.call(change, field)) current[field] = change[field];
    return current;
  };
  // Version history is a historical snapshot. The owned record-change list is
  // the live status source, keyed by the exact change ID to avoid crossing
  // revisions or edits that share the same Plant/Species target.
  const currentVersions = versions.map((version) => {
    const changeId = version?.change_id;
    const change = changeId == null ? null : currentById.get(String(changeId));
    return change ? currentReviewFields(version, change) : version;
  });
  const currentPriorChanges = priorChanges.map((prior) => {
    const change = prior?.id == null ? null : currentById.get(String(prior.id));
    return change ? currentReviewFields(prior, change) : prior;
  });
  const existingChangeIds = new Set([
    ...currentVersions.map((row) => row?.change_id),
    ...currentPriorChanges.map((row) => row?.id),
  ].filter((id) => id != null).map(String));
  const missing = recordChanges.filter((change) => change?.owner_subject && matchesTarget(change) &&
    !existingChangeIds.has(String(change.id)));
  return {
    history_available: Boolean(response?.history_available || missing.length),
    versions: currentVersions,
    prior_changes: [...currentPriorChanges, ...missing],
  };
}

function statusMatches(status, filter) {
  return filter === "all" || submissionStatus(status) === filter;
}

export function buildSubmissionGroups(records, kind, versionRows = {}, historyAvailability = {}) {
  const uniqueRecords = new Map();
  for (const record of records) {
    const id = kind === "plant" ? record.id : record.request_id;
    if (id != null && !uniqueRecords.has(String(id))) uniqueRecords.set(String(id), record);
  }
  return [...uniqueRecords.entries()].map(([id, record]) => {
    const key = `${kind}:${id}`;
    const versions = (versionRows[key] || []).map((version) => ({ ...version }));
    if (kind === "plant" && record.status !== "Approved" && versions.length === 1 &&
        versions[0].original && versions[0].status === "Pending Review" && record.initialSubmissionStatus &&
        record.initialObservationId && String(versions[0].snapshot?.observation_id) === String(record.initialObservationId))
      versions[0].status = record.initialSubmissionStatus;
    // Legacy edit submissions include both base_snapshot and proposed_snapshot,
    // but have no separate v1 row in record_version_history. Preserve that real
    // original as a row instead of letting the presence of an edit hide it.
    if (versions.length && !versions.some((version) => version.original)) {
      const firstChange = versions.filter((version) => version.priorChangeId && version.raw?.base_snapshot &&
        Object.keys(version.raw.base_snapshot).length > 0)
        .sort((left, right) => (Date.parse(left.createdAt || "") || 0) - (Date.parse(right.createdAt || "") || 0))[0];
      const firstVersionWithBase = versions.filter((version) => version.versionNumber === 2 &&
        version.raw?.previous_snapshot && Object.keys(version.raw.previous_snapshot).length > 0)
        .sort((left, right) => (Date.parse(left.createdAt || "") || 0) - (Date.parse(right.createdAt || "") || 0))[0];
      const baseSource = firstChange || firstVersionWithBase;
      if (baseSource) {
        const fromPriorChange = Boolean(firstChange);
        const snapshot = fromPriorChange ? baseSource.raw.base_snapshot : baseSource.raw.previous_snapshot;
        const originalStatus = kind === "plant" ? record.initialSubmissionStatus || record.status : record.request_status;
        versions.unshift({ key: `base:${key}`, kind, targetId: id,
          ...(fromPriorChange ? { priorChangeId: baseSource.priorChangeId } : { sourceVersionId: baseSource.versionId }),
          priorBase: true, original: true, snapshot, detailSnapshot: kind === "plant" && !snapshot.photo_refs
            ? { ...snapshot, photo_refs: (snapshot.photo_ids || []).map((asset_id) => ({ asset_id })) } : snapshot,
          title: snapshot.scientific_name,
          commonName: snapshot.common_name ?? snapshot.content?.commonName, status: originalStatus,
          createdAt: kind === "plant" ? record.registeredAt : record.submitted_at,
          raw: baseSource.raw });
      }
    }
    const approvedRows = versions.filter((version) => submissionStatus(version.status) === "approved").sort((left, right) => {
      if (left.original !== right.original) return left.original ? -1 : 1;
      return (Date.parse(left.createdAt || "") || 0) - (Date.parse(right.createdAt || "") || 0);
    });
    const latestApproved = approvedRows[approvedRows.length - 1];
    for (const version of versions) {
      if (submissionStatus(version.status) === "approved") {
        version.current = version === latestApproved;
        version.superseded = version !== latestApproved;
      }
    }
    markResolvedCorrections(versions, kind);
    const fallback = versions.length ? null : { key: `record:${key}`, kind, targetId: id,
      status: kind === "plant" ? (record.status !== "Approved" ? record.initialSubmissionStatus || record.status : record.status) : record.request_status,
      createdAt: kind === "plant" ? record.registeredAt : record.submitted_at,
      original: historyAvailability[key] === true, fallback: true, raw: record };
    const rows = versions.length ? versions : [fallback];
    const activity = rows.map((row) => Date.parse(row.createdAt || "")).concat([Date.parse(kind === "plant" ? record.registeredAt || "" : record.submitted_at || "")])
      .filter(Number.isFinite).reduce((latest, time) => Math.max(latest, time), 0);
    return { key, kind, id, record, versions: rows, versionCount: rows.length, activity };
  }).sort((left, right) => right.activity - left.activity || String(right.id).localeCompare(String(left.id), undefined, { numeric: true }));
}

export function filterSubmissionGroups(groups, filter) {
  if (filter === "all") return groups;
  return groups.filter((group) => group.versions.some((version) => statusMatches(version.status, filter)));
}

export function groupStatusSummary(group) {
  const rows = group.versions;
  const approved = rows.filter((row) => submissionStatus(row.status) === "approved");
  const pendingCount = rows.filter((row) => submissionStatus(row.status) === "pending").length;
  const rejectedCount = rows.filter((row) => submissionStatus(row.status) === "rejected").length;
  const current = rows.find((row) => row.current);
  if (approved.length) {
    if (pendingCount) return { status: "Approved", detailKey: "pendingEditCount", count: pendingCount };
    if (rejectedCount) return { status: "Approved", detailKey: "rejectedEditCount", count: rejectedCount };
    if (current?.edited) return { status: "Approved", detailKey: "currentEditSummary", edit: current };
    return { status: "Approved" };
  }
  const latest = rows.slice().reverse().find((row) => row.status);
  return { status: latest?.status || rows[0]?.status || "" };
}

function versionDisplayLabel(row) {
  if (row.original) return t("recordEdits.originalLabel");
  if (row.versionNumber > 1) return t("recordEdits.editNumber", { number: row.versionNumber - 1 });
  if (row.edited) return t("submissions.editWithoutNumber");
  return t("submissions.currentRecord");
}

export function versionDetailParams(row, botanist) {
  const detail = { historicalRecordDetail: true, submissionVersionLabel: versionDisplayLabel(row),
    historicalSnapshot: row.detailSnapshot || row.snapshot || {}, historicalVersionStatus: row.status,
    historicalVersionDate: row.createdAt, historicalReviewedAt: row.priorBase ? "" : row.raw?.reviewed_at || "",
    historicalReviewComment: row.priorBase ? "" : row.raw?.review_comment || "",
    historicalVersionNumber: row.versionNumber, historicalOriginal: Boolean(row.original),
    historicalCurrent: Boolean(row.current), historicalSuperseded: Boolean(row.superseded),
    historicalSubmittedBy: row.raw?.owner_subject === `staff:${botanist?.id}`
      ? botanist?.name || "" : "", historicalPhotos: row.historicalPhotos || [] };
  if (row.priorBase) return { kind: row.kind, targetId: row.targetId, botanist, ...detail,
    ...(row.sourceVersionId ? { versionId: row.sourceVersionId, versionSnapshot: "previous" }
      : { priorChangeId: row.priorChangeId, priorChangeVersion: "original" }),
    originalStatus: row.status, originalCreatedAt: row.createdAt };
  return { kind: row.kind, targetId: row.targetId, botanist, ...detail,
    ...(row.versionId ? { versionId: row.versionId } : { priorChangeId: row.priorChangeId }) };
}

export function submissionVersionRoute(row, botanist) {
  if (row.current && row.status === "Approved") return row.kind === "plant"
    ? ["BotanistPlantDetail", { plantId: row.targetId, botanist }]
    : ["BotanistSpeciesRequestDetail", { requestId: String(row.targetId), botanist }];
  const selectedChangeId = row.priorChangeId != null &&
    row.raw?.owner_subject === `staff:${botanist?.id}` &&
    ["Pending Review", "Correction Required"].includes(row.status)
    ? String(row.priorChangeId) : undefined;
  const params = { ...versionDetailParams(row, botanist), historicalRecordDetail: true,
    ...(selectedChangeId ? { selectedChangeId } : {}) };
  return row.kind === "plant"
    ? ["BotanistPlantDetail", { ...params, plantId: row.targetId }]
    : ["BotanistSpeciesRequestDetail", { ...params, requestId: String(row.targetId) }];
}

function versionPhotoSource(token, row) {
  const base = `${mobileApiUrl("plant")}/api`;
  // The live species-request photo endpoint can return a newer photo than the
  // selected historical snapshot. Only version/change endpoints are safe here.
  if (row.priorBase && row.kind === "species") return null;
  if (row.priorBase && row.kind === "plant") {
    const photoId = row.snapshot?.photo_ids?.[0];
    return photoId ? { uri: `${base}/assets/${encodeURIComponent(photoId)}?scope=mine`, headers: { Authorization: `Bearer ${token}` } } : null;
  }
  if (row.priorChangeId != null && row.kind === "species" && Number(row.raw?.proposal_photo_count) > 0)
    return { uri: `${base}/record-changes/${encodeURIComponent(row.priorChangeId)}/photos/0`, headers: { Authorization: `Bearer ${token}` } };
  if (row.kind === "species") return row.raw?.has_species_photo
    ? { uri: `${base}/record-versions/${encodeURIComponent(row.raw.id)}/photo`, headers: { Authorization: `Bearer ${token}` } } : null;
  if (row.priorChangeId != null) {
    const photoId = row.raw?.proposed_snapshot?.photo_ids?.[0] ?? row.raw?.base_snapshot?.photo_ids?.[0];
    if (photoId) return { uri: `${base}/assets/${encodeURIComponent(photoId)}?scope=mine`, headers: { Authorization: `Bearer ${token}` } };
    if (Number(row.raw?.proposal_photo_count) > 0)
      return { uri: `${base}/record-changes/${encodeURIComponent(row.priorChangeId)}/photos/0`, headers: { Authorization: `Bearer ${token}` } };
  }
  const ref = row.snapshot?.photo_refs?.[0];
  if (ref?.asset_id) return { uri: `${base}/assets/${encodeURIComponent(ref.asset_id)}?scope=mine`, headers: { Authorization: `Bearer ${token}` } };
  if (ref?.change_id != null) return { uri: `${base}/record-changes/${encodeURIComponent(ref.change_id)}/photos/${ref.change_photo_index}`, headers: { Authorization: `Bearer ${token}` } };
  return null;
}

export function versionPhotoSources(token, row) {
  if (row.kind === "species") {
    if (row.priorChangeId != null && !(Number(row.raw?.proposal_photo_count) > 0)) return [];
    const source = versionPhotoSource(token, row);
    return source ? [source] : [];
  }
  const base = `${mobileApiUrl("plant")}/api`;
  const snapshot = row.detailSnapshot || row.snapshot || {};
  const refs = Array.isArray(snapshot.photo_refs) ? snapshot.photo_refs
    : (snapshot.photo_ids || []).map((asset_id) => ({ asset_id }));
  return refs.map((ref) => ref.asset_id
    ? { uri: `${base}/assets/${encodeURIComponent(ref.asset_id)}?scope=mine`, headers: { Authorization: `Bearer ${token}` } }
    : ref.change_id != null
      ? { uri: `${base}/record-changes/${encodeURIComponent(ref.change_id)}/photos/${ref.change_photo_index}`, headers: { Authorization: `Bearer ${token}` } }
      : null).filter(Boolean);
}

export default function BotanistDashboardScreen({ route, navigation, onLogout }) {
  useAppTranslation();
  const { width } = useWindowDimensions();
  const tablet = width >= 768;
  const botanist = route.params?.botanist;
  const { unreadCount, error: notificationError } = useBotanistNotifications(botanist?.id);
  const { plants, observations, requests, edits, recordChanges, loading, loaded, error, refresh } = useBotanistRecords(botanist?.id);
  const pendingApproval = plants.filter((plant) => submissionStatus(plant.status) === "pending");
  const approvedPlants = plants.filter((plant) => submissionStatus(plant.status) === "approved");
  const correctionRequests = correctionTasks(plants, observations, requests, botanist?.id, edits, recordChanges);
  const handleLogout = () => onLogout ? onLogout() : navigation.goBack();
  const handleAddPlant = () => navigation.navigate("AddPlant", { botanist });
  const handleQRCodeManagement = () => navigation.navigate("PlantQRCode", { botanist });
  const statValue = (value) => !loaded && loading
    ? <View style={styles.statValueLoading}><ActivityIndicator size="small" color="#2F6B4F" /></View>
    : <Text style={styles.statNumber}>{!loaded && error ? "\u2014" : value}</Text>;
  return <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.listContent, tablet && styles.tabletListContent]} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => { void refresh(); }} tintColor="#2F6B4F" />}>
      <View style={styles.headerContent}>
        <View style={styles.hero}>
          <View style={styles.heroCopy}>
            <Text style={styles.greeting} numberOfLines={2} adjustsFontSizeToFit>{t("botanistDashboard.hello")} {botanist?.name || t("botanistDashboard.botanist")}</Text>
            <Text style={styles.role}>{t("botanistDashboard.botanist")}</Text>
            <Text style={styles.heroSubtitle}>{t("botanistDashboard.manageYourPlantRecords")}</Text>
          </View>
          <Ionicons name="leaf" size={94} color="#2F6B4F" style={styles.heroLeaf} />
          <View style={styles.headerActions}>
            <LanguageSelector />
            <TouchableOpacity style={styles.iconButton} onPress={() => navigation.navigate("BotanistNotifications")} activeOpacity={0.75} accessibilityRole="button" accessibilityLabel={notificationError ? t("botanistDashboard.notificationsUpdatesCouldNotRefresh") : t("botanistDashboard.notificationsUnread", { unreadCount })}>
              <Ionicons name="notifications-outline" size={21} color="#2F6B4F" />
              {unreadCount > 0 && <View style={styles.notificationBadge}><Text style={styles.notificationBadgeText}>{unreadCount > 99 ? "99+" : unreadCount}</Text></View>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconButton} onPress={handleLogout} activeOpacity={0.75} accessibilityRole="button" accessibilityLabel={t("botanistDashboard.logout")}><Ionicons name="log-out-outline" size={21} color="#2F6B4F" /></TouchableOpacity>
          </View>
        </View>
        <View style={styles.statsRow}>
          <View testID="dashboard-stat-plants" style={[styles.statCard, styles.plantsStat]}><Ionicons name="leaf-outline" size={21} color="#2F6B4F" />{statValue(plants.length)}<Text style={styles.statLabel}>{t("botanistDashboard.myPlants")}</Text></View>
          <View testID="dashboard-stat-pending" style={[styles.statCard, styles.pendingStat]}><Ionicons name="hourglass-outline" size={21} color="#2F6B4F" />{statValue(pendingApproval.length)}<Text style={styles.statLabel}>{t("botanistDashboard.pendingApproval")}</Text></View>
          <View testID="dashboard-stat-approved" style={[styles.statCard, styles.approvedStat]}><Ionicons name="checkmark-circle-outline" size={21} color="#2F6B4F" />{statValue(approvedPlants.length)}<Text style={styles.statLabel}>{t("botanistDashboard.approved")}</Text></View>
        </View>
        <Text style={styles.sectionTitle}>{t("common.dashboard")}</Text>
        <View style={styles.dashboardGrid}>
          <TouchableOpacity testID="dashboard-qr" style={[styles.dashboardCard, styles.qrCard]} onPress={handleQRCodeManagement} activeOpacity={0.82} accessibilityRole="button"><View style={[styles.dashboardIcon, styles.qrIcon]}><Ionicons name="qr-code-outline" size={26} color="#2F6B4F" /></View><Text style={styles.dashboardCardTitle}>{t("botanistDashboard.qrCodeManagement")}</Text><Ionicons name="arrow-forward" size={18} color="#2F6B4F" style={styles.dashboardArrow} /></TouchableOpacity>
          <TouchableOpacity testID="dashboard-add-plant" style={[styles.dashboardCard, styles.addPlantCard]} onPress={handleAddPlant} activeOpacity={0.82} accessibilityRole="button"><View style={[styles.dashboardIcon, styles.addPlantIcon]}><Ionicons name="leaf-outline" size={26} color="#2F6B4F" /><Ionicons name="add" size={15} color="#2F6B4F" style={styles.addGlyph} /></View><Text style={styles.dashboardCardTitle}>{t("botanistDashboard.addPlantCard")}</Text><Ionicons name="arrow-forward" size={18} color="#2F6B4F" style={styles.dashboardArrow} /></TouchableOpacity>
          <TouchableOpacity testID="dashboard-submissions" style={[styles.dashboardCard, styles.submissionsCard]} onPress={() => navigation.navigate("BotanistSubmissions", { botanist })} activeOpacity={0.82} accessibilityRole="button"><View style={[styles.dashboardIcon, styles.submissionsIcon]}><Ionicons name="documents-outline" size={26} color="#2F6B4F" /></View><Text style={styles.dashboardCardTitle}>{t("submissions.title")}</Text><Ionicons name="arrow-forward" size={18} color="#2F6B4F" style={styles.dashboardArrow} /></TouchableOpacity>
          <TouchableOpacity testID="dashboard-my-observations" style={[styles.dashboardCard, styles.observationsCard]} onPress={() => navigation.navigate("BotanistMyObservations", { botanist })} activeOpacity={0.82} accessibilityRole="button"><View style={[styles.dashboardIcon, styles.observationsIcon]}><Ionicons name="leaf-outline" size={26} color="#2F6B4F" /></View><Text style={styles.dashboardCardTitle}>{t("myObservations.title")}</Text><Ionicons name="arrow-forward" size={18} color="#2F6B4F" style={styles.dashboardArrow} /></TouchableOpacity>
          <TouchableOpacity testID="dashboard-my-draft" style={[styles.dashboardCard, styles.myDraftCard]} onPress={() => navigation.navigate("BotanistMyDrafts", { botanist })} activeOpacity={0.82} accessibilityRole="button" accessibilityLabel={t("botanistDashboard.myDraft")}><View style={[styles.dashboardIcon, styles.myDraftIcon]}><Ionicons name="document-text-outline" size={26} color="#2F6B4F" /></View><Text style={styles.dashboardCardTitle}>{t("botanistDashboard.myDraft")}</Text><Ionicons name="arrow-forward" size={18} color="#2F6B4F" style={styles.dashboardArrow} /></TouchableOpacity>
          <TouchableOpacity testID="dashboard-corrections" style={[styles.dashboardCard, styles.correctionsCard]} onPress={() => navigation.navigate("BotanistCorrectionRequests", { botanist })} activeOpacity={0.82} accessibilityRole="button" accessibilityLabel={`${t("botanistDashboard.correctionRequests")}${loaded && !error && correctionRequests.length ? `, ${correctionRequests.length}` : ""}`}><View style={[styles.dashboardIcon, styles.correctionsIcon]}><Ionicons name="clipboard-outline" size={26} color="#2F6B4F" /></View><Text style={styles.dashboardCardTitle}>{t("botanistDashboard.correctionRequests")}</Text>{loaded && !error && correctionRequests.length > 0 && <View testID="correction-request-badge" style={styles.correctionCardBadge}><Text style={styles.notificationBadgeText}>{correctionRequests.length > 99 ? "99+" : correctionRequests.length}</Text></View>}<Ionicons name="arrow-forward" size={18} color="#2F6B4F" style={styles.dashboardArrow} /></TouchableOpacity>
        </View>
      </View>
    </ScrollView>
  </SafeAreaView>;
}

export function BotanistSubmissionsScreen({ route, navigation }) {
  useAppTranslation();
  const { width } = useWindowDimensions();
  const tablet = width >= 768;
  const botanist = route.params?.botanist;
  const accountId = botanist?.id;
  const { plants, requests, recordChanges, loading, loaded, error, refresh } = useBotanistRecords(accountId);
  const [versionRows, setVersionRows] = useState({});
  const [versionHistoryAvailable, setVersionHistoryAvailable] = useState({});
  const versionRowsRef = useRef({});
  const versionHistoryAvailableRef = useRef({});
  const loadedAccountRef = useRef(accountId);
  const [versionLoading, setVersionLoading] = useState(false);
  const [versionLoadFailed, setVersionLoadFailed] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState({});
  const expandMatchesRef = useRef(null);
  const autoOpenedTargetRef = useRef(null);
  const activeTabRef = useRef("plants");
  const [tab, setTab] = useState("plants");
  const [filter, setFilter] = useState("all");

  useFocusEffect(useCallback(() => {
    let active = true;
    if (!loaded || !accountId) {
      setVersionLoading(false);
      return () => { active = false; };
    }
    if (loadedAccountRef.current !== accountId) {
      loadedAccountRef.current = accountId;
      versionRowsRef.current = {}; versionHistoryAvailableRef.current = {};
      setVersionRows({}); setVersionHistoryAvailable({}); setExpandedGroups({});
    }
    setVersionLoadFailed(false);
    setVersionLoading(true);
    const targets = [...new Map([
      ...plants.map((item) => ({ kind: "plant", id: item.id })),
      ...requests.map((item) => ({ kind: "species", id: item.request_id })),
    ].filter((item) => item.id != null).map((item) => [item.kind + ":" + item.id, item])).values()];
    const loadVersions = async () => {
      const loadedRows = {}, availability = {};
      let failed = false;
      for (let offset = 0; offset < targets.length; offset += 5) {
        const batch = await Promise.all(targets.slice(offset, offset + 5).map(async ({ kind, id }) => {
          const key = kind + ":" + id;
          try {
            const response = await plantApi("/record-versions?kind=" + kind + "&id=" + encodeURIComponent(id), { expectedAccountId: accountId });
            const complete = mergeRecordChangeSubmissions(kind, id, response, recordChanges);
            return [key, versionCardItems(kind, id, complete), Boolean(complete.history_available)];
          } catch {
            failed = true;
            const complete = mergeRecordChangeSubmissions(kind, id, null, recordChanges);
            return [key, versionCardItems(kind, id, complete), Boolean(complete.history_available)];
          }
        }));
        for (const result of batch) if (result) {
          if (result[1] !== null) loadedRows[result[0]] = result[1];
          availability[result[0]] = result[2];
        }
      }
      try {
        await faceSession.withToken(async (token, user) => {
          if (user.id !== accountId) throw Error("Account changed");
          for (const rows of Object.values(loadedRows)) for (const row of rows) {
            row.thumbnail = versionPhotoSource(token, row);
            row.historicalPhotos = versionPhotoSources(token, row);
          }
        });
      } catch { /* Keep version rows; their snapshots remain available through the detail screen. */ }
      if (active) {
        versionRowsRef.current = { ...versionRowsRef.current, ...loadedRows };
        versionHistoryAvailableRef.current = { ...versionHistoryAvailableRef.current, ...availability };
        setVersionRows(versionRowsRef.current);
        setVersionHistoryAvailable(versionHistoryAvailableRef.current);
        setVersionLoadFailed(failed);
        setVersionLoading(false);
        const filterToExpand = expandMatchesRef.current;
        if (filterToExpand) {
          const activeKind = activeTabRef.current === "plants" ? "plant" : "species";
          const activeRecords = activeTabRef.current === "plants" ? plants : requests;
          const matching = filterSubmissionGroups(buildSubmissionGroups(activeRecords, activeKind,
            versionRowsRef.current, versionHistoryAvailableRef.current), filterToExpand);
          if (matching.length) setExpandedGroups((old) => ({ ...old, ...Object.fromEntries(matching.map((group) => [group.key, true])) }));
          expandMatchesRef.current = null;
        }
      }
    };
    void loadVersions();
    return () => { active = false; };
  }, [loaded, accountId, plants, requests, recordChanges]));

  const records = tab === "plants" ? plants : requests;
  const kind = tab === "plants" ? "plant" : "species";
  const groups = buildSubmissionGroups(records, kind, versionRows, versionHistoryAvailable);
  const data = filterSubmissionGroups(groups, filter);
  const selectFilter = (value) => {
    setFilter(value);
    if (value === "all") { expandMatchesRef.current = null; return; }
    const currentlyMatching = filterSubmissionGroups(groups, value);
    if (currentlyMatching.length)
      setExpandedGroups((old) => ({ ...old, ...Object.fromEntries(currentlyMatching.map((group) => [group.key, true])) }));
    const versionsStillLoading = versionLoading || groups.some((group) => !(group.key in versionHistoryAvailable));
    if (versionsStillLoading) { expandMatchesRef.current = value; return; }
    expandMatchesRef.current = null;
  };
  const toggleGroup = (key) => setExpandedGroups((old) => ({ ...old, [key]: !old[key] }));
  const openRecord = useCallback((group, selectedKind = tab) => {
    const item = group.record;
    return selectedKind === "plants" || selectedKind === "plant"
      ? navigation.navigate("BotanistPlantDetail", { plantId: item.id, botanist, plant: item })
      : navigation.navigate("BotanistSpeciesRequestDetail", { requestId: String(item.request_id), botanist });
  }, [tab, navigation, botanist]);
  const openVersion = useCallback((version) => navigation.navigate(...submissionVersionRoute(version, botanist)), [navigation, botanist]);

  useEffect(() => {
    const target = route.params?.openTarget;
    if (!target) { autoOpenedTargetRef.current = null; return; }
    if (!loaded || loading || error) return;
    const kind = target.kind === "species" ? "species" : "plant";
    const recordId = String(target.recordId ?? "");
    if (!recordId) return;
    const requestKey = `${kind}:${recordId}:${String(target.changeId ?? "")}`;
    if (autoOpenedTargetRef.current === requestKey) return;
    const tabName = kind === "plant" ? "plants" : "requests";
    activeTabRef.current = tabName;
    // Deep links should leave the Botanist in the matching category even if
    // the newly submitted item has not appeared in the refreshed response yet.
    setTab(tabName);
    setFilter("all");
    const targetRecords = kind === "plant" ? plants : requests;
    const targetRecord = targetRecords.find((record) => String(kind === "plant" ? record.id : record.request_id) === recordId);
    if (!targetRecord) {
      autoOpenedTargetRef.current = requestKey;
      navigation.setParams({ openTarget: undefined });
      return;
    }
    const groupKey = `${kind}:${recordId}`;
    const group = buildSubmissionGroups([targetRecord], kind, versionRows, versionHistoryAvailable)[0];
    if (target.changeId) {
      if (versionLoading || !Object.prototype.hasOwnProperty.call(versionHistoryAvailable, groupKey)) return;
      const version = group.versions.find((row) =>
        String(row.priorChangeId ?? row.versionId ?? "") === String(target.changeId)
      );
      if (version) openVersion(version);
      else {
        // Keep the target version's group visible when history details are not
        // available, without opening a different version.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setExpandedGroups((old) => ({ ...old, [groupKey]: true }));
      }
    } else openRecord(group, kind);
    autoOpenedTargetRef.current = requestKey;
    navigation.setParams({ openTarget: undefined });
  }, [route.params?.openTarget, loaded, loading, error, plants, requests, versionRows, versionHistoryAvailable, versionLoading, botanist, navigation, openRecord, openVersion]);

  const record = ({ item: group }) => {
    const isPlant = tab === "plants";
    const parent = group.record;
    const lastVersion = group.versions.slice().reverse().find((version) => !version.fallback) || group.versions[0];
    const identifier = isPlant ? parent.id : parent.request_id;
    const name = isPlant
      ? lastVersion?.title || parent.scientificName || parent.commonName || parent.name
      : lastVersion?.title || parent.scientific_name || lastVersion?.commonName || parent.common_name;
    const scientificName = isPlant ? parent.speciesDetails?.scientificName : lastVersion?.commonName || parent.common_name;
    const summary = groupStatusSummary(group);
    const summaryDetail = summary.detailKey === "pendingEditCount" || summary.detailKey === "rejectedEditCount"
      ? t("submissions." + summary.detailKey.replace("Count", summary.count === 1 ? "One" : "Many"), { count: summary.count })
      : summary.detailKey === "currentEditSummary" ? t("submissions.currentEditSummary", { edit: versionDisplayLabel(summary.edit) }) : "";
    const thumbnail = lastVersion?.thumbnail || parent.thumbnail;
    const expanded = Boolean(expandedGroups[group.key]);
    return <View testID={(isPlant ? "submission-plant-group-" : "submission-species-group-") + identifier} style={styles.groupCard}>
      <TouchableOpacity testID={"submission-group-toggle-" + group.key} style={styles.groupHeader} activeOpacity={0.78}
        accessibilityRole="button" accessibilityState={{ expanded }}
        accessibilityLabel={t(isPlant ? "submissions.plantId" : "submissions.requestId") + " " + identifier + ", " + (name || t("submissions.notRecorded")) + ", " + t(group.versionCount === 1 ? "submissions.oneVersion" : "submissions.versionCount", { count: group.versionCount })}
        accessibilityHint={t("submissions.viewVersions")}
        onPress={() => toggleGroup(group.key)}>
        <View style={styles.groupTop}>
          {thumbnail ? <Image source={thumbnail} style={styles.thumbnail} accessibilityLabel={t("submissions.photo")} />
            : <View style={styles.thumbnailPlaceholder}><Ionicons name={isPlant ? "leaf-outline" : "flask-outline"} size={25} color="#2F6B4F" /></View>}
          <View style={styles.plantInfo}>
            <Text style={styles.recordType}>{t(isPlant ? "submissions.plantId" : "submissions.requestId")} {identifier}</Text>
            <Text style={styles.scientificName} numberOfLines={2}>{name || t("submissions.notRecorded")}</Text>
            {!!scientificName && scientificName !== name && <Text style={styles.commonName} numberOfLines={2}>{t(isPlant ? "submissions.speciesScientificName" : "submissions.commonName")}: {scientificName}</Text>}
          <Text style={styles.versionCount}>{t(group.versionCount === 1 ? "submissions.oneVersion" : "submissions.versionCount", { count: group.versionCount })}</Text>
          </View>
          <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={21} color="#2F6B4F" />
        </View>
        <View style={styles.groupSummary}>
          {!!summary.status && statusBadge(summary.status)}
          {!!summaryDetail && <Text style={styles.groupSummaryDetail} numberOfLines={1}>{summaryDetail}</Text>}
        </View>
      </TouchableOpacity>
      {expanded && <View style={styles.versionList}>{group.versions.map((version) => {
        const matchesFilter = filter !== "all" && statusMatches(version.status, filter);
        const date = version.createdAt && Number.isFinite(Date.parse(version.createdAt)) ? new Date(version.createdAt).toLocaleDateString() : "";
        return <TouchableOpacity key={version.key} testID={"submission-version-" + group.key + "-" + version.key}
          style={[styles.versionRow, matchesFilter && styles.matchingVersionRow]} activeOpacity={0.78}
          accessibilityRole="button" accessibilityLabel={versionDisplayLabel(version) + ", " + (version.correctionResolved
            ? t("recordEdits.correctionResolvedLabel") + ", " + t("recordEdits.supersededLabel") : translateLabel(version.status || ""))}
          onPress={() => version.fallback ? openRecord(group) : openVersion(version)}>
          <View style={styles.versionRowMain}>
            <Text style={styles.versionRowTitle}>{versionDisplayLabel(version)}</Text>
            {!!date && <Text style={styles.versionRowDate}>{t("submissions.submitted")}: {date}</Text>}
          </View>
          <View style={styles.versionRowBadges}>
            {!!version.status && statusBadge(version.status, version.correctionResolved)}
            {version.current && <View style={[styles.versionBadge, styles.currentVersionBadge]}><Text style={styles.currentVersionText}>{t("recordEdits.currentVersionLabel")}</Text></View>}
            {(version.superseded || version.correctionResolved) && <View style={[styles.versionBadge, styles.supersededVersionBadge]}><Text style={styles.supersededVersionText}>{t("recordEdits.supersededLabel")}</Text></View>}
          </View>
          <Ionicons name="chevron-forward" size={18} color="#718078" />
        </TouchableOpacity>;
      })}</View>}
    </View>;
  };
  const empty = loading && !loaded ? t("botanistRecords.loading")
    : error ? error.split("\n").map(translateUIMessage).join("\n")
      : filter !== "all" ? t("submissions.noMatchingRecords")
        : t(tab === "plants" ? "submissions.noPlants" : "submissions.noRequests");
  const plantCount = buildSubmissionGroups(plants, "plant").length;
  const requestCount = buildSubmissionGroups(requests, "species").length;

  return <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}><FlatList
    data={data} keyExtractor={(item) => item.key} renderItem={record} refreshing={loading} onRefresh={() => { void refresh(); }}
    contentContainerStyle={[styles.listContent, tablet && styles.tabletListContent, !data.length && styles.emptyList]}
    ListHeaderComponent={<View style={styles.pageHeaderContent}><View style={styles.pageHeading}><Text style={styles.pageTitle}>{t("submissions.title")}</Text></View>
      <View style={styles.tabs} accessibilityRole="tablist">{["plants", "requests"].map((value) => <TouchableOpacity key={value} testID={"submissions-tab-" + value} accessibilityRole="tab" accessibilityState={{ selected: tab === value }} onPress={() => { activeTabRef.current = value; expandMatchesRef.current = null; setTab(value); setFilter("all"); }} style={[styles.tab, tab === value && styles.activeTab]}><Ionicons name={value === "plants" ? "leaf-outline" : "flask-outline"} size={17} color={tab === value ? "#FFFFFF" : "#2F6B4F"} /><Text style={[styles.tabLabel, tab === value && styles.activeTabLabel]}>{t(value === "plants" ? "botanistDashboard.myPlantRecords" : "botanistRecords.speciesRequests")}</Text><Text style={[styles.tabCount, tab === value && styles.activeTabLabel]}>{value === "plants" ? plantCount : requestCount}</Text></TouchableOpacity>)}</View>
      <View style={styles.filters}>{["all", "pending", "approved", "rejected", ...(tab === "plants" ? ["withdrawn"] : [])].map((value) => <TouchableOpacity key={value} testID={"submissions-filter-" + value} accessibilityRole="button" accessibilityState={{ selected: filter === value }} onPress={() => selectFilter(value)} style={[styles.filterChip, filter === value && styles.selectedFilter]}><Text style={[styles.filterLabel, filter === value && styles.selectedFilterLabel]}>{t("submissions." + value)}</Text></TouchableOpacity>)}</View>
      {!!error && <Text style={styles.errorText} accessibilityRole="alert">{error.split("\n").map(translateUIMessage).join("\n")}</Text>}
      {versionLoadFailed && <Text style={styles.errorText} accessibilityRole="alert">{t("recordEdits.listHistoryLoadFailed")}</Text>}
    </View>}
    ListEmptyComponent={loading && !loaded && !error
      ? <CardListSkeleton label={t("botanistRecords.loading")} count={3} />
      : <View style={styles.emptyContainer}><Text style={styles.emptyTitle}>{empty}</Text>{error && <TouchableOpacity style={styles.emptyButton} onPress={() => { void refresh(); }}><Text style={styles.emptyButtonText}>{t("common.tryAgain")}</Text></TouchableOpacity>}{!loading && !error && <Text style={styles.emptyText}>{t("submissions.emptyHint")}</Text>}</View>}
    showsVerticalScrollIndicator={false}
  /></SafeAreaView>;
}

export function BotanistCorrectionRequestsScreen({ route, navigation }) {
  useAppTranslation();
  const { width } = useWindowDimensions();
  const tablet = width >= 768;
  const botanist = route.params?.botanist;
  const { plants, observations, requests, edits, recordChanges, loading, loaded, error, refresh } = useBotanistRecords(botanist?.id);
  const corrections = correctionTasks(plants, observations, requests, botanist?.id, edits, recordChanges);
  const [correctionQuery, setCorrectionQuery] = useState("");
  const visibleCorrections = corrections.filter((task) => {
    const label = `${task.id} ${task.plantId || ""} ${task.name} ${task.feedback}`.toLocaleLowerCase();
    return !correctionQuery.trim() || label.includes(correctionQuery.trim().toLocaleLowerCase());
  });
  const openCorrection = async (task) => {
    if (task.kind === "plantEdit" || task.kind === "speciesEdit") {
      try {
        const proposal = await fetchBotanistRecordChange(botanist.id, task.proposalId, { kind: task.kind === "plantEdit" ? "plant" : "species", targetId: task.kind === "plantEdit" ? task.plantId : task.requestId });
        return navigation.navigate(task.kind === "plantEdit" ? "EditPlant" : "EditSpeciesRequest", task.kind === "plantEdit"
          ? { plantId: task.plantId, botanist, correctionChangeId: proposal.id, correction: true }
          : { requestId: task.requestId, botanist, correctionChangeId: proposal.id, correction: true });
      } catch (cause) { return Alert.alert(t("common.error"), translateUIMessage(cause.message)); }
    }
    if (task.kind === "plant") return navigation.navigate("EditPlant", { plantId: task.plantId, botanist, correction: true });
    if (task.kind === "species") return navigation.navigate("EditSpeciesRequest", { requestId: task.id, botanist, correction: true });
    if (task.kind === "observationEdit") {
      try {
        const observation = await ownedNotificationObservation(botanist.id, task.observationId);
        const payload = await plantApi(`/observation-edits/${encodeURIComponent(task.id)}`, { expectedAccountId: botanist.id });
        if (payload.edit?.status !== "Correction Required" || payload.edit?.owner_subject !== `staff:${botanist.id}`) throw Error(t("botanistDashboard.noCorrectionRequests"));
        return navigation.navigate("FieldCollectionEdit", { observation, plantId: observation.plant_id, editRequest: payload.edit });
      } catch (cause) { return Alert.alert(t("common.error"), translateUIMessage(cause.message)); }
    }
    try {
      const observation = await ownedNotificationObservation(botanist.id, task.id);
      if (observation.status !== "Correction Required") return Alert.alert(t("common.error"), t("botanistDashboard.noCorrectionRequests"));
      navigation.navigate("FieldCollectionEdit", { observation, plantId: observation.plant_id });
    } catch (cause) { Alert.alert(t("common.error"), translateUIMessage(cause.message)); }
  };
  const renderCorrection = (task) => {
    const label = ["plant", "plantEdit"].includes(task.kind) ? t("recordEdits.correctPlantRegistration") : ["species", "speciesEdit"].includes(task.kind) ? t("recordEdits.correctSpeciesRequest") : t("fieldCollection.correctObservation");
    return <View key={task.key} testID={`correction-task-${task.key}`} style={styles.correctionCard}>
      <View style={styles.correctionTopRow}>
        <Text style={styles.correctionPlantId}>{["species", "speciesEdit"].includes(task.kind) ? `${t("submissions.requestId")} ${task.kind === "speciesEdit" ? task.requestId : task.id}` : task.plantId ? `${t("submissions.plantId")} ${task.plantId}` : t("myObservations.title")}</Text>
        <View style={styles.correctionStatus}><Text style={styles.correctionStatusText}>{translateLabel(task.status)}</Text></View>
      </View>
      <Text style={styles.recordType}>{t(["plant", "plantEdit"].includes(task.kind) ? "botanistDashboard.myPlantRecords" : ["species", "speciesEdit"].includes(task.kind) ? "botanistRecords.speciesRequests" : "myObservations.title")}</Text>
      <Text style={styles.correctionPlantName}>{task.name || t("submissions.notRecorded")}</Text>
      {["observation", "observationEdit"].includes(task.kind) && <Text style={styles.correctionPlantId}>{t("myObservations.observationId")} {task.observationId || task.id}</Text>}
      <View style={styles.correctionFeedbackSection}><Text style={styles.correctionFeedbackLabel}>{t("notificationObservation.officerFeedback")}</Text><Text style={styles.correctionFeedback}>{task.feedback || t("botanistDashboard.noOfficerNoteProvided")}</Text></View>
      <TouchableOpacity style={styles.correctionEditButton} onPress={() => openCorrection(task)} accessibilityRole="button" accessibilityLabel={label}><Text style={styles.correctionEditButtonText}>{label}</Text></TouchableOpacity>
    </View>;
  };
  return <SafeAreaView style={styles.screen} edges={["top", "left", "right"]}><ScrollView contentContainerStyle={[styles.listContent, tablet && styles.tabletListContent]} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => { void refresh(); }} tintColor="#2F6B4F" />}>
    <View style={styles.pageHeaderContent}><View style={styles.pageHeading}><Text style={styles.pageTitle}>{t("botanistDashboard.correctionRequests")}</Text></View>
      <TextInput style={styles.correctionSearch} value={correctionQuery} onChangeText={setCorrectionQuery}
        placeholder={t("botanistDashboard.searchCorrectionRequests")} placeholderTextColor="#7B8A80"
        accessibilityLabel={t("botanistDashboard.searchCorrectionRequests")} returnKeyType="search" />
      {loaded && !error && <Text style={styles.correctionResultCount}>{t("botanistDashboard.matchingCorrectionRequests", { count: visibleCorrections.length })}</Text>}
      {!!error && <View style={styles.correctionErrorBox}><Text style={styles.correctionErrorText} accessibilityRole="alert">{error.split("\n").map(translateUIMessage).join("\n")}</Text><TouchableOpacity style={styles.correctionRetryButton} onPress={() => { void refresh(); }}><Text style={styles.correctionRetryText}>{t("common.tryAgain")}</Text></TouchableOpacity></View>}
      {!loaded && loading ? <View style={styles.correctionMessage}><ActivityIndicator color="#2F6B4F" /><Text style={styles.correctionEmptyText}>{t("botanistDashboard.loadingCorrectionRequests")}</Text></View> : error && !loaded ? null : !visibleCorrections.length ? <View style={styles.correctionMessage}><Text style={styles.correctionEmptyText}>{corrections.length ? t("botanistDashboard.noMatchingCorrectionRequests") : t("botanistDashboard.noCorrectionRequests")}</Text></View> : visibleCorrections.map(renderCorrection)}
    </View>
  </ScrollView></SafeAreaView>;
}

// STYLES
// =====================================================

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#FAFBF7" },
  listContent: { paddingHorizontal: 14, paddingBottom: 28, width: "100%", alignSelf: "center" },
  tabletListContent: { maxWidth: 1000, paddingHorizontal: 24 },
  headerContent: { width: "100%", maxWidth: 952, alignSelf: "center", paddingTop: 8 },
  hero: { minHeight: 132, flexDirection: "row", alignItems: "center", justifyContent: "space-between", overflow: "hidden", backgroundColor: "#DCEBDD", borderRadius: 24, borderWidth: 1, borderColor: "#C9DEC9", paddingHorizontal: 18, paddingVertical: 16, marginBottom: 16 },
  heroCopy: { flex: 1, minWidth: 0, paddingRight: 7 },
  greeting: { color: "#2F6B4F", fontSize: 23, fontWeight: "800", flexShrink: 1 },
  role: { marginTop: 5, color: "#2F6B4F", fontSize: 14, fontWeight: "600" },
  heroSubtitle: { marginTop: 3, color: "#527064", fontSize: 12 },
  heroLeaf: { position: "absolute", right: 100, bottom: -24, opacity: 0.08 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 7, zIndex: 1 },
  iconButton: { width: 44, height: 44, borderRadius: 14, backgroundColor: "#FAFBF7", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#C9DEC9" },
  notificationBadge: { position: "absolute", top: -4, right: -4, minWidth: 19, height: 19, paddingHorizontal: 4, borderRadius: 10, backgroundColor: "#B84F43", borderWidth: 2, borderColor: "#DCEBDD", alignItems: "center", justifyContent: "center" },
  notificationBadgeText: { color: "#FFFFFF", fontSize: 9, fontWeight: "700" },
  statsRow: { flexDirection: "row", gap: 9, marginBottom: 21 },
  statCard: { flex: 1, minWidth: 0, minHeight: 114, borderRadius: 18, paddingHorizontal: 7, paddingVertical: 12, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  plantsStat: { backgroundColor: "#D5EEDC", borderColor: "#C3E1CC" },
  pendingStat: { backgroundColor: "#F5EBD6", borderColor: "#E8DDC4" },
  approvedStat: { backgroundColor: "#E8EDDA", borderColor: "#D9E1C7" },
  statNumber: { minHeight: 30, marginTop: 3, color: "#2F6B4F", fontSize: 24, fontWeight: "800", textAlign: "center" },
  statValueLoading: { minHeight: 33, justifyContent: "center", marginTop: 3 },
  statLabel: { marginTop: 2, color: "#2F6B4F", fontSize: 11, fontWeight: "600", textAlign: "center", flexShrink: 1 },
  sectionTitle: { color: "#2F6B4F", fontSize: 19, fontWeight: "800", marginBottom: 11 },
  dashboardGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 12 },
  dashboardCard: { flexBasis: "47%", flexGrow: 1, maxWidth: "49%", minHeight: 132, borderRadius: 19, padding: 14, borderWidth: 1, justifyContent: "space-between", shadowColor: "#2F6B4F", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 5, elevation: 1 },
  qrCard: { backgroundColor: "#E2F0E4", borderColor: "#D0E4D3" },
  addPlantCard: { backgroundColor: "#D6E9D9", borderColor: "#C5DDC9" },
  submissionsCard: { backgroundColor: "#D6E9D9", borderColor: "#C5DDC9" },
  observationsCard: { backgroundColor: "#E2F0E4", borderColor: "#D0E4D3" },
  myDraftCard: { backgroundColor: "#E8EDDA", borderColor: "#D9E1C7" },
  correctionsCard: { backgroundColor: "#F5E4D5", borderColor: "#E9D4C1" },
  dashboardIcon: { width: 46, height: 46, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  qrIcon: { backgroundColor: "#D1E6D5" },
  addPlantIcon: { backgroundColor: "#C8E0CC" },
  submissionsIcon: { backgroundColor: "#C8E0CC" },
  observationsIcon: { backgroundColor: "#D1E6D5" },
  myDraftIcon: { backgroundColor: "#DCE5CB" },
  correctionsIcon: { backgroundColor: "#ECD2BC" },
  addGlyph: { position: "absolute", right: 1, bottom: 3, backgroundColor: "#C8E0CC", borderRadius: 9 },
  correctionCardBadge: { position: "absolute", top: 10, right: 10, minWidth: 22, height: 22, paddingHorizontal: 5, borderRadius: 11, backgroundColor: "#B84F43", alignItems: "center", justifyContent: "center", zIndex: 2 },
  pageHeaderContent: { width: "100%", maxWidth: 952, alignSelf: "center", paddingTop: 8 },
  pageHeading: { marginBottom: 18 },
  pageTitle: { color: "#2F6B4F", fontSize: 24, fontWeight: "800" },
  dashboardCardTitle: { marginTop: 11, paddingRight: 18, color: "#2F6B4F", fontSize: 14, fontWeight: "750", lineHeight: 19, flexShrink: 1 },
  dashboardArrow: { position: "absolute", right: 13, bottom: 14 },
  secondaryAction: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 13, borderRadius: 14, backgroundColor: "#FAFBF7", borderWidth: 1, borderColor: "#DCEBDD", marginBottom: 22 },
  secondaryActionText: { flex: 1, color: "#2F6B4F", fontSize: 13, fontWeight: "700" },
  correctionSection: { marginBottom: 22 },
  sectionHeadingRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  correctionCount: { minWidth: 30, height: 30, borderRadius: 15, paddingHorizontal: 8, marginBottom: 11, alignItems: "center", justifyContent: "center", backgroundColor: "#F5E4D5" },
  correctionCountText: { color: "#2F6B4F", fontSize: 13, fontWeight: "800" },
  correctionCard: { padding: 16, marginBottom: 10, borderRadius: 16, borderWidth: 1, borderColor: "#E0EADF", backgroundColor: "#FFFFFF", gap: 7 },
  correctionTopRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 },
  correctionPlantName: { color: "#2F6B4F", fontSize: 16, fontWeight: "700", flexShrink: 1 },
  correctionScientificName: { color: "#52665A", fontSize: 13, fontStyle: "italic", marginTop: 3 },
  correctionPlantId: { color: "#52665A", fontSize: 13, fontWeight: "600", flexShrink: 1 },
  correctionStatus: { alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 15, backgroundColor: "#F8E9D2" },
  correctionStatusText: { color: "#77501D", fontSize: 12, fontWeight: "700" },
  correctionFeedbackSection: { borderTopWidth: 1, borderTopColor: "#E0EADF", paddingTop: 10, marginTop: 2 },
  correctionFeedbackLabel: { color: "#2F6B4F", fontSize: 13, fontWeight: "700", marginBottom: 4 },
  correctionFeedback: { color: "#52665A", fontSize: 14, lineHeight: 21 },
  correctionEditButton: { ...fieldFormStyles.submitButton, marginTop: 4, paddingHorizontal: 14 },
  correctionEditButtonText: fieldFormStyles.submitButtonText,
  correctionMessage: { alignItems: "center", padding: 18, borderRadius: 13, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#DCEBDD" },
  correctionEmptyText: { color: "#718078", fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: 7 },
  correctionErrorBox: { padding: 13, marginBottom: 10, borderRadius: 12, backgroundColor: "#FFF2EB" },
  correctionErrorText: { color: "#A34436", fontSize: 13, lineHeight: 20 },
  correctionRetryButton: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start", paddingHorizontal: 4 },
  correctionRetryText: { color: "#2F6B4F", fontSize: 13, fontWeight: "700" },
  correctionSearch: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: "#DCEBDD", paddingHorizontal: 13, backgroundColor: "#FFFFFF", color: "#2F6B4F", fontSize: 14, marginBottom: 11 },
  correctionResultCount: { color: "#64766B", fontSize: 12, marginTop: -7, marginBottom: 10 },
  submissionsSection: { marginBottom: 10 },
  tabs: { flexDirection: "row", backgroundColor: "#DCEBDD", borderRadius: 14, padding: 4, gap: 4, marginBottom: 12 },
  tab: { flex: 1, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 8, paddingVertical: 12, borderRadius: 11, minHeight: 48 },
  activeTab: { backgroundColor: "#2F6B4F" },
  tabLabel: { color: "#2F6B4F", fontWeight: "700", fontSize: 12, flexShrink: 1 },
  activeTabLabel: { color: "#FFFFFF" },
  tabCount: { color: "#2F6B4F", fontSize: 11, fontWeight: "700" },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 7, marginBottom: 14 },
  filterChip: { borderRadius: 20, paddingHorizontal: 13, paddingVertical: 10, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#DCE8D6", minHeight: 40 },
  selectedFilter: { backgroundColor: "#DCEBDD", borderColor: "#2F6B4F" },
  filterLabel: { color: "#718078", fontSize: 12 },
  selectedFilterLabel: { color: "#2F6B4F", fontWeight: "700" },
  groupCard: { backgroundColor: "#FFFFFF", borderRadius: 16, padding: 13, marginBottom: 10, borderWidth: 1, borderColor: "#DCEBDD", shadowColor: "#2F6B4F", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 6, elevation: 1 },
  groupHeader: { gap: 10 },
  groupTop: { flexDirection: "row", alignItems: "center", gap: 11 },
  recordType: { color: "#2F6B4F", fontSize: 11, fontWeight: "700", marginBottom: 5 },
  thumbnail: { width: 58, height: 68, borderRadius: 12 },
  thumbnailPlaceholder: { width: 58, height: 68, borderRadius: 12, backgroundColor: "#D5EEDC", alignItems: "center", justifyContent: "center" },
  plantInfo: { flex: 1, minWidth: 0, paddingRight: 8 },
  scientificName: { fontSize: 15, fontWeight: "700", fontStyle: "italic", color: "#2F6B4F", flexShrink: 1 },
  commonName: { marginTop: 3, fontSize: 13, color: "#6D7F75", flexShrink: 1 },
  versionCount: { marginTop: 5, color: "#718078", fontSize: 11, fontWeight: "600" },
  groupSummary: { minHeight: 28, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, paddingTop: 9, borderTopWidth: 1, borderTopColor: "#EFF3ED" },
  groupSummaryDetail: { flexShrink: 1, color: "#52665A", fontSize: 12, fontWeight: "600" },
  versionList: { marginTop: 10, gap: 7 },
  versionRow: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingVertical: 9, borderRadius: 11, backgroundColor: "#F7FAF5", borderWidth: 1, borderColor: "#E7EEE3" },
  matchingVersionRow: { backgroundColor: "#E8F2E8", borderColor: "#88AC8D" },
  versionRowMain: { flex: 1, minWidth: 85 },
  versionRowTitle: { color: "#2F6B4F", fontSize: 13, fontWeight: "700" },
  versionRowDate: { color: "#718078", fontSize: 10, marginTop: 4 },
  versionRowBadges: { maxWidth: "55%", flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: 5 },
  badge: { paddingVertical: 5, paddingHorizontal: 9, borderRadius: 8 },
  pendingBadge: { backgroundColor: "#F5EBD6" },
  pendingText: { fontSize: 10, fontWeight: "700", color: "#77501D" },
  approvedBadge: { backgroundColor: "#D5EEDC" },
  approvedText: { fontSize: 10, fontWeight: "700", color: "#2F6B4F" },
  rejectedBadge: { backgroundColor: "#FCE2E2" },
  rejectedText: { fontSize: 10, fontWeight: "700", color: "#B84444" },
  withdrawnBadge: { backgroundColor: "#F4E9E6" },
  withdrawnText: { fontSize: 10, fontWeight: "700", color: "#884B43" },
  versionBadge: { paddingVertical: 5, paddingHorizontal: 9, borderRadius: 8 },
  editedVersionBadge: { backgroundColor: "#E4F0E5" },
  editedVersionText: { fontSize: 10, fontWeight: "700", color: "#526B58" },
  currentVersionBadge: { backgroundColor: "#2F6B4F" },
  currentVersionText: { fontSize: 10, fontWeight: "700", color: "#FFFFFF" },
  supersededVersionBadge: { backgroundColor: "#ECEFED" },
  supersededVersionText: { fontSize: 10, fontWeight: "700", color: "#66736A" },
  resolvedBadge: { backgroundColor: "#E5F2E9" },
  resolvedText: { color: "#28664A", fontSize: 10, fontWeight: "700" },
  errorText: { color: "#A34436", backgroundColor: "#FFF2EB", padding: 12, borderRadius: 10, marginBottom: 10, lineHeight: 20 },
  emptyList: { flexGrow: 1 },
  emptyContainer: { alignItems: "center", justifyContent: "center", paddingHorizontal: 25, paddingVertical: 38 },
  emptyIcon: { fontSize: 42, marginBottom: 12 },
  emptyTitle: { fontSize: 18, fontWeight: "700", color: "#2F6B4F", textAlign: "center" },
  emptyText: { marginTop: 8, textAlign: "center", lineHeight: 20, fontSize: 13, color: "#718078" },
  emptyButton: { marginTop: 18, backgroundColor: "#2F6B4F", paddingVertical: 12, paddingHorizontal: 18, borderRadius: 12, minHeight: 44, justifyContent: "center" },
  emptyButtonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
});
