import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  GitBranch,
  GitCommit,
  GitPullRequest,
  RefreshCw,
  Loader2,
  Plus,
  Search,
  ChevronRight,
  Clock,
  User,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// Mock branches data
const mockBranches = [
  {
    name: 'main',
    isDefault: true,
    lastCommit: {
      message: 'feat: Add user authentication',
      author: 'John Doe',
      date: Date.now() - 1000 * 60 * 60 * 2, // 2 hours ago
      sha: 'abc1234',
    },
    protected: true,
  },
  {
    name: 'develop',
    isDefault: false,
    lastCommit: {
      message: 'chore: Update dependencies',
      author: 'Jane Smith',
      date: Date.now() - 1000 * 60 * 60 * 24, // 1 day ago
      sha: 'def5678',
    },
    protected: false,
  },
  {
    name: 'feature/user-profile',
    isDefault: false,
    lastCommit: {
      message: 'wip: User profile page',
      author: 'Bob Wilson',
      date: Date.now() - 1000 * 60 * 30, // 30 mins ago
      sha: 'ghi9012',
    },
    protected: false,
  },
]

// Mock commits data
const mockCommits = [
  {
    sha: 'abc1234',
    message: 'feat: Add user authentication',
    author: { name: 'John Doe', avatar: '' },
    date: Date.now() - 1000 * 60 * 60 * 2,
    filesChanged: 8,
  },
  {
    sha: 'xyz7890',
    message: 'fix: Resolve memory leak in WebSocket handler',
    author: { name: 'Jane Smith', avatar: '' },
    date: Date.now() - 1000 * 60 * 60 * 5,
    filesChanged: 3,
  },
  {
    sha: 'def5678',
    message: 'chore: Update dependencies',
    author: { name: 'Jane Smith', avatar: '' },
    date: Date.now() - 1000 * 60 * 60 * 24,
    filesChanged: 2,
  },
  {
    sha: 'mno3456',
    message: 'refactor: Extract utility functions',
    author: { name: 'Bob Wilson', avatar: '' },
    date: Date.now() - 1000 * 60 * 60 * 48,
    filesChanged: 5,
  },
]

export function VersionControlPage() {
  const { slug } = useParams<{ slug: string }>()
  const { currentOrganization } = useAuth()
  const [activeTab, setActiveTab] = useState<'branches' | 'commits'>('branches')
  const [searchQuery, setSearchQuery] = useState('')

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

  const formatTime = (timestamp: number) => {
    const diff = Date.now() - timestamp
    const minutes = Math.floor(diff / 60000)
    if (minutes < 60) return `${minutes}m ago`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  }

  const filteredBranches = mockBranches.filter(
    branch => branch.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const filteredCommits = mockCommits.filter(
    commit => commit.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
              commit.sha.includes(searchQuery.toLowerCase())
  )

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
      <div className="flex items-center justify-between px-4 h-9 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <GitBranch className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-sm font-medium">Version Control</h1>
          <Badge variant="secondary" className="text-xs">
            {mockBranches.length} branches
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button size="sm">
            <Plus className="h-4 w-4 mr-1" />
            New Branch
          </Button>
        </div>
      </div>

      {/* Tabs and Search */}
      <div className="px-4 py-3 border-b border-border flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Button
            variant={activeTab === 'branches' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7"
            onClick={() => setActiveTab('branches')}
          >
            <GitBranch className="h-3 w-3 mr-1" />
            Branches
          </Button>
          <Button
            variant={activeTab === 'commits' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7"
            onClick={() => setActiveTab('commits')}
          >
            <GitCommit className="h-3 w-3 mr-1" />
            Commits
          </Button>
        </div>

        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={activeTab === 'branches' ? 'Search branches...' : 'Search commits...'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8"
          />
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-2">
          {activeTab === 'branches' ? (
            filteredBranches.length === 0 ? (
              <Card className="p-12 text-center">
                <GitBranch className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                <h3 className="text-lg font-medium mb-2">No Branches Found</h3>
                <p className="text-sm text-muted-foreground">
                  No branches match your search.
                </p>
              </Card>
            ) : (
              filteredBranches.map((branch) => (
                <Card key={branch.name} className="p-4 hover:bg-muted/30 transition-colors cursor-pointer">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <GitBranch className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium font-mono text-sm">{branch.name}</span>
                          {branch.isDefault && (
                            <Badge variant="secondary" className="text-xs">default</Badge>
                          )}
                          {branch.protected && (
                            <Badge variant="outline" className="text-xs text-yellow-500 border-yellow-500/30">
                              protected
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                          <span className="font-mono">{branch.lastCommit.sha.slice(0, 7)}</span>
                          <span>·</span>
                          <span className="truncate max-w-[200px]">{branch.lastCommit.message}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <User className="h-3 w-3" />
                        {branch.lastCommit.author}
                      </div>
                      <div className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatTime(branch.lastCommit.date)}
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                </Card>
              ))
            )
          ) : (
            filteredCommits.length === 0 ? (
              <Card className="p-12 text-center">
                <GitCommit className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                <h3 className="text-lg font-medium mb-2">No Commits Found</h3>
                <p className="text-sm text-muted-foreground">
                  No commits match your search.
                </p>
              </Card>
            ) : (
              filteredCommits.map((commit) => (
                <Card key={commit.sha} className="p-4 hover:bg-muted/30 transition-colors cursor-pointer">
                  <div className="flex items-start gap-3">
                    <Avatar className="h-8 w-8 mt-0.5">
                      <AvatarImage src={commit.author.avatar} />
                      <AvatarFallback>
                        {commit.author.name.split(' ').map(n => n[0]).join('')}
                      </AvatarFallback>
                    </Avatar>

                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm">{commit.message}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span className="font-mono">{commit.sha.slice(0, 7)}</span>
                        <span>·</span>
                        <span>{commit.author.name}</span>
                        <span>·</span>
                        <span>{formatTime(commit.date)}</span>
                        <span>·</span>
                        <span>{commit.filesChanged} files changed</span>
                      </div>
                    </div>

                    <Button variant="ghost" size="sm">
                      View
                    </Button>
                  </div>
                </Card>
              ))
            )
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
