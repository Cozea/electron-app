import { describe, expect, it } from "vitest"

import {
  appendComposerMentions,
  partitionDroppedComposerFiles,
  toComposerMentionPath,
} from "../../../apps/desktop/src/features/assistant/chat/composerDroppedFiles"

function createFile(name: string, type = ""): File {
  return new File([""], name, { type })
}

const WORKSPACE_ROOT = "/Users/dev/repo"

function pathForFile(file: File): string {
  if (file.name === "no-path.txt") return ""
  if (file.name.startsWith("/")) return file.name
  return `${WORKSPACE_ROOT}/${file.name}`
}

describe("toComposerMentionPath", () => {
  it("trims a path inside the workspace down to a relative mention", () => {
    expect(toComposerMentionPath("/Users/dev/repo/docs/spec.pdf", WORKSPACE_ROOT)).toBe(
      "docs/spec.pdf",
    )
  })

  it("keeps paths outside the workspace absolute", () => {
    expect(toComposerMentionPath("/Users/dev/Desktop/spec.pdf", WORKSPACE_ROOT)).toBe(
      "/Users/dev/Desktop/spec.pdf",
    )
  })

  it("tolerates a trailing separator on the workspace root and a missing root", () => {
    expect(toComposerMentionPath("/Users/dev/repo/spec.pdf", "/Users/dev/repo/")).toBe("spec.pdf")
    expect(toComposerMentionPath("/Users/dev/repo/spec.pdf", null)).toBe("/Users/dev/repo/spec.pdf")
  })
})

describe("partitionDroppedComposerFiles", () => {
  it("attaches images and mentions everything else by path", () => {
    const result = partitionDroppedComposerFiles(
      [
        createFile("shot.png", "image/png"),
        createFile("spec.pdf", "application/pdf"),
        createFile("data.csv", "text/csv"),
      ],
      { resolvePath: pathForFile, workspaceRoot: WORKSPACE_ROOT },
    )

    expect(result.images.map((file) => file.name)).toEqual(["shot.png"])
    expect(result.mentionPaths).toEqual(["spec.pdf", "data.csv"])
    expect(result.unresolvedNames).toEqual([])
  })

  it("mentions a dropped folder, which arrives with no mime type", () => {
    const result = partitionDroppedComposerFiles([createFile("docs")], {
      resolvePath: pathForFile,
      workspaceRoot: WORKSPACE_ROOT,
    })

    expect(result.mentionPaths).toEqual(["docs"])
  })

  it("reports files that carry no local path instead of dropping them silently", () => {
    const result = partitionDroppedComposerFiles([createFile("no-path.txt", "text/plain")], {
      resolvePath: pathForFile,
      workspaceRoot: WORKSPACE_ROOT,
    })

    expect(result.mentionPaths).toEqual([])
    expect(result.unresolvedNames).toEqual(["no-path.txt"])
  })

  it("does not repeat a path dropped twice in one gesture", () => {
    const result = partitionDroppedComposerFiles(
      [createFile("spec.pdf", "application/pdf"), createFile("spec.pdf", "application/pdf")],
      { resolvePath: pathForFile, workspaceRoot: WORKSPACE_ROOT },
    )

    expect(result.mentionPaths).toEqual(["spec.pdf"])
  })
})

describe("appendComposerMentions", () => {
  it("appends mentions with the trailing space a mention chip needs", () => {
    expect(appendComposerMentions("", ["spec.pdf"])).toBe("@spec.pdf ")
    expect(appendComposerMentions("read this", ["spec.pdf", "data.csv"])).toBe(
      "read this @spec.pdf @data.csv ",
    )
  })

  it("does not double the separating space", () => {
    expect(appendComposerMentions("read this ", ["spec.pdf"])).toBe("read this @spec.pdf ")
  })

  it("leaves the composer untouched when there is nothing to mention", () => {
    expect(appendComposerMentions("read this", [])).toBe("read this")
  })
})
