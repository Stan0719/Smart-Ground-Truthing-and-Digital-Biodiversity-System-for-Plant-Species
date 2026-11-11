import React, { useEffect, useState } from "react";
import { Text, View, StyleSheet } from "react-native";

const COLORS = { background: "#FAFBF7", card: "#FFFFFF", skeleton: "#E8EDDA", border: "#DCEBDD", text: "#2F6B4F", muted: "#718078" };

function useSkeletonDelay(delay = 140) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(timer);
  }, [delay]);
  return visible;
}

export function SkeletonBlock({ width = "100%", height = 14, radius = 8, style }) {
  return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={[styles.block, { width, height, borderRadius: radius }, style]} />;
}

export function DetailSkeletonContent({ label, sections = 3 }) {
  const visible = useSkeletonDelay();
  if (!visible) return null;
  return <View accessibilityLabel={label} style={styles.detailContent}>
    <Text accessibilityRole="text" style={styles.loadingLabel}>{label}</Text>
    <SkeletonBlock height={176} radius={18} style={styles.photo} />
    <View style={styles.titleLines}><SkeletonBlock width="66%" height={23} radius={7} /><SkeletonBlock width="42%" height={13} /></View>
    <View style={styles.metaRow}><SkeletonBlock width="31%" height={29} radius={12} /><SkeletonBlock width="22%" height={29} radius={12} /></View>
    {Array.from({ length: sections }, (_, section) => <View key={section} style={styles.detailCard}>
      <View style={styles.sectionHeading}><SkeletonBlock width={26} height={26} radius={8} /><SkeletonBlock width="48%" height={17} /></View>
      {[0, 1, 2].map((row) => <View key={row} style={styles.detailField}>
        <SkeletonBlock width={row === 1 ? "38%" : "30%"} height={11} />
        <SkeletonBlock width={row === 2 ? "62%" : "82%"} height={14} />
      </View>)}
    </View>)}
  </View>;
}

export function CardListSkeleton({ label, count = 3 }) {
  const visible = useSkeletonDelay();
  if (!visible) return null;
  return <View accessibilityLabel={label} style={styles.listContent}>
    <Text style={styles.loadingLabel}>{label}</Text>
    {Array.from({ length: count }, (_, index) => <View key={index} style={styles.listCard}>
      <SkeletonBlock width={72} height={72} radius={13} />
      <View style={styles.listText}>
        <SkeletonBlock width="72%" height={16} />
        <SkeletonBlock width="49%" height={12} />
        <SkeletonBlock width="38%" height={11} />
      </View>
      <SkeletonBlock width={62} height={25} radius={10} />
      <SkeletonBlock width={16} height={16} radius={8} style={styles.arrow} />
    </View>)}
  </View>;
}

const styles = StyleSheet.create({
  block: { backgroundColor: COLORS.skeleton },
  detailContent: { width: "100%", maxWidth: 900, alignSelf: "center", padding: 16, paddingBottom: 28, gap: 13 },
  loadingLabel: { color: COLORS.muted, fontSize: 13, fontWeight: "600", marginBottom: 2 },
  photo: { borderWidth: 1, borderColor: COLORS.border },
  titleLines: { gap: 9, paddingHorizontal: 2, paddingVertical: 2 },
  metaRow: { flexDirection: "row", gap: 8 },
  detailCard: { padding: 15, gap: 15, backgroundColor: COLORS.card, borderColor: COLORS.border, borderWidth: 1, borderRadius: 17 },
  sectionHeading: { flexDirection: "row", alignItems: "center", gap: 10 },
  detailField: { gap: 7, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border },
  listContent: { gap: 11, padding: 16, paddingBottom: 24 },
  listCard: { minHeight: 104, padding: 13, backgroundColor: COLORS.card, borderWidth: 1, borderColor: COLORS.border, borderRadius: 16, flexDirection: "row", alignItems: "center", gap: 11 },
  listText: { flex: 1, minWidth: 0, gap: 9 }, arrow: { marginLeft: -6 },
});
