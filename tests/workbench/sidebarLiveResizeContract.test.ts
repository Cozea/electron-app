import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

describe("sidebarLiveResizeContract", () => {
  it("ensures neither sidebar source file contains synthetic global window.resize dispatches", () => {
    const repoRoot = path.resolve(__dirname, "../..")
    const appSidebarShellPath = path.join(
      repoRoot,
      "apps/desktop/src/app/shell/sidebar/AppSidebarShell.tsx",
    )
    const uiSidebarPath = path.join(
      repoRoot,
      "apps/desktop/src/components/ui/sidebar.tsx",
    )

    const appSidebarShellCode = fs.readFileSync(appSidebarShellPath, "utf-8")
    const uiSidebarCode = fs.readFileSync(uiSidebarPath, "utf-8")

    expect(appSidebarShellCode).not.toContain('window.dispatchEvent(new Event("resize"))')
    expect(appSidebarShellCode).not.toContain("window.dispatchEvent(new Event('resize'))")
    expect(uiSidebarCode).not.toContain('window.dispatchEvent(new Event("resize"))')
    expect(uiSidebarCode).not.toContain("window.dispatchEvent(new Event('resize'))")

    expect(uiSidebarCode).not.toContain("SIDEBAR_LAYOUT_SYNC_TIMEOUTS_MS")
    expect(uiSidebarCode).not.toContain("cozea:sidebar-layout-change")
  })
})
