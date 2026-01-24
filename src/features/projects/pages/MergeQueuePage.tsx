import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  GitMerge,
  RefreshCw,
  Loader2,
  GitPullRequest,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  MessageSquare,
  FileText,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// Mock pull requests
const mockPRs = [
  {
    id: '1',
    number: 42,
    title: 'feat: Add user authentication',
    status: 'approved',
    riskLevel: 'low',
    author: { name: 'John Doe', avatar: '' },
    targetBranch: 'main',
    comments: 3,
    filesChanged: 8,
    additions: 245,
    deletions: 12,
    createdAt: Date.now() - 1000 * 60 * 60 * 2, // 2 hours ago
  },
  {
    id: '2',
    number: 41,
    title: 'fix: Resolve memory leak in WebSocket handler',
    status: 'changes_requested',
    riskLevel: 'medium',
    author: { name: 'Jane Smith', avatar: '' },
    targetBranch: 'main',
    comments: 7,
    filesChanged: 3,
    additions: 45,
    deletions: 23,
    createdAt: Date.now() - 1000 * 60 * 60 * 24, // 1 day ago
  },
  {
    id: '3',
    number: 40,
    title: 'refactor: Database migration scripts',
    status: 'open',
    riskLevel: 'high',
    author: { name: 'Bob Wilson', avatar: '' },
    targetBranch: 'develop',
    comments: 12,
    filesChanged: 15,
    additions: 520,
    deletions: 380,
    createdAt: Date.now() - 1000 * 60 * 60 * 48, // 2 days ago
  },
]

export function MergeQueuePage() {
  const { slug } = useParams<{ slug: string }>()
  const { currentOrganization } = useAuth()
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'approved' | 'changes_requested'>('all')

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

  const filteredPRs = mockPRs.filter(
    pr => statusFilter === 'all' || pr.status === statusFilter
  )

  const formatTime = (timestamp: number) => {
    const diff = Date.now() - timestamp
    const hours = Math.floor(diff / 3600000)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    return `${days}d ago`
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'approved':
        return (
          <Badge className="bg-green-500/10 text-green-500 hover:bg-green-500/20">
            <CheckCircle className="h-3 w-3 mr-1" />
            Approved
          </Badge>
        )
      case 'changes_requested':
        return (
          <Badge className="bg-orange-500/10 text-orange-500 hover:bg-orange-500/20">
            <XCircle className="h-3 w-3 mr-1" />
            Changes
          </Badge>
        )
      case 'open':
        return (
          <Badge className="bg-blue-500/10 text-blue-500 hover:bg-blue-500/20">
            <Clock className="h-3 w-3 mr-1" />
            Open
          </Badge>
        )
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  const getRiskBadge = (risk: string) => {
    switch (risk) {
      case 'low':
        return <Badge variant="outline" className="text-green-500 border-green-500/30">Low Risk</Badge>
      case 'medium':
        return <Badge variant="outline" className="text-yellow-500 border-yellow-500/30">Medium Risk</Badge>
      case 'high':
        return <Badge variant="outline" className="text-red-500 border-red-500/30">High Risk</Badge>
      default:
        return null
    }
  }

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
          <GitMerge className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-sm font-medium">Merge Queue</h1>
          <Badge variant="secondary" className="text-xs">
            {mockPRs.length} PRs
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="px-4 py-3 border-b border-border flex items-center gap-2">
        <Button
          variant={statusFilter === 'all' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7"
          onClick={() => setStatusFilter('all')}
        >
          All ({mockPRs.length})
        </Button>
        <Button
          variant={statusFilter === 'open' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7"
          onClick={() => setStatusFilter('open')}
        >
          Open
        </Button>
        <Button
          variant={statusFilter === 'approved' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7"
          onClick={() => setStatusFilter('approved')}
        >
          Approved
        </Button>
        <Button
          variant={statusFilter === 'changes_requested' ? 'secondary' : 'ghost'}
          size="sm"
          className="h-7"
          onClick={() => setStatusFilter('changes_requested')}
        >
          Changes Requested
        </Button>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-3">
          {filteredPRs.length === 0 ? (
            <Card className="p-12 text-center">
              <GitPullRequest className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h3 className="text-lg font-medium mb-2">No Pull Requests</h3>
              <p className="text-sm text-muted-foreground">
                No pull requests match your filters.
              </p>
            </Card>
          ) : (
            filteredPRs.map((pr) => (
              <Card key={pr.id} className="p-4 hover:bg-muted/30 transition-colors cursor-pointer">
                <div className="flex items-start gap-4">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={pr.author.avatar} />
                    <AvatarFallback>
                      {pr.author.name.split(' ').map(n => n[0]).join('')}
                    </AvatarFallback>
                  </Avatar>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium">#{pr.number}</span>
                      <span className="font-medium truncate">{pr.title}</span>
                    </div>

                    <div className="flex items-center gap-3 text-sm text-muted-foreground mb-2">
                      <span>{pr.author.name}</span>
                      <span>into {pr.targetBranch}</span>
                      <span>{formatTime(pr.createdAt)}</span>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      {getStatusBadge(pr.status)}
                      {getRiskBadge(pr.riskLevel)}

                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MessageSquare className="h-3 w-3" />
                        {pr.comments}
                      </div>

                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <FileText className="h-3 w-3" />
                        {pr.filesChanged} files
                      </div>

                      <span className="text-xs text-green-500">+{pr.additions}</span>
                      <span className="text-xs text-red-500">-{pr.deletions}</span>
                    </div>
                  </div>

                  <Button size="sm" variant="outline">
                    Review
                  </Button>
                </div>
              </Card>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
