import type { ServerProvider } from "@cozea/assistant-contracts"

/**
 * Why the chat is gated. "update-available" is recoverable from inside the
 * tile, so it gets its own affordance instead of the dead-end notice.
 */
export type ProviderBannerKind = "update-available" | "unavailable"

export function resolveProviderBannerKind(
  status: ServerProvider | null,
): ProviderBannerKind | null {
  if (!status) return null
  if (status.status !== "ready" && status.status !== "disabled") return "unavailable"
  if (status.versionAdvisory?.status === "behind_latest") return "update-available"
  return null
}

export function hasBlockingProviderBanner(status: ServerProvider | null): boolean {
  return resolveProviderBannerKind(status) !== null
}

/** Keep implementation-vendor names out of Cozea's provider status UI. */
export function presentProviderStatusMessage(message: string): string {
  return message
    .replaceAll("T3 Code", "Cozea")
    .replaceAll("T3 server", "local agent service")
    .replaceAll("T3 runtime", "local agent runtime")
}
