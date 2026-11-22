export type GlobalSearchCategory = 'species' | 'plants' | 'observations' | 'alerts' | 'pages'

export interface GlobalSearchResult {
  id: string
  title: string
  snippet: string
  path: string
  type: GlobalSearchCategory
}

export interface GlobalSearchResponse {
  query: string
  locale: string
  results: Record<GlobalSearchCategory, GlobalSearchResult[]>
  counts: Record<GlobalSearchCategory, number>
  hasMore: Partial<Record<GlobalSearchCategory, boolean>>
}

export async function searchGlobalWebsite(
  query: string,
  locale: string,
  options: { limit?: number; offset?: number; signal?: AbortSignal } = {},
): Promise<GlobalSearchResponse> {
  const params = new URLSearchParams({ q: query, locale })
  if (options.limit !== undefined) params.set('limit', String(options.limit))
  if (options.offset !== undefined) params.set('offset', String(options.offset))

  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(12000)])
    : AbortSignal.timeout(12000)
  const response = await fetch(`/api/data/global-search?${params}`, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    signal,
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new Error(typeof payload?.error === 'string' ? payload.error : 'Global search is unavailable.')
  if (!payload || typeof payload !== 'object' || !payload.results) throw new Error('Global search returned an invalid response.')
  return payload as GlobalSearchResponse
}
