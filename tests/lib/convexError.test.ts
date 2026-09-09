import { describe, expect, it } from "vitest"

import { cleanConvexError, cleanConvexErrorMessage } from "@/lib/convexError"

describe("Convex error presentation", () => {
  it("removes transport decoration without changing multiline application detail", () => {
    expect(cleanConvexErrorMessage("[CONVEX M(projects:rename)] Name is invalid\nChoose another name.\nCalled by client"))
      .toBe("Name is invalid\nChoose another name.")
  })

  it("preserves ordinary messages and caller-owned whitespace", () => {
    expect(cleanConvexErrorMessage("  Connection failed  ")).toBe("  Connection failed  ")
    expect(cleanConvexErrorMessage("Called by client is part of this sentence"))
      .toBe("Called by client is part of this sentence")
  })

  it("uses the caller fallback for unknown errors and empty decorated messages", () => {
    for (const error of [null, "untrusted string", {}, new Error(""), new Error("[CONVEX M(x)] Called by client")]) {
      expect(cleanConvexError(error, "Unable to rename project.")).toBe("Unable to rename project.")
    }
  })
})
