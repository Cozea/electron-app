/** Wait for both URL renewal and any failed-request backoff before fetching. */
export function artifactMediaRefreshDelay(
  expiresAt: number | undefined,
  retryAt: number | undefined,
  now: number,
): number {
  return Math.max(
    0,
    expiresAt === undefined ? 0 : expiresAt - now - 30_000,
    retryAt === undefined ? 0 : retryAt - now,
  )
}
