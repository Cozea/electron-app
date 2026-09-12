import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { RebaseSessionBody } from "@/features/collaboration/ui/RebaseSessionDialog"

describe("P21 rebase dialog", () => {
  it("explains the explicit rebase before anything runs", () => {
    const markup = renderToStaticMarkup(
      <RebaseSessionBody targetBranch="main" result={null} error={null} rebasing={false} />,
    )
    expect(markup).toContain("first saves the live session")
    expect(markup).toContain("away from everyone&#x27;s working folders")
  })

  it("shows the conflict paths and explains collaborative conflict resolution", () => {
    const markup = renderToStaticMarkup(
      <RebaseSessionBody
        targetBranch="main"
        error={null}
        rebasing={false}
        result={{
          outcome: "conflicts",
          message: "Two files changed on both sides.",
          conflictingPaths: ["src/app.ts", "README.md"],
        }}
      />,
    )
    expect(markup).toContain("src/app.ts, README.md")
    expect(markup).toContain("conflict markers into the live session")
  })
})
