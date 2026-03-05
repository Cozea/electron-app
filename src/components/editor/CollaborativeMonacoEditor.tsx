import { useEffect, useRef, useCallback, useState } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { MonacoBinding } from 'y-monaco'
import { useYjsProject } from '@/contexts/YjsProjectContext'
import { useEditorStore } from '@/stores/useEditorStore'
import { useMonacoTheme } from '@/hooks/useMonacoTheme'
import { useCollaborationActivityStore } from '@/stores/useCollaborationActivityStore'
import { configureMonacoTypeScriptValidation, ensureMonacoEnvironment } from '@/lib/editor/monacoEnvironment'

ensureMonacoEnvironment()

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
  const activePathRef = useRef(path)
  const onSaveRef = useRef(onSave)
  const [showBottomFade, setShowBottomFade] = useState(false)
  const bindingRef = useRef<MonacoBinding | null>(null)
  const yTextObserverCleanupRef = useRef<(() => void) | null>(null)
  const cursorDisposablesRef = useRef<monaco.IDisposable[]>([])
  const theme = useMonacoTheme('sidebar')

  const model = useEditorStore((state) => state.models[path])
  const actions = useEditorStore((state) => state.actions)
  const pingMonacoTyping = useCollaborationActivityStore(
    (state) => state.actions.pingMonacoTyping
  )

  useEffect(() => {
    activePathRef.current = path
  }, [path])

  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  const teardownBinding = useCallback(() => {
    bindingRef.current?.destroy()
    bindingRef.current = null

    if (yTextObserverCleanupRef.current) {
      yTextObserverCleanupRef.current()
      yTextObserverCleanupRef.current = null
    }
  }, [])

  const bindCurrentModel = useCallback(() => {
    const editor = editorRef.current
    if (!editor || !yjsDoc) {
      return
    }

    const currentPath = activePathRef.current
    const currentModel = useEditorStore.getState().models[currentPath]
    if (!currentModel) {
      return
    }

    const editorModel = editor.getModel()
    if (!editorModel) {
      return
    }

    const yText = yjsDoc.getFileText(currentPath)
    if (!yText) {
      console.warn('[CollaborativeEditor] Yjs document marked as deleted for path:', currentPath)
      teardownBinding()
      return
    }

    // Initialize Y.Text content if empty and we have content from EditorStore
    if (yText.length === 0) {
      yjsDoc.initializeFile(currentPath, currentModel.currentContent)
    }

    teardownBinding()

    // Create y-monaco binding - this syncs Monaco <-> Y.Text automatically
    bindingRef.current = new MonacoBinding(
      yText,
      editorModel,
      new Set([editor]),
      awareness ?? undefined
    )

    const handleYTextChange = () => {
      const content = yText.toString()
      const latestModel = useEditorStore.getState().models[currentPath]
      // Only update if content actually changed to avoid loops
      if (content !== latestModel?.currentContent) {
        actions.updateContent(currentPath, content)
      }
    }

    yText.observe(handleYTextChange)
    yTextObserverCleanupRef.current = () => {
      yText.unobserve(handleYTextChange)
    }
  }, [actions, awareness, teardownBinding, yjsDoc])

  // Handle editor mount - set up y-monaco binding
  const handleMount: OnMount = useCallback(
    (editor, monacoInstance) => {
      configureMonacoTypeScriptValidation(monacoInstance)

      // Defensive cleanup in case Monaco remounts this editor instance.
      teardownBinding()
      for (const disposable of cursorDisposablesRef.current) {
        disposable.dispose()
      }
      cursorDisposablesRef.current = []

      editorRef.current = editor
      const updateBottomFade = () => {
        const scrollTop = editor.getScrollTop()
        const viewportHeight = editor.getLayoutInfo().height
        const scrollHeight = editor.getScrollHeight()
        setShowBottomFade(scrollTop + viewportHeight < scrollHeight - 1)
      }
      // Publish "active file" + cursor position for collaborator UI.
      if (awareness) {
        const updateCursorState = () => {
          const position = editor.getPosition()
          if (!position) return
          awareness.setLocalStateField('cursor', {
            filePath: activePathRef.current,
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
        () => {
          if (onSaveRef.current) {
            onSaveRef.current()
            return
          }
          actions.saveFile(activePathRef.current)
        }
      )
      editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.Period, () => {
        editor.trigger('keyboard', 'editor.action.quickFix', {})
      })
      editor.addCommand(
        monacoInstance.KeyMod.Shift | monacoInstance.KeyMod.Alt | monacoInstance.KeyCode.KeyO,
        () => {
          editor.trigger('keyboard', 'editor.action.organizeImports', {})
        }
      )

      const quickFixAction = editor.addAction({
        id: 'cozea.editor.quickFix.collab',
        label: 'Quick Fix',
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 0.5,
        run: () => {
          editor.trigger('contextmenu', 'editor.action.quickFix', {})
        },
      })
      const organizeImportsAction = editor.addAction({
        id: 'cozea.editor.organizeImports.collab',
        label: 'Organize Imports',
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 0.6,
        run: () => {
          editor.trigger('contextmenu', 'editor.action.organizeImports', {})
        },
      })
      const renameAction = editor.addAction({
        id: 'cozea.editor.renameSymbol.collab',
        label: 'Rename Symbol',
        contextMenuGroupId: 'navigation',
        contextMenuOrder: 0.7,
        run: () => {
          editor.trigger('contextmenu', 'editor.action.rename', {})
        },
      })

      updateBottomFade()
      cursorDisposablesRef.current.push(
        editor.onDidScrollChange(updateBottomFade),
        editor.onDidContentSizeChange(updateBottomFade),
        editor.onKeyDown((event) => {
          const key = event.browserEvent.key
          if (
            key.length === 1 ||
            key === 'Backspace' ||
            key === 'Delete' ||
            key === 'Enter' ||
            key === 'Tab'
          ) {
            pingMonacoTyping()
          }
        })
      )
      cursorDisposablesRef.current.push({
        dispose: () => {
          quickFixAction.dispose()
          organizeImportsAction.dispose()
          renameAction.dispose()
        },
      })

      // Notify parent that editor is ready
      onEditorReady?.(editor)

      bindCurrentModel()
    },
    [actions, awareness, bindCurrentModel, onEditorReady, pingMonacoTyping, teardownBinding]
  )

  // If the target file model is unavailable, ensure old bindings are fully torn down.
  useEffect(() => {
    if (model) return
    teardownBinding()
    for (const disposable of cursorDisposablesRef.current) {
      disposable.dispose()
    }
    cursorDisposablesRef.current = []
  }, [model, teardownBinding])

  // Rebind Yjs model when editor path/model changes without remounting the Monaco instance.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      bindCurrentModel()

      if (!awareness || !editorRef.current) {
        return
      }

      const position = editorRef.current.getPosition()
      if (!position) {
        return
      }

      awareness.setLocalStateField('cursor', {
        filePath: activePathRef.current,
        line: position.lineNumber,
        column: position.column,
      })
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [path, awareness, bindCurrentModel])

  // Cleanup editor bindings/listeners on unmount.
  useEffect(() => {
    return () => {
      teardownBinding()

      for (const disposable of cursorDisposablesRef.current) {
        disposable.dispose()
      }
      cursorDisposablesRef.current = []
    }
  }, [teardownBinding])

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
    <div className="relative h-full overflow-hidden bg-content-surface">
      <Editor
        height="100%"
        language={model.language}
        path={modelPath}
        // Don't set value prop - y-monaco manages content
        defaultValue={model.currentContent}
        keepCurrentModel
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
