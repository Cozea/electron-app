"use client"

import { useMemo, useRef, useEffect } from 'react'
import { DiffEditor, type DiffOnMount, loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { useMonacoTheme, type MonacoThemeVariant } from '@/hooks/useMonacoTheme'
import { cn } from '@/lib/utils'
import { getFileIcon } from '@/lib/fileExplorer/fileIcons'

// Import Monaco workers for Vite
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

// Configure Monaco environment for web workers (if not already configured)
if (typeof self !== 'undefined' && !self.MonacoEnvironment) {
  self.MonacoEnvironment = {
    getWorker(_, label) {
      if (label === 'json') return new jsonWorker()
      if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
      if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
      if (label === 'typescript' || label === 'javascript') return new tsWorker()
      return new editorWorker()
    },
  }
}

// Configure Monaco loader
loader.config({ monaco })

// Map file extensions to Monaco language IDs
const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  md: 'markdown',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sql: 'sql',
  yaml: 'yaml',
  yml: 'yaml',
  xml: 'xml',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  dockerfile: 'dockerfile',
  graphql: 'graphql',
  vue: 'vue',
  svelte: 'svelte',
}

function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  return EXTENSION_TO_LANGUAGE[ext] || 'plaintext'
}

function getFileName(filePath: string): string {
  return filePath.split(/[/\\]/).pop() || filePath
}

export interface CodeDiffViewerProps {
  /** Original content (before changes) */
  original: string
  /** Modified content (after changes) */
  modified: string
  /** File path for language detection and display */
  filePath?: string
  /** Override language detection */
  language?: string
  /** Show file header with icon */
  showHeader?: boolean
  /** Maximum height in pixels (auto-sizes to content by default) */
  maxHeight?: number
  /** Minimum height in pixels */
  minHeight?: number
  /** Use inline diff view instead of side-by-side */
  inline?: boolean
  /** Read-only mode (default: true) */
  readOnly?: boolean
  /** Theme variant for background styling */
  themeVariant?: MonacoThemeVariant
  /** Fill the container height instead of auto-sizing to content */
  fillContainer?: boolean
  /** Additional class names */
  className?: string
}

export function CodeDiffViewer({
  original,
  modified,
  filePath,
  language,
  showHeader = true,
  maxHeight = 400,
  minHeight = 100,
  inline = false,
  readOnly = true,
  themeVariant = 'default',
  fillContainer = false,
  className,
}: CodeDiffViewerProps) {
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const modelRef = useRef<monaco.editor.IDiffEditorModel | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const themeName = useMonacoTheme(themeVariant)

  // Detect language from file path or use provided language
  const detectedLanguage = useMemo(() => {
    if (language) return language
    if (filePath) return getLanguageFromPath(filePath)
    return 'plaintext'
  }, [language, filePath])

  // Calculate content height for auto-sizing
  const contentHeight = useMemo(() => {
    const lineCount = Math.max(
      original.split('\n').length,
      modified.split('\n').length
    )
    // Approximate line height (19px) + padding
    const estimatedHeight = lineCount * 19 + 20
    return Math.min(Math.max(estimatedHeight, minHeight), maxHeight)
  }, [original, modified, minHeight, maxHeight])

  const handleMount: DiffOnMount = (editor) => {
    editorRef.current = editor
    modelRef.current = editor.getModel()

    // Update layout on content change
    editor.onDidUpdateDiff(() => {
      editor.getModifiedEditor().layout()
    })

    // Theme is handled by useMonacoTheme
  }

  // Update layout when container size changes
  useEffect(() => {
    if (!containerRef.current || !editorRef.current) return

    const observer = new ResizeObserver(() => {
      editorRef.current?.layout()
    })

    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    return () => {
      const editor = editorRef.current
      const model = modelRef.current
      if (!editor || !model) return
      editor.setModel(null)
      model.original.dispose()
      model.modified.dispose()
      modelRef.current = null
      editorRef.current = null
    }
  }, [])

  const fileName = filePath ? getFileName(filePath) : null

  return (
    <div className={cn('overflow-hidden rounded-md border border-border/50 bg-sidebar text-foreground', className)}>
      {showHeader && fileName && (
        <div className="flex items-center gap-2 border-b bg-muted/50 px-3 py-2">
          {getFileIcon(fileName, { width: 16, height: 16 })}
          <span className="text-sm font-medium truncate">{fileName}</span>
          {filePath && filePath !== fileName && (
            <span className="text-xs text-muted-foreground truncate">
              {filePath}
            </span>
          )}
        </div>
      )}
      <div
        ref={containerRef}
        className="bg-background/70 text-foreground"
        style={{ height: fillContainer ? '100%' : contentHeight }}
      >
        <DiffEditor
          height="100%"
          language={detectedLanguage}
          original={original}
          modified={modified}
          theme={themeName}
          onMount={handleMount}
          keepCurrentModel
          options={{
            fontSize: 12,
            fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
            minimap: { enabled: false },
            automaticLayout: true,
            scrollBeyondLastLine: false,
            readOnly,
            renderSideBySide: !inline,
            // VS Code-like diff options
            diffAlgorithm: 'advanced',
            renderMarginRevertIcon: false,
            stickyScroll: { enabled: false },
            scrollbar: {
              vertical: 'auto',
              horizontal: 'auto',
              verticalScrollbarSize: 10,
              horizontalScrollbarSize: 10,
            },
            lineNumbers: 'off',
            lineDecorationsWidth: 0,
            glyphMargin: false,
            folding: false,
            renderLineHighlight: 'none',
            renderOverviewRuler: false,

            guides: {
              indentation: false,
              bracketPairs: false,
              highlightActiveIndentation: false,
            },
            overviewRulerBorder: false,
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            // Optimizations for embedded view
            contextmenu: false,
          }}
          loading={
            <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
              Loading diff...
            </div>
          }
        />
      </div>
    </div>
  )
}
