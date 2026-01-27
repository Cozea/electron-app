import { useQuery } from 'convex/react'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import {
  X,
  Bot,
  User,
  Clock,
  FilePlus,
  FileText,
  FileX,
  RotateCcw,
} from 'lucide-react'

interface DiffPanelProps {
  changeId: Id<"fileChanges"> | null
  onClose: () => void
}

function formatTime(timestamp: number) {
  const date = new Date(timestamp)
  return date.toLocaleString()
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

/**
 * Simple diff rendering - shows old and new content side by side
 * For a proper diff view, consider using a library like diff or react-diff-viewer
 */
function renderDiff(oldContent: string, newContent: string, changeType: string) {
  const oldLines = oldContent.split('\n')
  const newLines = newContent.split('\n')

  if (changeType === 'create') {
    return (
      <div className="font-mono text-xs">
        {newLines.map((line, i) => (
          <div key={i} className="flex">
            <span className="w-10 text-right pr-2 text-muted-foreground select-none border-r border-border">
              {i + 1}
            </span>
            <span className="flex-1 pl-2 bg-green-500/10 text-green-400">
              + {line || ' '}
            </span>
          </div>
        ))}
      </div>
    )
  }

  if (changeType === 'delete') {
    return (
      <div className="font-mono text-xs">
        {oldLines.map((line, i) => (
          <div key={i} className="flex">
            <span className="w-10 text-right pr-2 text-muted-foreground select-none border-r border-border">
              {i + 1}
            </span>
            <span className="flex-1 pl-2 bg-red-500/10 text-red-400">
              - {line || ' '}
            </span>
          </div>
        ))}
      </div>
    )
  }

  // For modifications, show a simple unified diff
  // In production, use a proper diff algorithm
  const maxLines = Math.max(oldLines.length, newLines.length)
  const diffLines: Array<{ type: 'same' | 'add' | 'remove'; line: string; lineNum: number }> = []

  for (let i = 0; i < maxLines; i++) {
    const oldLine = oldLines[i]
    const newLine = newLines[i]

    if (oldLine === newLine) {
      if (oldLine !== undefined) {
        diffLines.push({ type: 'same', line: oldLine, lineNum: i + 1 })
      }
    } else {
      if (oldLine !== undefined) {
        diffLines.push({ type: 'remove', line: oldLine, lineNum: i + 1 })
      }
      if (newLine !== undefined) {
        diffLines.push({ type: 'add', line: newLine, lineNum: i + 1 })
      }
    }
  }

  return (
    <div className="font-mono text-xs">
      {diffLines.map((item, i) => (
        <div key={i} className="flex">
          <span className="w-10 text-right pr-2 text-muted-foreground select-none border-r border-border">
            {item.lineNum}
          </span>
          <span
            className={`flex-1 pl-2 ${
              item.type === 'add'
                ? 'bg-green-500/10 text-green-400'
                : item.type === 'remove'
                  ? 'bg-red-500/10 text-red-400'
                  : ''
            }`}
          >
            {item.type === 'add' ? '+ ' : item.type === 'remove' ? '- ' : '  '}
            {item.line || ' '}
          </span>
        </div>
      ))}
    </div>
  )
}

export function DiffPanel({ changeId, onClose }: DiffPanelProps) {
  const change = useQuery(
    api.activity.getChangeWithContent,
    changeId ? { changeId } : 'skip'
  )

  if (!changeId) return null

  if (change === undefined) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Loading diff...</div>
      </div>
    )
  }

  if (!change) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-muted-foreground">Change not found</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          {getChangeIcon(change.changeType)}
          <div>
            <code className="text-sm font-mono">{change.filePath}</code>
            <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
              {change.isAgent ? (
                <Bot className="h-3 w-3" style={{ color: change.userColor }} />
              ) : (
                <User className="h-3 w-3" style={{ color: change.userColor }} />
              )}
              <span style={{ color: change.userColor }}>{change.userName}</span>
              <span>·</span>
              <Clock className="h-3 w-3" />
              <span>{formatTime(change.timestamp)}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Future: Revert button */}
          <Button variant="ghost" size="sm" disabled title="Revert (coming soon)">
            <RotateCcw className="h-4 w-4 mr-1.5" />
            Revert
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-border bg-muted/30">
        {change.additions !== undefined && change.additions > 0 && (
          <Badge variant="outline" className="text-green-500 border-green-500/30">
            +{change.additions} additions
          </Badge>
        )}
        {change.deletions !== undefined && change.deletions > 0 && (
          <Badge variant="outline" className="text-red-500 border-red-500/30">
            -{change.deletions} deletions
          </Badge>
        )}
        {change.totalLines !== undefined && (
          <span className="text-xs text-muted-foreground">
            {change.totalLines} total lines
          </span>
        )}
        {change.isAgent && (
          <Badge variant="secondary">AI Agent</Badge>
        )}
      </div>

      {/* Diff Content */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          {change.oldContent === '' && change.newContent === '' ? (
            <div className="text-center text-muted-foreground py-8">
              <p>No content stored for this change.</p>
              <p className="text-xs mt-1">Older changes may not have diff data.</p>
            </div>
          ) : (
            renderDiff(change.oldContent, change.newContent, change.changeType)
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
