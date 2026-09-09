/** Remove Convex transport decoration while preserving the application's message. */
export function cleanConvexErrorMessage(message: string): string {
  return message.replace(/^\[CONVEX.*?\]\s*/, "").replace(/\s*Called by client$/, "")
}

export function cleanConvexError(error: unknown, fallback: string): string {
  return cleanConvexErrorMessage(error instanceof Error ? error.message : fallback) || fallback
}
