import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import type { ProjectdMergePreview } from "@cozea/projectd-protocol"

import { MergeSessionBody } from "@/features/collaboration/ui/MergeSessionDialog"

const noop = () => {}

function preview(overrides: Partial<ProjectdMergePreview> = {}): ProjectdMergePreview {
  return {
    branch: "feat/live",
    targetBranch: "main",
    checkpointOid: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
    targetOid: "0".repeat(40),
    ahead: 3,
    behind: 0,
    clean: true,
    conflictingPaths: [],
    unsavedChanges: 0,
    pullRequestUrl: null,
    ...overrides,
  }
}

const render = (props: Partial<Parameters<typeof MergeSessionBody>[0]> = {}) =>
  renderToStaticMarkup(
    <MergeSessionBody
      targetBranch="main"
      preview={preview()}
      loading={false}
      error={null}
      result={null}
      strategy="merge"
      onStrategyChange={noop}
      {...props}
    />,
  )

describe("P22 merge dialog", () => {
  it("says what the merge takes and offers a merge commit or a squash", () => {
    const markup = render()
    expect(markup).toContain("The session&#x27;s last save, a1b2c3d, has 3 commits main doesn&#x27;t have.")
    expect(markup).toContain("Merge commit, keeping the session&#x27;s commits")
    expect(markup).toContain("Squash into one commit")
  })

  it("warns that unsaved changes stay out, with Save now", () => {
    const markup = render({ preview: preview({ unsavedChanges: 2 }), onSaveNow: noop })
    expect(markup).toContain("2 session changes aren&#x27;t saved to Git yet, so the merge leaves them out.")
    expect(markup).toContain(">Save now<")
  })

  it("lists files changed on both sides instead of the merge options", () => {
    const markup = render({ preview: preview({ clean: false, conflictingPaths: ["src/app.ts"] }) })
    expect(markup).toContain("src/app.ts changed on both sides.")
    expect(markup).toContain("Rebase the session from main first")
    expect(markup).not.toContain("Squash into one commit")
  })

  it("keeps the branch after a merge", () => {
    const markup = render({
      result: { outcome: "merged", mergeCommitOid: "f".repeat(40), message: "Merged into main as fffffff.", pullRequestUrl: null },
    })
    expect(markup).toContain("Merged into main as fffffff.")
    expect(markup).toContain("stays on its remote")
  })
})
