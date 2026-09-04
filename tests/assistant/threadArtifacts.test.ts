import { describe, expect, it } from "vitest"

import type { OrchestrationThreadActivity } from "@cozea/assistant-contracts"

import { deriveThreadImageArtifacts } from "../../apps/desktop/src/features/assistant/artifacts/threadArtifacts"

function imageActivity(input: {
  id: string
  callId: string
  kind: "tool.started" | "tool.updated" | "tool.completed"
  createdAt: string
  status: string
  title?: string
  prompt?: string
  available?: boolean
}): OrchestrationThreadActivity {
  return {
    id: input.id,
    tone: "tool",
    kind: input.kind,
    summary: "Generating image",
    payload: {
      itemType: "image_generation",
      toolCallId: input.callId,
      status: input.status,
      data: {
        artifact: {
          id: input.callId,
          kind: "image",
          status: input.status,
          ...(input.title ? { title: input.title } : {}),
          ...(input.prompt ? { prompt: input.prompt } : {}),
          available: input.available ?? false,
        },
      },
    },
    turnId: "turn-1",
    createdAt: input.createdAt,
  } as OrchestrationThreadActivity
}

describe("deriveThreadImageArtifacts", () => {
  it("folds every lifecycle state into one stable artifact and adopts completion metadata", () => {
    const artifacts = deriveThreadImageArtifacts("thread-1", [
      imageActivity({
        id: "start",
        callId: "image-1",
        kind: "tool.started",
        createdAt: "2026-08-28T10:00:00.000Z",
        status: "inProgress",
      }),
      imageActivity({
        id: "update",
        callId: "image-1",
        kind: "tool.updated",
        createdAt: "2026-08-28T10:00:01.000Z",
        status: "inProgress",
      }),
      imageActivity({
        id: "complete",
        callId: "image-1",
        kind: "tool.completed",
        createdAt: "2026-08-28T10:00:23.000Z",
        status: "completed",
        title: "Shrimp shop hero",
        prompt: "A cinematic shrimp shop hero image",
        available: true,
      }),
    ])

    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]).toMatchObject({
      id: "image-1",
      status: "completed",
      title: "Shrimp shop hero",
      prompt: "A cinematic shrimp shop hero image",
      available: true,
      startedAt: "2026-08-28T10:00:00.000Z",
      completedAt: "2026-08-28T10:00:23.000Z",
    })
  })

  it("deduplicates reconnect snapshots and keeps distinct calls separate", () => {
    const repeated = imageActivity({
      id: "same-completion",
      callId: "image-1",
      kind: "tool.completed",
      createdAt: "2026-08-28T10:00:02.000Z",
      status: "completed",
      available: true,
    })
    const artifacts = deriveThreadImageArtifacts("thread-1", [
      repeated,
      repeated,
      imageActivity({
        id: "second",
        callId: "image-2",
        kind: "tool.completed",
        createdAt: "2026-08-28T10:00:03.000Z",
        status: "completed",
        available: true,
      }),
    ])

    expect(artifacts.map((artifact) => artifact.id)).toEqual(["image-1", "image-2"])
  })

  it("ignores viewed images and artifacts belonging to no bound thread", () => {
    const viewedImage = imageActivity({
      id: "view",
      callId: "view-1",
      kind: "tool.completed",
      createdAt: "2026-08-28T10:00:00.000Z",
      status: "completed",
      available: true,
    })
    viewedImage.payload = { ...(viewedImage.payload as object), itemType: "image_view" }

    expect(deriveThreadImageArtifacts("thread-1", [viewedImage])).toEqual([])
    expect(deriveThreadImageArtifacts(null, [viewedImage])).toEqual([])
  })

  it("preserves an invalid provider timestamp instead of throwing while inferring duration", () => {
    const completed = imageActivity({
      id: "complete",
      callId: "image-1",
      kind: "tool.completed",
      createdAt: "provider-time-unavailable",
      status: "completed",
      available: true,
    })
    completed.payload = { ...(completed.payload as object), durationMs: 250 }

    expect(deriveThreadImageArtifacts("thread-1", [completed])[0]?.startedAt).toBe(
      "provider-time-unavailable",
    )
  })
})
