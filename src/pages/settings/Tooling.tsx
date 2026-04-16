import { useCallback, useEffect, useRef, useState } from 'react'
import { SiBun, SiGo, SiNodedotjs, SiNpm, SiPnpm, SiPython, SiRust, SiYarn } from 'react-icons/si'
import { SettingsPageBody } from '@/components/settings/SettingsChrome'
import { settingsDesktopClient } from '@/lib/settings/settingsDesktopClient'
import { toolingSettingsClient } from '@/lib/settings/toolingSettingsClient'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Switch } from '../../components/ui/switch'
import { cn } from '../../lib/utils'
import type { GitRuntimeHealth, RuntimeHealth, RuntimeKind } from '../../types/electron'
import { useRuntimeInstallStore, type RuntimeInstallStatus } from '../../stores/useRuntimeInstallStore'

import { HugeiconsIcon } from '@hugeicons/react'
import { Alert01Icon as __AlertTriangleHugeIcon, Archive01Icon as __PackageHugeIcon, Download01Icon as __DownloadHugeIcon, CheckmarkCircle02Icon as __CheckHugeIcon } from '@hugeicons/core-free-icons'

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

function RuntimeProgressRing({ progress }: { progress: number }) {
  const normalized = Math.max(0, Math.min(100, progress))
  const radius = 7
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (normalized / 100) * circumference

  return (
    <svg className="h-4 w-4 -rotate-90" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r={radius} className="fill-none stroke-muted/40" strokeWidth="2" />
      <circle
        cx="10"
        cy="10"
        r={radius}
        className="fill-none stroke-primary transition-[stroke-dashoffset] duration-300 ease-out"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
      />
    </svg>
  )
}

export function Tooling({ surface = 'page', route: _route }: ToolingProps) {
  const [isLoading, setIsLoading] = useState(!cachedRuntimeStatus)
  const [error, setError] = useState<string | null>(null)
  const [runtimeStatus, setRuntimeStatus] = useState<{ target: string; runtimes: RuntimeHealth[] } | null>(
    cachedRuntimeStatus
  )
  const [gitRuntimeHealth, setGitRuntimeHealth] = useState<GitRuntimeHealth | null>(cachedGitRuntimeHealth)
  const [previewHeaderCompatibilityEnabled, setPreviewHeaderCompatibilityEnabled] = useState(true)
  const [previewHeaderCompatibilityError, setPreviewHeaderCompatibilityError] = useState<string | null>(null)
  const [isSavingPreviewHeaderCompatibility, setIsSavingPreviewHeaderCompatibility] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 5
  const runtimeInstallJobs = useRuntimeInstallStore((state) => state.jobs)
  const ensureRuntimeInstalled = useRuntimeInstallStore((state) => state.ensureRuntimeInstalled)
  const previousStatusesRef = useRef<Partial<Record<RuntimeKind, RuntimeInstallStatus>>>({})

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

  useEffect(() => {
    const hasActiveInstall = Object.values(runtimeInstallJobs).some((job) => job?.status === 'installing')
    if (!hasActiveInstall) return
    const timer = window.setInterval(() => {
      void loadRuntimeStatus({ silent: true })
    }, 2500)
    return () => window.clearInterval(timer)
  }, [loadRuntimeStatus, runtimeInstallJobs])

  useEffect(() => {
    for (const [runtimeKey, job] of Object.entries(runtimeInstallJobs)) {
      if (!job) continue
      const runtime = runtimeKey as RuntimeKind
      const previousStatus = previousStatusesRef.current[runtime]
      if (previousStatus !== job.status && job.status === 'success') {
        void loadRuntimeStatus({ silent: true })
      }
      previousStatusesRef.current[runtime] = job.status
    }
  }, [loadRuntimeStatus, runtimeInstallJobs])

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

  const content = (
    <SettingsPageBody surface={surface} className="space-y-6">
        <div className="px-1 py-1">
          <div className="flex flex-wrap items-start gap-4">
            <div>
              <h2 className="text-base font-medium">Tooling and Framework Support</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                This page reflects what your current Cozea instance can execute on this device.
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
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium">Git Runtime</h3>
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
                    {gitRuntimeHealth.available ? 'Available' : 'Not available'}
                  </Badge>
                </div>
                {!gitRuntimeHealth.available && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                    Git is required for project sync and source control. Install Git and restart Cozea, or set
                    `COZEA_GIT_EXECUTABLE` to an absolute git binary path.
                    {gitRuntimeHealth.error ? ` (${gitRuntimeHealth.error})` : ''}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {isLoading
                  ? 'Git runtime details will appear here.'
                  : 'Git runtime status unavailable.'}
              </p>
            )}
          </div>
        </section>

        <section className="space-y-3">
          <div className="rounded-2xl bg-secondary/60 px-5 py-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-medium">Preview Embed Compatibility</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Helps localhost previews load inside Cozea&apos;s embedded browser.
                </p>
              </div>
              <Switch
                checked={previewHeaderCompatibilityEnabled}
                onCheckedChange={(checked) => {
                  void handlePreviewHeaderCompatibilityChange(checked)
                }}
                disabled={isSavingPreviewHeaderCompatibility}
                aria-label="Toggle preview embed compatibility"
              />
            </div>
            {previewHeaderCompatibilityError && (
              <p className="mt-3 text-xs text-destructive">{previewHeaderCompatibilityError}</p>
            )}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium">Runtime Inventory</h3>
          </div>
          <div className="overflow-hidden rounded-2xl bg-secondary/60">
            <div className="grid grid-cols-[1fr_2fr_0.8fr] gap-2 px-4 py-2 text-xs text-muted-foreground">
              <span>Runtime</span>
              <span>Path</span>
              <span className="text-right">Action</span>
            </div>
            <div className="space-y-1 px-1 pb-1">
              {(() => {
                const runtimes = runtimeStatus?.runtimes ?? []
                if (runtimes.length === 0) {
                  return (
                    <div className="px-3 py-4 text-sm text-muted-foreground">
                      {isLoading
                        ? 'Runtime inventory will appear here.'
                        : 'No runtime data available.'}
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
                          const installJob = runtimeInstallJobs[runtime.runtime]
                          const isInstalling = installJob?.status === 'installing'
                          const installSucceeded = installJob?.status === 'success'
                          const installFailed = installJob?.status === 'error'
                          const isInstalled = runtime.available || installSucceeded

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
                                title={runtime.executablePath || installJob?.error || runtime.error || ''}
                              >
                                {runtime.executablePath || installJob?.error || runtime.error || '—'}
                              </span>
                              <div className="flex items-center justify-end">
                                {isInstalled ? (
                                  <Badge variant="secondary" className="gap-1 rounded-full">
                                    <HugeiconsIcon icon={__CheckHugeIcon} className="h-3 w-3" />
                                    Installed
                                  </Badge>
                                ) : (
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className={cn(
                                      'h-8 w-8 rounded-full',
                                      installFailed && 'text-amber-500 hover:text-amber-500'
                                    )}
                                    title={
                                      isInstalling
                                        ? 'Downloading runtime...'
                                        : installFailed
                                          ? 'Retry download'
                                          : 'Download runtime'
                                    }
                                    aria-label={
                                      isInstalling
                                        ? 'Downloading runtime'
                                        : installFailed
                                          ? 'Retry runtime download'
                                          : 'Download runtime'
                                    }
                                    disabled={isInstalling}
                                    onClick={() => {
                                      void ensureRuntimeInstalled(runtime.runtime)
                                    }}
                                  >
                                    {isInstalling ? (
                                      <RuntimeProgressRing progress={installJob?.progress ?? 0} />
                                    ) : installFailed ? (
                                      <HugeiconsIcon icon={__AlertTriangleHugeIcon} className="h-4 w-4" />
                                    ) : (
                                      <HugeiconsIcon icon={__DownloadHugeIcon} className="h-4 w-4" />
                                    )}
                                  </Button>
                                )}
                              </div>
                            </div>
                          )
                        })()
                      ))}
                    </div>
                    {totalPages > 1 && (
                      <div className="mt-2 flex items-center justify-between border-t border-border/40 px-3 pt-3 pb-1">
                        <span className="text-xs text-muted-foreground">
                          Page {currentPage} of {totalPages}
                        </span>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                          >
                            Previous
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                            disabled={currentPage === totalPages}
                          >
                            Next
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
