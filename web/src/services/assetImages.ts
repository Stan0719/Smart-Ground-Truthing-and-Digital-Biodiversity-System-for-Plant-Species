// Map authorized API references only; never discover or infer evidence assets.
export function webAssetUrl(value: unknown): string {
  if (typeof value !== 'string') return ''
  const match = /^\/api\/(?:data\/)?assets\/([A-Za-z0-9_-]+)$/.exec(value)
  return match ? `/api/data/assets/${match[1]}` : ''
}
export function assetUrlFromId(value: unknown): string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value)
    ? `/api/data/assets/${value}` : ''
}
export function plantThumbnailImages(row: { plant_image_asset_id?: unknown; rbac_status?: unknown; status?: unknown }) {
  const status = row.rbac_status ?? row.status
  if (status !== undefined && status !== 'Approved') return []
  const path = assetUrlFromId(row.plant_image_asset_id)
  return path ? [{ path }] : []
}
export function speciesImageSelection(assets: { id: string; content_type: string }[], preview: unknown, portraitAssetId?: unknown) {
  const images = assets.flatMap(asset => {
    const path = assetUrlFromId(asset.id)
    return path && ['image/jpeg', 'image/png'].includes(asset.content_type)
      ? [{ path, caption: 'Official species photo' }] : []
  })
  // A preview may originate from plant evidence. Keep it out of the reference gallery.
  return { images, image: webAssetUrl(preview) || assetUrlFromId(portraitAssetId) || images[0]?.path || undefined }
}
