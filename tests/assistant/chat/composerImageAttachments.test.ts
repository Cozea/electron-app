import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { prepareComposerImageAttachments } from "@/features/workbench/assistant/useAssistantComposerAttachments"

const controllerSource = readFileSync(
  resolve(
    process.cwd(),
    "apps/desktop/src/features/workbench/assistant/useWorkbenchAssistantTileController.tsx",
  ),
  "utf8",
)
const chatSurfaceSource = readFileSync(
  resolve(
    process.cwd(),
    "apps/desktop/src/features/assistant/chat/CozeaChatSurface.tsx",
  ),
  "utf8",
)

function sourceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)

  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe("agent composer image attachments", () => {
  it("accepts images before a fresh tile has created its first thread", () => {
    const image = new File([new Uint8Array([1, 2, 3])], "pixel.png", {
      type: "image/png",
    })
    const prepared = prepareComposerImageAttachments([image], [], "codex")

    expect(prepared.error).toBeNull()
    expect(prepared.images).toHaveLength(1)
    expect(prepared.images[0]).toMatchObject({
      name: "pixel.png",
      mimeType: "image/png",
      sizeBytes: 3,
      file: image,
    })

    const bootstrapThread = controllerSource.indexOf(
      "// --- Fix 6: Bootstrap pattern --- create thread on first send if needed",
    )
    const readComposerImages = controllerSource.indexOf(
      "const hasImages = composerImages.length > 0",
      bootstrapThread,
    )
    expect(bootstrapThread).toBeGreaterThanOrEqual(0)
    expect(readComposerImages).toBeGreaterThan(bootstrapThread)
  })

  it("keeps the chat-surface drop forwarding architecture wired", () => {
    const dropHandler = sourceBetween(
      chatSurfaceSource,
      "const handleSurfaceDrop =",
      "const applyComposerMentionItem =",
    )

    expect(dropHandler).toContain("const files = Array.from(event.dataTransfer.files)")
    expect(dropHandler).toContain("props.onAttachFiles(files)")
    expect(chatSurfaceSource).toContain("onDrop={handleSurfaceDrop}")
  })
})
