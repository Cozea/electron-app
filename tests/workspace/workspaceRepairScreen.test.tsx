import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import type { ResolveProjectWorkspaceResult } from "@shared/workspaceTypes"
import { WorkspaceRepairScreen } from "@/features/workspace/WorkspaceRepairScreen"

const MISSING: Exclude<ResolveProjectWorkspaceResult, { status: "ready" }> = {
  status: "missing-binding",
  projectId: "proj-1",
  actions: [
    { kind: "clone", label: "Clone repository" },
    { kind: "create", label: "Create local folder" },
    { kind: "locate", label: "Locate existing folder" },
  ],
} as Exclude<ResolveProjectWorkspaceResult, { status: "ready" }>

const PROJECT = { _id: "proj-1", name: "Project cooked" }

describe("WorkspaceRepairScreen", () => {
  it("offers every action when nothing is running", () => {
    const markup = renderToStaticMarkup(<WorkspaceRepairScreen result={MISSING} project={PROJECT} />)
    expect(markup).toContain("No local workspace linked")
    expect(markup).toContain("Clone repository")
    expect(markup).toContain("Create local folder")
    expect(markup).toContain("Locate existing folder")
    expect(markup.match(/<button[^>]*\sdisabled=""/g)).toBeNull()
    expect(markup).not.toContain("Cloning repository")
  })

  it("shows progress on the running action and holds the others", () => {
    // Clone can take a while; the person who pressed it needs to see that it took.
    const markup = renderToStaticMarkup(
      <WorkspaceRepairScreen
        result={MISSING}
        project={PROJECT}
        pendingAction={{ kind: "clone", label: "Clone repository" }}
      />,
    )
    expect(markup).toContain("Cloning repository…")
    expect(markup).not.toContain(">Clone repository<")
    expect(markup).toContain("animate-spin")
    expect(markup).toContain('aria-busy="true"')
    // Every action waits on the one in flight.
    expect(markup.match(/<button[^>]*\sdisabled=""/g)).toHaveLength(3)
    // The untouched actions keep their labels and step back visually; the busy one does not.
    expect(markup).toContain("Create local folder")
    expect(markup).toContain("Locate existing folder")
    expect(markup.match(/opacity-60/g)).toHaveLength(2)
  })

  it("marks only the chosen candidate folder as linking", () => {
    const ambiguous = {
      status: "ambiguous",
      projectId: "proj-1",
      candidates: [
        { path: "/Users/me/a", reasons: ["name matches"] },
        { path: "/Users/me/b", reasons: [] },
      ],
      actions: [{ kind: "locate", label: "Locate existing folder" }],
    } as unknown as Exclude<ResolveProjectWorkspaceResult, { status: "ready" }>
    const markup = renderToStaticMarkup(
      <WorkspaceRepairScreen
        result={ambiguous}
        project={PROJECT}
        pendingAction={{ kind: "bind-candidate", folderPath: "/Users/me/b", label: "Use this folder" }}
      />,
    )
    expect(markup.match(/aria-label="Linking folder"/g)).toHaveLength(1)
    const bIndex = markup.indexOf("/Users/me/b")
    const spinnerIndex = markup.indexOf('aria-label="Linking folder"')
    expect(spinnerIndex).toBeGreaterThan(markup.indexOf("/Users/me/a"))
    expect(spinnerIndex).toBeLessThan(bIndex)
  })
})
