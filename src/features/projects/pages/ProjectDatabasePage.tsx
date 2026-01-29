import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { useAuth } from '@/contexts/AuthContext'
import { useIntegrations } from '@/hooks/useIntegrations'
import { useOptionalProjectSyncContext } from '../contexts/ProjectSyncContext'
import { buildBackendStudioGraph, type StudioGraph } from '../studio/graphBuilder'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Table as UiTable, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { IntegrationConnectDialog } from '@/components/integrations'
import { cn } from '@/lib/utils'
import { getIntegration } from '@/lib/integrations/registry'
import type { IntegrationCredentials, IntegrationProvider } from '@/lib/integrations/types'
import {
  Database,
  Table,
  Code,
  RefreshCw,
  Plus,
  Loader2,
  FolderOpen,
  FileCode2,
  PlugZap,
  Search,
} from 'lucide-react'

type DataProvider = 'convex' | 'supabase' | 'firebase' | 'unknown'
type DataResourceKind = 'table' | 'collection' | 'unknown'

interface DataResourceRef {
  id: string
  label: string
  subtitle?: string
  filePath?: string
}

interface DataResource {
  id: string
  name: string
  provider: DataProvider
  kind: DataResourceKind
  subtitle?: string
  filePath?: string
  references: DataResourceRef[]
}

interface EnvInfo {
  primaryEnvFile: string | null
  values: Record<string, string>
}

function parseEnvFile(content: string): Record<string, string> {
  const env: Record<string, string> = {}
  const lines = content.split('\n')

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const idx = line.indexOf('=')
    if (idx <= 0) continue

    const key = line.slice(0, idx).trim()
    let value = line.slice(idx + 1).trim()
    value = value.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')
    if (key) env[key] = value
  }

  return env
}

async function loadProjectEnvInfo(projectPath: string): Promise<EnvInfo> {
  const candidates = [
    '.env.local',
    '.env',
    '.env.development.local',
    '.env.development',
    '.env.production.local',
    '.env.production',
  ]

  let primaryEnvFile: string | null = null
  const values: Record<string, string> = {}

  for (const filePath of candidates) {
    const result = await window.electronAPI.project.readFile({ projectPath, filePath })
    if (!result.success || !result.content) continue

    if (!primaryEnvFile) primaryEnvFile = filePath
    Object.assign(values, parseEnvFile(result.content))
  }

  return { primaryEnvFile, values }
}

function providerFromSubtitle(subtitle?: string): { provider: DataProvider; kind: DataResourceKind } {
  const s = (subtitle ?? '').toLowerCase()
  if (s.includes('convex')) return { provider: 'convex', kind: 'table' }
  if (s.includes('supabase')) return { provider: 'supabase', kind: 'table' }
  if (s.includes('firebase')) return { provider: 'firebase', kind: s.includes('collection') ? 'collection' : 'unknown' }
  return { provider: 'unknown', kind: 'unknown' }
}

function providerLabel(provider: DataProvider): string {
  if (provider === 'convex') return 'Convex'
  if (provider === 'supabase') return 'Supabase'
  if (provider === 'firebase') return 'Firebase'
  return 'Unknown'
}

function providerBadgeVariant(provider: DataProvider): 'default' | 'secondary' | 'outline' {
  if (provider === 'convex') return 'default'
  if (provider === 'supabase') return 'secondary'
  if (provider === 'firebase') return 'outline'
  return 'outline'
}

export function ProjectDatabasePage() {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const { currentOrganization } = useAuth()
  const {
    integrations: connectedIntegrations,
    connect,
    disconnect,
    startOAuth,
    connectingProvider,
    connectError,
    clearConnectError,
  } = useIntegrations()
  const syncContext = useOptionalProjectSyncContext()
  const projectPath = syncContext?.projectPath ?? null
  const [activeTab, setActiveTab] = useState('schema')
  const [search, setSearch] = useState('')
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [graph, setGraph] = useState<StudioGraph | null>(null)
  const [envInfo, setEnvInfo] = useState<EnvInfo | null>(null)
  const [connectDialogProvider, setConnectDialogProvider] = useState<IntegrationProvider | null>(null)
  const [isConnectDialogOpen, setIsConnectDialogOpen] = useState(false)
  const [explorerProvider, setExplorerProvider] = useState<IntegrationProvider>('supabase')
  const [explorerTable, setExplorerTable] = useState<string>('')
  const [explorerLimit, setExplorerLimit] = useState<number>(50)
  const [explorerResults, setExplorerResults] = useState<Array<Record<string, unknown>>>([])
  const [explorerColumns, setExplorerColumns] = useState<string[]>([])
  const [explorerError, setExplorerError] = useState<string | null>(null)
  const [isExplorerRunning, setIsExplorerRunning] = useState(false)
  const [firestoreCollection, setFirestoreCollection] = useState<string>('')

  // Get Convex organization
  const convexOrg = useQuery(
    api.organizations.getByWorkosId,
    currentOrganization?.organizationId ? { workosId: currentOrganization.organizationId } : 'skip'
  )

  // Load project by slug
  const project = useQuery(
    api.projects.getBySlug,
    convexOrg?._id && slug ? { organizationId: convexOrg._id, slug } : 'skip'
  )

  const runAnalysis = useCallback(async () => {
    if (!projectPath) return

    setIsAnalyzing(true)
    setAnalysisError(null)
    try {
      const [nextGraph, nextEnv] = await Promise.all([
        buildBackendStudioGraph({ projectPath }),
        loadProjectEnvInfo(projectPath),
      ])
      setGraph(nextGraph)
      setEnvInfo(nextEnv)
    } catch (e) {
      setAnalysisError(e instanceof Error ? e.message : 'Failed to analyze project')
    } finally {
      setIsAnalyzing(false)
    }
  }, [projectPath])

  // Initial scan
  useEffect(() => {
    if (!projectPath) return
    void runAnalysis()
  }, [projectPath, runAnalysis])

  // Reset selection when project changes
  useEffect(() => {
    setSelectedResourceId(null)
    setSearch('')
  }, [projectPath])

  const resources = useMemo<DataResource[]>(() => {
    if (!graph) return []

    const nodesById = new Map(graph.nodes.map((n) => [n.id, n]))

    const dbNodes = graph.nodes.filter((n) => n.data.kind === 'db')
    const out: DataResource[] = dbNodes.map((n) => {
      const { provider, kind } = providerFromSubtitle(n.data.subtitle)
      const incoming = graph.edges.filter((e) => e.target === n.id)
      const references: DataResourceRef[] = incoming
        .map((e) => nodesById.get(e.source))
        .filter(Boolean)
        .map((src) => ({
          id: src!.id,
          label: src!.data.label,
          subtitle: src!.data.subtitle,
          filePath: src!.data.filePath,
        }))

      return {
        id: n.id,
        name: n.data.label,
        provider,
        kind,
        subtitle: n.data.subtitle,
        filePath: n.data.filePath,
        references,
      }
    })

    out.sort((a, b) => {
      if (a.provider !== b.provider) return a.provider.localeCompare(b.provider)
      return a.name.localeCompare(b.name)
    })

    return out
  }, [graph])

  const filteredResources = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return resources
    return resources.filter((r) => r.name.toLowerCase().includes(q) || r.provider.toLowerCase().includes(q))
  }, [resources, search])

  const selectedResource = useMemo(() => {
    if (!selectedResourceId) return null
    return resources.find((r) => r.id === selectedResourceId) ?? null
  }, [resources, selectedResourceId])

  const providerSummary = useMemo(() => {
    const counts: Record<DataProvider, number> = { convex: 0, supabase: 0, firebase: 0, unknown: 0 }
    for (const r of resources) counts[r.provider] = (counts[r.provider] ?? 0) + 1
    return counts
  }, [resources])

  const configuredBackend = (project?.stack?.backend as string | undefined) ?? null
  const configuredBackendLower = configuredBackend?.toLowerCase() ?? ''

  const organizationId =
    (currentOrganization?.convexOrgId as Id<"organizations"> | undefined) ??
    (convexOrg?._id as Id<"organizations"> | undefined)

  const keyMetadata = useQuery(
    api.integrations.getKeyMetadata,
    organizationId ? { organizationId } : 'skip'
  )

  const supabaseEncrypted = useQuery(
    api.integrations.getEncryptedCredentials,
    organizationId ? { organizationId, provider: 'supabase' } : 'skip'
  )

  const firebaseEncrypted = useQuery(
    api.integrations.getEncryptedCredentials,
    organizationId ? { organizationId, provider: 'firebase' } : 'skip'
  )

  const envStatus = useMemo(() => {
    const values = envInfo?.values ?? {}
    const convexUrl = values.VITE_CONVEX_URL || values.NEXT_PUBLIC_CONVEX_URL || values.CONVEX_URL || ''
    const supabaseUrl =
      values.VITE_SUPABASE_URL || values.NEXT_PUBLIC_SUPABASE_URL || values.SUPABASE_URL || ''
    const supabaseKey =
      values.VITE_SUPABASE_ANON_KEY ||
      values.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      values.SUPABASE_ANON_KEY ||
      ''
    const firebaseApiKey =
      values.VITE_FIREBASE_API_KEY || values.NEXT_PUBLIC_FIREBASE_API_KEY || values.FIREBASE_API_KEY || ''
    const firebaseProjectId =
      values.VITE_FIREBASE_PROJECT_ID || values.NEXT_PUBLIC_FIREBASE_PROJECT_ID || values.FIREBASE_PROJECT_ID || ''

    return {
      convexUrlPresent: convexUrl.trim().length > 0,
      supabaseUrlPresent: supabaseUrl.trim().length > 0,
      supabaseKeyPresent: supabaseKey.trim().length > 0,
      firebaseApiKeyPresent: firebaseApiKey.trim().length > 0,
      firebaseProjectIdPresent: firebaseProjectId.trim().length > 0,
    }
  }, [envInfo?.values])

  const supabaseEnvCredentials = useMemo(() => {
    const values = envInfo?.values ?? {}
    const url =
      values.VITE_SUPABASE_URL || values.NEXT_PUBLIC_SUPABASE_URL || values.SUPABASE_URL || ''
    const anonKey =
      values.VITE_SUPABASE_ANON_KEY ||
      values.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      values.SUPABASE_ANON_KEY ||
      ''

    if (!url.trim() || !anonKey.trim()) return null
    return { url: url.trim(), anonKey: anonKey.trim() }
  }, [envInfo?.values])

  const connectDialogIntegration = useMemo(() => {
    if (!connectDialogProvider) return null
    return getIntegration(connectDialogProvider) ?? null
  }, [connectDialogProvider])

  const connectedByProvider = useMemo(() => {
    const map = new Map<IntegrationProvider, (typeof connectedIntegrations)[number]>()
    for (const i of connectedIntegrations) map.set(i.provider, i)
    return map
  }, [connectedIntegrations])

  const providersToShow = useMemo(() => {
    const providers: IntegrationProvider[] = []
    const seesSupabase = providerSummary.supabase > 0 || configuredBackendLower.includes('supabase')
    const seesFirebase = providerSummary.firebase > 0 || configuredBackendLower.includes('firebase')

    if (seesSupabase) providers.push('supabase')
    if (seesFirebase) providers.push('firebase')

    return providers
  }, [configuredBackendLower, providerSummary.firebase, providerSummary.supabase])

  const explorerProviders = useMemo(() => {
    const set = new Set<IntegrationProvider>()

    for (const p of providersToShow) set.add(p)
    for (const i of connectedIntegrations) {
      if (i.provider === 'supabase' || i.provider === 'firebase') set.add(i.provider)
    }

    const out = Array.from(set)
    if (out.length === 0) out.push('supabase')
    out.sort()
    return out
  }, [connectedIntegrations, providersToShow])

  const supabaseTables = useMemo(() => {
    return Array.from(
      new Set(resources.filter((r) => r.provider === 'supabase' && r.kind === 'table').map((r) => r.name))
    ).sort()
  }, [resources])

  const firebaseCollections = useMemo(() => {
    return Array.from(
      new Set(resources.filter((r) => r.provider === 'firebase' && r.kind === 'collection').map((r) => r.name))
    ).sort()
  }, [resources])

  useEffect(() => {
    if (explorerProviders.length === 0) return
    if (explorerProviders.includes(explorerProvider)) return
    setExplorerProvider(explorerProviders[0])
  }, [explorerProvider, explorerProviders])

  useEffect(() => {
    if (!explorerTable && supabaseTables.length > 0) setExplorerTable(supabaseTables[0])
  }, [explorerTable, supabaseTables])

  useEffect(() => {
    if (!firestoreCollection && firebaseCollections.length > 0) setFirestoreCollection(firebaseCollections[0])
  }, [firebaseCollections, firestoreCollection])

  const openConnectDialog = useCallback(
    (provider: IntegrationProvider) => {
      setConnectDialogProvider(provider)
      clearConnectError()
      setIsConnectDialogOpen(true)
    },
    [clearConnectError]
  )

  const handleConnect = useCallback(
    async (credentials: IntegrationCredentials) => {
      if (!connectDialogProvider) return
      try {
        await connect(connectDialogProvider, credentials)
        setIsConnectDialogOpen(false)
        setConnectDialogProvider(null)
      } catch {
        // Keep dialog open; error is shown via connectError
      }
    },
    [connect, connectDialogProvider]
  )

  const handleStartOAuth = useCallback(async () => {
    if (!connectDialogProvider) return
    await startOAuth(connectDialogProvider)
  }, [connectDialogProvider, startOAuth])

  const handleConnectDialogOpenChange = useCallback(
    (open: boolean) => {
      setIsConnectDialogOpen(open)
      if (!open) setConnectDialogProvider(null)
    },
    []
  )

  const runExplorer = useCallback(async () => {
    setExplorerError(null)
    setIsExplorerRunning(true)
    setExplorerResults([])
    setExplorerColumns([])

    try {
      if (!window.electronAPI?.database) {
        throw new Error('Database API not available')
      }

      if (explorerProvider === 'supabase') {
        if (!explorerTable) throw new Error('Select a table')

        const keyId = keyMetadata?.keyId
        const encryptedCredentials = supabaseEncrypted?.encryptedCredentials

        const useIntegration = !!encryptedCredentials && !!keyId

        const result = await window.electronAPI.database.supabaseSelect({
          table: explorerTable,
          limit: explorerLimit,
          ...(useIntegration
            ? { encryptedCredentials: encryptedCredentials!, keyId: keyId! }
            : supabaseEnvCredentials
              ? { credentials: supabaseEnvCredentials }
              : {}),
        })

        if (!result.success) {
          throw new Error(result.error || 'Supabase query failed')
        }

        const rows = (result.rows ?? []).filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
        const columns = Array.from(new Set(rows.flatMap((r) => Object.keys(r)))).slice(0, 50)

        setExplorerResults(rows)
        setExplorerColumns(columns)
        return
      }

      if (explorerProvider === 'firebase') {
        const collection = firestoreCollection.trim()
        if (!collection) throw new Error('Select a collection')

        const keyId = keyMetadata?.keyId
        const encryptedCredentials = firebaseEncrypted?.encryptedCredentials

        if (!encryptedCredentials || !keyId) {
          throw new Error('Connect the Firebase integration to browse documents')
        }

        const result = await window.electronAPI.database.firestoreListDocuments({
          collection,
          pageSize: explorerLimit,
          encryptedCredentials,
          keyId,
        })

        if (!result.success) {
          throw new Error(result.error || 'Firestore query failed')
        }

        const docs = result.documents ?? []
        const rows: Array<Record<string, unknown>> = docs.map((d) => ({ id: d.id, ...d.fields }))
        const columns = Array.from(new Set(rows.flatMap((r) => Object.keys(r)))).slice(0, 50)

        setExplorerResults(rows)
        setExplorerColumns(columns)
        return
      }

      throw new Error(`Unsupported provider: ${explorerProvider}`)
    } catch (e) {
      setExplorerError(e instanceof Error ? e.message : 'Query failed')
    } finally {
      setIsExplorerRunning(false)
    }
  }, [
    explorerLimit,
    explorerProvider,
    explorerTable,
    firebaseEncrypted,
    firestoreCollection,
    keyMetadata,
    supabaseEncrypted,
    supabaseEnvCredentials,
  ])

  if (project === undefined) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-sidebar/60">
      {/* Header */}
      <div className="sticky top-0 z-20 flex items-center justify-between px-4 py-2 bg-sidebar/30 backdrop-blur-md">
        <div className="flex items-center gap-3 min-w-0">
          <Database className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-sm font-medium truncate">Database</h1>
          {configuredBackend ? (
            <Badge variant="outline" className="capitalize">
              {configuredBackend}
            </Badge>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <ButtonGroup>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-2 h-8 px-2 text-xs rounded-r-none border-r-0 focus:z-10">
                  <Table className="h-3.5 w-3.5" />
                  {activeTab === 'schema' ? 'Resources' : activeTab === 'data' ? 'Connections' : 'Query'}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setActiveTab('schema')}>
                  <Table className="h-3.5 w-3.5 mr-2" />
                  Resources
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setActiveTab('data')}>
                  <PlugZap className="h-3.5 w-3.5 mr-2" />
                  Connections
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setActiveTab('query')}>
                  <Code className="h-3.5 w-3.5 mr-2" />
                  Query
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" onClick={runAnalysis} disabled={!projectPath || isAnalyzing} className="h-8 px-2 text-xs gap-2 rounded-l-none focus:z-10">
              <RefreshCw className={cn('h-3.5 w-3.5', isAnalyzing && 'animate-spin')} />
              Scan
            </Button>
          </ButtonGroup>
          <Button className="h-8 px-2 text-xs gap-2" disabled>
            <Plus className="h-3.5 w-3.5" />
            New Table
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-hidden px-4 py-4">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full">
          <TabsContent value="schema" className="mt-0 flex-1 min-h-0">
            {!projectPath ? (
              <Card className="p-12">
                <Empty className="py-10">
                  <EmptyHeader>
                    <EmptyMedia>
                      <FolderOpen />
                    </EmptyMedia>
                    <EmptyTitle>Local project not ready</EmptyTitle>
                    <EmptyDescription>
                      Sync the project first so we can scan the codebase and detect tables/collections.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </Card>
            ) : analysisError ? (
              <Card className="p-6 border-destructive/50 bg-destructive/10">
                <div className="text-sm font-medium text-destructive">Analysis failed</div>
                <div className="mt-1 text-xs text-destructive/90">{analysisError}</div>
              </Card>
            ) : (
              <div className="h-full min-h-0">
                <ResizablePanelGroup orientation="horizontal" className="h-full">
                  <ResizablePanel defaultSize="38" minSize="24" maxSize="55" className="min-w-0">
                    <Card className="h-full overflow-hidden border-border/60 bg-background/70">
                      <div className="p-3 border-b border-border/60">
                        <div className="flex items-center gap-2">
                          <div className="relative flex-1">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                              value={search}
                              onChange={(e) => setSearch(e.target.value)}
                              placeholder="Search tables, collections…"
                              className="h-9 pl-9"
                            />
                          </div>
                          <Badge variant="secondary" className="tabular-nums">
                            {filteredResources.length}
                          </Badge>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2">
                          {providerSummary.convex ? (
                            <Badge variant="default" className="tabular-nums">
                              Convex {providerSummary.convex}
                            </Badge>
                          ) : null}
                          {providerSummary.supabase ? (
                            <Badge variant="secondary" className="tabular-nums">
                              Supabase {providerSummary.supabase}
                            </Badge>
                          ) : null}
                          {providerSummary.firebase ? (
                            <Badge variant="outline" className="tabular-nums">
                              Firebase {providerSummary.firebase}
                            </Badge>
                          ) : null}
                          {!resources.length ? (
                            <Badge variant="outline">No resources detected</Badge>
                          ) : null}
                        </div>
                      </div>

                      <ScrollArea className="h-[calc(100%-5.25rem)]">
                        <div className="p-2">
                          {isAnalyzing && !graph ? (
                            <div className="p-4 text-sm text-muted-foreground">Scanning…</div>
                          ) : filteredResources.length === 0 ? (
                            <div className="p-4 text-sm text-muted-foreground">No matches.</div>
                          ) : (
                            <div className="space-y-1">
                              {filteredResources.map((r) => {
                                const isActive = r.id === selectedResourceId
                                return (
                                  <button
                                    key={r.id}
                                    type="button"
                                    onClick={() => setSelectedResourceId(r.id)}
                                    className={cn(
                                      "w-full rounded-md border border-transparent px-3 py-2 text-left transition-colors",
                                      "hover:bg-sidebar-accent",
                                      isActive && "bg-sidebar-accent border-border/60"
                                    )}
                                  >
                                    <div className="flex items-start gap-2">
                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2 min-w-0">
                                          <div className="truncate text-sm font-medium">{r.name}</div>
                                          <Badge variant={providerBadgeVariant(r.provider)} className="shrink-0">
                                            {providerLabel(r.provider)}
                                          </Badge>
                                        </div>
                                        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                                          <span className="capitalize">{r.kind}</span>
                                          <span className="text-muted-foreground/60">•</span>
                                          <span className="tabular-nums">{r.references.length} refs</span>
                                        </div>
                                      </div>
                                    </div>
                                  </button>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      </ScrollArea>
                    </Card>
                  </ResizablePanel>

                  <ResizableHandle withHandle />

                  <ResizablePanel defaultSize="62" minSize="45" className="min-w-0">
                    <Card className="h-full overflow-hidden border-border/60 bg-background/70">
                      <div className="h-10 px-4 flex items-center justify-between border-b border-border/60">
                        <div className="text-sm font-medium">Details</div>
                        {selectedResource?.filePath ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 gap-2"
                            onClick={() => navigate(`/projects/${slug}?path=${encodeURIComponent(selectedResource.filePath!)}`)}
                          >
                            <FileCode2 className="h-4 w-4" />
                            Open
                          </Button>
                        ) : null}
                      </div>

                      <ScrollArea className="h-[calc(100%-2.5rem)]">
                        <div className="p-4">
                          {!selectedResource ? (
                            <Empty className="py-10">
                              <EmptyHeader>
                                <EmptyMedia>
                                  <Database />
                                </EmptyMedia>
                                <EmptyTitle>Select a resource</EmptyTitle>
                                <EmptyDescription>
                                  Choose a table/collection to see where it’s used in the codebase.
                                </EmptyDescription>
                              </EmptyHeader>
                            </Empty>
                          ) : (
                            <div className="space-y-4">
                              <Card className="p-4 bg-background/70">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2 min-w-0">
                                      <div className="truncate text-base font-semibold">{selectedResource.name}</div>
                                      <Badge variant={providerBadgeVariant(selectedResource.provider)}>
                                        {providerLabel(selectedResource.provider)}
                                      </Badge>
                                      <Badge variant="outline" className="capitalize">
                                        {selectedResource.kind}
                                      </Badge>
                                    </div>
                                    {selectedResource.subtitle ? (
                                      <div className="mt-1 text-xs text-muted-foreground">
                                        {selectedResource.subtitle}
                                      </div>
                                    ) : null}
                                    {selectedResource.filePath ? (
                                      <div className="mt-2 text-[11px] text-muted-foreground break-all">
                                        <span className="font-medium text-foreground">File:</span> {selectedResource.filePath}
                                      </div>
                                    ) : null}
                                  </div>
                                  <div className="shrink-0 text-xs text-muted-foreground tabular-nums">
                                    {selectedResource.references.length} refs
                                  </div>
                                </div>
                              </Card>

                              <Card className="p-4 bg-background/70">
                                <div className="text-sm font-medium mb-2">Referenced from</div>
                                {selectedResource.references.length === 0 ? (
                                  <div className="text-xs text-muted-foreground">
                                    No callers detected (it may be unused or defined but not referenced yet).
                                  </div>
                                ) : (
                                  <div className="space-y-2">
                                    {selectedResource.references.map((ref) => (
                                      <div key={ref.id} className="flex items-start gap-3 rounded-md border border-border/60 bg-muted/10 p-3">
                                        <div className="min-w-0 flex-1">
                                          <div className="truncate text-sm font-medium">{ref.label}</div>
                                          {ref.subtitle ? (
                                            <div className="truncate text-[11px] text-muted-foreground">
                                              {ref.subtitle}
                                            </div>
                                          ) : null}
                                          {ref.filePath ? (
                                            <div className="mt-1 text-[11px] text-muted-foreground break-all">
                                              {ref.filePath}
                                            </div>
                                          ) : null}
                                        </div>
                                        {ref.filePath ? (
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="h-8"
                                            onClick={() => navigate(`/projects/${slug}?path=${encodeURIComponent(ref.filePath!)}`)}
                                          >
                                            Open
                                          </Button>
                                        ) : null}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </Card>
                            </div>
                          )}
                        </div>
                      </ScrollArea>
                    </Card>
                  </ResizablePanel>
                </ResizablePanelGroup>
              </div>
            )}
          </TabsContent>

	          <TabsContent value="data" className="mt-0 flex-1 min-h-0 overflow-auto">
	            <div className="grid gap-4 lg:grid-cols-3">
                <Card className="p-4 bg-background/70 lg:col-span-2">
                  <div className="flex items-center gap-2">
                    <PlugZap className="h-4 w-4 text-muted-foreground" />
                    <div className="text-sm font-medium">Workspace integrations</div>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    Connect providers once for the whole workspace (encrypted), then reuse them across projects and teammates.
                  </div>

                  <div className="mt-4 space-y-3">
                    {providersToShow.length === 0 ? (
                      <div className="text-sm text-muted-foreground">
                        No database provider detected yet. Run <span className="font-medium text-foreground">Scan</span> after adding
                        Supabase/Firebase code, or connect one manually.
                      </div>
                    ) : (
                      providersToShow.map((provider) => {
                        const connected = connectedByProvider.get(provider)
                        const status = connected?.status ?? 'not_connected'

                        const statusBadgeVariant =
                          status === 'active' ? 'default' : status === 'not_connected' ? 'outline' : 'destructive'

                        const envBadgeVariant =
                          provider === 'supabase'
                            ? envStatus.supabaseUrlPresent && envStatus.supabaseKeyPresent
                              ? 'secondary'
                              : 'outline'
                            : provider === 'firebase'
                              ? envStatus.firebaseProjectIdPresent
                                ? 'outline'
                                : 'outline'
                              : 'outline'

                        const envLabel =
                          provider === 'supabase'
                            ? envStatus.supabaseUrlPresent && envStatus.supabaseKeyPresent
                              ? 'Env found'
                              : 'Env missing'
                            : provider === 'firebase'
                              ? envStatus.firebaseProjectIdPresent
                                ? 'Env found'
                                : 'Env missing'
                              : 'Env'

                        return (
                          <div
                            key={provider}
                            className="flex items-start justify-between gap-3 rounded-md border border-border/60 bg-muted/10 p-3"
                          >
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="text-sm font-medium">{providerLabel(provider as unknown as DataProvider)}</div>
                                <Badge variant={statusBadgeVariant as 'default' | 'secondary' | 'outline' | 'destructive'}>
                                  {status === 'not_connected' ? 'Not connected' : status.replaceAll('_', ' ')}
                                </Badge>
                                <Badge variant={envBadgeVariant as 'default' | 'secondary' | 'outline' | 'destructive'}>
                                  {envLabel}
                                </Badge>
                              </div>
                              {connected?.externalAccountName ? (
                                <div className="mt-1 truncate text-xs text-muted-foreground">
                                  {connected.externalAccountName}
                                </div>
                              ) : null}
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8"
                                onClick={() => navigate('/workspace/integrations')}
                              >
                                Manage
                              </Button>
                              {connected ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8"
                                  disabled={connectingProvider === provider}
                                  onClick={() => disconnect(connected._id)}
                                >
                                  Disconnect
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  className="h-8"
                                  disabled={connectingProvider === provider}
                                  onClick={() => openConnectDialog(provider)}
                                >
                                  Connect
                                </Button>
                              )}
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                </Card>

	              <Card className="p-4 bg-background/70">
	                <div className="flex items-center gap-2">
	                  <PlugZap className="h-4 w-4 text-muted-foreground" />
	                  <div className="text-sm font-medium">Environment</div>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  We detect provider connection info from your project’s env files (local only).
                </div>

                <div className="mt-4 space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm">Convex URL</div>
                    <Badge variant={envStatus.convexUrlPresent ? 'default' : 'outline'}>
                      {envStatus.convexUrlPresent ? 'Found' : 'Missing'}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm">Supabase URL</div>
                    <Badge variant={envStatus.supabaseUrlPresent ? 'secondary' : 'outline'}>
                      {envStatus.supabaseUrlPresent ? 'Found' : 'Missing'}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm">Supabase anon key</div>
                    <Badge variant={envStatus.supabaseKeyPresent ? 'secondary' : 'outline'}>
                      {envStatus.supabaseKeyPresent ? 'Found' : 'Missing'}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm">Firebase API key</div>
                    <Badge variant={envStatus.firebaseApiKeyPresent ? 'outline' : 'outline'}>
                      {envStatus.firebaseApiKeyPresent ? 'Found' : 'Missing'}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm">Firebase project id</div>
                    <Badge variant={envStatus.firebaseProjectIdPresent ? 'outline' : 'outline'}>
                      {envStatus.firebaseProjectIdPresent ? 'Found' : 'Missing'}
                    </Badge>
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-2">
                  {envInfo?.primaryEnvFile ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-2"
                      onClick={() => navigate(`/projects/${slug}?path=${encodeURIComponent(envInfo.primaryEnvFile!)}`)}
                    >
                      <FileCode2 className="h-4 w-4" />
                      Open {envInfo.primaryEnvFile}
                    </Button>
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      No env file found (expected `.env.local` or `.env`).
                    </div>
                  )}
	                </div>
	              </Card>

	              <Card className="p-4 bg-background/70 lg:col-span-3">
	                <div className="flex items-center gap-2">
	                  <Database className="h-4 w-4 text-muted-foreground" />
	                  <div className="text-sm font-medium">Data explorer</div>
	                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  Browse rows/documents in the <span className="font-medium text-foreground">Explorer</span> tab (read-only by default).
                </div>

                <div className="mt-4 space-y-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>Detected resources</div>
                    <div className="tabular-nums text-muted-foreground">{resources.length}</div>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div>Configured backend</div>
                    <div className="text-muted-foreground capitalize">{configuredBackend ?? 'unknown'}</div>
                  </div>
                </div>

                <div className="mt-4">
                  <Button size="sm" className="gap-2" onClick={() => setActiveTab('query')}>
                    <Code className="h-4 w-4" />
                    Open Explorer
                  </Button>
                </div>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="query" className="mt-0 flex-1 min-h-0 overflow-auto">
            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="p-4 bg-background/70 lg:col-span-1">
                <div className="flex items-center gap-2">
                  <Code className="h-4 w-4 text-muted-foreground" />
                  <div className="text-sm font-medium">Explorer</div>
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  Browse a sample of rows/documents using your connected provider (read permissions apply).
                </div>

                <div className="mt-4 space-y-3">
                  <div className="space-y-2">
                    <Label className="text-xs">Provider</Label>
                    <Select value={explorerProvider} onValueChange={(v) => setExplorerProvider(v as IntegrationProvider)}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select provider" />
                      </SelectTrigger>
                      <SelectContent>
                        {explorerProviders.map((p) => (
                          <SelectItem key={p} value={p}>
                            {providerLabel(p as unknown as DataProvider)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {explorerProvider === 'supabase' ? (
                    <div className="space-y-2">
                      <Label className="text-xs">Table</Label>
                      <Select value={explorerTable} onValueChange={setExplorerTable}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={supabaseTables.length ? 'Select table' : 'No tables detected'} />
                        </SelectTrigger>
                        <SelectContent>
                          {supabaseTables.map((t) => (
                            <SelectItem key={t} value={t}>
                              {t}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {!supabaseTables.length ? (
                        <div className="text-xs text-muted-foreground">
                          No Supabase tables detected. Run <span className="font-medium text-foreground">Scan</span> after adding
                          <span className="font-mono"> supabase.from(...)</span> calls.
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {explorerProvider === 'firebase' ? (
                    <div className="space-y-2">
                      <Label className="text-xs">Collection</Label>
                      <Select value={firestoreCollection} onValueChange={setFirestoreCollection}>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder={firebaseCollections.length ? 'Select collection' : 'No collections detected'} />
                        </SelectTrigger>
                        <SelectContent>
                          {firebaseCollections.map((c) => (
                            <SelectItem key={c} value={c}>
                              {c}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {!firebaseCollections.length ? (
                        <div className="text-xs text-muted-foreground">
                          No Firebase collections detected. Run <span className="font-medium text-foreground">Scan</span> after adding
                          <span className="font-mono"> collection(..., "name")</span> calls.
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    <Label className="text-xs">Limit</Label>
                    <Input
                      value={String(explorerLimit)}
                      onChange={(e) => setExplorerLimit(Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
                      className="h-9 font-mono text-sm"
                      inputMode="numeric"
                    />
                    <div className="text-[11px] text-muted-foreground">Max 200</div>
                  </div>

                  {explorerProvider === 'supabase' && !supabaseEncrypted?.encryptedCredentials && !supabaseEnvCredentials ? (
                    <div className="rounded-md border border-border/60 bg-muted/10 p-3 text-xs text-muted-foreground">
                      Connect Supabase (or add env vars) to browse rows.
                      <div className="mt-2 flex gap-2">
                        <Button size="sm" className="h-8" onClick={() => openConnectDialog('supabase')}>
                          Connect
                        </Button>
                        <Button size="sm" variant="outline" className="h-8" onClick={() => setActiveTab('data')}>
                          Connections
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  {explorerProvider === 'firebase' && !firebaseEncrypted?.encryptedCredentials ? (
                    <div className="rounded-md border border-border/60 bg-muted/10 p-3 text-xs text-muted-foreground">
                      Connect Firebase (service account) to browse documents.
                      <div className="mt-2 flex gap-2">
                        <Button size="sm" className="h-8" onClick={() => openConnectDialog('firebase')}>
                          Connect
                        </Button>
                        <Button size="sm" variant="outline" className="h-8" onClick={() => setActiveTab('data')}>
                          Connections
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  <Button
                    size="sm"
                    className="w-full gap-2"
                    onClick={runExplorer}
                    disabled={isExplorerRunning}
                  >
                    {isExplorerRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Run
                  </Button>

                  {explorerError ? (
                    <div className="text-xs text-destructive">{explorerError}</div>
                  ) : null}
                </div>
              </Card>

              <Card className="p-4 bg-background/70 lg:col-span-2 min-h-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">Results</div>
                    <div className="text-xs text-muted-foreground">
                      {explorerResults.length ? `${explorerResults.length} rows` : 'Run a query to see rows/documents.'}
                    </div>
                  </div>
                  {explorerColumns.length ? (
                    <Badge variant="secondary" className="tabular-nums">
                      {explorerColumns.length} cols
                    </Badge>
                  ) : null}
                </div>

                <div className="mt-4">
                  {!explorerResults.length ? (
                    <Empty className="py-10">
                      <EmptyHeader>
                        <EmptyMedia>
                          <Database />
                        </EmptyMedia>
                        <EmptyTitle>No results</EmptyTitle>
                        <EmptyDescription>Run a query to preview a small sample (read-only).</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  ) : (
                    <div className="rounded-md border border-border/60 overflow-hidden">
                      <UiTable className="text-xs">
                        <TableHeader>
                          <TableRow>
                            {explorerColumns.map((c) => (
                              <TableHead key={c} className="font-medium">
                                {c}
                              </TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {explorerResults.slice(0, 200).map((row, idx) => (
                            <TableRow key={idx}>
                              {explorerColumns.map((c) => {
                                const value = row[c]
                                const rendered =
                                  value === null
                                    ? 'null'
                                    : typeof value === 'object'
                                      ? JSON.stringify(value)
                                      : String(value)
                                return (
                                  <TableCell key={c} className="max-w-[280px] truncate">
                                    {rendered}
                                  </TableCell>
                                )
                              })}
                            </TableRow>
                          ))}
                        </TableBody>
                      </UiTable>
                    </div>
                  )}
                </div>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>

        <IntegrationConnectDialog
          integration={connectDialogIntegration}
          open={isConnectDialogOpen}
          onOpenChange={handleConnectDialogOpenChange}
          onConnect={handleConnect}
          onStartOAuth={handleStartOAuth}
          isConnecting={!!connectDialogProvider && connectingProvider === connectDialogProvider}
          error={connectError ?? undefined}
        />
	    </div>
	  )
}
