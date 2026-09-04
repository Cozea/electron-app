import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

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
    const addComposerImages = sourceBetween(
      controllerSource,
      "const addComposerImages = useCallback(",
      "const removeComposerImage = useCallback(",
    )

    expect(addComposerImages).not.toContain("if (!thread) return")
    expect(addComposerImages).toContain(
      "setComposerImages((current) => [...current, ...nextImages])",
    )

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

  it("forwards files dropped anywhere on the chat surface to the attachment callback", () => {
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
