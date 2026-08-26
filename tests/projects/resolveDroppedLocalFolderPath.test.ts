import { describe, expect, it, vi } from "vitest"

import { resolveDroppedLocalFolderPath } from "../../src/features/projects/lib/resolveDroppedLocalFolderPath"

function createFile(name: string, type = ""): File {
  return new File([""], name, { type })
}

describe("resolveDroppedLocalFolderPath", () => {
  it("resolves a single directory drop via getPathForFile", () => {
    const file = createFile("my-repo")
    const entry = { isDirectory: true, isFile: false } as FileSystemDirectoryEntry
    const item = {
      kind: "file",
      getAsFile: () => file,
      webkitGetAsEntry: () => entry,
    } as DataTransferItem

    const dataTransfer = {
      items: [item] as unknown as DataTransferItemList,
      files: [file] as unknown as FileList,
    } as DataTransfer

    const result = resolveDroppedLocalFolderPath(dataTransfer, () => "/home/ubuntu/code/my-repo")
    expect(result).toEqual({ ok: true, path: "/home/ubuntu/code/my-repo" })
  })

  it("rejects file drops", () => {
    const file = createFile("readme.md", "text/markdown")
    const entry = { isDirectory: false, isFile: true } as FileSystemFileEntry
    const item = {
      kind: "file",
      getAsFile: () => file,
      webkitGetAsEntry: () => entry,
    } as DataTransferItem

    const dataTransfer = {
      items: [item] as unknown as DataTransferItemList,
      files: [file] as unknown as FileList,
    } as DataTransfer

    expect(resolveDroppedLocalFolderPath(dataTransfer, () => "/tmp/readme.md")).toEqual({
      ok: false,
      reason: "not_folder",
    })
  })

  it("rejects multiple drops", () => {
    const fileA = createFile("a")
    const fileB = createFile("b")
    const dataTransfer = {
      items: [] as unknown as DataTransferItemList,
      files: [fileA, fileB] as unknown as FileList,
    } as DataTransfer

    expect(resolveDroppedLocalFolderPath(dataTransfer, () => "/tmp/a")).toEqual({
      ok: false,
      reason: "multiple",
    })
  })

  it("falls back to legacy File.path when getPathForFile is missing", () => {
    const file = Object.assign(createFile("legacy-repo"), { path: "/tmp/legacy-repo" })
    const dataTransfer = {
      items: [] as unknown as DataTransferItemList,
      files: [file] as unknown as FileList,
    } as DataTransfer

    expect(resolveDroppedLocalFolderPath(dataTransfer)).toEqual({
      ok: true,
      path: "/tmp/legacy-repo",
    })
  })

  it("returns no_path when path resolution fails", () => {
    const file = createFile("opaque")
    const dataTransfer = {
      items: [] as unknown as DataTransferItemList,
      files: [file] as unknown as FileList,
    } as DataTransfer

    const getPathForFile = vi.fn(() => "")
    expect(resolveDroppedLocalFolderPath(dataTransfer, getPathForFile)).toEqual({
      ok: false,
      reason: "no_path",
    })
  })
})
