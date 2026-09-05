import { describe, expect, it } from "vitest"
import { assertCollaborationWorkspaceOperation } from "../../apps/desktop/electron/collaboration/workspacePolicy"

describe("collaboration workspace write authority", () => {
  it.each(["write-file", "delete-file", "git-write", "terminal-create", "dev-server-start", "runtime-detect", "integration-tool", "open-external-editor"])("denies observer %s and keeps normal local workflows available", operation => {
    expect(() => assertCollaborationWorkspaceOperation(JSON.stringify({ generation: 3, state: "active", role: "observer" }), operation)).toThrow("Observers")
    expect(() => assertCollaborationWorkspaceOperation(null, operation)).not.toThrow()
    expect(() => assertCollaborationWorkspaceOperation(JSON.stringify({ generation: 3, state: "active", role: "editor" }), operation)).not.toThrow()
  })
  it.each(["left", "ended"])("preserves read-only recovery access after %s", state => {
    const policy = JSON.stringify({ generation: 3, state, role: "editor" })
    expect(() => assertCollaborationWorkspaceOperation(policy, "git-write")).toThrow("retained for recovery")
    expect(() => assertCollaborationWorkspaceOperation(policy, "read-file")).not.toThrow()
  })
})
