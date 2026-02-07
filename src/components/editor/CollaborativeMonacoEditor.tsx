import { useEffect, useRef, useCallback, useState } from 'react'
import Editor, { type OnMount, loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { MonacoBinding } from 'y-monaco'
import { useYjsProject } from '@/contexts/YjsProjectContext'
import { useEditorStore } from '@/stores/useEditorStore'
import { useMonacoTheme } from '@/hooks/useMonacoTheme'
import { useDiagnosticsFileSync } from '@/hooks/useDiagnosticsFileSync'
import { useMonacoDiagnostics } from '@/hooks/useMonacoDiagnostics'

// Import Monaco workers for Vite
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

// Configure Monaco environment for web workers (only if not already configured)
if (!self.MonacoEnvironment) {
  self.MonacoEnvironment = {
    getWorker(_, label) {
      if (label === 'json') {
        return new jsonWorker()
      }
      if (label === 'css' || label === 'scss' || label === 'less') {
        return new cssWorker()
      }
      if (label === 'html' || label === 'handlebars' || label === 'razor') {
        return new htmlWorker()
      }
      if (label === 'typescript' || label === 'javascript') {
        return new tsWorker()
      }
      return new editorWorker()
    },
  }
}

// Configure Monaco loader
loader.config({ monaco })

interface CollaborativeMonacoEditorProps {
  path: string
  onSave?: () => void
  onEditorReady?: (editor: monaco.editor.IStandaloneCodeEditor) => void
  minimapEnabled?: boolean
}

/**
 * CollaborativeMonacoEditor - Monaco editor with Yjs real-time collaboration.
 *
 * Uses y-monaco to bind the Monaco model to a Y.Text document,
 * enabling real-time collaborative editing with cursor awareness.
 */
export function CollaborativeMonacoEditor({
  path,
  onSave,
  onEditorReady,
  minimapEnabled = true,
}: CollaborativeMonacoEditorProps) {
  const { yjsDoc, awareness } = useYjsProject()
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const [showBottomFade, setShowBottomFade] = useState(false)
  const bindingRef = useRef<MonacoBinding | null>(null)
  const cursorDisposablesRef = useRef<monaco.IDisposable[]>([])
  const theme = useMonacoTheme('sidebar')

  const model = useEditorStore((state) => state.models[path])
  const actions = useEditorStore((state) => state.actions)

  // Handle save action
  const handleSave = useCallback(() => {
    if (onSave) {
      onSave()
    } else {
      actions.saveFile(path)
    }
  }, [onSave, actions, path])

  // Handle editor mount - set up y-monaco binding
  const handleMount: OnMount = useCallback(
    (editor, monacoInstance) => {
      editorRef.current = editor
      const updateBottomFade = () => {
        const scrollTop = editor.getScrollTop()
        const viewportHeight = editor.getLayoutInfo().height
        const scrollHeight = editor.getScrollHeight()
        setShowBottomFade(scrollTop + viewportHeight < scrollHeight - 1)
      }
      const editorModel = editor.getModel()

      if (!editorModel || !yjsDoc) {
        console.warn('[CollaborativeEditor] Missing model or yjsDoc')
        return
      }

      // Get or create the Y.Text for this file path
      const yText = yjsDoc.getFileText(path)
      if (!yText) {
        console.warn('[CollaborativeEditor] Yjs document marked as deleted for path:', path)
        return
      }

      // Initialize Y.Text content if empty and we have content from EditorStore
      if (yText.length === 0 && model?.currentContent) {
        yjsDoc.initializeFile(path, model.currentContent)
      }

      // Create y-monaco binding - this syncs Monaco <-> Y.Text automatically
      bindingRef.current = new MonacoBinding(
        yText,
        editorModel,
        new Set([editor]),
        awareness ?? undefined
      )

      // Publish "active file" + cursor position for collaborator UI.
      if (awareness) {
        const updateCursorState = () => {
          const position = editor.getPosition()
          if (!position) return
          awareness.setLocalStateField('cursor', {
            filePath: path,
            line: position.lineNumber,
            column: position.column,
          })
        }

        // Set immediately so others can see which file we're in even before moving.
        updateCursorState()

        cursorDisposablesRef.current.push(
          editor.onDidChangeCursorPosition(updateCursorState),
          editor.onDidFocusEditorText(updateCursorState)
        )
      }

      // Register Cmd+S save command
      editor.addCommand(
        monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS,
        handleSave
      )

      updateBottomFade()
      cursorDisposablesRef.current.push(
        editor.onDidScrollChange(updateBottomFade),
        editor.onDidContentSizeChange(updateBottomFade)
      )

      // Notify parent that editor is ready
      onEditorReady?.(editor)

      // Update EditorStore when Y.Text changes (for dirty state tracking)
      yText.observe(() => {
        const content = yText.toString()
        // Only update if content actually changed to avoid loops
        if (content !== model?.currentContent) {
          actions.updateContent(path, content)
        }
      })
    },
    [path, yjsDoc, awareness, model, actions, handleSave, onEditorReady]
  )

  // Cleanup binding on unmount or path change
  useEffect(() => {
    return () => {
      bindingRef.current?.destroy()
      bindingRef.current = null

      for (const disposable of cursorDisposablesRef.current) {
        disposable.dispose()
      }
      cursorDisposablesRef.current = []
    }
  }, [path])

  useDiagnosticsFileSync({
    projectPath: model?.projectPath,
    filePath: path,
    content: model?.currentContent ?? '',
  })

  useMonacoDiagnostics({
    projectPath: model?.projectPath,
    filePath: path,
  })

  useEffect(() => {
    editorRef.current?.updateOptions({
      minimap: { enabled: minimapEnabled },
    })
  }, [minimapEnabled])

  if (!model) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        Loading...
      </div>
    )
  }

  const modelPath = monaco.Uri.file(path).toString()

  return (
    <div className="relative h-full overflow-hidden bg-sidebar">
      <Editor
        height="100%"
        language={model.language}
        path={modelPath}
        // Don't set value prop - y-monaco manages content
        defaultValue={model.currentContent}
        theme={theme}
        onMount={handleMount}
        // Don't use onChange - y-monaco handles sync
        options={{
          fontSize: 13,
          fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
          minimap: { enabled: minimapEnabled },
          automaticLayout: true,
          tabSize: 2,
          scrollBeyondLastLine: false,
          scrollbar: {
            vertical: 'auto',
            horizontal: 'auto',
            verticalHasArrows: false,
            horizontalHasArrows: false,
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 8,
            alwaysConsumeMouseWheel: false,
            useShadows: false,
          },
          readOnly: false,
        }}
        loading={
          <div className="h-full flex items-center justify-center text-muted-foreground">
            Initializing collaborative editor...
          </div>
        }
      />
      {showBottomFade && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-sidebar to-transparent" />
      )}
    </div>
  )
}
