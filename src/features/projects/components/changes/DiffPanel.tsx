import { useCallback, useDeferredValue, useEffect, useRef, useState } from 'react'
import { useQuery, useMutation } from 'convex/react'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Shimmer } from '@/components/ai-elements/shimmer'
import { getFileIcon } from '@/lib/fileExplorer/fileIcons'
import { X, Bold, Italic, Underline, Link2, Smile, Minus, Plus, Asterisk } from 'lucide-react'
import { CodeMirrorMergeViewer } from './CodeMirrorMergeViewer'
import { CommentRichText } from '@/components/comments/CommentRichText'

interface DiffPanelProps {
  changeId: Id<"fileChanges"> | null
  onClose: () => void
  showHeader?: boolean
}

interface ChangeWithContent {
  id: Id<"fileChanges">
  filePath: string
  changeType: "create" | "modify" | "delete" | "rename"
  oldContent: string
  newContent: string
  additions?: number
  deletions?: number
  totalLines?: number
  origin: "user" | "agent" | "remote" | "init"
  userName: string
  userColor: string
  userImage?: string
  isAgent: boolean
  timestamp: number
}

function formatRelativeTime(timestamp: number) {
  const now = Date.now()
  const diff = now - timestamp
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return new Date(timestamp).toLocaleDateString()
}

function getChangeIcon(changeType: string) {
  const baseClasses = 'h-4 w-4'
  switch (changeType) {
    case 'create':
      return (
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-secondary">
          <Plus className={`${baseClasses} text-green-500`} />
        </span>
      )
    case 'delete':
      return (
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-secondary">
          <Minus className={`${baseClasses} text-red-500`} />
        </span>
      )
    case 'modify':
    default:
      return (
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-secondary">
          <Asterisk className={`${baseClasses} text-amber-500`} />
        </span>
      )
  }
}

// Extract relative path from full file path (strips local machine paths)
function getRelativePath(filePath: string): string {
  // Common project root directories to look for
  const rootMarkers = ['src/', 'app/', 'lib/', 'components/', 'pages/', 'convex/', 'electron/', 'public/', 'test/', 'tests/', '__tests__/']

  // Find the earliest occurrence of any root marker
  let earliestIndex = -1
  for (const marker of rootMarkers) {
    const index = filePath.indexOf(marker)
    if (index !== -1 && (earliestIndex === -1 || index < earliestIndex)) {
      earliestIndex = index
    }
  }

  if (earliestIndex !== -1) {
    return filePath.slice(earliestIndex)
  }

  // Fallback: look for the last path segment that looks like a project folder
  // (contains node_modules sibling or common config files pattern)
  const parts = filePath.split('/')

  // Find index after common non-project directories
  const skipDirs = ['Users', 'home', 'Documents', 'Coding', 'Projects', 'Desktop', 'Downloads']
  let startIndex = 0
  for (let i = 0; i < parts.length; i++) {
    if (skipDirs.includes(parts[i])) {
      startIndex = i + 1
    }
  }

  // Skip one more (likely the project folder name itself) if we have enough parts
  if (startIndex < parts.length - 1) {
    startIndex++
  }

  return parts.slice(startIndex).join('/') || filePath
}

export function DiffPanel({ changeId, onClose, showHeader = true }: DiffPanelProps) {
  const { convexUserId } = useAuth()
  const [commentText, setCommentText] = useState('')
  const deferredCommentText = useDeferredValue(commentText)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showTopFade, setShowTopFade] = useState(false)
  const [showBottomFade, setShowBottomFade] = useState(true)
  const [cachedChange, setCachedChange] = useState<ChangeWithContent | null>(null)
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const composerPreviewRef = useRef<HTMLDivElement | null>(null)
  const handleScrollStateChange = useCallback(({ atTop, atBottom }: { atTop: boolean; atBottom: boolean }) => {
    setShowTopFade(!atTop)
    setShowBottomFade(!atBottom)
  }, [])

  const syncComposerScroll = useCallback(() => {
    const textarea = composerTextareaRef.current
    const preview = composerPreviewRef.current
    if (!textarea || !preview) return
    preview.scrollTop = textarea.scrollTop
    preview.scrollLeft = textarea.scrollLeft
  }, [])

  useEffect(() => {
    setShowTopFade(false)
    setShowBottomFade(true)
  }, [changeId])

  useEffect(() => {
    setCommentText('')
  }, [changeId])

  const change = useQuery(
    api.activity.getChangeWithContent,
    changeId ? { changeId } : 'skip'
  ) as ChangeWithContent | null | undefined
  const displayedChange = change ?? cachedChange
  const isSwitchingDiff = change === undefined && cachedChange !== null

  const addComment = useMutation(api.activity.addComment)

  useEffect(() => {
    if (!changeId) {
      setCachedChange(null)
      return
    }

    if (change) {
      setCachedChange(change)
      return
    }

    if (change === null) {
      setCachedChange(null)
    }
  }, [change, changeId])

  const handleSubmitComment = async () => {
    if (!commentText.trim() || !changeId || !convexUserId) return

    setIsSubmitting(true)
    try {
      await addComment({
        changeId,
        userId: convexUserId,
        content: commentText.trim(),
      })
      setCommentText('')
    } catch (error) {
      console.error('Failed to add comment:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleSubmitComment()
    }
  }

  const applyWrapFormatting = useCallback(
    (prefix: string, suffix: string) => {
      const textarea = composerTextareaRef.current
      if (!textarea) return

      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const selected = commentText.slice(start, end)

      const nextText =
        commentText.slice(0, start) +
        prefix +
        selected +
        suffix +
        commentText.slice(end)

      setCommentText(nextText)

      window.requestAnimationFrame(() => {
        textarea.focus()
        if (selected.length > 0) {
          textarea.setSelectionRange(start + prefix.length, end + prefix.length)
          return
        }
        const cursor = start + prefix.length
        textarea.setSelectionRange(cursor, cursor)
      })
    },
    [commentText]
  )

  const insertTextAtCursor = useCallback(
    (text: string) => {
      const textarea = composerTextareaRef.current
      if (!textarea) return

      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const nextText = commentText.slice(0, start) + text + commentText.slice(end)
      setCommentText(nextText)

      window.requestAnimationFrame(() => {
        textarea.focus()
        const cursor = start + text.length
        textarea.setSelectionRange(cursor, cursor)
      })
    },
    [commentText]
  )

  const handleLinkInsert = useCallback(() => {
    const textarea = composerTextareaRef.current
    if (!textarea) return

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selected = commentText.slice(start, end).trim() || 'link'
    const rawUrl = window.prompt('Enter link URL')
    if (!rawUrl) return
    const normalizedUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`

    const linkText = `[${selected}](${normalizedUrl})`
    const nextText = commentText.slice(0, start) + linkText + commentText.slice(end)
    setCommentText(nextText)

    window.requestAnimationFrame(() => {
      textarea.focus()
      const cursor = start + linkText.length
      textarea.setSelectionRange(cursor, cursor)
    })
  }, [commentText])

  useEffect(() => {
    syncComposerScroll()
  }, [commentText, syncComposerScroll])

  if (!changeId) return null

  if (!displayedChange && change === undefined) {
    return (
      <div className="h-full flex items-center justify-center">
        <Shimmer className="text-sm text-muted-foreground">Loading diff preview...</Shimmer>
      </div>
    )
  }

  if (!displayedChange) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-muted-foreground">Change not found</p>
      </div>
    )
  }

  const fileName = displayedChange.filePath.split('/').pop() || displayedChange.filePath
  const displayPath = getRelativePath(displayedChange.filePath)

  return (
    <div className="relative flex flex-col h-full bg-background">
      {showHeader && (
        <div className="flex items-center gap-3 px-4 h-12 bg-sidebar">
          {/* File info - flexible */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {getChangeIcon(displayedChange.changeType)}
            {getFileIcon(fileName, { width: 16, height: 16 })}
            <code className="text-sm font-mono truncate">{displayPath}</code>
          </div>

          {/* Author & time */}
          <div className="flex items-center gap-2 shrink-0">
            {displayedChange.userImage ? (
              <img
                src={displayedChange.userImage}
                alt={displayedChange.userName}
                className="w-5 h-5 rounded-full object-cover"
                title={displayedChange.userName}
              />
            ) : (
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium text-white"
                style={{ backgroundColor: displayedChange.userColor }}
                title={displayedChange.userName}
              >
                {displayedChange.userName?.charAt(0).toUpperCase() || 'U'}
              </div>
            )}
            <span className="text-xs text-muted-foreground">{formatRelativeTime(displayedChange.timestamp)}</span>
          </div>

          {/* Close button */}
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 shrink-0">
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Diff Content */}
      <div className="flex-1 min-h-0 overflow-hidden relative">
        {/* Top fade gradient */}
        <div className={`absolute top-0 left-0 right-0 h-12 bg-gradient-to-b from-sidebar to-transparent z-10 pointer-events-none transition-opacity ${showTopFade ? 'opacity-100' : 'opacity-0'}`} />
        {/* Bottom fade gradient */}
        <div className={`absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-sidebar to-transparent z-10 pointer-events-none transition-opacity ${showBottomFade ? 'opacity-100' : 'opacity-0'}`} />
        {displayedChange.oldContent === '' && displayedChange.newContent === '' ? (
          <div className="flex items-center justify-center h-full text-center text-muted-foreground py-8">
            <div>
              <p>No content stored for this change.</p>
              <p className="text-xs mt-1">Older changes may not have diff data.</p>
            </div>
          </div>
        ) : (
          <CodeMirrorMergeViewer
            original={displayedChange.oldContent}
            modified={displayedChange.newContent}
            filePath={displayedChange.filePath}
            onScrollStateChange={handleScrollStateChange}
            className="h-full"
          />
        )}
      </div>

      {/* Comment Input */}
      <div className="p-4 bg-sidebar">
        <div className="rounded-xl border border-primary/30 bg-background overflow-hidden shadow-sm">
          {/* Text Input */}
          <div className="relative min-h-[80px]">
            <div
              ref={composerPreviewRef}
              className="pointer-events-none absolute inset-0 overflow-auto px-3 py-2"
            >
              {deferredCommentText.length > 0 ? (
                <CommentRichText
                  content={deferredCommentText}
                  className="text-sm text-foreground min-h-[64px]"
                />
              ) : (
                <span className="text-sm text-muted-foreground">Add comment</span>
              )}
            </div>
            <Textarea
              ref={composerTextareaRef}
              placeholder="Add comment"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              onKeyDown={handleKeyDown}
              onScroll={syncComposerScroll}
              className="min-h-[80px] resize-none border-0 bg-transparent text-transparent caret-foreground selection:bg-primary/20 focus-visible:ring-0 focus-visible:ring-offset-0 rounded-none placeholder:text-transparent"
              disabled={isSubmitting || isSwitchingDiff}
            />
          </div>

          {/* Toolbar */}
          <div className="flex items-center justify-between px-3 py-2">
            <div className="flex items-center gap-1">
              {/* Formatting buttons */}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={() => applyWrapFormatting('**', '**')}
                disabled={isSubmitting || isSwitchingDiff}
                aria-label="Bold"
              >
                <Bold className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={() => applyWrapFormatting('*', '*')}
                disabled={isSubmitting || isSwitchingDiff}
                aria-label="Italic"
              >
                <Italic className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={() => applyWrapFormatting('<u>', '</u>')}
                disabled={isSubmitting || isSwitchingDiff}
                aria-label="Underline"
              >
                <Underline className="h-4 w-4" />
              </Button>

              {/* Separator */}
              <div className="w-px h-5 bg-border mx-1" />

              {/* Link and emoji */}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={handleLinkInsert}
                disabled={isSubmitting || isSwitchingDiff}
                aria-label="Insert link"
              >
                <Link2 className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={() => insertTextAtCursor('😄')}
                disabled={isSubmitting || isSwitchingDiff}
                aria-label="Insert emoji"
              >
                <Smile className="h-4 w-4" />
              </Button>
            </div>

            {/* Send button */}
            <Button
              onClick={handleSubmitComment}
              disabled={!commentText.trim() || isSubmitting || !convexUserId || isSwitchingDiff}
              size="sm"
              className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-full px-4"
            >
              Send
            </Button>
          </div>
        </div>
      </div>
      {isSwitchingDiff && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/40 backdrop-blur-[1px]">
          <Shimmer className="text-sm text-muted-foreground">Loading selected diff...</Shimmer>
        </div>
      )}
    </div>
  )
}
