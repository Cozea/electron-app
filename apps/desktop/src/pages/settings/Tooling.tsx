import { useCallback, useEffect, useState } from 'react'
import { SiBun, SiGo, SiNodedotjs, SiNpm, SiPnpm, SiPython, SiRust, SiYarn } from 'react-icons/si'
import { SettingsPageBody } from '@/components/settings/SettingsChrome'
import { settingsDesktopClient } from '@/lib/settings/settingsDesktopClient'
import { toolingSettingsClient } from '@/lib/settings/toolingSettingsClient'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Switch } from '../../components/ui/switch'
import type { GitRuntimeHealth, RuntimeHealth, RuntimeKind } from '../../types/electron'
import { useTranslation } from '@/lib/i18n'

import { HugeiconsIcon } from '@hugeicons/react'
import { Alert01Icon as __AlertTriangleHugeIcon, Archive01Icon as __PackageHugeIcon, CheckmarkCircle02Icon as __CheckHugeIcon, Folder01Icon as __FolderHugeIcon } from '@hugeicons/core-free-icons'

interface ToolingProps {
  surface?: 'page' | 'drawer'
  route?: string
}

const RUNTIME_LABELS: Record<RuntimeKind, string> = {
  node: 'Node.js',
  npm: 'npm',
  corepack: 'Corepack',
  pnpm: 'pnpm',
  yarn: 'Yarn',
  bun: 'Bun',
  python: 'Python',
  rust: 'Rust (cargo)',
  go: 'Go',
}

let cachedRuntimeStatus: { target: string; runtimes: RuntimeHealth[] } | null = null

let cachedGitRuntimeHealth: GitRuntimeHealth | null = null
let runtimeStatusPrewarmPromise: Promise<void> | null = null

export async function prewarmToolingSettings(): Promise<void> {
  if (!toolingSettingsClient.isAvailable()) return
  if (cachedRuntimeStatus) return
  if (runtimeStatusPrewarmPromise) {
    await runtimeStatusPrewarmPromise
    return
  }

  runtimeStatusPrewarmPromise = toolingSettingsClient
    .getRuntimeStatus()
    .then((status) => {
      cachedRuntimeStatus = status
    })
    .catch(() => undefined)
    .finally(() => {
      runtimeStatusPrewarmPromise = null
    })

  await runtimeStatusPrewarmPromise
}

function getGitExecutableLabel(executablePath?: string): string {
  if (!executablePath) return 'git'
  const normalizedPath = executablePath.replace(/\\/g, '/')
  const basename = normalizedPath.split('/').pop()?.trim()
  return basename || executablePath
}

function RuntimeLogo({ runtime }: { runtime: RuntimeKind }) {
  const foregroundColor = 'var(--foreground)'
  const mutedColor = 'var(--muted-foreground)'

  switch (runtime) {
    case 'node':
      return <SiNodedotjs className="h-4 w-4" style={{ color: '#5FA04E' }} />
    case 'npm':
      return <SiNpm className="h-4 w-4" style={{ color: '#CB3837' }} />
    case 'corepack':
      return <HugeiconsIcon icon={__PackageHugeIcon} className="h-4 w-4" style={{ color: mutedColor }} />
    case 'pnpm':
      return <SiPnpm className="h-4 w-4" style={{ color: '#F9AD00' }} />
    case 'yarn':
      return <SiYarn className="h-4 w-4" style={{ color: '#2C8EBB' }} />
    case 'bun':
      return <SiBun className="h-4 w-4" style={{ color: foregroundColor }} />
    case 'python':
      return <SiPython className="h-4 w-4" style={{ color: '#3776AB' }} />
    case 'rust':
      return <SiRust className="h-4 w-4" style={{ color: foregroundColor }} />
    case 'go':
      return <SiGo className="h-4 w-4" style={{ color: '#00ADD8' }} />
    default:
      return <HugeiconsIcon icon={__PackageHugeIcon} className="h-4 w-4" style={{ color: mutedColor }} />
  }
}

export function Tooling({ surface = 'page', route: _route }: ToolingProps) {
  const { t } = useTranslation()
  const [isLoading, setIsLoading] = useState(!cachedRuntimeStatus)
  const [error, setError] = useState<string | null>(null)
  const [runtimeStatus, setRuntimeStatus] = useState<{ target: string; runtimes: RuntimeHealth[] } | null>(
    cachedRuntimeStatus
  )
  const [gitRuntimeHealth, setGitRuntimeHealth] = useState<GitRuntimeHealth | null>(cachedGitRuntimeHealth)
  const [previewHeaderCompatibilityEnabled, setPreviewHeaderCompatibilityEnabled] = useState(true)
  const [previewHeaderCompatibilityError, setPreviewHeaderCompatibilityError] = useState<string | null>(null)
  const [isSavingPreviewHeaderCompatibility, setIsSavingPreviewHeaderCompatibility] = useState(false)
  const [projectsDirectory, setProjectsDirectory] = useState<string | null>(null)
  const [projectsDirectoryError, setProjectsDirectoryError] = useState<string | null>(null)
  const [isSavingProjectsDirectory, setIsSavingProjectsDirectory] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 5

  const loadRuntimeStatus = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setIsLoading(true)
    }
    setError(null)
    try {
      if (!toolingSettingsClient.isAvailable()) {
        throw new Error('Runtime API is unavailable in this environment.')
      }
      const status = await toolingSettingsClient.getRuntimeStatus()
      cachedRuntimeStatus = status
      setRuntimeStatus(status)
      const gitHealth = await toolingSettingsClient.getGitRuntimeHealth()
      if (gitHealth) {
        cachedGitRuntimeHealth = gitHealth
        setGitRuntimeHealth(gitHealth)
      }
    } catch (runtimeError) {
      const message = runtimeError instanceof Error ? runtimeError.message : 'Failed to load tooling status.'
      setError(message)
      setRuntimeStatus((current) => current ?? cachedRuntimeStatus)
      setGitRuntimeHealth((current) => current ?? cachedGitRuntimeHealth)
    } finally {
      if (!options?.silent) {
        setIsLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    void loadRuntimeStatus({ silent: Boolean(cachedRuntimeStatus) })
  }, [loadRuntimeStatus])

  useEffect(() => {
    const loadPreviewHeaderCompatibilitySetting = async () => {
      if (!settingsDesktopClient.hasSettings()) return

      try {
        const settings = await settingsDesktopClient.get()
        setPreviewHeaderCompatibilityEnabled(settings.previewHeaderCompatibilityEnabled)
        setProjectsDirectory(settings.projectsDirectory)
      } catch (settingsError) {
        const message =
          settingsError instanceof Error
            ? settingsError.message
            : 'Failed to load preview compatibility setting.'
        setPreviewHeaderCompatibilityError(message)
      }
    }

    void loadPreviewHeaderCompatibilitySetting()
  }, [])

  const handlePreviewHeaderCompatibilityChange = useCallback(
    async (checked: boolean) => {
      if (!settingsDesktopClient.hasSettings()) return

      const previousValue = previewHeaderCompatibilityEnabled
      setPreviewHeaderCompatibilityEnabled(checked)
      setPreviewHeaderCompatibilityError(null)
      setIsSavingPreviewHeaderCompatibility(true)

      try {
        await settingsDesktopClient.set({
          previewHeaderCompatibilityEnabled: checked,
        })
      } catch (settingsError) {
        const message =
          settingsError instanceof Error
            ? settingsError.message
            : 'Failed to save preview compatibility setting.'
        setPreviewHeaderCompatibilityEnabled(previousValue)
        setPreviewHeaderCompatibilityError(message)
      } finally {
        setIsSavingPreviewHeaderCompatibility(false)
      }
    },
    [previewHeaderCompatibilityEnabled]
  )

  const handleChooseProjectsDirectory = useCallback(async () => {
    if (!settingsDesktopClient.hasSettings() || !settingsDesktopClient.hasDialog()) return

    setProjectsDirectoryError(null)
    setIsSavingProjectsDirectory(true)

    try {
      const result = await settingsDesktopClient.selectDirectory({
        title: t('settings.tooling.projectsDirectoryPickerTitle'),
      })
      if (!result.success || !result.path) {
        return
      }

      await settingsDesktopClient.set({
        projectsDirectory: result.path,
      })
      setProjectsDirectory(result.path)
    } catch (settingsError) {
      const message =
        settingsError instanceof Error
          ? settingsError.message
          : 'Failed to save projects directory.'
      setProjectsDirectoryError(message)
    } finally {
      setIsSavingProjectsDirectory(false)
    }
  }, [t])

  function getRuntimeBadgeLabel(runtime: RuntimeHealth): string {
    if (runtime.available) {
      if (runtime.source === 'override') return t('settings.tooling.override')
      return t('settings.tooling.system')
    }
    return t('settings.tooling.installOnSystem')
  }

  const content = (
    <SettingsPageBody surface={surface} className="space-y-6">
        <div className="px-1 py-1">
          <div className="flex flex-wrap items-start gap-4">
            <div>
              <h2 className="text-base font-medium">{t('settings.tooling.title')}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t('settings.tooling.description')}
              </p>
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-2xl bg-destructive/10 px-4 py-4 text-sm text-destructive">
            {error}
          </div>
        )}

        <section className="space-y-3">
          <div className="rounded-2xl bg-secondary/60 px-5 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 className="text-sm font-medium">{t('settings.tooling.projectsDirectory')}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('settings.tooling.projectsDirectoryDesc')}
                </p>
                <p className="mt-3 truncate font-mono text-xs text-muted-foreground" title={projectsDirectory ?? ''}>
                  {projectsDirectory ?? t('settings.tooling.projectsDirectoryLoading')}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 shrink-0 gap-1.5 text-xs"
                onClick={() => void handleChooseProjectsDirectory()}
                disabled={isSavingProjectsDirectory}
              >
                <HugeiconsIcon icon={__FolderHugeIcon} className="h-3.5 w-3.5" />
                {t('settings.tooling.changeProjectsDirectory')}
              </Button>
            </div>
            {projectsDirectoryError && (
              <p className="mt-3 text-xs text-destructive">{projectsDirectoryError}</p>
            )}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium">{t('settings.tooling.gitRuntime')}</h3>
          </div>
          <div className="rounded-2xl bg-secondary/60 px-5 py-4">
            {gitRuntimeHealth ? (
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                    <span
                      className="min-w-0 truncate whitespace-nowrap text-xs text-muted-foreground"
                      title={
                        gitRuntimeHealth.executablePath
                          ? `${gitRuntimeHealth.executablePath}${gitRuntimeHealth.gitVersion ? ` • Version ${gitRuntimeHealth.gitVersion}` : ''}`
                          : gitRuntimeHealth.gitVersion
                            ? `git • Version ${gitRuntimeHealth.gitVersion}`
                            : 'git'
                      }
                    >
                      {getGitExecutableLabel(gitRuntimeHealth.executablePath)}
                      {gitRuntimeHealth.gitVersion ? ` • v${gitRuntimeHealth.gitVersion}` : ''}
                    </span>
                  </div>
                  <Badge
                    variant={gitRuntimeHealth.available ? 'secondary' : 'destructive'}
                    className="ml-auto shrink-0 gap-1.5"
                  >
                    {gitRuntimeHealth.available ? (
                      <HugeiconsIcon icon={__CheckHugeIcon} className="h-3 w-3" />
                    ) : (
                      <HugeiconsIcon icon={__AlertTriangleHugeIcon} className="h-3 w-3" />
                    )}
                    {gitRuntimeHealth.available ? t('settings.tooling.available') : t('settings.tooling.notAvailable')}
                  </Badge>
                </div>
                {!gitRuntimeHealth.available && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                    {t('settings.tooling.gitRequired')}
                    {gitRuntimeHealth.error ? ` (${gitRuntimeHealth.error})` : ''}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {isLoading
                  ? t('settings.tooling.gitLoadingPlaceholder')
                  : t('settings.tooling.gitUnavailable')}
              </p>
            )}
          </div>
        </section>

        <section className="space-y-3">
          <div className="rounded-2xl bg-secondary/60 px-5 py-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-medium">{t('settings.tooling.previewEmbedCompatibility')}</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('settings.tooling.previewEmbedDesc')}
                </p>
              </div>
              <Switch
                checked={previewHeaderCompatibilityEnabled}
                onCheckedChange={(checked) => {
                  void handlePreviewHeaderCompatibilityChange(checked)
                }}
                disabled={isSavingPreviewHeaderCompatibility}
                aria-label={t('settings.tooling.previewEmbedCompatibility')}
              />
            </div>
            {previewHeaderCompatibilityError && (
              <p className="mt-3 text-xs text-destructive">{previewHeaderCompatibilityError}</p>
            )}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium">{t('settings.tooling.runtimeInventory')}</h3>
          </div>
          <div className="rounded-2xl border border-border/50 bg-background/60 px-4 py-3 text-xs text-muted-foreground">
            {t('settings.tooling.runtimeInventoryDesc')}
          </div>
          <div className="overflow-hidden rounded-2xl bg-secondary/60">
            <div className="grid grid-cols-[1fr_2fr_0.8fr] gap-2 px-4 py-2 text-xs text-muted-foreground">
              <span>{t('settings.tooling.colRuntime')}</span>
              <span>{t('settings.tooling.colPath')}</span>
              <span className="text-right">{t('settings.tooling.colAction')}</span>
            </div>
            <div className="space-y-1 px-1 pb-1">
              {(() => {
                const runtimes = runtimeStatus?.runtimes ?? []
                if (runtimes.length === 0) {
                  return (
                    <div className="px-3 py-4 text-sm text-muted-foreground">
                      {isLoading
                        ? t('settings.tooling.runtimeLoadingPlaceholder')
                        : t('settings.tooling.noRuntimeData')}
                    </div>
                  )
                }

                const totalPages = Math.ceil(runtimes.length / itemsPerPage)
                const startIndex = (currentPage - 1) * itemsPerPage
                const paginatedRuntimes = runtimes.slice(startIndex, startIndex + itemsPerPage)

                return (
                  <>
                    <div className="min-h-[260px] space-y-1">
                      {paginatedRuntimes.map((runtime) => (
                        (() => {
                          const badgeLabel = getRuntimeBadgeLabel(runtime)
                          const badgeVariant = runtime.available ? 'secondary' : 'destructive'

                          return (
                            <div
                              key={runtime.runtime}
                              className="grid grid-cols-[1fr_2fr_0.8fr] items-center gap-2 rounded-xl px-3 py-2 text-sm odd:bg-background/20"
                            >
                              <div className="flex min-w-0 items-center gap-3">
                                <div className="flex h-8 w-8 shrink-0 items-center justify-center">
                                  <RuntimeLogo runtime={runtime.runtime} />
                                </div>
                                <span className="truncate font-medium">{RUNTIME_LABELS[runtime.runtime]}</span>
                              </div>
                              <span
                                className="truncate text-muted-foreground"
                                title={runtime.executablePath || runtime.error || ''}
                              >
                                {runtime.executablePath || runtime.error || '—'}
                              </span>
                              <div className="flex items-center justify-end">
                                <Badge variant={badgeVariant} className="gap-1 rounded-full">
                                  <HugeiconsIcon
                                    icon={runtime.available ? __CheckHugeIcon : __AlertTriangleHugeIcon}
                                    className="h-3 w-3"
                                  />
                                  {badgeLabel}
                                </Badge>
                              </div>
                            </div>
                          )
                        })()
                      ))}
                    </div>
                    {totalPages > 1 && (
                      <div className="mt-2 flex items-center justify-between border-t border-border/40 px-3 pt-3 pb-1">
                        <span className="text-xs text-muted-foreground">
                          {t('common.page')} {currentPage} {t('common.of')} {totalPages}
                        </span>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                          >
                            {t('common.previous')}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                            disabled={currentPage === totalPages}
                          >
                            {t('common.next')}
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )
              })()}
            </div>
          </div>
        </section>
      </SettingsPageBody>
  )

  if (surface === 'drawer') {
    return content
  }

  return content
}
