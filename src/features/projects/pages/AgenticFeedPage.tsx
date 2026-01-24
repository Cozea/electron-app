import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Cpu,
  RefreshCw,
  Loader2,
  FileText,
  Terminal,
  CheckCircle,
  XCircle,
  Clock,
  Bot,
  MessageSquare,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// Mock feed items
const mockFeedItems = [
  {
    id: '1',
    type: 'file',
    source: 'builder',
    status: 'success',
    title: 'Created src/App.tsx',
    description: 'Generated main application component',
    timestamp: Date.now() - 1000 * 60 * 5, // 5 min ago
  },
  {
    id: '2',
    type: 'command',
    source: 'builder',
    status: 'success',
    title: 'npm install',
    description: 'Installed project dependencies',
    timestamp: Date.now() - 1000 * 60 * 10, // 10 min ago
  },
  {
    id: '3',
    type: 'file',
    source: 'chat',
    status: 'success',
    title: 'Modified src/components/Header.tsx',
    description: 'Added responsive navigation menu',
    timestamp: Date.now() - 1000 * 60 * 30, // 30 min ago
  },
  {
    id: '4',
    type: 'command',
    source: 'builder',
    status: 'error',
    title: 'npm run build',
    description: 'Build failed: Type error in utils.ts',
    timestamp: Date.now() - 1000 * 60 * 60, // 1 hour ago
  },
]

export function AgenticFeedPage() {
  const { slug } = useParams<{ slug: string }>()
  const { currentOrganization } = useAuth()
  const [sourceFilter, setSourceFilter] = useState<'all' | 'builder' | 'chat'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'error' | 'running'>('all')

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

  const filteredItems = mockFeedItems
    .filter(item => sourceFilter === 'all' || item.source === sourceFilter)
    .filter(item => statusFilter === 'all' || item.status === statusFilter)

  const formatTime = (timestamp: number) => {
    const diff = Date.now() - timestamp
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    return `${Math.floor(hours / 24)}d ago`
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="h-4 w-4 text-green-500" />
      case 'error':
        return <XCircle className="h-4 w-4 text-red-500" />
      case 'running':
        return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />
      default:
        return <Clock className="h-4 w-4 text-muted-foreground" />
    }
  }

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'file':
        return <FileText className="h-4 w-4" />
      case 'command':
        return <Terminal className="h-4 w-4" />
      default:
        return <Cpu className="h-4 w-4" />
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
          <Cpu className="h-4 w-4 text-muted-foreground" />
          <h1 className="text-sm font-medium">Agentic Feed</h1>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="px-4 py-3 border-b border-border flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Source:</span>
          <Button
            variant={sourceFilter === 'all' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7"
            onClick={() => setSourceFilter('all')}
          >
            All
          </Button>
          <Button
            variant={sourceFilter === 'builder' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 gap-1"
            onClick={() => setSourceFilter('builder')}
          >
            <Bot className="h-3 w-3" />
            Builder
          </Button>
          <Button
            variant={sourceFilter === 'chat' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7 gap-1"
            onClick={() => setSourceFilter('chat')}
          >
            <MessageSquare className="h-3 w-3" />
            Chat
          </Button>
        </div>

        <div className="w-px h-4 bg-border" />

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Status:</span>
          <Button
            variant={statusFilter === 'all' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7"
            onClick={() => setStatusFilter('all')}
          >
            All
          </Button>
          <Button
            variant={statusFilter === 'success' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7"
            onClick={() => setStatusFilter('success')}
          >
            Success
          </Button>
          <Button
            variant={statusFilter === 'error' ? 'secondary' : 'ghost'}
            size="sm"
            className="h-7"
            onClick={() => setStatusFilter('error')}
          >
            Error
          </Button>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-3">
          {filteredItems.length === 0 ? (
            <Card className="p-12 text-center">
              <Cpu className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
              <h3 className="text-lg font-medium mb-2">No Activity</h3>
              <p className="text-sm text-muted-foreground">
                No agentic actions match your filters.
              </p>
            </Card>
          ) : (
            filteredItems.map((item) => (
              <Card key={item.id} className="p-4">
                <div className="flex items-start gap-3">
                  <div className={cn(
                    "p-2 rounded-lg",
                    item.status === 'success' && "bg-green-500/10",
                    item.status === 'error' && "bg-red-500/10",
                    item.status === 'running' && "bg-blue-500/10",
                  )}>
                    {getTypeIcon(item.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm">{item.title}</span>
                      {getStatusIcon(item.status)}
                    </div>
                    <p className="text-sm text-muted-foreground">{item.description}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant="outline" className="text-xs">
                        {item.source}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatTime(item.timestamp)}
                      </span>
                    </div>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
