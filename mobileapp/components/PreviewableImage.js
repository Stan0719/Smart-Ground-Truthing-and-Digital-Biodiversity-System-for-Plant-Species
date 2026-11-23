import React, { useState } from "react";
import { ActivityIndicator, Alert, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Text from "./ScaledText";
import { t, useAppTranslation } from "../translations/i18n";

export function confirmPhotoRemoval(translate, remove) {
  Alert.alert(translate("imagePreview.removeTitle"), translate("imagePreview.removeMessage"), [
    { text: translate("common.cancel"), style: "cancel" },
    { text: translate("common.delete"), style: "destructive", onPress: remove },
  ]);
}

/** An image with an independent, read-only full-screen preview. Image props stay on the thumbnail. */
export default function PreviewableImage({ source, previewSource, style, accessibilityLabel, onError, onLoad, resizeMode = "cover", ...imageProps }) {
  useAppTranslation();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [retry, setRetry] = useState(0);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const label = accessibilityLabel || t("submissions.photo");
  const close = () => { setOpen(false); setZoom(1); };
  const show = (event) => {
    event?.stopPropagation?.();
    setFailed(false);
    setLoading(true);
    setZoom(1);
    setOpen(true);
  };
  const frame = StyleSheet.flatten(style) || {};
  const imageStyle = [StyleSheet.absoluteFillObject, { width: "100%", height: "100%", borderRadius: frame.borderRadius }];
  const availableHeight = Math.max(200, height - insets.top - insets.bottom - 76);

  return <>
    <Pressable onPress={show} disabled={!source} accessibilityRole="button"
      accessibilityLabel={t("imagePreview.open", { label })}
      style={style}>
      <Image {...imageProps} source={source} style={imageStyle} resizeMode={resizeMode} onError={onError} onLoad={onLoad} />
    </Pressable>
    {open && <Modal visible animationType="fade" onRequestClose={close} statusBarTranslucent={false}>
      <View style={[styles.viewer, { paddingTop: Math.max(12, insets.top), paddingBottom: Math.max(12, insets.bottom) }]}>
        <View style={styles.toolbar}>
          <Pressable onPress={close} accessibilityRole="button" accessibilityLabel={t("plantDetail.closeImageViewer")} style={styles.control}>
            <Text style={styles.controlText}>×</Text>
          </Pressable>
          <View style={styles.zoomControls}>
            <Pressable onPress={() => setZoom((value) => Math.max(1, value - 0.5))} disabled={zoom <= 1}
              accessibilityRole="button" accessibilityLabel={t("imagePreview.zoomOut")} accessibilityState={{ disabled: zoom <= 1 }} style={styles.control}><Text style={styles.controlText}>−</Text></Pressable>
            <Text style={styles.zoomLabel}>{Math.round(zoom * 100)}%</Text>
            <Pressable onPress={() => setZoom((value) => Math.min(3, value + 0.5))} disabled={zoom >= 3}
              accessibilityRole="button" accessibilityLabel={t("imagePreview.zoomIn")} accessibilityState={{ disabled: zoom >= 3 }} style={styles.control}><Text style={styles.controlText}>+</Text></Pressable>
          </View>
        </View>
        <ScrollView horizontal contentContainerStyle={{ minWidth: width, alignItems: "center" }}
          showsHorizontalScrollIndicator={zoom > 1} style={styles.stage}>
          <ScrollView contentContainerStyle={{ minHeight: availableHeight, justifyContent: "center" }}
            showsVerticalScrollIndicator={zoom > 1} minimumZoomScale={1} maximumZoomScale={Platform.OS === "ios" ? 3 : 1}>
            {failed ? <View style={[styles.message, { width, height: availableHeight }]}>
              <Text style={styles.messageText}>{t("recordEdits.informationNotAvailable")}</Text>
              <Pressable onPress={() => { setFailed(false); setLoading(true); setRetry((value) => value + 1); }}
                accessibilityRole="button" style={styles.retry}><Text style={styles.messageText}>{t("common.tryAgain")}</Text></Pressable>
            </View> : <Image key={retry} source={previewSource || source} resizeMode="contain"
              style={{ width: width * zoom, height: availableHeight * zoom }}
              onLoad={() => setLoading(false)} onError={() => { setLoading(false); setFailed(true); }} />}
          </ScrollView>
        </ScrollView>
        {loading && !failed && <ActivityIndicator color="#FFFFFF" style={styles.loading} accessibilityLabel={t("submissions.photo")} />}
      </View>
    </Modal>}
  </>;
}

const styles = StyleSheet.create({
  viewer: { flex: 1, backgroundColor: "#101812" },
  toolbar: { minHeight: 56, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  zoomControls: { flexDirection: "row", alignItems: "center", gap: 8 },
  control: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 22, backgroundColor: "#FFFFFF25" },
  controlText: { color: "#FFFFFF", fontSize: 28, lineHeight: 34 },
  zoomLabel: { color: "#FFFFFF", minWidth: 44, textAlign: "center" },
  stage: { flex: 1 },
  loading: { position: "absolute", top: "50%", alignSelf: "center" },
  message: { justifyContent: "center", alignItems: "center", gap: 16, padding: 24 },
  messageText: { color: "#FFFFFF", textAlign: "center" },
  retry: { minHeight: 44, justifyContent: "center", paddingHorizontal: 16, borderRadius: 10, backgroundColor: "#FFFFFF25" },
});
