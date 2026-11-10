import { mobileApiUrl } from "./apiConfiguration.js";

const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const photoError = (code) => Object.assign(Error(code), { code });

export async function downloadPhotoForReuse(fileSystem, source) {
  const authorization = source?.headers?.Authorization || source?.headers?.authorization;
  let photoUrl, apiUrl;
  try {
    photoUrl = new URL(source?.uri);
    apiUrl = new URL(mobileApiUrl("plant"));
  } catch {
    throw photoError("PHOTO_REUSE_UNAVAILABLE");
  }
  if (photoUrl.origin !== apiUrl.origin || !/^\/api\/species-requests\/\d+\/photo$/.test(photoUrl.pathname) ||
    !/^Bearer\s+\S+$/i.test(authorization || ""))
    throw photoError("PHOTO_REUSE_UNAVAILABLE");
  if (!fileSystem.documentDirectory || typeof fileSystem.downloadAsync !== "function")
    throw photoError("PHOTO_REUSE_UNAVAILABLE");

  const directory = `${fileSystem.documentDirectory}photo-reuse/`;
  const target = `${directory}photo-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  let localUri = target;
  try {
    const directoryInfo = await fileSystem.getInfoAsync(directory);
    if (!directoryInfo.exists)
      await fileSystem.makeDirectoryAsync(directory, { intermediates: true });
    const downloaded = await fileSystem.downloadAsync(source.uri, target, { headers: source.headers });
    localUri = downloaded.uri || target;
    if (downloaded.status !== 200)
      throw photoError("PHOTO_REUSE_DOWNLOAD_FAILED");
    const contentType = Object.entries(downloaded.headers || {}).find(([name]) => name.toLowerCase() === "content-type")?.[1]
      ?.split(";")[0].trim().toLowerCase();
    if (!/^image\/(jpeg|png)$/.test(contentType || ""))
      throw photoError("PHOTO_REUSE_UNSUPPORTED_FORMAT");
    const info = await fileSystem.getInfoAsync(localUri);
    if (!info.exists || !Number.isFinite(info.size) || info.size <= 0 || info.size > MAX_PHOTO_BYTES)
      throw photoError("PHOTO_REUSE_TOO_LARGE");
    const base64 = await fileSystem.readAsStringAsync(localUri, { encoding: fileSystem.EncodingType.Base64 });
    if (typeof base64 !== "string" || !base64.length || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64))
      throw photoError("PHOTO_REUSE_DOWNLOAD_FAILED");
    return {
      photo: { content_type: contentType, base64 },
      cleanup: () => fileSystem.deleteAsync(localUri, { idempotent: true }),
    };
  } catch (error) {
    await fileSystem.deleteAsync(localUri, { idempotent: true }).catch(() => {});
    if (String(error?.code || "").startsWith("PHOTO_REUSE_")) throw error;
    throw photoError("PHOTO_REUSE_DOWNLOAD_FAILED");
  }
}
