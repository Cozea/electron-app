/**
 * Canonical device presentation utilities: display initials and deterministic colors.
 */

export function getDeviceInitials(name?: string | null, fallback = "D"): string {
  if (!name) return fallback
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return fallback
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
}

export function getDeviceColor(principalId: string | null | undefined): string {
  if (!principalId) return "#6b7280"
  const colors = [
    "#ef4444", // red
    "#f97316", // orange
    "#eab308", // yellow
    "#22c55e", // green
    "#14b8a6", // teal
    "#0ea5e9", // sky
    "#6366f1", // indigo
    "#a855f7", // purple
    "#ec4899", // pink
  ]
  let hash = 0
  for (let i = 0; i < principalId.length; i++) {
    hash = principalId.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colors[Math.abs(hash) % colors.length]
}

// Backward-compatible alias for existing call sites
export const getUserColor = getDeviceColor
