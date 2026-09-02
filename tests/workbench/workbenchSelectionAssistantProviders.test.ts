import type { ServerProvider } from "@cozea/assistant-contracts"
import { describe, expect, it } from "vitest"

import { resolveEnabledWorkbenchAssistantProviders } from "@/features/projects/components/workbench/workbenchSelectionAssistantProviders"

function providerSnapshot(driver: string, enabled: boolean): ServerProvider {
  return {
    instanceId: driver,
    driver,
    enabled,
  } as unknown as ServerProvider
}

describe("workbench assistant launcher provider projection", () => {
  it("keeps Cursor and OpenCode selectable from driver-only T3 snapshots", () => {
    expect(
      resolveEnabledWorkbenchAssistantProviders([
        providerSnapshot("codex", true),
        providerSnapshot("claudeAgent", true),
        providerSnapshot("cursor", true),
        providerSnapshot("opencode", true),
      ]),
    ).toEqual(["codex", "claudeAgent", "cursor", "opencode"])
  })

  it("does not expose unsupported or explicitly disabled providers", () => {
    expect(
      resolveEnabledWorkbenchAssistantProviders([
        providerSnapshot("cursor", false),
        providerSnapshot("grok", true),
        providerSnapshot("opencode", true),
      ]),
    ).toEqual(["opencode"])
  })

  it("distinguishes a loading runtime from a loaded runtime with no enabled assistants", () => {
    expect(resolveEnabledWorkbenchAssistantProviders(null)).toBeNull()
    expect(resolveEnabledWorkbenchAssistantProviders([])).toEqual([])
  })
})
