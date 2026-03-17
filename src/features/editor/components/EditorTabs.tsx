import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { X, MoreHorizontal } from "lucide-react"
import { cn } from "@/lib/utils"
import { useFileTabsStore, pathsReferToSameFile } from "@/stores/useFileTabsStore"
import { useEditorStore } from "@/stores/useEditorStore"
import { getFileIcon } from "@/lib/fileExplorer/fileIcons"
import { UnsavedChangesDialog } from "@/components/editor/UnsavedChangesDialog"
import { useAccessibleProject } from "@/features/projects/hooks/useAccessibleProject"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const EMPTY_ARRAY: string[] = []

export function EditorTabs() {
    const { project, slugParam, projectIdParam } = useAccessibleProject()
    const [searchParams, setSearchParams] = useSearchParams()
    const projectId = project?.slug ?? slugParam ?? projectIdParam ?? ''

    const filePath = searchParams.get('path')

    const fileTabsStore = useFileTabsStore()
    const { openFiles, activeFile } = projectId
        ? fileTabsStore.actions.getProjectTabs(projectId)
        : { openFiles: EMPTY_ARRAY, activeFile: null }
    const { setActiveFile, closeFile, openFile } = fileTabsStore.actions

    const editorModels = useEditorStore((state) => state.models)
    const editorActions = useEditorStore((state) => state.actions)

    const [showUnsavedDialog, setShowUnsavedDialog] = useState(false)
    const [pendingClosePath, setPendingClosePath] = useState<string | null>(null)
    const [hoveredPath, setHoveredPath] = useState<string | null>(null)
    const syncingFromUrlRef = useRef(false)
    const scrollerRef = useRef<HTMLDivElement | null>(null)
    const [showLeftFade, setShowLeftFade] = useState(false)
    const [showRightFade, setShowRightFade] = useState(false)

    const updateScrollFades = useCallback(() => {
        const el = scrollerRef.current
        if (!el) {
            setShowLeftFade(false)
            setShowRightFade(false)
            return
        }

        const maxScrollLeft = Math.max(0, el.scrollWidth - el.clientWidth)
        if (maxScrollLeft <= 1) {
            setShowLeftFade(false)
            setShowRightFade(false)
            return
        }

        setShowLeftFade(el.scrollLeft > 2)
        setShowRightFade(el.scrollLeft < maxScrollLeft - 2)
    }, [])

    useEffect(() => {
        if (filePath && projectId) {
            syncingFromUrlRef.current = true
            openFile(projectId, filePath)
            setActiveFile(projectId, filePath)
        }
    }, [filePath, projectId, openFile, setActiveFile])

    const handleTabClick = (path: string) => {
        if (projectId) {
            setActiveFile(projectId, path)
            setSearchParams({ path })
        }
    }

    const handleCloseTab = (e: React.MouseEvent, path: string) => {
        e.stopPropagation()
        if (!projectId) return

        const model = editorModels[path]
        if (model?.isDirty) {
            setPendingClosePath(path)
            setShowUnsavedDialog(true)
            return
        }

        editorActions.closeFile(path)
        closeFile(projectId, path)
    }

    const handleDiscardAndClose = () => {
        if (pendingClosePath && projectId) {
            editorActions.closeFile(pendingClosePath)
            closeFile(projectId, pendingClosePath)
        }
        setShowUnsavedDialog(false)
        setPendingClosePath(null)
    }

    const handleSaveAndClose = async () => {
        if (pendingClosePath && projectId) {
            await editorActions.saveFile(pendingClosePath)
            editorActions.closeFile(pendingClosePath)
            closeFile(projectId, pendingClosePath)
        }
        setShowUnsavedDialog(false)
        setPendingClosePath(null)
    }

    const handleCancelClose = () => {
        setShowUnsavedDialog(false)
        setPendingClosePath(null)
    }

    const handleCloseAll = () => {
        if (!projectId) return
        const hasUnsaved = openFiles.some(path => editorModels[path]?.isDirty)

        if (hasUnsaved) {
            openFiles.forEach(path => {
                if (!editorModels[path]?.isDirty) {
                    editorActions.closeFile(path)
                    closeFile(projectId, path)
                }
            })
        } else {
            openFiles.forEach(path => {
                editorActions.closeFile(path)
                closeFile(projectId, path)
            })
        }
    }

    const handleCloseAllSaved = () => {
        if (!projectId) return
        openFiles.forEach(path => {
            if (!editorModels[path]?.isDirty) {
                editorActions.closeFile(path)
                closeFile(projectId, path)
            }
        })
    }

    useEffect(() => {
        if (!projectId) return

        if (syncingFromUrlRef.current) {
            if ((activeFile && filePath && pathsReferToSameFile(activeFile, filePath)) || !filePath) {
                syncingFromUrlRef.current = false
            }
            return
        }

        const urlPath = searchParams.get('path')

        if (activeFile) {
            if (!urlPath || !pathsReferToSameFile(activeFile, urlPath)) {
                const nextParams = new URLSearchParams(searchParams)
                nextParams.set('path', activeFile)
                setSearchParams(nextParams, { replace: true })
            }
            return
        }

        if (urlPath) {
            const nextParams = new URLSearchParams(searchParams)
            nextParams.delete('path')
            setSearchParams(nextParams, { replace: true })
        }
    }, [activeFile, filePath, projectId, searchParams, setSearchParams])

    useEffect(() => {
        const el = scrollerRef.current
        if (!el) return

        requestAnimationFrame(() => updateScrollFades())

        const onScroll = () => requestAnimationFrame(() => updateScrollFades())
        el.addEventListener('scroll', onScroll, { passive: true })

        const resizeObserver = new ResizeObserver(() => requestAnimationFrame(() => updateScrollFades()))
        resizeObserver.observe(el)

        return () => {
            el.removeEventListener('scroll', onScroll)
            resizeObserver.disconnect()
        }
    }, [openFiles.length, updateScrollFades])

    if (openFiles.length === 0) return null

    return (
        <>
            <div className="relative flex w-full min-w-0 items-center h-9 bg-transparent">
                <div className="relative flex-1 min-w-0 h-full">
                    <div ref={scrollerRef} className="flex items-center h-full overflow-x-auto scrollbar-hide">
                        {openFiles.map((path, index) => {
                            const isActive = path === activeFile || (activeFile != null && pathsReferToSameFile(path, activeFile))
                            const nextPath = openFiles[index + 1]
                            const isNextActive = nextPath
                                ? (nextPath === activeFile || (activeFile != null && pathsReferToSameFile(nextPath, activeFile)))
                                : false
                            const isHovered = hoveredPath != null && pathsReferToSameFile(path, hoveredPath)
                            const isNextHovered = nextPath != null && hoveredPath != null && pathsReferToSameFile(nextPath, hoveredPath)
                            const showSeparator = !isActive && !isNextActive && !isHovered && !isNextHovered && index < openFiles.length - 1
                            const fileName = path.split('/').pop() || 'file'
                            const model = editorModels[path]
                            const isDirty = model?.isDirty ?? false
                            return (
                                <div
                                    key={path}
                                    onClick={() => handleTabClick(path)}
                                    onMouseEnter={() => setHoveredPath(path)}
                                    onMouseLeave={() => setHoveredPath((current) => (current && pathsReferToSameFile(current, path) ? null : current))}
                                    className={cn(
                                        "relative flex items-center gap-2 px-3 h-full min-w-[120px] max-w-[200px] shrink-0 text-xs cursor-pointer select-none group",
                                        isActive
                                            ? "bg-foreground/14 text-foreground rounded-full h-7 my-1"
                                            : "bg-transparent text-muted-foreground hover:bg-foreground/10 hover:text-foreground rounded-full h-7 my-1"
                                    )}
                                >
                                    {showSeparator && (
                                        <span
                                            className="pointer-events-none absolute right-0 top-1/2 h-4 -translate-y-1/2 w-px bg-border/70"
                                            aria-hidden
                                        />
                                    )}
                                    {getFileIcon(fileName, { width: 14, height: 14 })}
                                    <span className="truncate flex-1">{fileName}</span>
                                    {isDirty && (
                                        <span
                                            className="w-2 h-2 rounded-full bg-amber-500 shrink-0"
                                            title="Unsaved changes"
                                        />
                                    )}
                                    <button
                                        onClick={(e) => handleCloseTab(e, path)}
                                        className={cn(
                                            "rounded-sm p-0.5 opacity-0 group-hover:opacity-100 hover:bg-muted text-muted-foreground hover:text-foreground transition-all",
                                            isActive && "opacity-100",
                                            isDirty && "group-hover:opacity-100"
                                        )}
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                </div>
                            )
                        })}
                    </div>

                    <div
                        className={cn(
                            "tab-scroll-fade-left pointer-events-none absolute left-0 top-0 h-full w-6 transition-opacity duration-150",
                            showLeftFade ? "opacity-100" : "opacity-0"
                        )}
                    />
                    <div
                        className={cn(
                            "tab-scroll-fade-right pointer-events-none absolute right-0 top-0 h-full w-6 transition-opacity duration-150",
                            showRightFade ? "opacity-100" : "opacity-0"
                        )}
                    />
                </div>

                <div className="shrink-0 flex items-center h-full bg-transparent">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <button className="h-9 w-9 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
                                <MoreHorizontal className="h-4 w-4" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={handleCloseAll}>
                                Close All
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={handleCloseAllSaved}>
                                Close All Saved
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>

            <UnsavedChangesDialog
                open={showUnsavedDialog}
                fileName={pendingClosePath?.split('/').pop() || 'file'}
                onCancel={handleCancelClose}
                onDiscard={handleDiscardAndClose}
                onSave={handleSaveAndClose}
            />
        </>
    )
}
