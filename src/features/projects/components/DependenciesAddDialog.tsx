import { useCallback, useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Kbd } from '@/components/ui/kbd'
import { Command, CommandInput, CommandList } from '@/components/ui/command'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { CornerDownLeft, Loader2 } from 'lucide-react'

interface RegistryPackage {
  name: string
  version: string
  description?: string
}

interface DependenciesAddDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectPath: string
  onAdd: (name: string, options: { dev?: boolean; version?: string }) => void
}

export function DependenciesAddDialog({ open, onOpenChange, projectPath: _projectPath, onAdd }: DependenciesAddDialogProps) {
  const [query, setQuery] = useState('')
  const [registryResults, setRegistryResults] = useState<RegistryPackage[]>([])
  const [registryLoading, setRegistryLoading] = useState(false)
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({})
  const [versionOverrides, setVersionOverrides] = useState<Record<string, string>>({})
  const [showTopFade, setShowTopFade] = useState(false)
  const [showBottomFade, setShowBottomFade] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    if (!open) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const value = query.trim()
    if (!value) {
      setRegistryResults([])
      return
    }
    debounceRef.current = setTimeout(() => {
      void fetchRegistry(value)
    }, 300)
  }, [query, open, fetchRegistry])

  const getRowKey = useCallback((name: string) => `registry:${name}`, [])

  const toggleRowExpanded = useCallback((rowKey: string) => {
    setExpandedRows((prev) => ({ ...prev, [rowKey]: !prev[rowKey] }))
  }, [])

  const setRowVersionOverride = useCallback((rowKey: string, value: string) => {
    setVersionOverrides((prev) => ({ ...prev, [rowKey]: value }))
  }, [])

  const updateFades = useCallback((element: HTMLElement) => {
    const maxScrollTop = element.scrollHeight - element.clientHeight
    setShowTopFade(element.scrollTop > 2)
    setShowBottomFade(maxScrollTop - element.scrollTop > 2)
  }, [])

  const handleAdd = useCallback((name: string, targetType: 'dependency' | 'devDependency', overrideVersion?: string) => {
    onAdd(name, {
      dev: targetType === 'devDependency',
      version: overrideVersion?.trim() || undefined,
    })
  }, [onAdd])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setRegistryResults([])
      setExpandedRows({})
      setVersionOverrides({})
      setShowTopFade(false)
      setShowBottomFade(false)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      const listElement = document.getElementById('dependencies-add-command-list')
      if (listElement) updateFades(listElement)
    })
    return () => cancelAnimationFrame(frame)
  }, [open, query, registryLoading, registryResults.length, expandedRows, updateFades])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="gap-0 overflow-hidden p-0 pb-10 sm:max-w-lg"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Add Package</DialogTitle>
          <DialogDescription>Search npm packages and add directly to this project.</DialogDescription>
        </DialogHeader>
        <Command
          shouldFilter={false}
          className="[&_[data-slot=command-input-wrapper]]:border-b-0"
        >
          <CommandInput
            placeholder="Search npm registry..."
            value={query}
            onValueChange={setQuery}
          />
          <div className="relative">
            <CommandList
              id="dependencies-add-command-list"
              className="max-h-[420px] overflow-x-hidden overflow-y-auto"
              onScroll={(event) => updateFades(event.currentTarget)}
            >
            <div className="w-full min-w-0 space-y-2 p-2">
              {registryLoading && (
                <div className="flex items-center gap-2 rounded-lg bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Searching registry...
                </div>
              )}
              {!registryLoading && !query.trim() && (
                <div className="rounded-lg bg-muted/20 px-3 py-6 text-center text-xs text-muted-foreground">
                  Start typing to search npm packages.
                </div>
              )}
              {!registryLoading && query.trim() && registryResults.length === 0 && (
                <div className="rounded-lg bg-muted/20 px-3 py-6 text-center text-xs text-muted-foreground">
                  No packages found.
                </div>
              )}
              {registryResults.map((pkg) => {
                const rowKey = getRowKey(pkg.name)
                const isExpanded = expandedRows[rowKey] ?? false
                const overrideValue = versionOverrides[rowKey] ?? ''

                return (
                  <div
                    key={pkg.name}
                    className="w-full min-w-0 max-w-full overflow-hidden rounded-lg bg-muted/10 p-3 transition-colors hover:bg-muted/30"
                  >
                    <div className="flex w-full min-w-0 flex-wrap items-start gap-2">
                      <div className="min-w-0 basis-0 grow">
                        <div className="mb-0.5 truncate text-sm font-medium">{pkg.name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {pkg.description || 'No description'}
                        </div>
                        <div className="mt-1">
                          <Badge variant="secondary" className="text-[10px]">
                            Latest {pkg.version}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5 sm:ml-auto">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 rounded-full px-2.5 text-[11px]"
                          onClick={() => toggleRowExpanded(rowKey)}
                        >
                          {isExpanded ? 'hide ver' : 'version'}
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" className="h-7 rounded-full px-3 text-xs">
                              Add
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleAdd(pkg.name, 'dependency', overrideValue)}>
                              add as prod
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleAdd(pkg.name, 'devDependency', overrideValue)}>
                              add as dev
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="mt-2 flex w-full flex-wrap items-center gap-2">
                        <Input
                          placeholder="override version (e.g. 4.7.0 or ^4.7.0)"
                          value={overrideValue}
                          onChange={(event) => setRowVersionOverride(rowKey, event.target.value)}
                          className="h-8 min-w-0 basis-full border-0 bg-muted/40 text-xs shadow-none focus-visible:ring-1 focus-visible:ring-ring/30 sm:basis-[220px] sm:flex-1"
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 shrink-0 rounded-full px-2.5 text-[11px]"
                          onClick={() => setRowVersionOverride(rowKey, pkg.version)}
                        >
                          latest
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 shrink-0 rounded-full px-2.5 text-[11px]"
                          onClick={() => setRowVersionOverride(rowKey, '')}
                        >
                          auto
                        </Button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
            </CommandList>
            {showTopFade && (
              <div className="pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-background to-transparent" />
            )}
            {showBottomFade && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-background to-transparent" />
            )}
          </div>
        </Command>
        <div className="absolute inset-x-0 bottom-0 flex h-10 items-center gap-2 bg-background px-4 text-xs text-muted-foreground">
          <Kbd>
            <CornerDownLeft className="h-3 w-3" />
          </Kbd>
          <span>Add as prod from dropdown</span>
          <Kbd className="ml-2">Esc</Kbd>
          <span>Close</span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
