export function getAiTimezoneHeaders(): Record<string, string> {
  const headers: Record<string, string> = {}

  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (typeof timeZone === 'string' && timeZone.trim().length > 0) {
      headers['x-cozea-timezone'] = timeZone.trim()
    }
  } catch {
    // Ignore timezone detection errors.
  }

  const offsetMinutes = new Date().getTimezoneOffset()
  if (Number.isFinite(offsetMinutes)) {
    headers['x-cozea-tz-offset-minutes'] = String(offsetMinutes)
  }

  return headers
}
