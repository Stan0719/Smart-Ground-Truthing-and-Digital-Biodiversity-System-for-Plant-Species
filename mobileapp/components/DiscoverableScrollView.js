import React, { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { FlatList, ScrollView, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useAppTranslation } from "../translations/i18n";
import { hasMoreContent } from "../utils/scrollOverflow";

const DiscoverableScrollView = forwardRef(function DiscoverableScrollView({
  horizontal = false, nested = false, hintKey, asList = false, showHint = true, onContentSizeChange, onLayout, onScroll, style, scrollEnabled = true, ...props
}, ref) {
  const { t } = useAppTranslation();
  const measurements = useRef({ contentSize: 0, viewportSize: 0, offset: 0 });
  const [more, setMore] = useState(false);
  const updateHint = useCallback(() => {
    const { contentSize, viewportSize, offset } = measurements.current;
    setMore(scrollEnabled && hasMoreContent(contentSize, viewportSize, offset));
  }, [scrollEnabled]);
  useEffect(updateHint, [updateHint]);
  const sizeChanged = useCallback((width, height) => {
    measurements.current.contentSize = horizontal ? width : height;
    updateHint();
    onContentSizeChange?.(width, height);
  }, [horizontal, onContentSizeChange, updateHint]);
  const layoutChanged = useCallback((event) => {
    measurements.current.viewportSize = horizontal ? event.nativeEvent.layout.width : event.nativeEvent.layout.height;
    updateHint();
    onLayout?.(event);
  }, [horizontal, onLayout, updateHint]);
  const scrolled = useCallback((event) => {
    measurements.current.offset = horizontal ? event.nativeEvent.contentOffset.x : event.nativeEvent.contentOffset.y;
    updateHint();
    onScroll?.(event);
  }, [horizontal, onScroll, updateHint]);
  const ScrollComponent = asList ? FlatList : ScrollView;

  const label = t(hintKey || (horizontal ? "scrollHints.horizontal" : "scrollHints.vertical"));
  return <View style={horizontal || nested ? styles.horizontalContainer : styles.container}>
    <ScrollComponent {...props} ref={ref} style={[horizontal || nested ? styles.horizontalScroll : styles.scroll, style]} horizontal={horizontal}
      scrollEnabled={scrollEnabled} onContentSizeChange={sizeChanged} onLayout={layoutChanged}
      onScroll={scrolled} scrollEventThrottle={32}
      showsVerticalScrollIndicator={!horizontal} showsHorizontalScrollIndicator={horizontal} />
    {showHint && more && <View style={styles.hint} accessible accessibilityRole="text" accessibilityLabel={label}>
      <Ionicons name={horizontal ? "chevron-forward" : "chevron-down"} size={14} color="#526C5A" accessibilityElementsHidden />
      <Text style={styles.hintText}>{label}</Text>
    </View>}
  </View>;
});

const styles = StyleSheet.create({
  container: { flex: 1 }, scroll: { flex: 1 },
  horizontalContainer: { flexGrow: 0 }, horizontalScroll: { flexGrow: 0 },
  hint: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4,
    paddingHorizontal: 12, paddingVertical: 3 },
  hintText: { color: "#526C5A", fontSize: 13, fontWeight: "500", flexShrink: 1, textAlign: "center" },
});

export default DiscoverableScrollView;
