import { useCallback, useEffect, useRef, useState } from 'react'
import Editor, { type OnMount, type OnChange } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { useEditorStore } from '@/stores/useEditorStore'
import { useYjsProject } from '@/contexts/YjsProjectContext'
import { CollaborativeMonacoEditor } from './CollaborativeMonacoEditor'
import { useMonacoTheme } from '@/hooks/useMonacoTheme'
import { configureMonacoTypeScriptValidation, ensureMonacoEnvironment } from '@/lib/editor/monacoEnvironment'

ensureMonacoEnvironment()

interface MonacoEditorProps {
    path: string
    onEditorReady?: (editor: monaco.editor.IStandaloneCodeEditor) => void
    minimapEnabled?: boolean
}

export function MonacoEditor({ path, onEditorReady, minimapEnabled = true }: MonacoEditorProps) {
    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
    const pathRef = useRef(path)
    const [showBottomFade, setShowBottomFade] = useState(false)
    const model = useEditorStore((state) => state.models[path])
    const actions = useEditorStore((state) => state.actions)
    const { yjsDoc } = useYjsProject()
    const theme = useMonacoTheme('sidebar')

    useEffect(() => {
        pathRef.current = path
    }, [path])

    useEffect(() => {
        editorRef.current?.updateOptions({
            minimap: { enabled: minimapEnabled },
        })
    }, [minimapEnabled])

    // Handle save for collaborative editor
    const handleSave = useCallback(() => {
        actions.saveFile(path)
    }, [path, actions])

    // Handle content changes
    const handleChange: OnChange = useCallback(
        (value) => {
            if (value !== undefined) {
                actions.updateContent(path, value)
            }
        },
        [path, actions]
    )

    // Handle editor mount - register save command
    const handleEditorMount: OnMount = useCallback(
        (editor, monacoInstance) => {
            configureMonacoTypeScriptValidation(monacoInstance)
            editorRef.current = editor
            const updateBottomFade = () => {
                const scrollTop = editor.getScrollTop()
                const viewportHeight = editor.getLayoutInfo().height
                const scrollHeight = editor.getScrollHeight()
                setShowBottomFade(scrollTop + viewportHeight < scrollHeight - 1)
            }

            // Cmd+S to save
            editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS, () => {
                actions.saveFile(pathRef.current)
            })
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
                id: 'cozea.editor.quickFix',
                label: 'Quick Fix',
                contextMenuGroupId: 'navigation',
                contextMenuOrder: 0.5,
                run: () => {
                    editor.trigger('contextmenu', 'editor.action.quickFix', {})
                },
            })
            const organizeImportsAction = editor.addAction({
                id: 'cozea.editor.organizeImports',
                label: 'Organize Imports',
                contextMenuGroupId: 'navigation',
                contextMenuOrder: 0.6,
                run: () => {
                    editor.trigger('contextmenu', 'editor.action.organizeImports', {})
                },
            })
            const renameAction = editor.addAction({
                id: 'cozea.editor.renameSymbol',
                label: 'Rename Symbol',
                contextMenuGroupId: 'navigation',
                contextMenuOrder: 0.7,
                run: () => {
                    editor.trigger('contextmenu', 'editor.action.rename', {})
                },
            })

            updateBottomFade()
            editor.onDidScrollChange(updateBottomFade)
            editor.onDidContentSizeChange(updateBottomFade)
            editor.onDidDispose(() => {
                quickFixAction.dispose()
                organizeImportsAction.dispose()
                renameAction.dispose()
            })

            // Notify parent that editor is ready
            onEditorReady?.(editor)
        },
        [actions, onEditorReady]
    )


    if (!model) {
        return (
            <div className="h-full flex items-center justify-center text-muted-foreground">
                Loading...
            </div>
        )
    }

    const modelPath = monaco.Uri.file(path).toString()

    // Use collaborative editor when Yjs is available
    if (yjsDoc) {
        return (
            <CollaborativeMonacoEditor
                path={path}
                onSave={handleSave}
                onEditorReady={onEditorReady}
                minimapEnabled={minimapEnabled}
            />
        )
    }

    // Fallback to regular editor when not in collaborative mode
    return (
        <div className="relative h-full overflow-hidden bg-sidebar">
            <Editor
                height="100%"
                language={model.language}
                path={modelPath}
                value={model.currentContent}
                keepCurrentModel
                theme={theme}
                onChange={handleChange}
                onMount={handleEditorMount}
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
                    readOnly: false, // Could hook up to lock status
                }}
                loading={
                    <div className="h-full flex items-center justify-center text-muted-foreground">
                        Initializing editor...
                    </div>
                }
            />
            {showBottomFade && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-sidebar to-transparent" />
            )}
        </div>
    )
}
