import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useOptionalProjectSyncContext } from '../contexts/ProjectSyncContext'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Package,
  RefreshCw,
  Plus,
  Loader2,
  ArrowUp,
  Trash2,
  MoreHorizontal,
  Box,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ButtonGroup } from '@/components/ui/button-group'

interface Dependency {
  name: string
  version: string
  type: 'dependency' | 'devDependency'
}

export function ProjectDependenciesPage() {
  const { slug } = useParams<{ slug: string }>()
  const { currentOrganization } = useAuth()
  const syncContext = useOptionalProjectSyncContext()
  const projectPath = syncContext?.projectPath ?? null
  const [filter, setFilter] = useState<'all' | 'dependencies' | 'devDependencies'>('all')
  const [isLoading, setIsLoading] = useState(false)
  const [dependencies, setDependencies] = useState<Dependency[]>([])
  const [error, setError] = useState<string | null>(null)

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

  const loadDependencies = useCallback(async () => {
    if (!projectPath) return

    setIsLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.project.readFile({
        projectPath,
        filePath: 'package.json',
      })

      if (result.success && result.content) {
        try {
          const pkg = JSON.parse(result.content)
          const deps: Dependency[] = []

          if (pkg.dependencies) {
            Object.entries(pkg.dependencies).forEach(([name, version]) => {
              deps.push({ name, version: version as string, type: 'dependency' })
            })
          }

          if (pkg.devDependencies) {
            Object.entries(pkg.devDependencies).forEach(([name, version]) => {
              deps.push({ name, version: version as string, type: 'devDependency' })
            })
          }

          // Sort alphabetically
          deps.sort((a, b) => a.name.localeCompare(b.name))
          setDependencies(deps)
        } catch (e) {
          setError('Failed to parse package.json')
          console.error('Failed to parse package.json', e)
        }
      } else {
        setError('package.json not found')
        setDependencies([])
      }
    } catch (err) {
      setError('Failed to read package.json')
      console.error('Failed to read package.json', err)
    } finally {
      setIsLoading(false)
    }
  }, [projectPath])

  // Initial load
  useEffect(() => {
    if (projectPath) {
      loadDependencies()
    }
  }, [projectPath, loadDependencies])

  const filteredDeps = dependencies.filter((dep) => {
    if (filter === 'dependencies') return dep.type === 'dependency'
    if (filter === 'devDependencies') return dep.type === 'devDependency'
    return true
  })

  const prodCount = dependencies.filter(d => d.type === 'dependency').length
  const devCount = dependencies.filter(d => d.type === 'devDependency').length

  if (project === undefined) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2 bg-background/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Box className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-sm font-medium">Dependencies</h1>
        </div>

        <div className="flex items-center gap-2">
          <ButtonGroup>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2 rounded-r-none border-r-0">
                  <Package className="h-3.5 w-3.5" />
                  {filter === 'all' ? `All (${dependencies.length})` : filter === 'dependencies' ? `Dependencies (${prodCount})` : `Dev (${devCount})`}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setFilter('all')}>All ({dependencies.length})</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setFilter('dependencies')}>Dependencies ({prodCount})</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setFilter('devDependencies')}>Dev ({devCount})</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="outline"
              size="sm"
              onClick={loadDependencies}
              disabled={isLoading}
              className="rounded-l-none px-2"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </Button>
          </ButtonGroup>
          <Button size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            Add Package
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">

        {/* Error State */}
        {error && (
          <Card className="p-4 mb-6 border-destructive/50 bg-destructive/10 text-destructive text-sm text-center">
            {error}
          </Card>
        )}

        {/* Dependencies Table */}
        {filteredDeps.length === 0 ? (
          <Card className="p-12 text-center">
            <Package className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <h3 className="text-lg font-medium mb-2">No packages found</h3>
            <p className="text-sm text-muted-foreground">
              No dependencies found in package.json.
            </p>
          </Card>
        ) : (
          <Card className="border-0 shadow-none bg-transparent">
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10">
                <TableRow>
                  <TableHead className="w-[350px]">Package</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right w-[80px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDeps.map((dep) => (
                  <TableRow key={dep.name}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Package className="h-4 w-4 text-muted-foreground" />
                        {dep.name}
                      </div>
                    </TableCell>
                    <TableCell>
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                        {dep.version}
                      </code>
                    </TableCell>
                    <TableCell>
                      <Badge variant={dep.type === 'dependency' ? 'default' : 'secondary'}>
                        {dep.type === 'dependency' ? 'prod' : 'dev'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem>
                            <ArrowUp className="h-4 w-4 mr-2" />
                            Update to Latest
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive">
                            <Trash2 className="h-4 w-4 mr-2" />
                            Uninstall
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
    </div>
  )
}
