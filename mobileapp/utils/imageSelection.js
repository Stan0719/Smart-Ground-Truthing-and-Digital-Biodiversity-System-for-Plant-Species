export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const base64Bytes = (base64) => Math.floor(base64.length * 3 / 4) - (base64.match(/=*$/)?.[0].length || 0);

export async function inspectPickedImages(assets, labels, getInfoAsync) {
  const accepted = [], rejected = [];
  for (let index = 0; index < (assets || []).length; index += 1) {
    const asset = assets[index];
    if (!asset?.uri) continue;
    let bytes = null;
    if (getInfoAsync) {
      try {
        const info = await getInfoAsync(asset.uri);
        bytes = info?.exists && Number.isFinite(info.size) ? info.size : null;
      } catch { /* A missing file size must never replace a valid selection. */ }
    }
    // Picker metadata may describe the original asset rather than the local file to upload.
    // Never accept a file whose local size could not be verified.
    if (bytes == null || bytes < 0 || bytes > MAX_IMAGE_BYTES) {
      const name = typeof asset.fileName === "string" ? asset.fileName.split(/[\\/]/).pop()?.trim() : "";
      rejected.push({ label: labels[index] || labels[0], filename: name && name !== "null" && name !== "undefined" ? name : "", bytes });
    } else accepted.push(asset);
  }
  return { accepted, rejected };
}

export function imageSizeAlert(t, rejected) {
  const oversized = rejected.filter((item) => item.bytes > MAX_IMAGE_BYTES);
  const unknown = rejected.length - oversized.length;
  if (!oversized.length) return { title: t("imageSizeAlert.unknownTitle"), message: `${t("imageSizeAlert.unknownSize")}\n\n${t("imageSizeAlert.action")}` };
  const title = t(oversized.length > 1 ? "imageSizeAlert.pluralTitle" : "imageSizeAlert.title");
  const lines = oversized.map((item, index) => {
    const label = item.label || t("imageSizeAlert.photo");
    const filename = typeof item.filename === "string" ? item.filename.split(/[\\/]/).pop()?.trim() : "";
    const name = filename && filename !== "null" && filename !== "undefined" ? `${t("imageSizeAlert.filename")}: ${filename}\n` : "";
    return `${oversized.length > 1 ? `${index + 1}. ` : ""}${t("imageSizeAlert.photo")}: ${label}\n${name}${t("imageSizeAlert.imageSize")}: ${(item.bytes / 1048576).toFixed(1)} MB`;
  });
  const intro = t(oversized.length > 1 ? "imageSizeAlert.pluralIntro" : "imageSizeAlert.intro");
  const unavailable = unknown ? `\n\n${t("imageSizeAlert.unknownSize")}` : "";
  return { title, message: `${intro}\n\n${lines.join("\n\n")}${unavailable}\n\n${t("imageSizeAlert.maximum")}\n\n${t("imageSizeAlert.action")}` };
}
