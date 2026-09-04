import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const maintenanceSource = fs.readFileSync(
  path.join(root, "convex/yjsMaintenance.ts"),
  "utf8",
)
const providerSource = fs.readFileSync(
  path.join(root, "apps/desktop/src/contexts/YjsProjectContext.tsx"),
  "utf8",
)

describe("encrypted collaboration cleanup policy", () => {
  it("prunes updates through an explicit causal sequence boundary", () => {
    expect(maintenanceSource).toContain("cleanupUpdatesThroughSeq")
    expect(maintenanceSource).toContain('.lte("seq", throughSeq)')
    expect(maintenanceSource).toContain("deletedBytes")
    expect(maintenanceSource).toContain("collaborationData: -deletedBytes")
  })

  it("never uses wall-clock age to decide what an encrypted snapshot contains", () => {
    expect(providerSource).toContain("api.yjsMaintenance.cleanupUpdatesThroughSeq")
    expect(providerSource).toContain("throughSeq: snapshotBaseSeq")
    expect(providerSource).not.toContain("api.yjs.cleanupOldUpdates")
    expect(providerSource).not.toContain("olderThan:")
  })
})
