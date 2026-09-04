export function isIntentionalAbortMessage(message: string | null | undefined): boolean {
  const normalized = message?.trim().toLowerCase()
  if (!normalized) return false

  return (
    normalized === "aborted" ||
    normalized === "aborterror" ||
    normalized.includes("request was aborted") ||
    normalized.includes("operation was aborted") ||
    normalized.includes("turn aborted") ||
    normalized.includes("interrupted by user") ||
    normalized.includes("user cancelled") ||
    normalized.includes("user canceled")
  )
}

export function normalizeThreadError(error: string | null | undefined): string | null {
  if (!error || isIntentionalAbortMessage(error)) return null
  return error
}
