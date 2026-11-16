export function parsePlantQrPayload(data) {
  let token = String(data || "").trim();
  if (/^https?:\/\//i.test(token)) {
    const scannedUrl = new URL(token);
    const qrRoute = scannedUrl.pathname.match(/\/(?:api\/)?qr\/([^/]+)\/?$/);
    if (!qrRoute) throw new Error("This QR code is not a plant record code.");
    token = decodeURIComponent(qrRoute[1]);
  }
  if (!token || token.length > 200) {
    throw new Error("The scanned QR code does not contain a valid plant token.");
  }
  return token;
}
