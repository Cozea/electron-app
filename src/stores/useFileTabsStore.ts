import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

interface ProjectFileTabs {
    openFiles: string[]
    activeFile: string | null
}

interface FileTabsState {
    projectTabs: Record<string, ProjectFileTabs> // projectId -> tabs
    actions: {
        openFile: (projectId: string, path: string) => void
        closeFile: (projectId: string, path: string) => void
        setActiveFile: (projectId: string, path: string | null) => void
        replaceFilePath: (projectId: string, currentPath: string, nextPath: string) => void
        closeAllFiles: (projectId: string) => void
        getProjectTabs: (projectId: string) => ProjectFileTabs
        rebaseProjectPaths: (projectId: string, previousRoot: string | null, nextRoot: string) => void
    }
}

const defaultTabs: ProjectFileTabs = {
    openFiles: [],
    activeFile: null,
}

/** True if two paths refer to the same file (handles relative/absolute and slashes). */
export function pathsReferToSameFile(a: string, b: string): boolean {
    const n = (p: string) => p.replace(/\\/g, '/')
    const na = n(a)
    const nb = n(b)
    if (na === nb) return true
    if (na.endsWith('/' + nb) || nb.endsWith('/' + na)) return true
    return false
}

function normalizePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

function isAbsolutePath(path: string): boolean {
    return path.startsWith('/') || /^[A-Za-z]:\//.test(path)
}

export const useFileTabsStore = create<FileTabsState>()(
    persist(
        (set, get) => ({
            projectTabs: {},
            actions: {
                getProjectTabs: (projectId) => {
                    return get().projectTabs[projectId] || defaultTabs
                },
                openFile: (projectId, path) => set((state) => {
                    const tabs = state.projectTabs[projectId] || defaultTabs
                    const existing = tabs.openFiles.find((p) => pathsReferToSameFile(p, path))

                    if (existing !== undefined) {
                        return {
                            projectTabs: {
                                ...state.projectTabs,
                                [projectId]: {
                                    ...tabs,
                                    activeFile: existing
                                }
                            }
                        }
                    }

                    return {
                        projectTabs: {
                            ...state.projectTabs,
                            [projectId]: {
                                openFiles: [...tabs.openFiles, path],
                                activeFile: path
                            }
                        }
                    }
                }),
                closeFile: (projectId, path) => set((state) => {
                    const tabs = state.projectTabs[projectId] || defaultTabs
                    const newFiles = tabs.openFiles.filter(p => p !== path)
                    let newActive = tabs.activeFile

                    if (tabs.activeFile === path) {
                        // If closing active file, switch to last one or null
                        newActive = newFiles.length > 0 ? newFiles[newFiles.length - 1] : null
                    }

                    return {
                        projectTabs: {
                            ...state.projectTabs,
                            [projectId]: {
                                openFiles: newFiles,
                                activeFile: newActive
                            }
                        }
                    }
                }),
                setActiveFile: (projectId, path) => set((state) => {
                    const tabs = state.projectTabs[projectId] || defaultTabs
                    return {
                        projectTabs: {
                            ...state.projectTabs,
                            [projectId]: {
                                ...tabs,
                                activeFile: path
                            }
                        }
                    }
                }),
                replaceFilePath: (projectId, currentPath, nextPath) => set((state) => {
                    const tabs = state.projectTabs[projectId] || defaultTabs
                    const existingNextPath = tabs.openFiles.find((path) => pathsReferToSameFile(path, nextPath)) ?? nextPath

                    const remappedFiles = tabs.openFiles.map((path) =>
                        pathsReferToSameFile(path, currentPath) ? existingNextPath : path
                    )

                    const dedupedFiles: string[] = []
                    for (const path of remappedFiles) {
                        if (!dedupedFiles.some((existing) => pathsReferToSameFile(existing, path))) {
                            dedupedFiles.push(path)
                        }
                    }

                    const activeFile = tabs.activeFile && pathsReferToSameFile(tabs.activeFile, currentPath)
                        ? existingNextPath
                        : tabs.activeFile

                    return {
                        projectTabs: {
                            ...state.projectTabs,
                            [projectId]: {
                                openFiles: dedupedFiles,
                                activeFile,
                            },
                        },
                    }
                }),
                closeAllFiles: (projectId) => set((state) => ({
                    projectTabs: {
                        ...state.projectTabs,
                        [projectId]: defaultTabs
                    }
                })),
                rebaseProjectPaths: (projectId, previousRoot, nextRoot) => set((state) => {
                    const tabs = state.projectTabs[projectId]
                    if (!tabs || tabs.openFiles.length === 0) return state

                    const prev = previousRoot ? normalizePath(previousRoot) : null
                    const next = normalizePath(nextRoot)
                    if (!next || (prev && prev === next)) return state

                    const remappedRaw = tabs.openFiles
                        .map((filePath) => {
                            const normalized = normalizePath(filePath)
                            if (!isAbsolutePath(normalized)) return filePath
                            if (prev && (normalized === prev || normalized.startsWith(`${prev}/`))) {
                                return `${next}${normalized.slice(prev.length)}`
                            }
                            if (normalized === next || normalized.startsWith(`${next}/`)) {
                                return filePath
                            }
                            return null
                        })
                        .filter((value): value is string => Boolean(value))

                    const deduped: string[] = []
                    for (const filePath of remappedRaw) {
                        if (!deduped.some((existing) => pathsReferToSameFile(existing, filePath))) {
                            deduped.push(filePath)
                        }
                    }

                    const remappedActive = (() => {
                        if (!tabs.activeFile) return null
                        const normalized = normalizePath(tabs.activeFile)
                        if (!isAbsolutePath(normalized)) {
                            return deduped.find((p) => pathsReferToSameFile(p, tabs.activeFile!)) ?? tabs.activeFile
                        }
                        if (prev && (normalized === prev || normalized.startsWith(`${prev}/`))) {
                            const candidate = `${next}${normalized.slice(prev.length)}`
                            return deduped.find((p) => pathsReferToSameFile(p, candidate)) ?? candidate
                        }
                        return deduped.find((p) => pathsReferToSameFile(p, tabs.activeFile!)) ?? null
                    })()

                    return {
                        projectTabs: {
                            ...state.projectTabs,
                            [projectId]: {
                                openFiles: deduped,
                                activeFile: remappedActive ?? (deduped.length > 0 ? deduped[deduped.length - 1] : null),
                            },
                        },
                    }
                })
            }
        }),
        {
            name: 'cozea-file-tabs',
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                projectTabs: state.projectTabs,
            }),
        }
    )
)
