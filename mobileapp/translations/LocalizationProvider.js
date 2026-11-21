import React, { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { I18nextProvider } from "react-i18next";
import { i18n, localization } from "./i18n";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { TextSizeContext } from "../components/TextSizeContext";
import { createTextSizePreference } from "../utils/textSizePreference";

const textSizePreference = createTextSizePreference(AsyncStorage);

export default function LocalizationProvider({ children }) {
  const [ready, setReady] = useState(false);
  const [percent, updatePercent] = useState(100);
  useEffect(() => {
    let mounted = true;
    void Promise.all([localization.restoreLanguage(), textSizePreference.restore()]).then(([, savedPercent]) => {
      if (mounted) { updatePercent(savedPercent); setReady(true); }
    });
    return () => { mounted = false; };
  }, []);
  const setPercent = async (value) => { updatePercent(value); await textSizePreference.save(value); };
  if (!ready) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#F7FBF4" }}><ActivityIndicator color="#468585" /></View>;
  return <I18nextProvider i18n={i18n}><TextSizeContext.Provider value={{ percent, setPercent }}>{children}</TextSizeContext.Provider></I18nextProvider>;
}
