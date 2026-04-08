import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, Download, Loader2, Package, Plus, RefreshCw, Terminal } from 'lucide-react'
import { FaApple, FaLinux, FaWindows } from 'react-icons/fa6'
import { SiBun, SiGo, SiNodedotjs, SiNpm, SiPnpm, SiPython, SiRust, SiYarn } from 'react-icons/si'
import { SettingsRouteShell } from '@/components/settings/SettingsRouteShell'
import { settingsDesktopClient } from '@/lib/settings/settingsDesktopClient'
import { toolingSettingsClient } from '@/lib/settings/toolingSettingsClient'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Switch } from '../../components/ui/switch'
import { cn } from '../../lib/utils'
import type { GitRuntimeHealth, RuntimeHealth, RuntimeKind } from '../../types/electron'
import { useRuntimeInstallStore, type RuntimeInstallStatus } from '../../stores/useRuntimeInstallStore'

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

function getRuntimeTargetPresentation(target: string): {
  label: string
  icon: React.ReactNode
} {
  const normalized = target.trim().toLowerCase()

  if (!normalized) {
    return {
      label: 'Unknown platform',
      icon: <Terminal className="h-3.5 w-3.5" />,
    }
  }
  if (normalized === 'darwin-arm64') {
    return {
      label: 'Apple silicon',
      icon: <FaApple className="h-3.5 w-3.5" />,
    }
  }
  if (normalized === 'darwin-x64') {
    return {
      label: 'Intel Mac',
      icon: <FaApple className="h-3.5 w-3.5" />,
    }
  }
  if (normalized === 'win32-arm64') {
    return {
      label: 'Windows on ARM',
      icon: <FaWindows className="h-3.5 w-3.5" />,
    }
  }
  if (normalized === 'win32-x64') {
    return {
      label: 'Windows (x64)',
      icon: <FaWindows className="h-3.5 w-3.5" />,
    }
  }
  if (normalized === 'win32-ia32') {
    return {
      label: 'Windows (32-bit)',
      icon: <FaWindows className="h-3.5 w-3.5" />,
    }
  }
  if (normalized === 'linux-x64') {
    return {
      label: 'Linux (x64)',
      icon: <FaLinux className="h-3.5 w-3.5" />,
    }
  }
  if (normalized === 'linux-arm64') {
    return {
      label: 'Linux ARM64',
      icon: <FaLinux className="h-3.5 w-3.5" />,
    }
  }

  const [platform, arch] = normalized.split('-', 2)
  if (!platform || !arch) {
    return {
      label: target,
      icon: <Terminal className="h-3.5 w-3.5" />,
    }
  }

  const platformLabel =
    platform === 'darwin'
      ? 'macOS'
      : platform === 'win32'
        ? 'Windows'
        : platform === 'linux'
          ? 'Linux'
          : platform.charAt(0).toUpperCase() + platform.slice(1)

  const archLabel =
    arch === 'x64'
      ? 'x64'
      : arch === 'arm64'
        ? 'ARM64'
        : arch === 'ia32'
        ? '32-bit'
          : arch.toUpperCase()

  const icon =
    platform === 'darwin'
      ? <FaApple className="h-3.5 w-3.5" />
      : platform === 'win32'
        ? <FaWindows className="h-3.5 w-3.5" />
        : platform === 'linux'
          ? <FaLinux className="h-3.5 w-3.5" />
          : <Terminal className="h-3.5 w-3.5" />

  return {
    label: `${platformLabel} (${archLabel})`,
    icon,
  }
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
      return <Package className="h-4 w-4" style={{ color: mutedColor }} />
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
      return <Package className="h-4 w-4" style={{ color: mutedColor }} />
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

export function Tooling({ surface = 'page', route }: ToolingProps) {
  const [isLoading, setIsLoading] = useState(!cachedRuntimeStatus)
  const [error, setError] = useState<string | null>(null)
  const [runtimeStatus, setRuntimeStatus] = useState<{ target: string; runtimes: RuntimeHealth[] } | null>(
    cachedRuntimeStatus
  )
  const [gitRuntimeHealth, setGitRuntimeHealth] = useState<GitRuntimeHealth | null>(cachedGitRuntimeHealth)
  const [previewHeaderCompatibilityEnabled, setPreviewHeaderCompatibilityEnabled] = useState(true)
  const [previewHeaderCompatibilityError, setPreviewHeaderCompatibilityError] = useState<string | null>(null)
  const [isSavingPreviewHeaderCompatibility, setIsSavingPreviewHeaderCompatibility] = useState(false)
  const runtimeInstallJobs = useRuntimeInstallStore((state) => state.jobs)
  const ensureRuntimeInstalled = useRuntimeInstallStore((state) => state.ensureRuntimeInstalled)
  const previousStatusesRef = useRef<Partial<Record<RuntimeKind, RuntimeInstallStatus>>>({})
  const runtimeTargetPresentation = runtimeStatus
    ? getRuntimeTargetPresentation(runtimeStatus.target)
    : null

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

  const headerActions = (
    <Button disabled size="sm" variant="secondary" className="rounded-full opacity-60">
      <Plus className="h-4 w-4" />
      Add Framework Tooling
    </Button>
  )

  const content = (
    <div
      className={
        surface === 'drawer'
          ? 'mx-auto w-full max-w-6xl space-y-6 px-6 py-6'
          : 'max-w-6xl space-y-6 px-6 pt-6 pb-8'
      }
    >
        <div className="px-1 py-1">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-medium">Tooling and Framework Support</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                This page reflects what your current Cozea instance can execute on this device.
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Current builder target mode: web projects (websites and web apps).
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void loadRuntimeStatus()
              }}
              disabled={isLoading}
              className="rounded-full"
            >
              <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
              Refresh
            </Button>
          </div>
          {runtimeStatus && runtimeTargetPresentation && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge variant="secondary" className="gap-1.5">
                {runtimeTargetPresentation.icon}
                {runtimeTargetPresentation.label}
              </Badge>
            </div>
          )}
        </div>

        {error && (
          <div className="rounded-2xl bg-destructive/10 px-4 py-4 text-sm text-destructive">
            {error}
          </div>
        )}

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-medium">Git Runtime</h3>
          </div>
          <div className="rounded-2xl bg-secondary/60 px-5 py-4">
            {gitRuntimeHealth ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    variant={gitRuntimeHealth.available ? 'secondary' : 'destructive'}
                    className="gap-1.5"
                  >
                    {gitRuntimeHealth.available ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <AlertTriangle className="h-3 w-3" />
                    )}
                    {gitRuntimeHealth.available ? 'Available' : 'Not available'}
                  </Badge>
                  <Badge variant="outline" className="capitalize">
                    source: {gitRuntimeHealth.source}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground break-all">
                  Executable: {gitRuntimeHealth.executablePath || 'git (PATH lookup)'}
                </p>
                {gitRuntimeHealth.gitVersion ? (
                  <p className="text-xs text-muted-foreground">Version: {gitRuntimeHealth.gitVersion}</p>
                ) : null}
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
                {isLoading ? 'Checking git runtime...' : 'Git runtime status unavailable.'}
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
                  Enabled by default. Cozea removes frame-blocking headers from localhost preview responses so project pages can load inside the embedded preview.
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  When disabled, preview falls back to credentialless mode and may require opening pages externally.
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
            <Terminal className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-medium">Runtime Inventory</h3>
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : null}
          </div>
          <div className="overflow-hidden rounded-2xl bg-secondary/60">
            <div className="grid grid-cols-[1fr_2fr_0.8fr] gap-2 px-4 py-2 text-xs text-muted-foreground">
              <span>Runtime</span>
              <span>Path</span>
              <span className="text-right">Action</span>
            </div>
            <div className="space-y-1 px-1 pb-1">
              {(runtimeStatus?.runtimes ?? []).length > 0 ? (
                (runtimeStatus?.runtimes ?? []).map((runtime) => (
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
                              <Check className="h-3 w-3" />
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
                                <AlertTriangle className="h-4 w-4" />
                              ) : (
                                <Download className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                        </div>
                      </div>
                    )
                  })()
                ))
              ) : (
                <div className="px-3 py-4 text-sm text-muted-foreground">
                  {isLoading ? 'Checking runtime inventory...' : 'No runtime data available.'}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
  )

  if (surface === 'drawer') {
    return content
  }

  return (
    <SettingsRouteShell surfaceId="tooling" route={route} header={headerActions}>
      {content}
    </SettingsRouteShell>
  )
}
