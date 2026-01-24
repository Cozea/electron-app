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

                    if (tabs.openFiles.includes(path)) {
                        return {
                            projectTabs: {
                                ...state.projectTabs,
                                [projectId]: {
                                    ...tabs,
                                    activeFile: path
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
