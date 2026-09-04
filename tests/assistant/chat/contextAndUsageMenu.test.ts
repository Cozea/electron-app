import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const meterSource = readFileSync(
  resolve(
    process.cwd(),
    "apps/desktop/src/features/assistant/chat/ContextWindowMeter.tsx",
  ),
  "utf8",
)

describe("compact context and usage menu", () => {
  it("keeps only context and account usage decision data", () => {
    expect(meterSource).toContain("AI usage left")
    expect(meterSource).toContain("Not reported")
    expect(meterSource).toContain("accountUsage")
    expect(meterSource).toContain('data-usage-row="context"')
    expect(meterSource).toContain('data-usage-row="account"')
    expect(meterSource).not.toContain("accountUsage && accountUsage.windows.length > 0")
    expect(meterSource).not.toContain("Total processed:")
    expect(meterSource).not.toContain("Automatically compacts")
  })
})
