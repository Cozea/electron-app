import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
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
  Search,
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

// Mock dependencies data
const mockDependencies = [
  { name: 'react', version: '^18.2.0', type: 'dependency' },
  { name: 'react-dom', version: '^18.2.0', type: 'dependency' },
  { name: 'react-router-dom', version: '^6.20.0', type: 'dependency' },
  { name: 'typescript', version: '^5.3.0', type: 'devDependency' },
  { name: 'vite', version: '^5.0.0', type: 'devDependency' },
  { name: 'tailwindcss', version: '^3.4.0', type: 'devDependency' },
]

export function ProjectDependenciesPage() {
  const { slug } = useParams<{ slug: string }>()
  const { currentOrganization } = useAuth()
  const [searchQuery, setSearchQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'dependencies' | 'devDependencies'>('all')
  const [isLoading, setIsLoading] = useState(false)

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

  const filteredDeps = mockDependencies
    .filter((dep) => {
      if (filter === 'dependencies') return dep.type === 'dependency'
      if (filter === 'devDependencies') return dep.type === 'devDependency'
      return true
    })
    .filter((dep) =>
      dep.name.toLowerCase().includes(searchQuery.toLowerCase())
    )

  const prodCount = mockDependencies.filter(d => d.type === 'dependency').length
  const devCount = mockDependencies.filter(d => d.type === 'devDependency').length

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
          <Button variant="ghost" size="sm" onClick={() => setIsLoading(true)}>
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
          <Button size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            Add Package
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {/* Filters and Search */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Button
              variant={filter === 'all' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter('all')}
            >
              All ({mockDependencies.length})
            </Button>
            <Button
              variant={filter === 'dependencies' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter('dependencies')}
            >
              Dependencies ({prodCount})
            </Button>
            <Button
              variant={filter === 'devDependencies' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setFilter('devDependencies')}
            >
              Dev ({devCount})
            </Button>
          </div>

          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search packages..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>

        {/* Dependencies Table */}
        {filteredDeps.length === 0 ? (
          <Card className="p-12 text-center">
            <Package className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <h3 className="text-lg font-medium mb-2">No packages found</h3>
            <p className="text-sm text-muted-foreground">
              {searchQuery ? 'No matching packages.' : 'No dependencies in this project.'}
            </p>
          </Card>
        ) : (
          <Card className="border-0 shadow-none bg-transparent">
            <Table>
              <TableHeader>
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
