import type { ServerProvider } from "@cozea/assistant-contracts"

export function hasBlockingProviderBanner(status: ServerProvider | null): boolean {
  return Boolean(
    status &&
      (status.versionAdvisory?.status === "behind_latest" ||
        (status.status !== "ready" && status.status !== "disabled")),
  )
}

/** Keep implementation-vendor names out of Cozea's provider status UI. */
export function presentProviderStatusMessage(message: string): string {
  return message
    .replaceAll("T3 Code", "Cozea")
    .replaceAll("T3 server", "local agent service")
    .replaceAll("T3 runtime", "local agent runtime")
}
