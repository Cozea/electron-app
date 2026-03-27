// @ts-nocheck
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import * as monaco from 'monaco-editor'

/**
 * EditorModel - Tracks file state following VSCode's TextFileEditorModel pattern
 */
export interface EditorModel {
    path: string
    projectPath?: string
    originalContent: string  // Content when opened or last saved
    currentContent: string   // Current editor buffer (working copy)
    isDirty: boolean         // Has unsaved changes
    inConflictMode: boolean  // External changes detected
    language: string         // Monaco language ID
    lastModifiedAt: number   // Last modification timestamp
    lastSavedAt: number | null
}

interface EditorState {
    models: Record<string, EditorModel>
    savingFiles: Set<string>
    externalChanges: Record<string, { detectedAt: number; newContent: string }>

    actions: {
        openFile: (path: string, content: string, projectPath?: string) => void
        updateContent: (path: string, content: string) => void
        saveFile: (path: string) => Promise<{ success: boolean; error?: string }>
        // saveAll: () => Promise<{ saved: string[]; failed: string[] }> // deferred
        markSaved: (path: string, content: string) => void
        closeFile: (path: string) => void
        getModel: (path: string) => EditorModel | undefined
        hasUnsavedChanges: () => boolean
        getDirtyFiles: () => string[]
        // notifyExternalChange... deferred
        // acceptExternalChanges... deferred
        // revertFile... deferred
    }
}

function getLanguageFromPath(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase() || ''
    const languageMap: Record<string, string> = {
        ts: 'typescript', tsx: 'typescript',
        js: 'javascript', jsx: 'javascript',
        json: 'json', css: 'css', html: 'html',
        md: 'markdown', py: 'python',
        // add others as needed
    }
    return languageMap[ext] || 'plaintext'
}

function normalizePathForModelMatch(path: string): string {
    return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

function disposeMonacoModelForPath(path: string): void {
    const normalizedPath = normalizePathForModelMatch(path)
    const uriCandidates = new Set<string>([path])

    try {
        uriCandidates.add(monaco.Uri.file(path).toString())
    } catch {
        // Ignore invalid filesystem paths; fallback matching still applies.
    }

    try {
        uriCandidates.add(monaco.Uri.parse(path).toString())
    } catch {
        // Ignore parse errors for non-URI strings.
    }

    const model = monaco.editor.getModels().find((candidate) => {
        const modelUri = candidate.uri.toString()
        if (uriCandidates.has(modelUri)) return true

        const modelFsPath = candidate.uri.fsPath
            ? normalizePathForModelMatch(candidate.uri.fsPath)
            : ''
        return modelFsPath !== '' && modelFsPath === normalizedPath
    })

    model?.dispose()
}

export const useEditorStore = create<EditorState>()(
    immer((set, get) => ({
        models: {},
        savingFiles: new Set(),
        externalChanges: {},

        actions: {
            openFile: (path, content, projectPath) =>
                set((state) => {
                    if (!state.models[path]) {
                        state.models[path] = {
                            path,
                            projectPath,
                            originalContent: content,
                            currentContent: content,
                            isDirty: false,
                            inConflictMode: false,
                            language: getLanguageFromPath(path),
                            lastModifiedAt: Date.now(),
                            lastSavedAt: null,
                        }
                    } else {
                        // If already open, just update original content if not dirty?
                        // For now, assuming openFile might be called when re-reading disk
                        if (!state.models[path].isDirty) {
                            state.models[path].originalContent = content
                            state.models[path].currentContent = content
                            if (projectPath) state.models[path].projectPath = projectPath
                        }
                    }
                }),

            updateContent: (path, content) =>
                set((state) => {
                    const model = state.models[path]
                    if (model) {
                        model.currentContent = content
                        model.isDirty = content !== model.originalContent
                        model.lastModifiedAt = Date.now()
                    }
                }),

            saveFile: async (path) => {
                const model = get().models[path]
                if (!model) {
                    return { success: false, error: 'File not open' }
                }

                set((state) => { state.savingFiles.add(path) })

                try {
                    if (!model.projectPath) {
                        console.error("Missing project path for file:", path)
                        return { success: false, error: "Missing project context" }
                    }

                    // Convert absolute path to relative path for writeFile API
                    let relativePath = model.path
                    if (model.path.startsWith(model.projectPath)) {
                        relativePath = model.path.slice(model.projectPath.length)
                        // Remove leading slash if present
                        if (relativePath.startsWith('/') || relativePath.startsWith('\\')) {
                            relativePath = relativePath.slice(1)
                        }
                    }

                    const result = await window.electronAPI.project.writeFile({
                        projectPath: model.projectPath,
                        filePath: relativePath,
                        content: model.currentContent
                    })

                    if (result.success) {
                        get().actions.markSaved(path, model.currentContent)
                    }
                    return { success: result.success, error: result.error }
                } catch (err) {
                    return { success: false, error: String(err) }
                } finally {
                    set((state) => { state.savingFiles.delete(path) })
                }
            },

            markSaved: (path, content) =>
                set((state) => {
                    const model = state.models[path]
                    if (model) {
                        model.originalContent = content
                        model.currentContent = content
                        model.isDirty = false
                        model.lastSavedAt = Date.now()
                    }
                }),

            closeFile: (path) =>
                set((state) => {
                    disposeMonacoModelForPath(path)
                    delete state.models[path]
                }),

            getModel: (path) => get().models[path],
            hasUnsavedChanges: () => Object.values(get().models).some((m) => m.isDirty),
            getDirtyFiles: () => Object.values(get().models).filter((m) => m.isDirty).map((m) => m.path),
        },
    }))
)
