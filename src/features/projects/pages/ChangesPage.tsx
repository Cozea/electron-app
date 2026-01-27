import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from 'convex/react'
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { useAuth } from '@/contexts/AuthContext'
import { Card } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import {
  Activity,
  FileText,
  FilePlus,
  FileX,
  Bot,
  User,
  Clock,
  PanelRightClose,
} from 'lucide-react'
import { DiffPanel } from '../components/changes/DiffPanel'

function formatTime(timestamp: number) {
  const diff = Date.now() - timestamp
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function getChangeIcon(changeType: string) {
  switch (changeType) {
    case 'create':
      return <FilePlus className="h-4 w-4 text-green-500" />
    case 'delete':
      return <FileX className="h-4 w-4 text-red-500" />
    case 'modify':
    default:
      return <FileText className="h-4 w-4 text-blue-500" />
  }
}

function getChangeLabel(changeType: string) {
  switch (changeType) {
    case 'create':
      return 'created'
    case 'delete':
      return 'deleted'
    case 'modify':
    default:
      return 'modified'
  }
}

export function ChangesPage() {
  const { slug } = useParams<{ slug: string }>()
  const { currentOrganization } = useAuth()
  const [selectedChangeId, setSelectedChangeId] = useState<Id<"fileChanges"> | null>(null)

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

  // Get activity feed
  const activity = useQuery(
    api.activity.getRecentActivity,
    project?._id ? { projectId: project._id, limit: 100 } : 'skip'
  )

  return (
    <div className="flex h-full">
      {/* Timeline Panel */}
      <div className={`flex flex-col ${selectedChangeId ? 'w-1/2 border-r border-border' : 'w-full'} transition-all`}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-lg font-semibold">Changes</h1>
          </div>
          {selectedChangeId && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <PanelRightClose className="h-3 w-3" />
              Click item to view diff
            </span>
          )}
        </div>

        {/* Timeline Content */}
        <ScrollArea className="flex-1">
          <div className="p-4">
            {!project?._id ? (
              <div className="flex items-center justify-center h-40 text-muted-foreground">
                <p className="text-sm">Loading project...</p>
              </div>
            ) : activity === undefined ? (
              <div className="flex items-center justify-center h-40">
                <div className="animate-pulse text-muted-foreground">Loading activity...</div>
              </div>
            ) : activity.length === 0 ? (
              <Card className="p-12 text-center">
                <Activity className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                <h3 className="text-lg font-medium mb-2">No Changes Yet</h3>
                <p className="text-sm text-muted-foreground">
                  File changes will appear here in real-time as you and your team edit files.
                </p>
              </Card>
            ) : (
              <div className="relative">
                {/* Timeline line */}
                <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />

                {/* Timeline items */}
                <div className="space-y-1">
                  {activity.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => setSelectedChangeId(item.id as Id<"fileChanges">)}
                      className={`
                        relative pl-10 pr-3 py-3 rounded-lg cursor-pointer transition-colors
                        ${selectedChangeId === item.id
                          ? 'bg-primary/10 border border-primary/20'
                          : 'hover:bg-muted/50'
                        }
                      `}
                    >
                      {/* Timeline dot */}
                      <div
                        className="absolute left-2.5 top-4 w-3 h-3 rounded-full border-2 border-background"
                        style={{ backgroundColor: item.userColor }}
                      />

                      {/* Content */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          {/* User and action */}
                          <div className="flex items-center gap-2 mb-1">
                            {item.isAgent ? (
                              <Bot className="h-3.5 w-3.5" style={{ color: item.userColor }} />
                            ) : (
                              <User className="h-3.5 w-3.5" style={{ color: item.userColor }} />
                            )}
                            <span
                              className="font-medium text-sm"
                              style={{ color: item.userColor }}
                            >
                              {item.userName}
                            </span>
                            <span className="text-sm text-muted-foreground">
                              {getChangeLabel(item.changeType)}
                            </span>
                            {getChangeIcon(item.changeType)}
                          </div>

                          {/* File path */}
                          <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded truncate block max-w-full">
                            {item.filePath}
                          </code>

                          {/* Stats */}
                          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                            {item.additions !== undefined && item.additions > 0 && (
                              <span className="text-green-500">+{item.additions}</span>
                            )}
                            {item.deletions !== undefined && item.deletions > 0 && (
                              <span className="text-red-500">-{item.deletions}</span>
                            )}
                            <div className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {formatTime(item.timestamp)}
                            </div>
                            {item.isAgent && (
                              <Badge variant="outline" className="text-[10px] px-1 py-0">
                                AI
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Diff Panel */}
      {selectedChangeId && (
        <div className="w-1/2 bg-background">
          <DiffPanel
            changeId={selectedChangeId}
            onClose={() => setSelectedChangeId(null)}
          />
        </div>
      )}
    </div>
  )
}
