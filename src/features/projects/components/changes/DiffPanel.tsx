import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useMutation } from 'convex/react'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Shimmer } from '@/components/ai-elements/shimmer'
import { getFileIcon } from '@/lib/fileExplorer/fileIcons'
import { cn } from '@/lib/utils'
import { X, Bold, Italic, Underline, Link2, Smile, Minus, Plus, Asterisk } from 'lucide-react'
import { CodeMirrorMergeViewer } from './CodeMirrorMergeViewer'

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

function convertEditorNodeToMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? ""
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return ""
  }

  const element = node as HTMLElement
  const tagName = element.tagName.toLowerCase()
  const childrenText = Array.from(element.childNodes)
    .map((childNode) => convertEditorNodeToMarkdown(childNode))
    .join("")

  switch (tagName) {
    case "strong":
    case "b":
      return childrenText.length > 0 ? `**${childrenText}**` : ""
    case "em":
    case "i":
      return childrenText.length > 0 ? `*${childrenText}*` : ""
    case "u":
      return childrenText.length > 0 ? `<u>${childrenText}</u>` : ""
    case "a": {
      const rawHref = element.getAttribute("href")?.trim()
      const label = childrenText.trim().length > 0 ? childrenText : rawHref ?? ""
      if (!rawHref) return label
      return `[${label}](${rawHref})`
    }
    case "br":
      return "\n"
    case "div":
    case "p":
    case "li":
      return `${childrenText}\n`
    default:
      return childrenText
  }
}

function getMarkdownFromEditor(editor: HTMLElement | null): string {
  if (!editor) return ""

  const markdown = Array.from(editor.childNodes)
    .map((childNode) => convertEditorNodeToMarkdown(childNode))
    .join("")

  return markdown
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

interface ComposerFormatState {
  bold: boolean
  italic: boolean
  underline: boolean
  link: boolean
}

export function DiffPanel({ changeId, onClose, showHeader = true }: DiffPanelProps) {
  const { convexUserId } = useAuth()
  const [commentText, setCommentText] = useState('')
  const [isComposerFocused, setIsComposerFocused] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showTopFade, setShowTopFade] = useState(false)
  const [showBottomFade, setShowBottomFade] = useState(true)
  const [cachedChange, setCachedChange] = useState<ChangeWithContent | null>(null)
  const [activeFormats, setActiveFormats] = useState<ComposerFormatState>({
    bold: false,
    italic: false,
    underline: false,
    link: false,
  })
  const composerEditorRef = useRef<HTMLDivElement | null>(null)
  const handleScrollStateChange = useCallback(({ atTop, atBottom }: { atTop: boolean; atBottom: boolean }) => {
    setShowTopFade(!atTop)
    setShowBottomFade(!atBottom)
  }, [])

  useEffect(() => {
    setShowTopFade(false)
    setShowBottomFade(true)
  }, [changeId])

  useEffect(() => {
    setCommentText('')
    setIsComposerFocused(false)
    setActiveFormats({
      bold: false,
      italic: false,
      underline: false,
      link: false,
    })
    if (composerEditorRef.current) {
      composerEditorRef.current.innerHTML = ''
    }
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
    const serializedComment = getMarkdownFromEditor(composerEditorRef.current)
    if (!serializedComment.trim() || !changeId || !convexUserId) return

    setIsSubmitting(true)
    try {
      await addComment({
        changeId,
        userId: convexUserId,
        content: serializedComment.trim(),
      })
      setCommentText('')
      setIsComposerFocused(false)
      if (composerEditorRef.current) {
        composerEditorRef.current.innerHTML = ''
      }
    } catch (error) {
      console.error('Failed to add comment:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const syncCommentTextFromEditor = useCallback(() => {
    setCommentText(getMarkdownFromEditor(composerEditorRef.current))
  }, [])

  const syncActiveFormats = useCallback(() => {
    const editor = composerEditorRef.current
    const selection = window.getSelection()
    if (!editor || !selection || selection.rangeCount === 0) {
      setActiveFormats({
        bold: false,
        italic: false,
        underline: false,
        link: false,
      })
      return
    }

    const range = selection.getRangeAt(0)
    const startNode = range.startContainer
    const endNode = range.endContainer
    const isSelectionInsideEditor =
      (startNode === editor || editor.contains(startNode)) &&
      (endNode === editor || editor.contains(endNode))

    if (!isSelectionInsideEditor) {
      setActiveFormats({
        bold: false,
        italic: false,
        underline: false,
        link: false,
      })
      return
    }

    const selectionElement =
      startNode.nodeType === Node.ELEMENT_NODE
        ? (startNode as Element)
        : startNode.parentElement

    const readCommandState = (command: 'bold' | 'italic' | 'underline') => {
      try {
        return document.queryCommandState(command)
      } catch {
        return false
      }
    }

    const nextState: ComposerFormatState = {
      bold: readCommandState('bold'),
      italic: readCommandState('italic'),
      underline: readCommandState('underline'),
      link: Boolean(selectionElement?.closest('a')),
    }

    setActiveFormats((current) => {
      if (
        current.bold === nextState.bold &&
        current.italic === nextState.italic &&
        current.underline === nextState.underline &&
        current.link === nextState.link
      ) {
        return current
      }
      return nextState
    })
  }, [])

  useEffect(() => {
    const handleSelectionChange = () => {
      syncActiveFormats()
    }
    document.addEventListener('selectionchange', handleSelectionChange)
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange)
    }
  }, [syncActiveFormats])

  const focusComposerEditor = useCallback(() => {
    const editor = composerEditorRef.current
    if (!editor) return null
    editor.focus()
    return editor
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void handleSubmitComment()
    }
  }

  const applyInlineFormatting = useCallback(
    (command: 'bold' | 'italic' | 'underline') => {
      const editor = focusComposerEditor()
      if (!editor) return

      document.execCommand(command)
      setCommentText(getMarkdownFromEditor(editor))
      syncActiveFormats()
    },
    [focusComposerEditor, syncActiveFormats]
  )

  const insertTextAtCursor = useCallback(
    (text: string) => {
      const editor = focusComposerEditor()
      if (!editor) return

      const inserted = document.execCommand('insertText', false, text)
      if (!inserted) {
        const selection = window.getSelection()
        if (!selection || selection.rangeCount === 0) return

        const range = selection.getRangeAt(0)
        range.deleteContents()
        const textNode = document.createTextNode(text)
        range.insertNode(textNode)
        range.setStartAfter(textNode)
        range.collapse(true)
        selection.removeAllRanges()
        selection.addRange(range)
      }

      setCommentText(getMarkdownFromEditor(editor))
      syncActiveFormats()
    },
    [focusComposerEditor, syncActiveFormats]
  )

  const handleLinkInsert = useCallback(() => {
    const editor = focusComposerEditor()
    if (!editor) return

    const rawUrl = window.prompt('Enter link URL')
    if (!rawUrl) return

    const normalizedUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`
    const escapedUrl = normalizedUrl.replace(/"/g, '&quot;')
    const selection = window.getSelection()
    const hasSelectedText = Boolean(
      selection &&
        selection.rangeCount > 0 &&
        !selection.getRangeAt(0).collapsed &&
        selection.toString().trim().length > 0
    )

    if (hasSelectedText) {
      document.execCommand('createLink', false, normalizedUrl)
    } else {
      document.execCommand(
        'insertHTML',
        false,
        `<a href="${escapedUrl}" target="_blank" rel="noreferrer noopener">${normalizedUrl}</a>`
      )
    }

    setCommentText(getMarkdownFromEditor(editor))
    syncActiveFormats()
  }, [focusComposerEditor, syncActiveFormats])

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
  const isComposerLocked = isSubmitting || isSwitchingDiff

  return (
    <div className="relative flex flex-col h-full bg-background [--cm-merge-gutter-bg:var(--background)]">
      {showHeader && (
        <div className="flex items-center gap-3 px-4 h-12 bg-background">
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
        <div className={`absolute top-0 left-0 right-0 h-12 bg-gradient-to-b from-background to-transparent z-10 pointer-events-none transition-opacity ${showTopFade ? 'opacity-100' : 'opacity-0'}`} />
        {/* Bottom fade gradient */}
        <div className={`absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-background to-transparent z-10 pointer-events-none transition-opacity ${showBottomFade ? 'opacity-100' : 'opacity-0'}`} />
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
      <div className="p-4 bg-background">
        <div className="rounded-xl bg-secondary overflow-hidden">
          {/* Text Input */}
          <div className="relative min-h-[96px] px-3 py-2">
            {!commentText.trim() && !isComposerFocused && (
              <span className="pointer-events-none absolute left-3 top-2 text-sm text-muted-foreground">
                Add comment
              </span>
            )}
            <div
              ref={composerEditorRef}
              contentEditable={!isComposerLocked}
              suppressContentEditableWarning
              role="textbox"
              aria-multiline="true"
              aria-label="Add comment"
              onInput={syncCommentTextFromEditor}
              onFocus={() => {
                setIsComposerFocused(true)
                syncActiveFormats()
              }}
              onBlur={() => {
                setIsComposerFocused(false)
                syncCommentTextFromEditor()
                syncActiveFormats()
              }}
              onKeyDown={handleKeyDown}
              className="min-h-[96px] whitespace-pre-wrap break-words text-sm text-foreground outline-none"
            />
          </div>

          {/* Toolbar */}
          <div className="flex items-center justify-between px-3 py-2">
            <div className="flex items-center gap-1">
              {/* Formatting buttons */}
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-8 w-8 text-muted-foreground hover:text-foreground",
                  activeFormats.bold && "bg-background text-foreground hover:bg-background"
                )}
                onClick={() => applyInlineFormatting('bold')}
                disabled={isComposerLocked}
                aria-label="Bold"
              >
                <Bold className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-8 w-8 text-muted-foreground hover:text-foreground",
                  activeFormats.italic && "bg-background text-foreground hover:bg-background"
                )}
                onClick={() => applyInlineFormatting('italic')}
                disabled={isComposerLocked}
                aria-label="Italic"
              >
                <Italic className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "h-8 w-8 text-muted-foreground hover:text-foreground",
                  activeFormats.underline && "bg-background text-foreground hover:bg-background"
                )}
                onClick={() => applyInlineFormatting('underline')}
                disabled={isComposerLocked}
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
                className={cn(
                  "h-8 w-8 text-muted-foreground hover:text-foreground",
                  activeFormats.link && "bg-background text-foreground hover:bg-background"
                )}
                onClick={handleLinkInsert}
                disabled={isComposerLocked}
                aria-label="Insert link"
              >
                <Link2 className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={() => insertTextAtCursor('😄')}
                disabled={isComposerLocked}
                aria-label="Insert emoji"
              >
                <Smile className="h-4 w-4" />
              </Button>
            </div>

            {/* Send button */}
            <Button
              onClick={handleSubmitComment}
              disabled={!commentText.trim() || isComposerLocked || !convexUserId}
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
