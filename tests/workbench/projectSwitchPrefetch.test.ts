import { describe, expect, it } from "vitest"

import { layoutProjectQueryCacheKey } from "@/features/projects/lib/projectSwitchPrefetch"

describe("layoutProjectQueryCacheKey", () => {
  it("prefers the canonical project id over a slug", () => {
    expect(layoutProjectQueryCacheKey("proj_123", "my-app")).toBe("layout-project-proj_123")
  })

  it("falls back to the slug for legacy routes", () => {
    expect(layoutProjectQueryCacheKey(null, "my-app")).toBe("layout-project-my-app")
  })
})
