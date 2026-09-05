import { describe, expect, it } from "vitest"
import { verifiedInstallationIsCurrent } from "../../convex/lib/collaborationInstallationAccess"
import type { QueryCtx } from "../../convex/_generated/server"

describe("installation-wide repository revocation", () => {
  it("invalidates every repository and rejects a setup that began before access removal", async () => {
    const removals = new Map([["removed", { revokedAt: 200 }]])
    const ctx = { db: { query: () => ({ withIndex: (_name: string, filter: (q: { eq: (_key: string, id: string) => unknown }) => unknown) => {
      let installation = ""
      filter({ eq: (_key, id) => { installation = id; return {} } })
      return { unique: async () => removals.get(installation) ?? null }
    } }) } } as unknown as Pick<QueryCtx, "db">
    const catalog = Array.from({ length: 1500 }, () => ({ installationId: "removed", verifiedAt: 100 }))
    expect((await Promise.all(catalog.map(repository => verifiedInstallationIsCurrent(ctx, repository)))).every(value => !value)).toBe(true)
    expect(await verifiedInstallationIsCurrent(ctx, { installationId: "removed", verifiedAt: 200 })).toBe(false)
    expect(await verifiedInstallationIsCurrent(ctx, { installationId: "removed", verifiedAt: 201 })).toBe(true)
    expect(await verifiedInstallationIsCurrent(ctx, { installationId: "unrelated", verifiedAt: 100 })).toBe(true)
  })
})
