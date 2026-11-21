export const TEXT_SIZE_STORAGE_KEY = "niah.ui-text-size.v1";
export const TEXT_SIZE_STEPS = [100, 125, 150, 175, 200];

export function createTextSizePreference(storage) {
  let version = 0;
  let pendingSave = Promise.resolve();
  return {
    async restore() {
      const currentVersion = version;
      try {
        const value = Number(await storage.getItem(TEXT_SIZE_STORAGE_KEY));
        return currentVersion === version && TEXT_SIZE_STEPS.includes(value) ? value : 100;
      } catch { return 100; }
    },
    async save(value) {
      if (!TEXT_SIZE_STEPS.includes(value)) throw Error("Unsupported text size.");
      version += 1;
      pendingSave = pendingSave.catch(() => {}).then(() => storage.setItem(TEXT_SIZE_STORAGE_KEY, String(value)));
      await pendingSave;
    },
  };
}

// System scaling remains enabled. The app preference is a minimum effective
// scale, so a large system font is never reduced or multiplied unexpectedly.
export function appTextFactor(percent, systemFontScale = 1) {
  const system = Number.isFinite(systemFontScale) && systemFontScale > 0 ? systemFontScale : 1;
  return Math.max(1, (TEXT_SIZE_STEPS.includes(percent) ? percent : 100) / 100 / system);
}
