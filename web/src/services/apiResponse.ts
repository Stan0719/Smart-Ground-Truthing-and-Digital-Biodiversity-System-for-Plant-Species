export async function readApiResponse<T>(response: Response, unavailable: string): Promise<T> {
  const fallback = response.status >= 500 ? unavailable : `Request failed (${response.status}).`
  let result: unknown
  try {
    result = JSON.parse(await response.text())
  } catch {
    throw new Error(
      response.ok ? 'The server returned an invalid response. Please try again.' : fallback,
    )
  }
  if (!response.ok) {
    const error = result && typeof result === 'object' && 'error' in result ? result.error : null
    throw new Error(typeof error === 'string' && error.trim() ? error : fallback)
  }
  return result as T
}
