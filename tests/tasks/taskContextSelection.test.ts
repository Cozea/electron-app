import { describe, expect, it } from "vitest"

import {
  resolveAvailableTaskContextKind,
  selectDefaultTaskContext,
} from "@/features/tasks/model/taskContextSelection"

const page = { kind: "page" as const, value: "/", label: "Home", title: "Home" }
const file = { kind: "file" as const, value: "src/main.ts", label: "main.ts", title: "src/main.ts" }

describe("task context selection", () => {
  it("uses only contexts discovered in the current project", () => {
    expect(selectDefaultTaskContext([], [])).toBeNull()
    expect(selectDefaultTaskContext([page], [file])).toBe(page)
    expect(selectDefaultTaskContext([], [file])).toBe(file)
  })

  it("moves to the context kind that actually has options", () => {
    expect(resolveAvailableTaskContextKind("page", 0, 1)).toBe("file")
    expect(resolveAvailableTaskContextKind("file", 1, 0)).toBe("page")
    expect(resolveAvailableTaskContextKind("page", 0, 0)).toBe("page")
  })
})
