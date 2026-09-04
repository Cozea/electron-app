import * as Y from "yjs"
import { describe, expect, it, vi } from "vitest"

import {
  BINARY_SYNC_REQUIRES_GIT_PUSH,
  BinaryFileSync,
  isBinaryFile,
} from "@/lib/sync/BinaryFileSync"
import { ReconnectionProtocol } from "@/lib/yjs/ReconnectionProtocol"

describe("collaboration v2 safety guardrails", () => {
  it("never sends a plaintext Yjs document through the legacy reconnect path", async () => {
    const mutation = vi.fn(() => {
      throw new Error("legacy reconnect must not mutate server state")
    })
    const query = vi.fn(async () => [])
    const doc = new Y.Doc()

    const protocol = new ReconnectionProtocol(
      doc,
      "project_1" as never,
      { query, mutation } as never,
    )

    const result = await protocol.performSync()

    expect(result).toMatchObject({
      success: true,
      sentUpdates: 0,
      receivedUpdates: 0,
      deleteConflicts: [],
    })
    expect(mutation).not.toHaveBeenCalled()
    expect(query).toHaveBeenCalledTimes(1)

    doc.destroy()
  })

  it("classifies common code assets as binary", () => {
    expect(isBinaryFile("public/logo.png")).toBe(true)
    expect(isBinaryFile("fonts/inter.woff2")).toBe(true)
    expect(isBinaryFile("src/index.ts")).toBe(false)
  })

  it("reports that binary files require an explicit Git push", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const sync = new BinaryFileSync(
      "project_1" as never,
      "/tmp/project",
      {} as never,
      "user_1" as never,
    )

    await expect(sync.uploadBinaryFile("public/logo.png")).resolves.toBe(
      BINARY_SYNC_REQUIRES_GIT_PUSH,
    )
    expect(sync.getPendingCount()).toBe(0)
    expect(warn).toHaveBeenCalledTimes(1)

    sync.destroy()
    warn.mockRestore()
  })
})
