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
        raise RuntimeError(f"Expected one match in {path}, found {count}: {old[:120]!r}")
    write(path, content.replace(old, new, 1))


# ── App Store ────────────────────────────────────────────────────────────────
store_path = "apps/desktop/src/features/devapps/pages/AppStorePage.tsx"
replace_once(
    store_path,
    'import { useOrgDevAppInstallations } from "@/features/devapps/useOrgDevAppInstallations"\n',
    'import { useOrgDevAppInstallations } from "@/features/devapps/useOrgDevAppInstallations"\n'
    'import { useDevAppInstallations } from "@/features/devapps/useDevAppInstallations"\n'
    'import { installedDevAppSourceLabel } from "@/features/devapps/installedDevAppManifest"\n',
)
replace_once(
    store_path,
    '  const [pendingPublicationId, setPendingPublicationId] = useState<string | null>(null)\n',
    '  const [pendingPublicationId, setPendingPublicationId] = useState<string | null>(null)\n'
    '  const [pendingInstallationId, setPendingInstallationId] = useState<string | null>(null)\n',
)
replace_once(
    store_path,
    '  const { installations, loading: installationsLoading, refresh } = useOrgDevAppInstallations()\n',
    '  const { installations, loading: installationsLoading, refresh } = useOrgDevAppInstallations()\n'
    '  const {\n'
    '    installations: nativeInstallations,\n'
    '    loading: nativeInstallationsLoading,\n'
    '    refresh: refreshNativeInstallations,\n'
    '  } = useDevAppInstallations()\n',
)
replace_once(
    store_path,
    '    () => ({ query, builtinApps, orgApps: orgDevApps, installations }),\n'
    '    [query, builtinApps, orgDevApps, installations],\n',
    '    () => ({\n'
    '      query,\n'
    '      builtinApps,\n'
    '      nativeInstallations,\n'
    '      orgApps: orgDevApps,\n'
    '      installations,\n'
    '    }),\n'
    '    [query, builtinApps, nativeInstallations, orgDevApps, installations],\n',
)
replace_once(
    store_path,
    '  const rail = useMemo(() => buildInstalledRail(listStoreApps(), installations), [installations])\n',
    '  const rail = useMemo(\n'
    '    () => buildInstalledRail(listStoreApps(), installations, nativeInstallations),\n'
    '    [installations, nativeInstallations],\n'
    '  )\n'
    '  const availableScopes = useMemo<AppStoreScope[]>(\n'
    '    () => (orgScopeEnabled ? ["builtin", "installed", "organization"] : ["builtin", "installed"]),\n'
    '    [orgScopeEnabled],\n'
    '  )\n'
    '  const alternateScope = useMemo(\n'
    '    () => availableScopes.find((candidate) => candidate !== scope && matchCounts[candidate] > 0) ?? null,\n'
    '    [availableScopes, matchCounts, scope],\n'
    '  )\n',
)
replace_once(
    store_path,
    '  const copyRef = (ref: string) => {\n',
    dedent(
        '''
          const activateInstalledRelease = async (
            installationId: string,
            releaseId: string,
          ): Promise<void> => {
            setPendingInstallationId(installationId)
            setInstallationError(null)
            try {
              const result = await window.electronAPI.devApp.activateRelease({
                installationId,
                releaseId,
              })
              if (!result.success) throw new Error(result.error)
            } catch (error) {
              setInstallationError(
                error instanceof Error ? error.message : "The DevApp release could not be activated.",
              )
            } finally {
              setPendingInstallationId(null)
            }
          }

          const uninstallInstalledDevApp = async (installationId: string): Promise<void> => {
            setPendingInstallationId(installationId)
            setInstallationError(null)
            try {
              const result = await window.electronAPI.devApp.uninstall({
                installationId,
                removeData: false,
              })
              if (!result.success) throw new Error(result.error)
            } catch (error) {
              setInstallationError(
                error instanceof Error ? error.message : t("appStore.uninstall.failed"),
              )
            } finally {
              setPendingInstallationId(null)
            }
          }

          const copyRef = (ref: string) => {
        '''
    ),
)
replace_once(
    store_path,
    '  const handleRefresh = () => {\n'
    '    setRefreshing(true)\n'
    '    void refresh().finally(() => setRefreshing(false))\n'
    '  }\n',
    '  const handleRefresh = () => {\n'
    '    setRefreshing(true)\n'
    '    void Promise.all([refresh(), refreshNativeInstallations()]).finally(() => setRefreshing(false))\n'
    '  }\n',
)
installed_render = dedent(
    '''
        if (item.kind === "installed") {
          const { installation, activeRelease } = item
          const isPending = pendingInstallationId === installation.installationId
          const inactiveReleases = installation.releases
            .filter((release) => release.releaseId !== installation.activeReleaseId)
            .sort((left, right) => right.installedAt - left.installedAt)

          const handleInstalledMenu = async (event: React.MouseEvent<HTMLButtonElement>) => {
            event.preventDefault()
            event.stopPropagation()
            const rect = event.currentTarget.getBoundingClientRect()
            const position = { x: Math.round(rect.left), y: Math.round(rect.bottom + 4) }
            const items: ContextMenuItem<string>[] = [
              {
                id: "manage",
                label: t("common.manage"),
                icon: getNativeMenuIcon("settings"),
              },
              ...inactiveReleases.map((release) => ({
                id: `activate:${release.releaseId}`,
                label: `Use v${release.appVersion}`,
                icon: getNativeMenuIcon("refresh"),
              })),
              { id: "separator", type: "separator" },
              {
                id: "uninstall",
                label: t("appStore.install.uninstall"),
                destructive: true,
                icon: getNativeMenuIcon("delete"),
              },
            ]
            const action = await showDesktopContextMenu(items, position)
            if (action === "manage") {
              navigate("/projects/settings/devapps")
            } else if (action === "uninstall") {
              void uninstallInstalledDevApp(installation.installationId)
            } else if (action?.startsWith("activate:")) {
              void activateInstalledRelease(
                installation.installationId,
                action.slice("activate:".length),
              )
            }
          }

          return (
            <div key={item.key} ref={registerRow}>
              <DevAppStoreRow
                app={item.app}
                meta={`v${activeRelease.appVersion} · ${activeRelease.manifest.contributes.surfaces.length} ${
                  activeRelease.manifest.contributes.surfaces.length === 1 ? "surface" : "surfaces"
                }`}
                highlighted={highlighted}
                badge={
                  <Badge
                    variant="secondary"
                    className="h-5 shrink-0 rounded-full px-2 text-[10px] font-normal"
                  >
                    {installedDevAppSourceLabel(installation)}
                  </Badge>
                }
                action={
                  nativeInstallationsLoading ? (
                    <Skeleton className="size-7 rounded-full" />
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="size-7 text-muted-foreground hover:text-foreground"
                      aria-label="Options"
                      disabled={isPending}
                      onClick={handleInstalledMenu}
                    >
                      <HugeiconsIcon
                        icon={isPending ? __RefreshHugeIcon : __MoreHorizontalHugeIcon}
                        className={cn("size-4", isPending && "animate-spin")}
                        aria-hidden
                      />
                    </Button>
                  )
                }
              />
            </div>
          )
        }

    '''
)
replace_once(
    store_path,
    '    const { entry, installState } = item\n',
    installed_render + '    const { entry, installState } = item\n',
)
replace_once(
    store_path,
    '  const orgLoading = orgScopeEnabled && orgDevApps === undefined\n'
    '  const showEmptyState = sections.length === 0 && !orgLoading\n',
    '  const orgLoading = orgScopeEnabled && orgDevApps === undefined\n'
    '  const activeScopeLoading =\n'
    '    (scope === "organization" && orgLoading) ||\n'
    '    (scope === "installed" && nativeInstallationsLoading)\n'
    '  const showEmptyState = sections.length === 0 && !activeScopeLoading\n',
)
old_tabs = dedent(
    '''
          {orgScopeEnabled ? (
            <div className="flex items-end border-b border-border/60">
              {(["builtin", "organization"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setParam("scope", tab === "builtin" ? null : tab)}
                  className={cn(
                    "relative inline-flex items-center gap-1.5 px-3 pt-1.5 pb-2.5 text-[13px] font-medium transition-colors",
                    scope === tab
                      ? "text-foreground after:absolute after:right-0 after:-bottom-px after:left-0 after:h-0.5 after:bg-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {tab === "builtin"
                    ? t("appStore.page.badgeBuiltIn")
                    : t("appStore.page.privateDevApps")}
                  {query.trim() && scope !== tab && matchCounts[tab] > 0 ? (
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {matchCounts[tab]}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
    '''
)
new_tabs = dedent(
    '''
          <div className="flex items-end border-b border-border/60">
            {availableScopes.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setParam("scope", tab === "builtin" ? null : tab)}
                className={cn(
                  "relative inline-flex items-center gap-1.5 px-3 pt-1.5 pb-2.5 text-[13px] font-medium transition-colors",
                  scope === tab
                    ? "text-foreground after:absolute after:right-0 after:-bottom-px after:left-0 after:h-0.5 after:bg-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab === "builtin"
                  ? t("appStore.page.badgeBuiltIn")
                  : tab === "installed"
                    ? t("appStore.section.installed")
                    : t("appStore.page.privateDevApps")}
                {query.trim() && scope !== tab && matchCounts[tab] > 0 ? (
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {matchCounts[tab]}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
    '''
)
replace_once(store_path, old_tabs, new_tabs)
replace_once(
    store_path,
    '      {orgLoading && scope === "organization" ? (\n',
    '      {nativeInstallationsLoading && scope === "installed" ? (\n'
    '        <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">\n'
    '          {[0, 1].map((row) => (\n'
    '            <div key={row} className="flex items-center gap-3 px-2 py-2.5">\n'
    '              <Skeleton className="size-10 rounded-[9px]" />\n'
    '              <div className="flex-1 space-y-1.5">\n'
    '                <Skeleton className="h-3.5 w-40" />\n'
    '                <Skeleton className="h-3 w-64" />\n'
    '              </div>\n'
    '            </div>\n'
    '          ))}\n'
    '        </div>\n'
    '      ) : null}\n\n'
    '      {orgLoading && scope === "organization" ? (\n',
)
old_empty_other = dedent(
    '''
                    {matchCounts[scope === "builtin" ? "organization" : "builtin"] > 0 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setParam("scope", scope === "builtin" ? "organization" : null)}
                      >
                        {t("appStore.page.searchOtherScope").replace(
                          "{count}",
                          String(matchCounts[scope === "builtin" ? "organization" : "builtin"]),
                        )}
                      </Button>
                    ) : null}
    '''
)
new_empty_other = dedent(
    '''
                    {alternateScope ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setParam("scope", alternateScope === "builtin" ? null : alternateScope)}
                      >
                        {t("appStore.page.searchOtherScope").replace(
                          "{count}",
                          String(matchCounts[alternateScope]),
                        )}
                      </Button>
                    ) : null}
    '''
)
replace_once(store_path, old_empty_other, new_empty_other)
replace_once(
    store_path,
    '            ) : orgScopeEnabled ? (\n',
    '            ) : scope === "organization" && orgScopeEnabled ? (\n',
)

# ── Settings ─────────────────────────────────────────────────────────────────
settings_path = "apps/desktop/src/features/settings/DevAppSettings.tsx"
replace_once(
    settings_path,
    'import { useOrgDevAppInstallations } from "@/features/devapps/useOrgDevAppInstallations"\n',
    'import { useOrgDevAppInstallations } from "@/features/devapps/useOrgDevAppInstallations"\n'
    'import { useDevAppInstallations } from "@/features/devapps/useDevAppInstallations"\n'
    'import {\n'
    '  activeInstalledDevAppRelease,\n'
    '  buildInstalledDevAppStoreManifest,\n'
    '  installedDevAppSourceLabel,\n'
    '} from "@/features/devapps/installedDevAppManifest"\n',
)
replace_once(
    settings_path,
    '  const [pendingPublicationId, setPendingPublicationId] = useState<string | null>(null)\n',
    '  const [pendingPublicationId, setPendingPublicationId] = useState<string | null>(null)\n'
    '  const [pendingInstallationId, setPendingInstallationId] = useState<string | null>(null)\n',
)
replace_once(
    settings_path,
    '  const { installations, loading: installationsLoading } = useOrgDevAppInstallations()\n',
    '  const { installations, loading: installationsLoading } = useOrgDevAppInstallations()\n'
    '  const {\n'
    '    installations: nativeInstallations,\n'
    '    loading: nativeInstallationsLoading,\n'
    '  } = useDevAppInstallations()\n',
)
replace_once(
    settings_path,
    '    const assistantsCount = builtinApps.filter((a) => a.launcher.group === "Assistant").length\n'
    '    const installedCount = installations.filter((i) => i.active).length\n'
    '    const totalCount = builtinApps.length + (orgDevApps?.length ?? installations.length)\n',
    '    const nativeApps = nativeInstallations.map((installation) =>\n'
    '      buildInstalledDevAppStoreManifest(installation),\n'
    '    )\n'
    '    const assistantsCount =\n'
    '      builtinApps.filter((a) => a.launcher.group === "Assistant").length +\n'
    '      nativeApps.filter((a) => a.launcher.group === "Assistant").length\n'
    '    const installedCount =\n'
    '      installations.filter((i) => i.active).length + nativeInstallations.length\n'
    '    const totalCount =\n'
    '      builtinApps.length + nativeInstallations.length + (orgDevApps?.length ?? installations.length)\n',
)
replace_once(
    settings_path,
    '  }, [builtinApps, installations, orgDevApps])\n',
    '  }, [builtinApps, installations, nativeInstallations, orgDevApps])\n',
)
replace_once(
    settings_path,
    '  const query = searchQuery.trim().toLowerCase()\n',
    dedent(
        '''
          const uninstallInstalledDevApp = async (installationId: string): Promise<void> => {
            setPendingInstallationId(installationId)
            setOperationError(null)
            try {
              const result = await window.electronAPI.devApp.uninstall({
                installationId,
                removeData: false,
              })
              if (!result.success) throw new Error(result.error)
            } catch (error) {
              setOperationError(
                error instanceof Error ? error.message : t("appStore.uninstall.failed"),
              )
            } finally {
              setPendingInstallationId(null)
            }
          }

          const query = searchQuery.trim().toLowerCase()
        '''
    ),
)
replace_once(
    settings_path,
    '  const filteredOrgApps = useMemo(() => {\n',
    dedent(
        '''
          const filteredNativeApps = useMemo(() => {
            if (activeTab === "builtin") return []
            return nativeInstallations
              .map((installation) => ({
                installation,
                release: activeInstalledDevAppRelease(installation),
                app: buildInstalledDevAppStoreManifest(installation),
              }))
              .filter(({ installation, release, app }) => {
                if (activeTab === "assistants" && app.launcher.group !== "Assistant") return false
                if (query) {
                  return [
                    app.name,
                    app.description,
                    installation.appId,
                    installedDevAppSourceLabel(installation),
                    release.appVersion,
                  ].some((value) => value.toLowerCase().includes(query))
                }
                return true
              })
          }, [activeTab, nativeInstallations, query])

          const filteredOrgApps = useMemo(() => {
        '''
    ),
)
replace_once(
    settings_path,
    '  const totalFilteredCount = filteredBuiltins.length + filteredOrgApps.length\n',
    '  const totalFilteredCount =\n'
    '    filteredBuiltins.length + filteredNativeApps.length + filteredOrgApps.length\n',
)
settings_rows = dedent(
    '''
            {/* Installed manifest-v3 DevApps */}
            {filteredNativeApps.map(({ installation, release, app }) => {
              const isPending = pendingInstallationId === installation.installationId
              return (
                <div
                  key={installation.installationId}
                  className="flex min-h-[58px] items-center gap-3.5 px-5 py-3 transition-colors hover:bg-muted/30 dark:hover:bg-white/[0.02]"
                >
                  <div
                    className={cn(
                      "flex shrink-0 items-center justify-center overflow-hidden bg-gradient-to-br ring-1 ring-border/60",
                      app.store.accentClassName,
                    )}
                    style={{
                      height: ICON_SIZE_PX,
                      width: ICON_SIZE_PX,
                      borderRadius: ICON_SIZE_PX * SQUIRCLE_RATIO,
                    }}
                  >
                    <DevAppIcon app={app} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {installation.name}
                    </span>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground/70">
                      <span>{installedDevAppSourceLabel(installation)}</span>
                      <span aria-hidden className="text-muted-foreground/40">·</span>
                      <span>{formatDevAppSize(release.sizeBytes)}</span>
                      <span aria-hidden className="text-muted-foreground/40">·</span>
                      <span>v{release.appVersion}</span>
                      <span aria-hidden className="text-muted-foreground/40">·</span>
                      <span>
                        {release.manifest.contributes.surfaces.length}{" "}
                        {release.manifest.contributes.surfaces.length === 1 ? "surface" : "surfaces"}
                      </span>
                      {installation.installedAt ? (
                        <>
                          <span aria-hidden className="text-muted-foreground/40">·</span>
                          <span>Installed {formatDevAppDate(installation.installedAt)}</span>
                        </>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    <Switch
                      checked
                      disabled={isPending || nativeInstallationsLoading}
                      onCheckedChange={(checked) => {
                        if (!checked) void uninstallInstalledDevApp(installation.installationId)
                      }}
                      aria-label={installation.name}
                    />
                  </div>
                </div>
              )
            })}

    '''
)
replace_once(
    settings_path,
    '        {/* Organization Apps Rows */}\n',
    settings_rows + '        {/* Organization Apps Rows */}\n',
)

# ── Install/update from a live native preview ────────────────────────────────
preview_path = "apps/desktop/src/features/workbench/WorkbenchDevAppPreviewTile.tsx"
replace_once(
    preview_path,
    'import { createNativeDevAppHostClient } from "@/features/devapps/native-runtime/createNativeDevAppHostClient";\n',
    'import { createNativeDevAppHostClient } from "@/features/devapps/native-runtime/createNativeDevAppHostClient";\n'
    'import { useDevAppInstallations } from "@/features/devapps/useDevAppInstallations";\n',
)
replace_once(
    preview_path,
    '  const [approvalError, setApprovalError] = useState<string | null>(null);\n',
    '  const [approvalError, setApprovalError] = useState<string | null>(null);\n'
    '  const [installationPending, setInstallationPending] = useState(false);\n'
    '  const [installationError, setInstallationError] = useState<string | null>(null);\n',
)
replace_once(
    preview_path,
    '  const preview = window.electronAPI?.devAppPreview;\n',
    '  const preview = window.electronAPI?.devAppPreview;\n'
    '  const { installations: installedDevApps } = useDevAppInstallations();\n',
)
replace_once(
    preview_path,
    '  const running = status?.status === "running" ? status : null;\n',
    dedent(
        '''
          const running = status?.status === "running" ? status : null;
          const installedDevelopment = useMemo(
            () =>
              installedDevApps.find(
                (installation) =>
                  installation.source.kind === "development" &&
                  installation.source.workspaceId === sourceWorkspaceId &&
                  installation.source.relativePath === tile.relativePath,
              ) ?? null,
            [installedDevApps, sourceWorkspaceId, tile.relativePath],
          );

          const installDevelopment = useCallback(() => {
            if (!sourceWorkspaceId || !tile.relativePath || installationPending) return;
            setInstallationPending(true);
            setInstallationError(null);
            void window.electronAPI.devApp
              .installDevelopment({
                workspaceId: sourceWorkspaceId,
                laneId: sourceLaneId,
                relativePath: tile.relativePath,
              })
              .then((result) => {
                if (!result.success) throw new Error(result.error);
              })
              .catch((error: unknown) => {
                setInstallationError(
                  error instanceof Error ? error.message : "The DevApp could not be installed.",
                );
              })
              .finally(() => setInstallationPending(false));
          }, [installationPending, sourceLaneId, sourceWorkspaceId, tile.relativePath]);
        '''
    ),
)
replace_once(
    preview_path,
    '      controls={<DevelopmentBadge status={status} hotReload={hotReload} />}\n',
    '      controls={\n'
    '        <DevelopmentControls\n'
    '          status={status}\n'
    '          hotReload={hotReload}\n'
    '          canInstall={Boolean(nativeView && sourceWorkspaceId && tile.relativePath)}\n'
    '          installed={Boolean(installedDevelopment)}\n'
    '          pending={installationPending}\n'
    '          error={installationError}\n'
    '          onInstall={installDevelopment}\n'
    '        />\n'
    '      }\n',
)
replace_once(
    preview_path,
    'function DevelopmentBadge({\n',
    dedent(
        '''
        function DevelopmentControls({
          status,
          hotReload,
          canInstall,
          installed,
          pending,
          error,
          onInstall,
        }: {
          status: DevAppPreviewStatus | null;
          hotReload: boolean;
          canInstall: boolean;
          installed: boolean;
          pending: boolean;
          error: string | null;
          onInstall: () => void;
        }) {
          return (
            <span className="flex items-center gap-1.5">
              <DevelopmentBadge status={status} hotReload={hotReload} />
              {canInstall ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="h-6 rounded-full px-2 text-[10px]"
                  disabled={pending}
                  title={error ?? (installed ? "Build and activate a new release" : "Install this DevApp")}
                  onClick={onInstall}
                >
                  {pending ? "Building…" : installed ? "Update" : "Install"}
                </Button>
              ) : null}
            </span>
          );
        }

        function DevelopmentBadge({
        '''
    ),
)

# ── Model tests ──────────────────────────────────────────────────────────────
test_path = "tests/devapps/appStoreSections.test.ts"
replace_once(
    test_path,
    '  matchesOrgDevAppQuery,\n',
    '  matchesInstalledDevAppQuery,\n  matchesOrgDevAppQuery,\n',
)
replace_once(
    test_path,
    'import type { OrgDevAppInstallation } from "@shared/orgDevAppInstallation"\n',
    'import type { DevAppInstallationV3 } from "@shared/devAppInstallationV3"\n'
    'import type { OrgDevAppInstallation } from "@shared/orgDevAppInstallation"\n',
)
fixture = dedent(
    '''

    function nativeInstallation(
      overrides: Partial<DevAppInstallationV3> = {},
    ): DevAppInstallationV3 {
      const releaseId = "b".repeat(64)
      return {
        installationId: "0123456789abcdef0123456789abcdef",
        appId: "com.example.counter",
        name: "Counter",
        description: "A native counter",
        source: {
          kind: "development",
          workspaceId: "workspace-1",
          relativePath: "devapps/counter",
        },
        installedAt: 1_000,
        updatedAt: 2_000,
        activeReleaseId: releaseId,
        releases: [
          {
            releaseId,
            appVersion: "1.0.0",
            installedAt: 1_000,
            sizeBytes: 512,
            manifest: {
              releaseManifestVersion: 1,
              appId: "com.example.counter",
              appVersion: "1.0.0",
              nativeApi: 1,
              rendererModules: {
                main: { entry: "renderer/main.mjs", contentHash: "c".repeat(64) },
              },
              permissions: { required: [], optional: [] },
              contributes: {
                surfaces: [
                  {
                    id: "main",
                    title: "Counter",
                    default: true,
                    renderer: {
                      kind: "native-react",
                      module: "main",
                      component: "CounterTile",
                    },
                  },
                ],
              },
            },
          },
        ],
        ...overrides,
      }
    }
    '''
)
replace_once(test_path, '\nconst builtinApps = listStoreApps()\n', fixture + '\nconst builtinApps = listStoreApps()\n')
# Every existing build input now declares the third source explicitly.
tests = read(test_path)
tests = tests.replace(
    'const base = { scope: "builtin" as const, query: "", builtinApps, orgApps: [], installations: [] }',
    'const base = {\n    scope: "builtin" as const,\n    query: "",\n    builtinApps,\n    nativeInstallations: [],\n    orgApps: [],\n    installations: [],\n  }',
)
tests = tests.replace(
    'const base = { scope: "organization" as const, query: "", builtinApps }',
    'const base = {\n    scope: "organization" as const,\n    query: "",\n    builtinApps,\n    nativeInstallations: [],\n  }',
)
tests = tests.replace(
    '      orgApps: [orgEntry({ publicationId: "pub-2", name: "Docs" })],\n      installations: [],',
    '      nativeInstallations: [],\n      orgApps: [orgEntry({ publicationId: "pub-2", name: "Docs" })],\n      installations: [],',
)
insert_before = '\ndescribe("resolveOrgInstallState", () => {'
installed_tests = dedent(
    '''

    describe("buildAppStoreSections — installed scope", () => {
      const base = {
        scope: "installed" as const,
        query: "",
        builtinApps,
        nativeInstallations: [nativeInstallation()],
        orgApps: [],
        installations: [],
      }

      it("shows one app-level row for an installed release", () => {
        const sections = buildAppStoreSections(base)
        expect(sections.map((section) => section.id)).toEqual(["all"])
        expect(sections[0]?.items).toHaveLength(1)
        expect(sections[0]?.items[0]).toMatchObject({
          kind: "installed",
          key: "0123456789abcdef0123456789abcdef",
        })
      })

      it("searches app, source and contributed surface metadata", () => {
        for (const query of ["counter", "local", "1.0.0"]) {
          expect(buildAppStoreSections({ ...base, query })[0]?.items).toHaveLength(1)
          expect(matchesInstalledDevAppQuery(nativeInstallation(), query)).toBe(true)
        }
        expect(buildAppStoreSections({ ...base, query: "unrelated" })).toEqual([])
      })
    })
    '''
)
if tests.count(insert_before) != 1:
    raise RuntimeError("Expected resolveOrgInstallState insertion point")
tests = tests.replace(insert_before, installed_tests + insert_before, 1)
# Extend scope expectations and rail coverage.
tests = tests.replace(
    '    expect(resolveAppStoreScope("builtin")).toBe("builtin")',
    '    expect(resolveAppStoreScope("builtin")).toBe("builtin")\n    expect(resolveAppStoreScope("installed")).toBe("installed")',
)
tests = tests.replace(
    '    expect(counts.organization).toBe(1)\n    expect(counts.builtin)',
    '    expect(counts.organization).toBe(1)\n    expect(counts.installed).toBe(0)\n    expect(counts.builtin)',
)
rail_insert = '\n  it("appends one entry per publication, most recently used first", () => {'
rail_test = dedent(
    '''

      it("includes manifest-v3 installations in their own Store scope", () => {
        const rail = buildInstalledRail([], [], [nativeInstallation()])
        expect(rail).toHaveLength(1)
        expect(rail[0]).toMatchObject({
          kind: "installed",
          key: "0123456789abcdef0123456789abcdef",
          scope: "installed",
          name: "Counter",
        })
      })
    '''
)
if tests.count(rail_insert) != 1:
    raise RuntimeError("Expected rail test insertion point")
tests = tests.replace(rail_insert, rail_test + rail_insert, 1)
write(test_path, tests)

# Remove one-shot automation from the product commit.
(ROOT / ".automation/native-devapp-finish-store.py").unlink()
(ROOT / ".github/workflows/native-devapp-finish-store.yml").unlink()
