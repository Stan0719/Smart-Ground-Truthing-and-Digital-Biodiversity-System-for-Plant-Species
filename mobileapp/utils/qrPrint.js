const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
);

export function qrImageData(svg) {
  return new Promise((resolve, reject) => {
    if (!svg?.toDataURL) return reject(Error("QR image is not ready. Please try printing again."));
    const timer = setTimeout(() => reject(Error("Preparing the QR image timed out. Please try again.")), 10000);
    try {
      svg.toDataURL((data) => {
        clearTimeout(timer);
        if (typeof data !== "string" || !data || !/^[A-Za-z0-9+/=]+$/.test(data)) {
          reject(Error("Could not prepare the QR image for printing."));
        } else resolve(`data:image/png;base64,${data}`);
      }, { width: 1024, height: 1024 });
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}

export function buildQRPrintHtml(records, labels = {}) {
  if (!records.length) throw Error("Choose at least one QR code to print.");
  const pages = records.map(({ qr, image }) => {
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image)) throw Error("Invalid QR print image.");
    return `<section><p class="park">${escapeHtml(labels.park || "NIAH NATIONAL PARK")}</p>
      <h1>${escapeHtml(qr.label)}</h1>
      <p>${qr.plantId ? `${escapeHtml(labels.plant || "Plant")} ${escapeHtml(qr.plantId)}` : escapeHtml(labels.tag || "Plant identification tag")}</p>
      <img src="${image}" alt="${escapeHtml(qr.label)}" width="300" height="300" />
      <p>${escapeHtml(labels.instruction || "Attach this tag to its documented plant.")}</p></section>`;
  }).join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>@page{margin:18mm}body{font-family:Arial,sans-serif;color:#172D25;margin:0;text-align:center}
    section{break-inside:avoid;page-break-after:always;padding:24px 0}section:last-child{page-break-after:auto}
    .park{font-size:12px;letter-spacing:2px}h1{font-size:26px;margin:16px 0 8px;overflow-wrap:anywhere}
    p{font-size:13px;line-height:1.5}img{display:block;margin:20px auto;max-width:100%;height:auto}</style>
    </head><body>${pages}</body></html>`;
}
