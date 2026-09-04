import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")

const LAYOUT = "apps/desktop/src/features/projects/layouts/ProjectLayout.tsx"
const SHELL = "apps/desktop/src/app/shell/sidebar/AppSidebarShell.tsx"
const SIDEBAR = "apps/desktop/src/features/projects/ui/ProjectSidebar.tsx"
const PAGE = "apps/desktop/src/features/devapps/pages/AppStorePage.tsx"
const ROW = "apps/desktop/src/features/devapps/components/DevAppStoreRow.tsx"

describe("DevApps Store shell unification", () => {
  it("does not special-case the store route in the project layout", () => {
    const layout = read(LAYOUT)
    expect(layout).not.toContain("isAppStoreRoute")
    expect(layout).not.toContain("AppStoreSidebar")
    expect(layout).not.toContain("/projects/store")
  })

  it("keeps one persistent shell with a single lazy settings branch", () => {
    const layout = read(LAYOUT)
    const block = layout.slice(
      layout.indexOf("<AppSidebarShell"),
      layout.indexOf("<SidebarInset"),
    )
    expect(block).toContain("isSettingsModeRoute ?")
    expect(block).toContain("<LazySettingsSidebar")
    expect(block).toContain("<SidebarModeFallback />")
    expect(block).toContain("<ProjectSidebar")
    expect(block.match(/<Suspense/g)).toHaveLength(1)
    expect(block).not.toContain("surface=")
  })

  it("removes the per-surface taxonomy from the application shell", () => {
    const shell = read(SHELL)
    expect(shell).not.toContain("AppSidebarSurface")
    expect(shell).not.toContain("appStore")
  })

  it("leaves no orphaned store sidebar or store catalog module", () => {
    for (const path of [
      "apps/desktop/src/features/projects/components/AppStoreSidebar.tsx",
      "apps/desktop/src/features/projects/lib/appStoreCatalog.ts",
      "apps/desktop/src/features/devapps/ui/AppStoreSidebar.tsx",
      "apps/desktop/src/features/devapps/model/appStoreCatalog.ts",
    ]) {
      expect(existsSync(resolve(process.cwd(), path))).toBe(false)
    }
  })

  it("keeps the store nav row and its active state in project UI", () => {
    const sidebar = read(SIDEBAR)
    expect(sidebar).toContain('navigate("/projects/store")')
    expect(sidebar).toContain('const isOnAppStore = pathname === "/projects/store"')

    const activeIndex = sidebar.indexOf("isOnAppStore && SIDEBAR_PILL_ACTIVE_CLASS")
    const labelIndex = sidebar.indexOf("t('nav.devAppsStore')")
    expect(activeIndex).toBeGreaterThan(-1)
    expect(labelIndex).toBeGreaterThan(activeIndex)
    expect(sidebar.slice(activeIndex, labelIndex)).toContain("onClick={handleOpenMarketplace}")
  })

  it("drops the old storefront taxonomy but keeps registry categories", () => {
    const page = read(PAGE)
    expect(page).not.toContain("appStoreCatalog")
    expect(page).not.toContain("resolveAppStoreCategory")
    expect(page).not.toContain("activeCategory")
    expect(page).toContain("resolveAppStoreScope")

    const types = read("apps/desktop/src/features/devapps/registry/types.ts")
    expect(types).toContain("export type DevAppCategoryId")
    const registry = read("apps/desktop/src/features/devapps/registry/index.ts")
    expect(registry).toContain("options.category")
  })

  it("pins store actions to the title bar and supports hiding share", () => {
    const page = read(PAGE)
    expect(page).toContain("rightAddon: headerActions")
    expect(page).toContain("hideShare: true")
    expect(page).not.toContain('className="flex items-center justify-end gap-2"')

    const hook = read("apps/desktop/src/features/projects/hooks/useProjectHeader.ts")
    expect(hook).toContain("rightAddon")
    expect(hook).toContain("hideShare")

    // Settings routes keep the page's own right-hand actions and drop only the
    // sharing chrome, so the suppression rides on hideShare and the nulled
    // invite/editor context rather than on withholding rightAddon wholesale.
    const chrome = read("apps/desktop/src/features/projects/hooks/useProjectChromeHeader.tsx")
    expect(chrome).toContain("rightAddon: rightFromPage")
    expect(chrome).toContain("hideShare: hideShare || isSettingsModeRoute")
    expect(chrome).toContain("projectInviteContext: isSettingsModeRoute ? undefined")

    const header = read("apps/desktop/src/components/layouts/UnifiedHeader.tsx")
    expect(header).toContain("hideShare = false")
    expect(header).toContain("if (!hideShare) {")
  })

  it("never builds an i18n key from a free-text label, and uses no any casts", () => {
    for (const source of [read(PAGE), read(ROW)]) {
      expect(source).not.toContain("devApp.category.${")
      expect(source).not.toContain("(t as any)")
    }
  })
})

const REMOVED_KEYS = [
  "appStore.store",
  "appStore.search",
  "projects.backToProjects",
  "appStore.page.resultsFor",
  "appStore.page.openingSoon",
  "appStore.page.heroTitle",
  "appStore.page.heroDesc",
  "appStore.page.storefrontPreview",
  "appStore.page.builtIn",
  "appStore.page.builtInDesc",
  "appStore.page.privateDevAppsDesc",
  "appStore.page.release",
  "appStore.page.releases",
  "appStore.page.noMatchesEyebrow",
  "appStore.page.noMatchesTitle",
  "appStore.page.noMatchesDesc",
  "appStore.page.roadmapEyebrow",
  "appStore.page.installFlows",
  "appStore.page.curatedBundles",
  "appStore.page.buildNativeDevApp",
  "devApp.category.Local",
] as const

const RETAINED_KEYS = [
  "nav.devAppsStore",
  "nav.search",
  "projects.projects",
  "appStore.page.title",
  "appStore.page.privateBadge",
  "appStore.page.editDevAppFor",
  "appStore.page.createNativeDevApp",
  "appStore.page.openExistingDevApp",
  "appStore.searchPlaceholder",
  "appStore.section.popular",
  "appStore.section.assistants",
  "appStore.page.subtitle",
  "devApp.category.All",
  "devApp.category.Your org",
  "devApp.category.Development",
  "devApp.category.Assistant",
] as const

describe("DevApps Store i18n sweep", () => {
  it.each(["en", "es"] as const)("%s drops storefront keys and keeps live ones", (locale) => {
    const source = read(`apps/desktop/src/lib/i18n/${locale}.ts`)

    for (const key of REMOVED_KEYS) expect(source).not.toContain(`"${key}"`)
    for (const key of RETAINED_KEYS) expect(source).toContain(`"${key}"`)

    expect(source).not.toMatch(
      /"appStore\.(discover|agent-kits|preview-tools|runtimes|build-release|themes|updates)\./,
    )
    expect(source).not.toMatch(
      /"devApp\.category\.(discover|agent-kits|preview-tools|runtimes|build-release|themes|updates)"/,
    )
  })
})
