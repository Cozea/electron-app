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
        closeAllFiles: (projectId: string) => void
        getProjectTabs: (projectId: string) => ProjectFileTabs
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
                closeAllFiles: (projectId) => set((state) => ({
                    projectTabs: {
                        ...state.projectTabs,
                        [projectId]: defaultTabs
                    }
                }))
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
