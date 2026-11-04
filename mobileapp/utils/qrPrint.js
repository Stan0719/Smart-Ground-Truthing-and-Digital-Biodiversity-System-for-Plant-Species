import QRCodeCore from "qrcode/lib/core/qrcode.js";

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
);

const A4_WIDTH_PT = 210 * 72 / 25.4;
const A4_HEIGHT_PT = 297 * 72 / 25.4;

export const A4_PRINT_OPTIONS = Object.freeze({
  width: A4_WIDTH_PT,
  height: A4_HEIGHT_PT,
  orientation: "portrait",
  margins: Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 }),
});

export function buildQRSvg(value, quietZone = 4) {
  if (typeof value !== "string" || !value.trim() || value.length > 200) {
    throw Error("Invalid QR payload.");
  }
  const modules = QRCodeCore.create(value, { errorCorrectionLevel: "M" }).modules;
  const size = modules.size;
  const dimension = size + quietZone * 2;
  const paths = [];
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      if (modules.get(row, column)) {
        paths.push(`M${column + quietZone},${row + quietZone}h1v1h-1z`);
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" class="qr-svg" viewBox="0 0 ${dimension} ${dimension}" width="227" height="227" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${dimension}" height="${dimension}" fill="#fff"/><path d="${paths.join("")}" fill="#000"/></svg>`;
}

export function buildQRPrintHtml(records, labels = {}) {
  if (!records.length) throw Error("Choose at least one QR code to print.");
  const pages = records.map(({ qr }, index) => {
    const pageBreak = index === 0 ? "" : ' style="break-before:page;page-break-before:always"';
    return `<section class="page"${pageBreak}><div class="tag">
      ${buildQRSvg(qr.value)}
      <h1>${escapeHtml(qr.label)}</h1>
      <p>${qr.plantName ? escapeHtml(qr.plantName) : qr.plantId ? `${escapeHtml(labels.plant || "Plant")} ${escapeHtml(qr.plantId)}` : escapeHtml(labels.tag || "Plant identification tag")}</p>
      <p class="instruction">${escapeHtml(labels.instruction || "Attach this tag to its documented plant.")}</p>
      </div></section>`;
  }).join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>@page{size:A4 portrait;margin:10mm}*{box-sizing:border-box}html,body{margin:0;padding:0;width:100%}
    body{font-family:Arial,sans-serif;color:#111;background:#fff;text-align:center}
    .page{width:190mm;height:275mm;margin:0 auto;overflow:hidden;display:flex;align-items:center;justify-content:center;break-inside:avoid;page-break-inside:avoid}
    .tag{width:100%;display:flex;flex-direction:column;align-items:center;justify-content:center}
    .qr-svg{display:block;box-sizing:border-box;width:60mm;height:60mm;flex:none;background:#fff;margin:0 auto 8mm}
    h1{font-size:24pt;line-height:1.2;margin:0 0 3mm;overflow-wrap:anywhere;color:#000}p{font-size:14pt;line-height:1.4;margin:0 0 3mm}
    .instruction{font-size:12pt;margin-top:6mm;color:#333}</style>
    </head><body>${pages}</body></html>`;
}
