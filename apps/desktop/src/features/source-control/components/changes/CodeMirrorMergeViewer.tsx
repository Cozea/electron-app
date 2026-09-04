import { useEffect, useRef } from 'react'
import { EditorState, type Extension } from '@codemirror/state'
import { lineNumbers, EditorView } from '@codemirror/view'
import { unifiedMergeView } from '@codemirror/merge'
import { minimalSetup } from 'codemirror'
import { oneDark } from '@codemirror/theme-one-dark'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { sql } from '@codemirror/lang-sql'
import { yaml } from '@codemirror/lang-yaml'
import { cn } from '@/lib/utils'
import './codemirror-merge-viewer.css'

interface CodeMirrorMergeViewerProps {
  original: string
  modified: string
  filePath?: string
  onScrollStateChange?: (state: { atTop: boolean; atBottom: boolean }) => void
  className?: string
}

function getFileExtension(filePath?: string): string {
  if (!filePath) return ''
  const parts = filePath.split('.')
  if (parts.length < 2) return ''
  return parts[parts.length - 1].toLowerCase()
}

function getLanguageExtension(filePath?: string): Extension | null {
  const ext = getFileExtension(filePath)

  switch (ext) {
    case 'js':
    case 'mjs':
    case 'cjs':
      return javascript()
    case 'jsx':
      return javascript({ jsx: true })
    case 'ts':
      return javascript({ typescript: true })
    case 'tsx':
      return javascript({ jsx: true, typescript: true })
    case 'json':
      return json()
    case 'css':
    case 'scss':
    case 'less':
      return css()
    case 'html':
    case 'htm':
      return html()
    case 'md':
    case 'mdx':
      return markdown()
    case 'py':
      return python()
    case 'sql':
      return sql()
    case 'yaml':
    case 'yml':
      return yaml()
    default:
      return null
  }
}

export function CodeMirrorMergeViewer({
  original,
  modified,
  filePath,
  onScrollStateChange,
  className,
}: CodeMirrorMergeViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<EditorView | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const languageExtension = getLanguageExtension(filePath)

    const extensions: Extension[] = [
      oneDark,
      minimalSetup,
      lineNumbers(),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      unifiedMergeView({
        original,
        gutter: true,
        highlightChanges: true,
        allowInlineDiffs: false,
        mergeControls: false,
        collapseUnchanged: {
          margin: 3,
          minSize: 4,
        },
      }),
      EditorView.theme(
        {
          '&': {
            backgroundColor: 'transparent',
            color: 'var(--foreground)',
            fontSize: '13px',
          },
          '.cm-scroller': {
            fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
            lineHeight: '1.55',
            paddingBottom: '24px',
          },
          '.cm-gutters': {
            backgroundColor: 'transparent',
            border: 'none',
            color: 'var(--muted-foreground)',
          },
          '.cm-activeLine': {
            backgroundColor: 'color-mix(in oklab, var(--muted) 45%, transparent)',
          },
          '.cm-activeLineGutter': {
            backgroundColor: 'transparent',
          },
          '.cm-content': {
            caretColor: 'var(--foreground)',
          },
          '.cm-cursor, .cm-dropCursor': {
            borderLeftColor: 'var(--foreground)',
          },
          '&.cm-focused': {
            outline: 'none',
          },
        },
        { dark: true },
      ),
    ]

    if (languageExtension) {
      extensions.push(languageExtension)
    }

    const view = new EditorView({
      parent: container,
      doc: modified,
      extensions,
    })
    editorRef.current = view

    const scrollEl = view.scrollDOM
    const emitScrollState = () => {
      const atTop = scrollEl.scrollTop <= 1
      const atBottom = scrollEl.scrollHeight - scrollEl.clientHeight - scrollEl.scrollTop <= 1
      onScrollStateChange?.({ atTop, atBottom })
    }

    const onScroll = () => {
      emitScrollState()
    }

    scrollEl.addEventListener('scroll', onScroll, { passive: true })
    const resizeObserver = new ResizeObserver(() => {
      emitScrollState()
    })
    resizeObserver.observe(scrollEl)
    requestAnimationFrame(() => {
      emitScrollState()
    })

    return () => {
      scrollEl.removeEventListener('scroll', onScroll)
      resizeObserver.disconnect()
      view.destroy()
      editorRef.current = null
      container.textContent = ''
    }
  }, [filePath, modified, onScrollStateChange, original])

  return (
    <div
      ref={containerRef}
      className={cn('changes-codemirror-merge h-full overflow-auto', className)}
    />
  )
}
