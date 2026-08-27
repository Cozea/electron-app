import type {
  BrowserAutomationClickInput,
  BrowserAutomationNavigateInput,
  BrowserAutomationResult,
  BrowserAutomationSnapshot,
  BrowserAutomationStatus,
  BrowserAutomationTileInput,
  BrowserAutomationTypeInput,
} from "@shared/browserAutomationTypes"
import { featureFlags } from "@/lib/featureFlags"

/**
 * Renderer-side bridge for agent browser automation (Track C).
 *
 * Main-process enforcement still requires `COZEA_BROWSER_AGENT_AUTOMATION=1`.
 * The Vite flag only mirrors intent in the renderer.
 */
export function isBrowserAgentAutomationUiEnabled(): boolean {
  return featureFlags.browserAgentAutomation
}

function requireApi() {
  const api = window.electronAPI?.browserAutomation
  if (!api) {
    throw new Error("browserAutomation IPC is unavailable in this environment.")
  }
  return api
}

export async function browserAutomationStatus(): Promise<
  BrowserAutomationResult<BrowserAutomationStatus>
> {
  return requireApi().status()
}

export async function browserAutomationNavigate(
  options: BrowserAutomationNavigateInput,
): Promise<
  BrowserAutomationResult<{
    tileId: string
    url: string
    title: string
    isLoading: boolean
  }>
> {
  return requireApi().navigate(options)
}

export async function browserAutomationSnapshot(
  options: BrowserAutomationTileInput,
): Promise<BrowserAutomationResult<BrowserAutomationSnapshot>> {
  return requireApi().snapshot(options)
}

export async function browserAutomationClick(
  options: BrowserAutomationClickInput,
): Promise<BrowserAutomationResult<{ clicked: true }>> {
  return requireApi().click(options)
}

export async function browserAutomationType(
  options: BrowserAutomationTypeInput,
): Promise<BrowserAutomationResult<{ typed: true }>> {
  return requireApi().type(options)
}
