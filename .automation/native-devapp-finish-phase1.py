from __future__ import annotations

from pathlib import Path
from textwrap import dedent

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    content = read(path)
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f"Expected one match in {path}, found {count}: {old[:100]!r}")
    write(path, content.replace(old, new, 1))


write(
    "apps/desktop/src/features/devapps/useDevAppInstallations.ts",
    dedent(
        '''
        import { useCallback, useEffect, useState } from "react"

        import type { DevAppInstallationV3 } from "@shared/devAppInstallationV3"

        export function useDevAppInstallations() {
          const [installations, setInstallations] = useState<DevAppInstallationV3[]>([])
          const [loading, setLoading] = useState(true)
          const [error, setError] = useState<string | null>(null)

          const refresh = useCallback(async () => {
            setLoading(true)
            try {
              const result = await window.electronAPI.devApp.listInstallations()
              if (!result.success) throw new Error(result.error)
              setInstallations(result.installations)
              setError(null)
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "DevApp installations could not be loaded.")
            } finally {
              setLoading(false)
            }
          }, [])

          useEffect(() => {
            let mounted = true
            void refresh()
            const unsubscribe = window.electronAPI.devApp.onInstallationsChanged((next) => {
              if (!mounted) return
              setInstallations(next)
              setLoading(false)
              setError(null)
            })
            return () => {
              mounted = false
              unsubscribe()
            }
          }, [refresh])

          return { installations, loading, error, refresh }
        }
        '''
    ).lstrip(),
)

write(
    "apps/desktop/src/features/devapps/installedDevAppManifest.ts",
    dedent(
        '''
        import type { DevAppInstallationV3, DevAppInstalledReleaseV3 } from "@shared/devAppInstallationV3"
        import type { DevAppReleaseManifestV1, DevAppSurfaceContributionV3 } from "@shared/devAppManifestV3"
        import type { DevAppParts, DevAppStateScope } from "@shared/devAppParts"

        import type {
          DevAppCategoryId,
          DevAppLauncherGroup,
          DevAppManifest,
          InstalledDevAppLaunchSpec,
        } from "@/features/devapps/registry/types"

        function activeRelease(installation: DevAppInstallationV3): DevAppInstalledReleaseV3 {
          const release = installation.releases.find(
            (candidate) => candidate.releaseId === installation.activeReleaseId,
          )
          if (!release) throw new Error(`DevApp ${installation.appId} has no active installed release.`)
          return release
        }

        function stateScopeForParts(
          state: DevAppReleaseManifestV1["services"] extends Record<string, infer Service>
            ? Service extends { state: infer State }
              ? State
              : never
            : never,
        ): DevAppStateScope {
          if (state === "organization") return "organization"
          if (state === "none") return "none"
          return "device"
        }

        function partsForInstalledRelease(release: DevAppReleaseManifestV1): DevAppParts {
          const service = Object.values(release.services ?? {})[0]
          const capabilities = [...release.permissions.required, ...release.permissions.optional]
          return {
            view: { source: "package" },
            ...(release.extension
              ? {
                  worker: {
                    capabilities,
                    protocolVersion: 1,
                  },
                }
              : {}),
            ...(service
              ? {
                  service: { runtimeKind: "node" as const, network: true },
                  runtime: {
                    kind: "container" as const,
                    location: service.location,
                    state: stateScopeForParts(service.state),
                  },
                }
              : {}),
          }
        }

        function fallbackIcon(name: string, appId: string): string {
          const initials = name
            .split(/\\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((part) => part[0]?.toUpperCase() ?? "")
            .join("") || "D"
          let hue = 0
          for (const character of appId) hue = (hue * 31 + character.charCodeAt(0)) % 360
          const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="hsl(${hue} 58% 45%)"/><text x="32" y="39" text-anchor="middle" font-family="system-ui,sans-serif" font-size="22" font-weight="700" fill="white">${initials.replace(/[<>&\"']/g, "")}</text></svg>`
          return `data:image/svg+xml,${encodeURIComponent(svg)}`
        }

        function launcherGroup(surface: DevAppSurfaceContributionV3): DevAppLauncherGroup {
          return surface.placement?.group === "Assistant" ? "Assistant" : "Development"
        }

        function categoriesFor(group: DevAppLauncherGroup): DevAppCategoryId[] {
          return group === "Assistant"
            ? ["discover", "agent-kits"]
            : ["discover", "preview-tools"]
        }

        function sourceLabel(installation: DevAppInstallationV3): string {
          switch (installation.source.kind) {
            case "system":
              return "System"
            case "organization":
              return "Organization"
            case "development":
              return "Local"
          }
        }

        export function buildInstalledDevAppManifest(
          installation: DevAppInstallationV3,
          surface: DevAppSurfaceContributionV3,
          order = 0,
        ): DevAppManifest {
          const release = activeRelease(installation)
          const group = launcherGroup(surface)
          const launch: InstalledDevAppLaunchSpec = {
            kind: "installedDevApp",
            tileType: "devApp",
            singleton: surface.singleton === true,
            installationId: installation.installationId,
            releaseId: release.releaseId,
            appId: installation.appId,
            appVersion: release.appVersion,
            surfaceId: surface.id,
            name: surface.title,
          }
          return {
            id: `installed-devapp:${installation.installationId}:${surface.id}`,
            name:
              release.manifest.contributes.surfaces.length === 1
                ? installation.name
                : `${installation.name} · ${surface.title}`,
            description: surface.description ?? installation.description ?? "Installed Cozea DevApp",
            categories: categoriesFor(group),
            icon: {
              src: fallbackIcon(installation.name, installation.appId),
              alt: installation.name,
              className: "scale-100",
            },
            launcher: {
              enabled: true,
              order: 5_000 + order,
              group,
              searchTerms: [
                installation.appId,
                installation.name,
                surface.title,
                sourceLabel(installation),
              ],
            },
            store: {
              categoryLabel: sourceLabel(installation),
              accentClassName: "bg-muted text-foreground",
              badgeLabel: `v${release.appVersion}`,
            },
            parts: partsForInstalledRelease(release.manifest),
            launch,
          }
        }

        export function buildInstalledDevAppManifests(
          installations: ReadonlyArray<DevAppInstallationV3>,
        ): DevAppManifest[] {
          return installations.flatMap((installation, installationIndex) => {
            const release = activeRelease(installation)
            return release.manifest.contributes.surfaces.map((surface, surfaceIndex) =>
              buildInstalledDevAppManifest(
                installation,
                surface,
                installationIndex * 100 + surfaceIndex,
              ),
            )
          })
        }
        '''
    ).lstrip(),
)

replace_once(
    "apps/desktop/src/features/devapps/registry/types.ts",
    '''export interface DevAppMobileSimulatorLaunchSpec extends DevAppLaunchBase {\n''',
    '''export interface InstalledDevAppLaunchSpec extends DevAppLaunchBase {\n  kind: "installedDevApp"\n  tileType: "devApp"\n  installationId: string\n  releaseId: string\n  appId: string\n  appVersion: string\n  surfaceId: string\n  name: string\n}\n\nexport interface DevAppMobileSimulatorLaunchSpec extends DevAppLaunchBase {\n''',
)
replace_once(
    "apps/desktop/src/features/devapps/registry/types.ts",
    '''  | DevelopmentDevAppLaunchSpec\n  | DevAppLlamaLaunchSpec\n''',
    '''  | DevelopmentDevAppLaunchSpec\n  | InstalledDevAppLaunchSpec\n  | DevAppLlamaLaunchSpec\n''',
)
replace_once(
    "apps/desktop/src/features/devapps/registry/types.ts",
    '''  developmentDevApp?: DevelopmentDevAppLaunchSpec\n}\n''',
    '''  developmentDevApp?: DevelopmentDevAppLaunchSpec\n  installedDevApp?: InstalledDevAppLaunchSpec\n}\n''',
)

replace_once(
    "apps/desktop/src/features/workbench/model/workbenchSelectionLaunch.ts",
    '''  devAppRef?: string | null\n  devAppPreviewRelativePath?: string | null\n''',
    '''  devAppRef?: string | null\n  devAppInstallationId?: string | null\n  installedDevAppId?: string | null\n  installedDevAppVersion?: string | null\n  installedDevAppReleaseId?: string | null\n  installedDevAppSurfaceId?: string | null\n  devAppPreviewRelativePath?: string | null\n''',
)
replace_once(
    "apps/desktop/src/features/workbench/model/workbenchSelectionLaunch.ts",
    '''  tileType: "assistantChat" | "browser" | "terminal" | "orgDevApp" | "devAppPreview"\n''',
    '''  tileType: "assistantChat" | "browser" | "terminal" | "orgDevApp" | "devApp" | "devAppPreview"\n''',
)
replace_once(
    "apps/desktop/src/features/workbench/model/workbenchSelectionLaunch.ts",
    '''  if (request.developmentDevApp) {\n''',
    '''  if (request.installedDevApp) {\n    const devApp = request.installedDevApp\n    if (request.appId !== `installed-devapp:${devApp.installationId}:${devApp.surfaceId}`) {\n      throw new Error(`Invalid installed DevApp launch request for "${request.appId}"`)\n    }\n    return {\n      action: "addTile",\n      tileType: "devApp",\n      options: {\n        title: devApp.name,\n        devAppInstallationId: devApp.installationId,\n        installedDevAppId: devApp.appId,\n        installedDevAppVersion: devApp.appVersion,\n        installedDevAppReleaseId: devApp.releaseId,\n        installedDevAppSurfaceId: devApp.surfaceId,\n      },\n    }\n  }\n\n  if (request.developmentDevApp) {\n''',
)
replace_once(
    "apps/desktop/src/features/workbench/model/workbenchSelectionLaunch.ts",
    '''    case "publishedDevApp":\n    case "projectDevApp":\n    case "developmentDevApp":\n''',
    '''    case "publishedDevApp":\n    case "projectDevApp":\n    case "developmentDevApp":\n    case "installedDevApp":\n''',
)

replace_once(
    "apps/desktop/src/features/workbench/WorkbenchSelectionTile.tsx",
    '''import { buildDevelopmentDevAppManifest } from "@/features/devapps/developmentDevAppManifest"\n''',
    '''import { buildDevelopmentDevAppManifest } from "@/features/devapps/developmentDevAppManifest"\nimport { buildInstalledDevAppManifests } from "@/features/devapps/installedDevAppManifest"\nimport { useDevAppInstallations } from "@/features/devapps/useDevAppInstallations"\n''',
)
replace_once(
    "apps/desktop/src/features/workbench/WorkbenchSelectionTile.tsx",
    '''  DevAppManifest,\n  DevelopmentDevAppLaunchSpec,\n  PublishedDevAppLaunchSpec,\n''',
    '''  DevAppManifest,\n  DevelopmentDevAppLaunchSpec,\n  InstalledDevAppLaunchSpec,\n  PublishedDevAppLaunchSpec,\n''',
)
replace_once(
    "apps/desktop/src/features/workbench/WorkbenchSelectionTile.tsx",
    '''  const { installations } = useOrgDevAppInstallations()\n''',
    '''  const { installations } = useOrgDevAppInstallations()\n  const { installations: installedDevApps } = useDevAppInstallations()\n''',
)
replace_once(
    "apps/desktop/src/features/workbench/WorkbenchSelectionTile.tsx",
    '''  const developmentDevAppOptions = useMemo(\n    () => developmentSources.map(buildDevelopmentDevAppManifest),\n    [developmentSources],\n  )\n''',
    '''  const developmentDevAppOptions = useMemo(\n    () => developmentSources.map(buildDevelopmentDevAppManifest),\n    [developmentSources],\n  )\n  const installedDevAppOptions = useMemo(\n    () => buildInstalledDevAppManifests(installedDevApps),\n    [installedDevApps],\n  )\n''',
)
selection_path = "apps/desktop/src/features/workbench/WorkbenchSelectionTile.tsx"
selection = read(selection_path)
needle = "[...developmentDevAppOptions, ...orgDevAppOptions]"
if selection.count(needle) < 2:
    raise RuntimeError("Expected installed option insertion points in WorkbenchSelectionTile")
selection = selection.replace(
    needle,
    "[...installedDevAppOptions, ...developmentDevAppOptions, ...orgDevAppOptions]",
)
selection = selection.replace(
    "[developmentDevAppOptions, enabledAssistantProviders, orgDevAppOptions]",
    "[developmentDevAppOptions, enabledAssistantProviders, installedDevAppOptions, orgDevAppOptions]",
)
selection = selection.replace(
    "[allOptions, developmentDevAppOptions, enabledAssistantProviders, orgDevAppOptions, parsedRef, resolvedRefOptions, searchQuery]",
    "[allOptions, developmentDevAppOptions, enabledAssistantProviders, installedDevAppOptions, orgDevAppOptions, parsedRef, resolvedRefOptions, searchQuery]",
)
old_choose = '''      const developmentDevApp: DevelopmentDevAppLaunchSpec | undefined =\n        option.launch.kind === "developmentDevApp" ? option.launch : undefined\n      onChoose({\n        appId: option.id,\n        ...(publishedDevApp ? { publishedDevApp } : {}),\n        ...(developmentDevApp ? { developmentDevApp } : {}),\n      })\n'''
new_choose = '''      const developmentDevApp: DevelopmentDevAppLaunchSpec | undefined =\n        option.launch.kind === "developmentDevApp" ? option.launch : undefined\n      const installedDevApp: InstalledDevAppLaunchSpec | undefined =\n        option.launch.kind === "installedDevApp" ? option.launch : undefined\n      onChoose({\n        appId: option.id,\n        ...(publishedDevApp ? { publishedDevApp } : {}),\n        ...(developmentDevApp ? { developmentDevApp } : {}),\n        ...(installedDevApp ? { installedDevApp } : {}),\n      })\n'''
if selection.count(old_choose) != 1:
    raise RuntimeError("Expected launch request block in WorkbenchSelectionTile")
selection = selection.replace(old_choose, new_choose, 1)
write(selection_path, selection)

write(
    "tests/devapps/installedDevAppManifest.test.ts",
    dedent(
        '''
        import { describe, expect, it } from "vitest"

        import { buildInstalledDevAppManifests } from "@/features/devapps/installedDevAppManifest"
        import { resolveWorkbenchSelectionLaunchRequest } from "@/features/workbench/model/workbenchSelectionLaunch"
        import type { DevAppInstallationV3 } from "@shared/devAppInstallationV3"

        const installation: DevAppInstallationV3 = {
          installationId: "0123456789abcdef0123456789abcdef",
          appId: "com.example.counter",
          name: "Counter",
          description: "A native counter",
          source: { kind: "development", workspaceId: "workspace-1", relativePath: "devapps/counter" },
          installedAt: 1,
          updatedAt: 1,
          activeReleaseId: "a".repeat(64),
          releases: [
            {
              releaseId: "a".repeat(64),
              appVersion: "1.0.0",
              installedAt: 1,
              sizeBytes: 10,
              manifest: {
                releaseManifestVersion: 1,
                appId: "com.example.counter",
                appVersion: "1.0.0",
                nativeApi: 1,
                rendererModules: {
                  main: { entry: "renderer/main.mjs", contentHash: "b".repeat(64) },
                },
                permissions: { required: [], optional: [] },
                contributes: {
                  surfaces: [
                    {
                      id: "main",
                      title: "Counter",
                      default: true,
                      renderer: { kind: "native-react", module: "main", component: "CounterTile" },
                    },
                  ],
                },
              },
            },
          ],
        }

        describe("installed DevApp launcher adapter", () => {
          it("turns installed surface contributions into generic workbench launch requests", () => {
            const [manifest] = buildInstalledDevAppManifests([installation])
            expect(manifest?.launch.kind).toBe("installedDevApp")
            const resolved = resolveWorkbenchSelectionLaunchRequest({
              appId: manifest!.id,
              installedDevApp:
                manifest!.launch.kind === "installedDevApp" ? manifest!.launch : undefined,
            })
            expect(resolved).toEqual({
              action: "addTile",
              tileType: "devApp",
              options: {
                title: "Counter",
                devAppInstallationId: installation.installationId,
                installedDevAppId: installation.appId,
                installedDevAppVersion: "1.0.0",
                installedDevAppReleaseId: installation.activeReleaseId,
                installedDevAppSurfaceId: "main",
              },
            })
          })
        })
        '''
    ).lstrip(),
)

# Remove the one-shot automation from the resulting product commit.
(ROOT / ".automation/native-devapp-finish-phase1.py").unlink()
(ROOT / ".github/workflows/native-devapp-finish-phase1.yml").unlink()
