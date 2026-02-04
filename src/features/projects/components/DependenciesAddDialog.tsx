import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useAuth } from '@/contexts/AuthContext'
import { useDependenciesStore, selectDependenciesSnapshot } from '@/stores/useDependenciesStore'

const AI_API_URL = import.meta.env.VITE_AI_API_URL || 'http://localhost:3001/ai/chat'
const AI_BASE_URL = AI_API_URL.replace(/\/chat$/, '')

interface RegistryPackage {
  name: string
  version: string
  description?: string
}

interface AiSuggestion {
  name: string
  reason: string
  confidence: 'high' | 'medium' | 'low'
}

interface DependenciesAddDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectPath: string
  onAdd: (name: string, options: { dev?: boolean; version?: string }) => void
}

export function DependenciesAddDialog({ open, onOpenChange, projectPath, onAdd }: DependenciesAddDialogProps) {
  const { accessToken, currentOrganization } = useAuth()
  const snapshot = useDependenciesStore(selectDependenciesSnapshot(projectPath))
  const [activeTab, setActiveTab] = useState<'registry' | 'ai'>('registry')
  const [query, setQuery] = useState('')
  const [registryResults, setRegistryResults] = useState<RegistryPackage[]>([])
  const [registryLoading, setRegistryLoading] = useState(false)
  const [targetType, setTargetType] = useState<'dependency' | 'devDependency'>('dependency')
  const [version, setVersion] = useState('')
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiResults, setAiResults] = useState<AiSuggestion[]>([])
  const [aiLoading, setAiLoading] = useState(false)
  const [metaLookup, setMetaLookup] = useState<Record<string, { latest?: string; description?: string }>>({})
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const dependencyContext = useMemo(() => {
    const items = snapshot?.items ?? []
    return {
      dependencies: items.filter((item) => item.type === 'dependency').map((item) => item.name),
      devDependencies: items.filter((item) => item.type === 'devDependency').map((item) => item.name),
    }
  }, [snapshot?.items])

  const fetchRegistry = useCallback(async (value: string) => {
    if (!window.electronAPI?.dependencies) return
    setRegistryLoading(true)
    const result = await window.electronAPI.dependencies.searchRegistry({ query: value, size: 20 })
    if (result.success && result.results) {
      const packages = result.results.objects.map((obj) => ({
        name: obj.package.name,
        version: obj.package.version,
        description: obj.package.description,
      }))
      setRegistryResults(packages)
    } else {
      setRegistryResults([])
    }
    setRegistryLoading(false)
  }, [])

  useEffect(() => {
    if (!open || activeTab !== 'registry') return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const value = query.trim()
    if (!value) {
      setRegistryResults([])
      return
    }
    debounceRef.current = setTimeout(() => {
      void fetchRegistry(value)
    }, 300)
  }, [query, open, activeTab, fetchRegistry])

  const handleAdd = useCallback((name: string) => {
    onAdd(name, {
      dev: targetType === 'devDependency',
      version: version.trim() || undefined,
    })
  }, [onAdd, targetType, version])

  const handleAskAi = useCallback(async () => {
    if (!aiPrompt.trim() || !accessToken || !currentOrganization?.organizationId) return
    setAiLoading(true)
    setAiResults([])
    try {
      const response = await fetch(`${AI_BASE_URL}/dependencies/suggest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          organizationId: currentOrganization.organizationId,
          query: aiPrompt.trim(),
          context: {
            dependencies: dependencyContext.dependencies,
            devDependencies: dependencyContext.devDependencies,
          },
        }),
      })
      if (!response.ok) {
        throw new Error('Failed to fetch AI suggestions')
      }
      const data = await response.json()
      const suggestions: AiSuggestion[] = data.suggestions ?? []
      setAiResults(suggestions)
      const names = suggestions.map((item) => item.name)
      if (names.length && window.electronAPI?.dependencies) {
        const meta = await window.electronAPI.dependencies.fetchPackageMeta({ names })
        if (meta.success && meta.results) {
          setMetaLookup(meta.results)
        }
      }
    } catch {
      setAiResults([])
    } finally {
      setAiLoading(false)
    }
  }, [aiPrompt, accessToken, currentOrganization?.organizationId, dependencyContext])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setRegistryResults([])
      setAiPrompt('')
      setAiResults([])
      setMetaLookup({})
    }
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add Dependency</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Badge variant={targetType === 'dependency' ? 'default' : 'secondary'} className="cursor-pointer" onClick={() => setTargetType('dependency')}>
            Dependency
          </Badge>
          <Badge variant={targetType === 'devDependency' ? 'default' : 'secondary'} className="cursor-pointer" onClick={() => setTargetType('devDependency')}>
            Dev Dependency
          </Badge>
          <Input
            placeholder="Version (optional, e.g. ^1.2.3)"
            value={version}
            onChange={(event) => setVersion(event.target.value)}
            className="ml-auto h-8 w-48 text-xs"
          />
        </div>

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'registry' | 'ai')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="registry">Registry Search</TabsTrigger>
            <TabsTrigger value="ai">Ask AI</TabsTrigger>
          </TabsList>

          <TabsContent value="registry">
            <div className="space-y-3">
              <Input
                placeholder="Search npm registry..."
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <ScrollArea className="h-[340px] rounded-md border">
                <div className="p-3 space-y-2">
                  {registryLoading && <div className="text-xs text-muted-foreground">Searching registry…</div>}
                  {!registryLoading && registryResults.length === 0 && (
                    <div className="text-xs text-muted-foreground">No results yet.</div>
                  )}
                  {registryResults.map((pkg) => (
                    <div key={pkg.name} className="flex items-center justify-between gap-3 p-2 rounded-md hover:bg-muted/50">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{pkg.name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {pkg.description || 'No description'}
                        </div>
                        <div className="text-[11px] text-muted-foreground">Latest: {pkg.version}</div>
                      </div>
                      <Button size="sm" onClick={() => handleAdd(pkg.name)}>
                        Add
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          </TabsContent>

          <TabsContent value="ai">
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input
                  placeholder="Describe what you need (e.g. “testing tools for React”)"
                  value={aiPrompt}
                  onChange={(event) => setAiPrompt(event.target.value)}
                />
                <Button onClick={handleAskAi} disabled={!aiPrompt.trim() || aiLoading}>
                  {aiLoading ? 'Thinking…' : 'Ask'}
                </Button>
              </div>
              <ScrollArea className="h-[340px] rounded-md border">
                <div className="p-3 space-y-3">
                  {aiLoading && <div className="text-xs text-muted-foreground">Generating suggestions…</div>}
                  {!aiLoading && aiResults.length === 0 && (
                    <div className="text-xs text-muted-foreground">No suggestions yet.</div>
                  )}
                  {aiResults.map((suggestion) => {
                    const meta = metaLookup[suggestion.name]
                    return (
                      <div key={suggestion.name} className="flex items-start justify-between gap-3 p-2 rounded-md hover:bg-muted/50">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium truncate">{suggestion.name}</span>
                            <Badge variant="secondary" className="text-[10px]">{suggestion.confidence}</Badge>
                          </div>
                          <div className="text-xs text-muted-foreground">{suggestion.reason}</div>
                          <div className="text-[11px] text-muted-foreground">
                            Latest: {meta?.latest ?? 'unknown'}
                          </div>
                          {meta?.description && (
                            <div className="text-[11px] text-muted-foreground truncate">{meta.description}</div>
                          )}
                        </div>
                        <Button size="sm" onClick={() => handleAdd(suggestion.name)}>
                          Add
                        </Button>
                      </div>
                    )
                  })}
                </div>
              </ScrollArea>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
