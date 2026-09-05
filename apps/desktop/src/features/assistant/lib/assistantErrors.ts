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

/**
 * What to show the user when a call into the local assistant runtime fails.
 *
 * Lives with the other assistant error helpers rather than in the workbench's
 * shared module: the runtime metadata store needs it too, and that store is
 * assistant domain that happened to be filed under the workbench.
 */
export function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  if (typeof error === "string" && error.trim()) {
    return error
  }

  return "Something went wrong while talking to the local assistant runtime."
}
