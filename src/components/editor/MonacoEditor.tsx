import { useCallback, useRef } from 'react'
import Editor, { type OnMount, type OnChange, loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { useEditorStore } from '@/stores/useEditorStore'
import { useYjsProject } from '@/contexts/YjsProjectContext'
import { CollaborativeMonacoEditor } from './CollaborativeMonacoEditor'

// Import Monaco workers for Vite
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

// Configure Monaco environment for web workers
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

// Configure Monaco loader
loader.config({ monaco })

interface MonacoEditorProps {
    path: string
}

export function MonacoEditor({ path }: MonacoEditorProps) {
    const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
    const model = useEditorStore((state) => state.models[path])
    const actions = useEditorStore((state) => state.actions)
    const { yjsDoc } = useYjsProject()

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
            editorRef.current = editor

            // Cmd+S to save
            editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS, () => {
                actions.saveFile(path)
            })
        },
        [path, actions]
    )


    if (!model) {
        return (
            <div className="h-full flex items-center justify-center text-muted-foreground">
                Loading...
            </div>
        )
    }

    // Use collaborative editor when Yjs is available
    if (yjsDoc) {
        return (
            <CollaborativeMonacoEditor
                path={path}
                language={model.language}
                onSave={handleSave}
            />
        )
    }

    // Fallback to regular editor when not in collaborative mode
    return (
        <Editor
            height="100%"
            language={model.language}
            value={model.currentContent}
            theme="vs-dark" // Could make dynamic later
            onChange={handleChange}
            onMount={handleEditorMount}
            options={{
                fontSize: 13,
                fontFamily: 'JetBrains Mono, Menlo, Monaco, Consolas, monospace',
                minimap: { enabled: true },
                automaticLayout: true,
                tabSize: 2,
                scrollBeyondLastLine: false,
                readOnly: false, // Could hook up to lock status
            }}
            loading={
                <div className="h-full flex items-center justify-center text-muted-foreground">
                    Initializing editor...
                </div>
            }
        />
    )
}
