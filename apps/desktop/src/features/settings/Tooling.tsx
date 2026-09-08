import { useLocalSettings } from '@/lib/settings/localSettings'
import { AntigravitySetup } from "./AntigravitySetup"
import { useCallback, useEffect, useState } from 'react'
import { SiBun, SiGo, SiNodedotjs, SiNpm, SiPnpm, SiPython, SiRust, SiYarn } from 'react-icons/si'
import {
  SettingsGroup,
  SettingsPageBody,
  SettingsPageHeader,
  SettingsRow,
  SettingsRowControl,
  SettingsRowLabel,
  SettingsSectionDescription,
  SettingsSectionTitle,
} from '@/features/settings/ui/SettingsChrome'
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

async function readToolingHealth(): Promise<void> {
  if (runtimeStatusPrewarmPromise) return runtimeStatusPrewarmPromise
  runtimeStatusPrewarmPromise = Promise.allSettled([
    toolingSettingsClient.getRuntimeStatus().then((status) => { cachedRuntimeStatus = status }),
    toolingSettingsClient.getGitRuntimeHealth().then((health) => { cachedGitRuntimeHealth = health }),
  ]).then((results) => {
    const failure = results.find((result) => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
  }).finally(() => { runtimeStatusPrewarmPromise = null })
  return runtimeStatusPrewarmPromise
}

export async function prewarmToolingSettings(): Promise<void> {
  if (!toolingSettingsClient.isAvailable() || cachedRuntimeStatus) return
  await readToolingHealth()
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
  const { data: savedSettings, error: localSettingsError } = useLocalSettings()
  const [isLoading, setIsLoading] = useState(!cachedRuntimeStatus)
  const [error, setError] = useState<string | null>(null)
  const [runtimeStatus, setRuntimeStatus] = useState<{ target: string; runtimes: RuntimeHealth[] } | null>(
    cachedRuntimeStatus
  )
  const [gitRuntimeHealth, setGitRuntimeHealth] = useState<GitRuntimeHealth | null>(cachedGitRuntimeHealth)
  const [previewHeaderCompatibilityEnabled, setPreviewHeaderCompatibilityEnabled] = useState(savedSettings?.previewHeaderCompatibilityEnabled ?? false)
  const [previewHeaderCompatibilityError, setPreviewHeaderCompatibilityError] = useState<string | null>(null)
  const [isSavingPreviewHeaderCompatibility, setIsSavingPreviewHeaderCompatibility] = useState(false)
  const [projectsDirectory, setProjectsDirectory] = useState<string | null>(savedSettings?.projectsDirectory ?? null)
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
      await readToolingHealth()
      setRuntimeStatus(cachedRuntimeStatus)
      setGitRuntimeHealth(cachedGitRuntimeHealth)
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
    if (savedSettings) {
      setPreviewHeaderCompatibilityEnabled(savedSettings.previewHeaderCompatibilityEnabled)
      setProjectsDirectory(savedSettings.projectsDirectory)
    }
    setPreviewHeaderCompatibilityError(localSettingsError)
  }, [savedSettings, localSettingsError])

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
      <SettingsPageHeader
        title={t('settings.tooling.title')}
        description={t('settings.tooling.description')}
      />

      {error && (
        <div className="rounded-2xl bg-destructive/10 px-4 py-4 text-sm text-destructive">
          {error}
        </div>
      )}

      <section>
        <SettingsSectionTitle>{t('settings.tooling.projectsDirectory')}</SettingsSectionTitle>
        <SettingsSectionDescription>{t('settings.tooling.projectsDirectoryDesc')}</SettingsSectionDescription>
        <SettingsGroup>
          <div className="p-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 w-full justify-start rounded-lg border-border/50 bg-background/50 px-3 text-xs font-normal shadow-none transition-colors hover:bg-background/80 hover:text-foreground"
              onClick={() => void handleChooseProjectsDirectory()}
              disabled={isSavingProjectsDirectory}
              title={projectsDirectory ?? ''}
            >
              <HugeiconsIcon icon={__FolderHugeIcon} className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground/80" />
              <span className="min-w-0 flex-1 truncate text-left font-mono text-[11px]">
                {projectsDirectory ?? t('settings.tooling.projectsDirectoryLoading')}
              </span>
            </Button>
            {projectsDirectoryError && (
              <p className="mt-2 text-xs text-destructive">{projectsDirectoryError}</p>
            )}
          </div>
        </SettingsGroup>
      </section>

      <section>
        <SettingsSectionTitle>{t('settings.tooling.gitRuntime')}</SettingsSectionTitle>
        <SettingsGroup>
          <div className="px-4 py-3">
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
        </SettingsGroup>
      </section>

      <section>
        <SettingsSectionTitle>{t('settings.tooling.previewEmbedCompatibility')}</SettingsSectionTitle>
        <SettingsGroup>
          <SettingsRow isFirst>
            <SettingsRowLabel
              title={t('settings.tooling.previewEmbedCompatibility')}
              description={t('settings.tooling.previewEmbedDesc')}
            />
            <SettingsRowControl>
              <Switch
                checked={previewHeaderCompatibilityEnabled}
                onCheckedChange={(checked) => {
                  void handlePreviewHeaderCompatibilityChange(checked)
                }}
                disabled={!savedSettings || isSavingPreviewHeaderCompatibility}
                aria-label={t('settings.tooling.previewEmbedCompatibility')}
              />
            </SettingsRowControl>
          </SettingsRow>
          {previewHeaderCompatibilityError && (
            <div className="px-4 py-2 text-xs text-destructive">
              {previewHeaderCompatibilityError}
            </div>
          )}
        </SettingsGroup>
      </section>

      <section>
        <SettingsSectionTitle>{t('settings.tooling.runtimeInventory')}</SettingsSectionTitle>
        <SettingsSectionDescription>{t('settings.tooling.runtimeInventoryDesc')}</SettingsSectionDescription>
        <SettingsGroup>
          <div className="grid grid-cols-[1fr_2fr_0.8fr] gap-2 border-b border-border/30 px-4 py-2 text-xs font-medium text-muted-foreground">
            <span>{t('settings.tooling.colRuntime')}</span>
            <span>{t('settings.tooling.colPath')}</span>
            <span className="text-right">{t('settings.tooling.colAction')}</span>
          </div>
          <div className="divide-y divide-border/20">
            {(() => {
              const runtimes = runtimeStatus?.runtimes ?? []
              if (runtimes.length === 0) {
                return (
                  <div className="px-4 py-4 text-xs text-muted-foreground">
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
                  <div className="divide-y divide-border/20">
                    {paginatedRuntimes.map((runtime) => (
                      (() => {
                        const badgeLabel = getRuntimeBadgeLabel(runtime)
                        const badgeVariant = runtime.available ? 'secondary' : 'destructive'

                        return (
                          <div
                            key={runtime.runtime}
                            className="grid grid-cols-[1fr_2fr_0.8fr] items-center gap-2 px-4 py-2.5 text-xs"
                          >
                            <div className="flex min-w-0 items-center gap-2.5">
                              <div className="flex h-6 w-6 shrink-0 items-center justify-center">
                                <RuntimeLogo runtime={runtime.runtime} />
                              </div>
                              <span className="truncate font-medium text-foreground">{RUNTIME_LABELS[runtime.runtime]}</span>
                            </div>
                            <span
                              className="truncate font-mono text-[11px] text-muted-foreground"
                              title={runtime.executablePath || runtime.error || ''}
                            >
                              {runtime.executablePath || runtime.error || '—'}
                            </span>
                            <div className="flex items-center justify-end">
                              <Badge variant={badgeVariant} className="gap-1 rounded-full text-[10px]">
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
                    <div className="flex items-center justify-between border-t border-border/30 px-4 py-2.5">
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
        </SettingsGroup>
      </section>
      <AntigravitySetup />
    </SettingsPageBody>
  )

  if (surface === 'drawer') {
    return content
  }

  return content
}
