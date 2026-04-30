export function isLocalDeviceEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && email.trim().toLowerCase().endsWith("@local.cozea.app")
}

export function formatLocalDeviceLabel(label: string | null | undefined): string {
  const trimmed = label?.trim() ?? ""
  if (!trimmed) return ""

  return trimmed.replace(/(\.localdomain|\.local)$/i, "") || ""
}

export function formatActorDisplayName(
  name: string | null | undefined,
  fallbackLabel = "Unknown",
): string {
  const trimmed = name?.trim() ?? ""
  if (!trimmed) return fallbackLabel

  const displayName = isLocalDeviceEmail(trimmed)
    ? formatLocalDeviceLabel(trimmed.split("@")[0])
    : formatLocalDeviceLabel(trimmed)

  return displayName || fallbackLabel
}
