import { useState, useEffect, useCallback } from 'react'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  FileCode,
  Package,
  Layers,
  Database,
  TestTube,
  Route,
} from 'lucide-react'
import {
  IconBrandNextjs,
  IconBrandReact,
  IconBrandVue,
  IconBrandSvelte,
  IconBrandNuxt,
  IconBrandTailwind,
  IconCode,
} from '@tabler/icons-react'
import type { WizardRepoSource } from '@/hooks/useWizardState'
import {
  detectFramework,
  detectPackageManager,
  type FrameworkInfo,
  type PackageManager,
} from '@/utils/projectDetector'

interface RepoScanStepProps {
  repoSource: WizardRepoSource
  projectSlug: string
  onScanComplete: (detectedStack: NonNullable<WizardRepoSource['detectedStack']>) => void
}

type ScanPhase = 'idle' | 'copying' | 'scanning' | 'complete' | 'error'

interface ScanResult {
  framework?: FrameworkInfo
  packageManager?: PackageManager
  styling?: string
  database?: string
  testingFramework?: string
  pageCount: number
  componentCount: number
}

const FRAMEWORK_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  nextjs: IconBrandNextjs,
  'vite-react': IconBrandReact,
  cra: IconBrandReact,
  'vite-vue': IconBrandVue,
  nuxt: IconBrandNuxt,
  sveltekit: IconBrandSvelte,
  'vite-svelte': IconBrandSvelte,
}

function normalizePath(pathValue: string): string {
  return pathValue.replace(/\\/g, '/')
}

function isComponentFile(pathValue: string): boolean {
  const normalized = normalizePath(pathValue)
  return (
    normalized.includes('/components/') &&
    /\.(tsx|jsx|vue|svelte)$/i.test(normalized)
  )
}

function isPageFile(pathValue: string): boolean {
  const normalized = normalizePath(pathValue)
  return (
    /\/app\/.*\/page\.(tsx|jsx|ts|js)$/i.test(normalized) ||
    /\/pages\/.*\.(tsx|jsx|ts|js|vue|svelte|astro|md|mdx)$/i.test(normalized) ||
    /\/src\/pages\/.*\.(tsx|jsx|ts|js|vue|svelte|astro|md|mdx)$/i.test(normalized) ||
    /\/src\/routes\/.*\/\+page\.svelte$/i.test(normalized) ||
    /\/app\/routes\/.*\.(tsx|jsx|ts|js)$/i.test(normalized)
  )
}

export function RepoScanStep({
  repoSource,
  onScanComplete,
}: RepoScanStepProps) {
  const [phase, setPhase] = useState<ScanPhase>('idle')
  const [progress, setProgress] = useState(0)
  const [statusMessage, setStatusMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [scanResult, setScanResult] = useState<ScanResult | null>(null)

  const runScan = useCallback(async () => {
    setPhase('copying')
    setProgress(0)
    setErrorMessage('')

    try {
      let projectPath: string

      if (repoSource.provider === 'local') {
        // For local folders, scan directly from source path
        setStatusMessage('Analyzing local folder...')
        setProgress(20)
        projectPath = repoSource.repoUrl
      } else {
        // For GitHub/GitLab, we can't clone yet - just show preview
        // The actual clone will happen when the project is created and opened
        setStatusMessage('Validating repository...')
        setProgress(50)

        // For now, show a placeholder result for remote repos
        // The actual scan will happen after clone on project build page
        setProgress(100)
        setPhase('complete')
        setStatusMessage('Ready to import!')

        const placeholderResult: ScanResult = {
          pageCount: 0,
          componentCount: 0,
        }
        setScanResult(placeholderResult)

        onScanComplete({
          framework: undefined,
          styling: undefined,
          database: undefined,
          testingFramework: undefined,
          pageCount: 0,
          componentCount: 0,
        })
        return
      }

      // Scan the local project
      setPhase('scanning')
      setStatusMessage('Detecting framework...')
      setProgress(40)

      const frameworkInfo = await detectFramework(projectPath)

      setStatusMessage('Detecting package manager...')
      setProgress(50)

      const packageManager = await detectPackageManager(projectPath)

      setStatusMessage('Scanning project files...')
      setProgress(60)
      let pageCount = 0
      let componentCount = 0
      try {
        const listResult = await window.electronAPI.project.listFiles({ projectPath })
        if (listResult.success && listResult.files) {
          for (const file of listResult.files) {
            if (isComponentFile(file.path)) componentCount++
            if (isPageFile(file.path)) pageCount++
          }
        }
      } catch {
        // Ignore list errors and keep defaults
      }

      setStatusMessage('Analyzing dependencies...')
      setProgress(80)

      // Detect styling, database, testing from package.json
      let styling: string | undefined
      let database: string | undefined
      let testingFramework: string | undefined

      try {
        const pkgResult = await window.electronAPI.project.readFile({
          projectPath,
          filePath: 'package.json',
        })

        if (pkgResult.success && pkgResult.content) {
          const pkg = JSON.parse(pkgResult.content)
          const allDeps = {
            ...pkg.dependencies,
            ...pkg.devDependencies,
          }

          // Detect styling
          if (allDeps['tailwindcss']) styling = 'Tailwind CSS'
          else if (allDeps['@emotion/react'] || allDeps['@emotion/styled']) styling = 'Emotion'
          else if (allDeps['styled-components']) styling = 'Styled Components'
          else if (allDeps['@chakra-ui/react']) styling = 'Chakra UI'
          else if (allDeps['@mui/material']) styling = 'Material UI'

          // Detect database
          if (allDeps['@supabase/supabase-js']) database = 'Supabase'
          else if (allDeps['prisma'] || allDeps['@prisma/client']) database = 'Prisma'
          else if (allDeps['drizzle-orm']) database = 'Drizzle'
          else if (allDeps['firebase'] || allDeps['firebase-admin']) database = 'Firebase'
          else if (allDeps['mongoose']) database = 'MongoDB'
          else if (allDeps['convex']) database = 'Convex'

          // Detect testing
          if (allDeps['vitest']) testingFramework = 'Vitest'
          else if (allDeps['jest']) testingFramework = 'Jest'
          else if (allDeps['@testing-library/react']) testingFramework = 'Testing Library'
          else if (allDeps['cypress']) testingFramework = 'Cypress'
          else if (allDeps['playwright']) testingFramework = 'Playwright'
        }
      } catch {
        // Ignore package.json parse errors
      }

      setProgress(100)
      setPhase('complete')
      setStatusMessage('Scan complete!')

      const result: ScanResult = {
        framework: frameworkInfo,
        packageManager,
        styling,
        database,
        testingFramework,
        pageCount,
        componentCount,
      }

      setScanResult(result)

      // Notify parent with detected stack
      onScanComplete({
        framework: frameworkInfo.framework,
        styling,
        database,
        testingFramework,
        pageCount,
        componentCount,
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error occurred'
      setErrorMessage(msg)
      setPhase('error')
      setStatusMessage('')
    }
  }, [repoSource, onScanComplete])

  // Auto-start scan when component mounts
  useEffect(() => {
    if (phase === 'idle' && repoSource.repoUrl) {
      runScan()
    }
  }, [phase, repoSource.repoUrl, runScan])

  const FrameworkIcon = scanResult?.framework
    ? FRAMEWORK_ICONS[scanResult.framework.framework] || IconCode
    : IconCode

  return (
    <div className="space-y-8 max-w-2xl mx-auto">
      <div className="text-center space-y-1">
        <h2 className="text-2xl font-semibold">
          {phase === 'complete' ? 'Repository Analyzed' : 'Analyzing Repository'}
        </h2>
        <p className="text-muted-foreground text-sm">
          {phase === 'complete'
            ? 'We detected the following tech stack'
            : 'Scanning your codebase to detect frameworks and dependencies'}
        </p>
      </div>

      {/* Progress Section */}
      {(phase === 'copying' || phase === 'scanning') && (
        <div className="space-y-4">
          <Progress value={progress} className="h-2" />
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{statusMessage}</span>
          </div>
        </div>
      )}

      {/* Error State */}
      {phase === 'error' && (
        <div className="space-y-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
          <div className="flex justify-center">
            <Button variant="outline" onClick={runScan}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          </div>
        </div>
      )}

      {/* Results */}
      {phase === 'complete' && scanResult && (
        <div className="space-y-6">
          {/* Success indicator */}
          <div className="flex items-center justify-center gap-2 text-green-600">
            <CheckCircle2 className="h-5 w-5" />
            <span className="font-medium">
              {repoSource.provider === 'local' ? 'Analysis Complete' : 'Ready to Import'}
            </span>
          </div>

          {/* Detected Stack Grid - only show for local projects */}
          {repoSource.provider === 'local' ? (
            <>
              <div className="grid grid-cols-2 gap-4">
                {/* Framework */}
                <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <FileCode className="h-4 w-4" />
                    <span className="text-xs uppercase tracking-wider">Framework</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <FrameworkIcon className="h-5 w-5" />
                    <span className="font-medium">
                      {scanResult.framework?.displayName || 'Unknown'}
                    </span>
                  </div>
                </div>

                {/* Package Manager */}
                <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Package className="h-4 w-4" />
                    <span className="text-xs uppercase tracking-wider">Package Manager</span>
                  </div>
                  <span className="font-medium capitalize">
                    {scanResult.packageManager || 'npm'}
                  </span>
                </div>

                {/* Styling */}
                <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    {scanResult.styling === 'Tailwind CSS' ? (
                      <IconBrandTailwind className="h-4 w-4" />
                    ) : (
                      <Layers className="h-4 w-4" />
                    )}
                    <span className="text-xs uppercase tracking-wider">Styling</span>
                  </div>
                  <span className="font-medium">
                    {scanResult.styling || 'CSS'}
                  </span>
                </div>

                {/* Database */}
                <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Database className="h-4 w-4" />
                    <span className="text-xs uppercase tracking-wider">Database</span>
                  </div>
                  <span className="font-medium">
                    {scanResult.database || 'None detected'}
                  </span>
                </div>

                {/* Testing */}
                <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <TestTube className="h-4 w-4" />
                    <span className="text-xs uppercase tracking-wider">Testing</span>
                  </div>
                  <span className="font-medium">
                    {scanResult.testingFramework || 'None detected'}
                  </span>
                </div>

                {/* Routes */}
                <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Route className="h-4 w-4" />
                    <span className="text-xs uppercase tracking-wider">Pages/Routes</span>
                  </div>
                  <span className="font-medium">
                    {scanResult.pageCount} detected
                  </span>
                </div>
              </div>

              {/* Component count */}
              {scanResult.componentCount > 0 && (
                <div className="text-center text-sm text-muted-foreground">
                  Found {scanResult.componentCount} components in your codebase
                </div>
              )}
            </>
          ) : (
            /* GitHub/GitLab preview */
            <div className="rounded-xl border border-border bg-muted/30 p-6 space-y-4">
              <div className="text-center space-y-2">
                <p className="font-medium">Repository validated</p>
                <p className="text-sm text-muted-foreground">
                  {repoSource.repoUrl}
                </p>
                {repoSource.branch && (
                  <p className="text-xs text-muted-foreground">
                    Branch: {repoSource.branch}
                  </p>
                )}
              </div>
              <p className="text-xs text-muted-foreground text-center">
                The repository will be cloned and analyzed when you create the project.
              </p>
            </div>
          )}

          {/* Info box */}
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">
            <p className="text-muted-foreground">
              {repoSource.provider === 'local'
                ? 'Your project has been analyzed and is ready to import. Continue to customize the visual style and team settings.'
                : 'Continue to customize the visual style and team settings. Your repository will be cloned when the project is created.'}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
