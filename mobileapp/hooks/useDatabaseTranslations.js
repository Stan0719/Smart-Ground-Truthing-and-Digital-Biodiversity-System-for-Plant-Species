import { useEffect, useMemo, useState } from "react";
import { useAppTranslation } from "../translations/i18n";
import {
  createDatabaseContentTranslator,
  databaseContentDisplayKey,
  localeForBackend,
} from "../translations/databaseContent";
import { requestMobileDatabaseTranslations } from "../utils/plantApi";

const translator = createDatabaseContentTranslator(requestMobileDatabaseTranslations);

export default function useDatabaseTranslations(fields, { accountId = null, publicOnly = false } = {}) {
  const { i18n } = useAppTranslation();
  const language = i18n.resolvedLanguage || i18n.language || "en";
  const locale = localeForBackend(language);
  const fieldsSignature = JSON.stringify(fields || []);
  const normalizedFields = useMemo(() => {
    const candidates = JSON.parse(fieldsSignature);
    return (Array.isArray(candidates) ? candidates : []).filter((field) =>
      field && typeof field.recordType === "string" && typeof field.recordId === "string" &&
      typeof field.fieldName === "string" && typeof field.sourceText === "string" && field.sourceText.trim(),
    );
  }, [fieldsSignature]);
  const [translatedValues, setTranslatedValues] = useState({});

  useEffect(() => {
    let active = true;
    if (!locale) return () => { active = false; };
    void translator.translateFields(normalizedFields, language, accountId, { publicOnly }).then((result) => {
      if (active && (i18n.resolvedLanguage || i18n.language || "en") === language)
        setTranslatedValues((current) => ({ ...current, ...result }));
    });
    return () => { active = false; };
  }, [locale, language, accountId, publicOnly, fieldsSignature, i18n, normalizedFields]);

  return (field) => {
    if (!field || !locale) return field?.sourceText ?? "";
    return translatedValues[databaseContentDisplayKey(field, locale, accountId)] || field.sourceText || "";
  };
}
