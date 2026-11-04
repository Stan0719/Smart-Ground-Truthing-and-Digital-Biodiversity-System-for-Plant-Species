export function websiteOrigin(env = process.env) {
  if (env.NODE_ENV === 'production' && !env.APP_ORIGIN)
    throw new Error('Set APP_ORIGIN explicitly for production.')
  const value =
    env.APP_ORIGIN ||
    (env.CODESPACE_NAME && env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN
      ? `https://${env.CODESPACE_NAME}-5173.${env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`
      : 'http://localhost:5173')
  const url = new URL(value)
  if (
    url.origin !== value ||
    url.username ||
    url.password ||
    !['https:', 'http:'].includes(url.protocol) ||
    (env.NODE_ENV === 'production' && url.protocol !== 'https:')
  )
    throw new Error('Configure APP_ORIGIN with the exact website origin.')
  return value
}
