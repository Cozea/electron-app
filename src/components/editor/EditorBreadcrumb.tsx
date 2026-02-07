import { Fragment, useEffect, useState, useMemo } from 'react'
import * as monaco from 'monaco-editor'
import { ChevronRight, Eye, EyeOff } from 'lucide-react'
import { getFileIcon } from '@/lib/fileExplorer/fileIcons'

interface EditorBreadcrumbProps {
  path: string
  editorRef: React.RefObject<monaco.editor.IStandaloneCodeEditor | null>
  projectPath?: string | null
  editorReady?: boolean
  minimapEnabled?: boolean
  onToggleMinimap?: () => void
}

interface BreadcrumbSymbol {
  name: string
  kind: monaco.languages.SymbolKind
  range: monaco.IRange
  children?: BreadcrumbSymbol[]
}

// Convert Monaco DocumentSymbol to our flattened structure
function convertSymbols(symbols: monaco.languages.DocumentSymbol[]): BreadcrumbSymbol[] {
  return symbols.map(sym => ({
    name: sym.name,
    kind: sym.kind,
    range: sym.range,
    children: sym.children ? convertSymbols(sym.children) : undefined,
  }))
}

// Check if position is within a range
function positionInRange(position: monaco.Position, range: monaco.IRange): boolean {
  if (position.lineNumber < range.startLineNumber || position.lineNumber > range.endLineNumber) {
    return false
  }
  if (position.lineNumber === range.startLineNumber && position.column < range.startColumn) {
    return false
  }
  if (position.lineNumber === range.endLineNumber && position.column > range.endColumn) {
    return false
  }
  return true
}

// Find the symbol path at a given cursor position
function findSymbolPathAtPosition(
  symbols: BreadcrumbSymbol[],
  position: monaco.Position
): BreadcrumbSymbol[] {
  const path: BreadcrumbSymbol[] = []

  function search(syms: BreadcrumbSymbol[]): boolean {
    for (const sym of syms) {
      if (positionInRange(position, sym.range)) {
        path.push(sym)
        if (sym.children?.length) {
          search(sym.children)
        }
        return true
      }
    }
    return false
  }

  search(symbols)
  return path
}

// Get symbol kind icon/indicator
function getSymbolKindLabel(kind: monaco.languages.SymbolKind): string {
  switch (kind) {
    case monaco.languages.SymbolKind.Function:
    case monaco.languages.SymbolKind.Method:
      return 'fn'
    case monaco.languages.SymbolKind.Class:
      return 'class'
    case monaco.languages.SymbolKind.Interface:
      return 'interface'
    case monaco.languages.SymbolKind.Variable:
    case monaco.languages.SymbolKind.Constant:
      return 'var'
    case monaco.languages.SymbolKind.Property:
    case monaco.languages.SymbolKind.Field:
      return 'prop'
    case monaco.languages.SymbolKind.Enum:
      return 'enum'
    case monaco.languages.SymbolKind.Module:
    case monaco.languages.SymbolKind.Namespace:
      return 'module'
    default:
      return ''
  }
}

export function EditorBreadcrumb({
  path,
  editorRef,
  projectPath,
  editorReady = false,
  minimapEnabled = true,
  onToggleMinimap,
}: EditorBreadcrumbProps) {
  const [symbols, setSymbols] = useState<BreadcrumbSymbol[]>([])
  const [currentSymbolPath, setCurrentSymbolPath] = useState<BreadcrumbSymbol[]>([])

  // Get file path segments (relative to project)
  const pathSegments = useMemo(() => {
    let relativePath = path

    // Remove project path prefix if available
    if (projectPath && path.startsWith(projectPath)) {
      relativePath = path.slice(projectPath.length)
      if (relativePath.startsWith('/') || relativePath.startsWith('\\')) {
        relativePath = relativePath.slice(1)
      }
    }

    // Split and filter empty parts
    const parts = relativePath.split(/[/\\]/).filter(Boolean)
    return parts
  }, [path, projectPath])

  const fileName = pathSegments[pathSegments.length - 1] || 'file'

  // Fetch symbols when editor model is available
  useEffect(() => {
    if (!editorReady) return

    const editor = editorRef.current
    if (!editor) return

    const model = editor.getModel()
    if (!model) return

    let cancelled = false

    // Get symbols with retry (language services need time to initialize)
    const fetchSymbols = async (retryCount = 0) => {
      if (cancelled) return

      try {
        const getDocumentSymbols = (monaco.languages as {
          getDocumentSymbols?: (model: monaco.editor.ITextModel) => Promise<monaco.languages.DocumentSymbol[]>
        }).getDocumentSymbols

        if (!getDocumentSymbols) {
          setSymbols([])
          return
        }

        const docSymbols = await getDocumentSymbols(model)
        if (cancelled) return

        if (docSymbols && docSymbols.length > 0) {
          setSymbols(convertSymbols(docSymbols))
        } else if (retryCount < 5) {
          // Language services might not be ready yet, retry
          setTimeout(() => fetchSymbols(retryCount + 1), 500)
        }
      } catch {
        // Language might not support document symbols
        if (retryCount < 3) {
          setTimeout(() => fetchSymbols(retryCount + 1), 500)
        } else {
          setSymbols([])
        }
      }
    }

    // Initial delay to let language services initialize
    const initialTimeout = setTimeout(() => fetchSymbols(), 300)

    // Refetch when content changes (debounced)
    let contentTimeout: ReturnType<typeof setTimeout>
    const disposable = model.onDidChangeContent(() => {
      clearTimeout(contentTimeout)
      contentTimeout = setTimeout(() => fetchSymbols(), 500)
    })

    return () => {
      cancelled = true
      disposable.dispose()
      clearTimeout(initialTimeout)
      clearTimeout(contentTimeout)
    }
  }, [editorRef, editorReady])

  // Track cursor position
  useEffect(() => {
    if (!editorReady) return

    const editor = editorRef.current
    if (!editor) return

    const updateSymbolPath = () => {
      const position = editor.getPosition()
      if (position && symbols.length > 0) {
        const symbolPath = findSymbolPathAtPosition(symbols, position)
        setCurrentSymbolPath(symbolPath)
      } else {
        setCurrentSymbolPath([])
      }
    }

    // Update on cursor change
    const disposable = editor.onDidChangeCursorPosition(updateSymbolPath)

    // Initial update
    updateSymbolPath()

    return () => disposable.dispose()
  }, [editorRef, editorReady, symbols])

  return (
    <div className="flex items-center h-6 bg-sidebar text-xs">
      <div className="flex min-w-0 flex-1 items-center overflow-x-auto scrollbar-hide px-2">
        {/* File path segments */}
        {pathSegments.map((segment, i) => {
          const isLast = i === pathSegments.length - 1
          return (
            <Fragment key={i}>
              {i > 0 && (
                <ChevronRight className="h-3 w-3 mx-0.5 text-muted-foreground shrink-0" />
              )}
              <span
                className={`shrink-0 flex items-center gap-1 ${
                  isLast ? 'text-foreground' : 'text-muted-foreground hover:text-foreground cursor-pointer'
                }`}
              >
                {isLast && getFileIcon(fileName, { width: 14, height: 14 })}
                {segment}
              </span>
            </Fragment>
          )
        })}

        {/* Symbol path */}
        {currentSymbolPath.map((sym, i) => (
          <Fragment key={`sym-${i}`}>
            <ChevronRight className="h-3 w-3 mx-0.5 text-muted-foreground shrink-0" />
            <span className="text-foreground shrink-0 flex items-center gap-1">
              {getSymbolKindLabel(sym.kind) && (
                <span className="text-muted-foreground text-[10px]">
                  {getSymbolKindLabel(sym.kind)}
                </span>
              )}
              {sym.name}
            </span>
          </Fragment>
        ))}
      </div>
      {onToggleMinimap && (
        <button
          type="button"
          onClick={onToggleMinimap}
          className="mr-1 inline-flex h-5 items-center gap-1 rounded-sm px-1.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
          title={minimapEnabled ? 'Hide minimap' : 'Show minimap'}
          aria-label={minimapEnabled ? 'Hide minimap' : 'Show minimap'}
        >
          {minimapEnabled ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
          Minimap
        </button>
      )}
    </div>
  )
}
