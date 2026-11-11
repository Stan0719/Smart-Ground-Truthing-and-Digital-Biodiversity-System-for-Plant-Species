import React, { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { I18nextProvider } from "react-i18next";
import { i18n, localization } from "./i18n";

export default function LocalizationProvider({ children }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let mounted = true;
    void localization.restoreLanguage().then(() => { if (mounted) setReady(true); });
    return () => { mounted = false; };
  }, []);
  if (!ready) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#F7FBF4" }}><ActivityIndicator color="#468585" /></View>;
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
