import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, Download, HardDrive, Loader2, Plus, RefreshCw, Terminal } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { DashboardLayout } from '../../components/layouts/DashboardLayout'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Switch } from '../../components/ui/switch'
import { cn } from '../../lib/utils'
import type { RuntimeHealth, RuntimeKind } from '../../types/electron'
import { useRuntimeInstallStore, type RuntimeInstallStatus } from '../../stores/useRuntimeInstallStore'

interface ToolingFamily {
  id: string
  name: string
  description: string
  examples: string[]
  requiredAll: RuntimeKind[]
  requiredAny?: RuntimeKind[]
}

interface ToolingProps {
  surface?: 'page' | 'drawer'
}

const TOOLING_FAMILIES: ToolingFamily[] = [
  {
    id: 'js-web',
    name: 'JavaScript Web Frameworks',
    description: 'Primary web app stacks used by the builder and runtime resolver.',
    examples: ['Next.js', 'Remix', 'Vite (React/Vue/Svelte)', 'Nuxt', 'Astro', 'SvelteKit', 'Angular', 'Qwik'],
    requiredAll: ['node'],
    requiredAny: ['npm', 'pnpm', 'yarn', 'bun'],
  },
  {
    id: 'python-web',
    name: 'Python Web Frameworks',
    description: 'Web/API projects that run through the Python runtime pack flow.',
    examples: ['FastAPI', 'Flask', 'Django'],
    requiredAll: ['python'],
  },
  {
    id: 'rust-web',
    name: 'Rust Web Frameworks',
    description: 'Rust-based web/API stacks executed through Cargo.',
    examples: ['Axum', 'Actix Web'],
    requiredAll: ['rust'],
  },
  {
    id: 'go-web',
    name: 'Go Web Frameworks',
    description: 'Go web services and APIs run through the Go runtime pack.',
    examples: ['Gin', 'Fiber', 'Echo'],
    requiredAll: ['go'],
  },
]

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

function sourceLabel(source: RuntimeHealth['source']): string {
  if (source === 'runtime-pack') return 'Runtime pack'
  if (source === 'bundled') return 'Bundled'
  if (source === 'override') return 'Override'
  if (source === 'system') return 'System'
  return 'Missing'
}

function isFamilyInstalled(family: ToolingFamily, byRuntime: Map<RuntimeKind, RuntimeHealth>): boolean {
  const hasRequiredAll = family.requiredAll.every((runtime) => byRuntime.get(runtime)?.available)
  if (!hasRequiredAll) return false
  if (!family.requiredAny || family.requiredAny.length === 0) return true
  return family.requiredAny.some((runtime) => byRuntime.get(runtime)?.available)
}

function requiredRuntimeSummary(family: ToolingFamily): string {
  const requiredAll = family.requiredAll.map((runtime) => RUNTIME_LABELS[runtime]).join(' + ')
  if (!family.requiredAny || family.requiredAny.length === 0) return requiredAll
  const any = family.requiredAny.map((runtime) => RUNTIME_LABELS[runtime]).join(' / ')
  return `${requiredAll} + any of (${any})`
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

export function Tooling({ surface = 'page' }: ToolingProps) {
  const { user, logout } = useAuth()
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [runtimeStatus, setRuntimeStatus] = useState<{ target: string; runtimes: RuntimeHealth[] } | null>(null)
  const [previewHeaderCompatibilityEnabled, setPreviewHeaderCompatibilityEnabled] = useState(true)
  const [previewHeaderCompatibilityError, setPreviewHeaderCompatibilityError] = useState<string | null>(null)
  const [isSavingPreviewHeaderCompatibility, setIsSavingPreviewHeaderCompatibility] = useState(false)
  const runtimeInstallJobs = useRuntimeInstallStore((state) => state.jobs)
  const ensureRuntimeInstalled = useRuntimeInstallStore((state) => state.ensureRuntimeInstalled)
  const previousStatusesRef = useRef<Partial<Record<RuntimeKind, RuntimeInstallStatus>>>({})

  const loadRuntimeStatus = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      if (!window.electronAPI?.runtime?.getRuntimeStatus) {
        throw new Error('Runtime API is unavailable in this environment.')
      }
      const status = await window.electronAPI.runtime.getRuntimeStatus()
      setRuntimeStatus(status)
    } catch (runtimeError) {
      const message = runtimeError instanceof Error ? runtimeError.message : 'Failed to load tooling status.'
      setError(message)
      setRuntimeStatus(null)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadRuntimeStatus()
  }, [loadRuntimeStatus])

  useEffect(() => {
    const loadPreviewHeaderCompatibilitySetting = async () => {
      if (!window.electronAPI?.settings) return

      try {
        const settings = await window.electronAPI.settings.get()
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
      void loadRuntimeStatus()
    }, 2500)
    return () => window.clearInterval(timer)
  }, [loadRuntimeStatus, runtimeInstallJobs])

  useEffect(() => {
    for (const [runtimeKey, job] of Object.entries(runtimeInstallJobs)) {
      if (!job) continue
      const runtime = runtimeKey as RuntimeKind
      const previousStatus = previousStatusesRef.current[runtime]
      if (previousStatus !== job.status && job.status === 'success') {
        void loadRuntimeStatus()
      }
      previousStatusesRef.current[runtime] = job.status
    }
  }, [loadRuntimeStatus, runtimeInstallJobs])

  const runtimeByKind = useMemo(
    () => new Map((runtimeStatus?.runtimes ?? []).map((runtime) => [runtime.runtime, runtime])),
    [runtimeStatus]
  )

  const installedFamilies = useMemo(
    () => TOOLING_FAMILIES.filter((family) => isFamilyInstalled(family, runtimeByKind)),
    [runtimeByKind]
  )

  const missingFamilies = useMemo(
    () => TOOLING_FAMILIES.filter((family) => !isFamilyInstalled(family, runtimeByKind)),
    [runtimeByKind]
  )

  const installedRuntimes = useMemo(
    () => (runtimeStatus?.runtimes ?? []).filter((runtime) => runtime.available),
    [runtimeStatus]
  )

  const missingRuntimes = useMemo(
    () => (runtimeStatus?.runtimes ?? []).filter((runtime) => !runtime.available),
    [runtimeStatus]
  )

  const handlePreviewHeaderCompatibilityChange = useCallback(
    async (checked: boolean) => {
      if (!window.electronAPI?.settings) return

      const previousValue = previewHeaderCompatibilityEnabled
      setPreviewHeaderCompatibilityEnabled(checked)
      setPreviewHeaderCompatibilityError(null)
      setIsSavingPreviewHeaderCompatibility(true)

      try {
        await window.electronAPI.settings.set({
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
        <div className="rounded-2xl bg-secondary/70 px-5 py-4">
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
              onClick={loadRuntimeStatus}
              disabled={isLoading}
              className="rounded-full"
            >
              <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
              Refresh
            </Button>
          </div>
          {runtimeStatus && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge variant="secondary">Target: {runtimeStatus.target}</Badge>
              <Badge variant="secondary">Installed runtimes: {installedRuntimes.length}</Badge>
              <Badge variant="secondary">Missing runtimes: {missingRuntimes.length}</Badge>
              <Badge variant="secondary">Installed framework families: {installedFamilies.length}</Badge>
            </div>
          )}
        </div>

        {isLoading && (
          <div className="flex items-center gap-2 rounded-2xl bg-secondary/60 px-4 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading tooling status...
          </div>
        )}
        {error && (
          <div className="rounded-2xl bg-destructive/10 px-4 py-4 text-sm text-destructive">
            {error}
          </div>
        )}

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
            <h3 className="text-sm font-medium">Framework Families Installed</h3>
          </div>
          {installedFamilies.length === 0 ? (
            <div className="rounded-2xl bg-secondary/60 px-4 py-4 text-sm text-muted-foreground">
              {isLoading && !runtimeStatus
                ? 'Loading framework support...'
                : 'No framework families are installed yet on this device.'}
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {installedFamilies.map((family) => (
                <div key={family.id} className="rounded-2xl bg-secondary/60 px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{family.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{family.description}</p>
                    </div>
                    <Badge variant="secondary">Installed</Badge>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Examples:</span>{' '}
                    {family.examples.join(', ')}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Requires:</span>{' '}
                    {requiredRuntimeSummary(family)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-medium">Framework Families Not Installed</h3>
          </div>
          {missingFamilies.length === 0 ? (
            <div className="rounded-2xl bg-secondary/60 px-4 py-4 text-sm text-muted-foreground">
              {isLoading && !runtimeStatus
                ? 'Loading framework support...'
                : 'All supported framework families are currently available in this Cozea instance.'}
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {missingFamilies.map((family) => (
                <div key={family.id} className="rounded-2xl bg-secondary/40 px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{family.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{family.description}</p>
                    </div>
                    <Badge variant="secondary" className="opacity-80">Missing</Badge>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Requires:</span>{' '}
                    {requiredRuntimeSummary(family)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-medium">Runtime Inventory</h3>
          </div>
          <div className="overflow-hidden rounded-2xl bg-secondary/60">
            <div className="grid grid-cols-[1fr_0.9fr_1.8fr_0.8fr] gap-2 px-4 py-2 text-xs text-muted-foreground">
              <span>Runtime</span>
              <span>Source</span>
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
                        className="grid grid-cols-[1fr_0.9fr_1.8fr_0.8fr] items-center gap-2 rounded-xl px-3 py-2 text-sm odd:bg-background/20"
                      >
                        <span className="font-medium">{RUNTIME_LABELS[runtime.runtime]}</span>
                        <span className="text-muted-foreground">{sourceLabel(runtime.source)}</span>
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
                  {isLoading ? 'Loading runtime inventory...' : 'No runtime data available.'}
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
    <DashboardLayout
      user={user}
      onLogout={logout}
      breadcrumbs={[{ label: 'Settings' }, { label: 'Tooling' }]}
      header={headerActions}
    >
      {content}
    </DashboardLayout>
  )
}
