import { describe, expect, it, vi } from "vitest"

import {
  buildMemoryUpdatePrompt,
  dispatchMemoryUpdateRequest,
  reportMemoryUpdateOutcome,
  subscribeMemoryUpdateOutcomes,
  subscribeMemoryUpdateRequests,
} from "../../apps/desktop/src/features/project-memory/memoryUpdateBus"

describe("memory update bus", () => {
  it("reports failure when no agent controller is mounted", () => {
    // The tile relies on this to say "that agent tile is no longer open"
    // instead of silently pretending an update is running.
    expect(dispatchMemoryUpdateRequest({ targetTileId: "tile-1", prompt: "go" })).toBe(false)
  })

  it("delivers a request to subscribed controllers", () => {
    const handler = vi.fn()
    const unsubscribe = subscribeMemoryUpdateRequests(handler)

    expect(dispatchMemoryUpdateRequest({ targetTileId: "tile-1", prompt: "go" })).toBe(true)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0]).toMatchObject({ targetTileId: "tile-1", prompt: "go" })
    expect(handler.mock.calls[0][0].requestedAt).toBeGreaterThan(0)

    unsubscribe()
    expect(dispatchMemoryUpdateRequest({ targetTileId: "tile-1", prompt: "go" })).toBe(false)
  })

  it("broadcasts to every controller so the addressed tile can self-select", () => {
    // Controllers filter by tile id; the bus does not know which is mounted.
    const first = vi.fn()
    const second = vi.fn()
    const un1 = subscribeMemoryUpdateRequests(first)
    const un2 = subscribeMemoryUpdateRequests(second)

    dispatchMemoryUpdateRequest({ targetTileId: "tile-2", prompt: "go" })
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)

    un1()
    un2()
  })

  it("survives a handler that throws without losing the others", () => {
    const bad = vi.fn(() => {
      throw new Error("controller blew up")
    })
    const good = vi.fn()
    const un1 = subscribeMemoryUpdateRequests(good)
    const un2 = subscribeMemoryUpdateRequests(bad)

    // A single broken controller must not strand the dispatch.
    expect(() => dispatchMemoryUpdateRequest({ targetTileId: "t", prompt: "p" })).not.toThrow()
    expect(good).toHaveBeenCalledTimes(1)

    un1()
    un2()
  })

  it("names the chosen skill in the prompt so a custom skill still works", () => {
    expect(buildMemoryUpdatePrompt("graphify")).toContain("graphify skill")
    expect(buildMemoryUpdatePrompt("Our Memory")).toContain("Our Memory skill")
  })

  it("carries a failed turn back so the tile can stop waiting", () => {
    // Without this the tile polls its full 15-minute timeout for a build that
    // died on a usage limit.
    const handler = vi.fn()
    const unsubscribe = subscribeMemoryUpdateOutcomes(handler)

    reportMemoryUpdateOutcome({
      targetTileId: "tile-1",
      status: "failed",
      message: "You've hit your usage limit.",
    })

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0]).toEqual({
      targetTileId: "tile-1",
      status: "failed",
      message: "You've hit your usage limit.",
    })

    unsubscribe()
    reportMemoryUpdateOutcome({ targetTileId: "tile-1", status: "failed", message: "again" })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it("isolates a throwing outcome listener", () => {
    const good = vi.fn()
    const un1 = subscribeMemoryUpdateOutcomes(() => {
      throw new Error("listener blew up")
    })
    const un2 = subscribeMemoryUpdateOutcomes(good)

    expect(() =>
      reportMemoryUpdateOutcome({ targetTileId: "t", status: "failed", message: "m" }),
    ).not.toThrow()
    expect(good).toHaveBeenCalledTimes(1)

    un1()
    un2()
  })
})
