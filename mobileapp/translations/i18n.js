import AsyncStorage from "@react-native-async-storage/async-storage";
import { initReactI18next, useTranslation } from "react-i18next";
import en from "./en.json";
import ms from "./ms.json";
import zh from "./zh.json";
import { createDisplayTranslator, createFieldValueTranslator, createLocalization } from "./core";

export const localization = createLocalization({
  storage: AsyncStorage,
  resources: { en: { translation: en }, ms: { translation: ms }, zh: { translation: zh } },
  plugins: [initReactI18next],
});
export const i18n = localization.i18n;
export const t = (key, values) => i18n.t(key, values);
const display = createDisplayTranslator(i18n, en);
export const translateLabel = display.label;
export const translateUIMessage = display.message;
export const useAppTranslation = () => useTranslation(undefined, { i18n });

const fieldLabels = {
  heightCm: "Height (cm)", healthStatus: "Health Status", lifeStage: "Life Stage",
  morphology: "Morphology", taxonomy: "Taxonomy", notes: "Notes",
  latitude: "Latitude", longitude: "Longitude", accuracy_m: "GPS Accuracy (m)",
};
export const translateFieldLabel = (field) => translateLabel(fieldLabels[field] || field);
export const translateFieldValue = createFieldValueTranslator(translateLabel, en, ms, zh);
export const dateLocale = () => i18n.resolvedLanguage === "ms" ? "ms-MY" : i18n.resolvedLanguage === "zh" ? "zh-CN" : "en-GB";
export function formatDateTime(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(dateLocale()) : translateLabel("Not recorded");
}
