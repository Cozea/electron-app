import { beforeEach, describe, expect, it, vi } from "vitest"

const storageValues = new Map<string, string>()

vi.stubGlobal("localStorage", {
  getItem: (key: string) => storageValues.get(key) ?? null,
  setItem: (key: string, value: string) => storageValues.set(key, value),
  removeItem: (key: string) => storageValues.delete(key),
})

const { useAssistantComposerDraftStore } = await import(
  "../../../apps/desktop/src/features/projects/components/assistant/chat/composerDraftStore"
)

describe("assistant composer model preference", () => {
  beforeEach(() => {
    storageValues.clear()
    useAssistantComposerDraftStore.setState({
      draftsByTargetKey: {},
      lastModelSelectionByInstanceId: {},
    })
  })

  it("records the selected model by provider instance and persists it", () => {
    const modelSelection = {
      provider: "opencode" as const,
      instanceId: "opencode:default",
      model: "opencode/last-used",
    }

    useAssistantComposerDraftStore.getState().upsertDraft("tile-1", { modelSelection })

    expect(
      useAssistantComposerDraftStore.getState().lastModelSelectionByInstanceId[
        "opencode:default"
      ],
    ).toEqual(modelSelection)
    expect(storageValues.get("cozea:assistant-composer-drafts:v1")).toContain(
      '"lastModelSelectionByInstanceId"',
    )
  })

  it("keeps the remembered model after its source tile draft is cleared", () => {
    const modelSelection = {
      provider: "codex" as const,
      instanceId: "codex:default",
      model: "gpt-last-used",
    }
    const store = useAssistantComposerDraftStore.getState()

    store.upsertDraft("tile-1", { modelSelection })
    useAssistantComposerDraftStore.getState().clearDraft("tile-1")

    expect(useAssistantComposerDraftStore.getState().draftsByTargetKey["tile-1"]).toBeUndefined()
    expect(
      useAssistantComposerDraftStore.getState().lastModelSelectionByInstanceId["codex:default"],
    ).toEqual(modelSelection)
  })

  it("tracks different provider instances independently", () => {
    const store = useAssistantComposerDraftStore.getState()
    store.upsertDraft("codex-tile", {
      modelSelection: {
        provider: "codex",
        instanceId: "codex:default",
        model: "gpt-last-used",
      },
    })
    useAssistantComposerDraftStore.getState().upsertDraft("claude-tile", {
      modelSelection: {
        provider: "claudeAgent",
        instanceId: "claudeAgent:default",
        model: "claude-last-used",
      },
    })

    expect(
      Object.fromEntries(
        Object.entries(
          useAssistantComposerDraftStore.getState().lastModelSelectionByInstanceId,
        ).map(([instanceId, selection]) => [instanceId, selection.model]),
      ),
    ).toEqual({
      "codex:default": "gpt-last-used",
      "claudeAgent:default": "claude-last-used",
    })
  })
})
