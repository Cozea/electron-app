import { beforeEach, describe, expect, it, vi } from "vitest"

class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>()

  get length(): number {
    return this.items.size
  }

  clear(): void {
    this.items.clear()
  }

  getItem(key: string): string | null {
    return this.items.get(key) ?? null
  }

  key(index: number): string | null {
    return Array.from(this.items.keys())[index] ?? null
  }

  removeItem(key: string): void {
    this.items.delete(key)
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value)
  }
}

const dispatchCommand = vi.fn()
const assistantState = {
  projectIds: ["assistant-project-1"],
  projectIdByCwd: {
    "/tmp/project": "assistant-project-1",
  } as Record<string, string>,
}

vi.mock("@/features/assistant/lib/utils", () => ({
  newCommandId: () => "command-1",
}))

vi.mock("@/lib/nativeApi", () => ({
  ensureNativeApi: () => ({ orchestration: { dispatchCommand } }),
}))

vi.mock("@/features/assistant/model/assistantStore", () => ({
  useStore: {
    getState: () => assistantState,
  },
}))

describe("assistant project deletion", () => {
  let localStorage: MemoryStorage

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    localStorage = new MemoryStorage()
    assistantState.projectIds = ["assistant-project-1"]
    assistantState.projectIdByCwd = { "/tmp/project": "assistant-project-1" }
    dispatchCommand.mockResolvedValue(undefined)
    vi.stubGlobal("window", { localStorage })
  })

  it("resolves T3 projects by explicit binding and workspace root", async () => {
    const deletion = await import(
      "@/features/assistant/services/assistantProjectDeletion"
    )

    expect(
      deletion.collectAssistantProjectIdsForDeletion({
        assistantProjectIds: ["assistant-project-2"],
        workspaceRoots: ["/tmp/project"],
      }),
    ).toEqual(["assistant-project-2", "assistant-project-1"])
  })

  it("forces deletion so T3 also removes project threads", async () => {
    const deletion = await import(
      "@/features/assistant/services/assistantProjectDeletion"
    )

    await deletion.deleteAssistantProjectsForDeletedWorkspace({
      assistantProjectIds: [],
      workspaceRoots: ["/tmp/project"],
    })

    expect(dispatchCommand).toHaveBeenCalledWith({
      type: "project.delete",
      commandId: "command-1",
      projectId: "assistant-project-1",
      force: true,
    })
    expect(localStorage.length).toBe(0)
  })

  it("persists failed deletions and retries them after a later runtime snapshot", async () => {
    dispatchCommand.mockRejectedValueOnce(new Error("runtime unavailable"))
    const deletion = await import(
      "@/features/assistant/services/assistantProjectDeletion"
    )

    await deletion.deleteAssistantProjectsForDeletedWorkspace({
      assistantProjectIds: ["assistant-project-1"],
      workspaceRoots: [],
    })
    expect(localStorage.length).toBe(1)

    dispatchCommand.mockResolvedValue(undefined)
    await deletion.flushPendingAssistantProjectDeletions({ snapshotIsAuthoritative: true })

    expect(dispatchCommand).toHaveBeenCalledTimes(2)
    expect(localStorage.length).toBe(0)
  })
})
