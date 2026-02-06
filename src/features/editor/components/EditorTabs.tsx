import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useFileTabsStore, pathsReferToSameFile } from "@/stores/useFileTabsStore"
import { useParams } from "react-router-dom"
import { useShallow } from 'zustand/react/shallow'
import { getFileIcon } from "@/lib/fileExplorer/fileIcons"

const EMPTY_ARRAY: string[] = []

interface EditorTabsProps {
    variant?: 'inline' | 'header'
}

export function EditorTabs({ variant = 'inline' }: EditorTabsProps) {
    const { slug } = useParams<{ slug: string }>()
    const projectId = slug || 'default'

    // Separate selectors with useShallow is safer, or just select the specific project state safely
    const projectTabs = useFileTabsStore(
        useShallow(state => state.projectTabs[projectId])
    )

    // Stable references
    const openFiles = projectTabs?.openFiles || EMPTY_ARRAY
    const activeFile = projectTabs?.activeFile || null

    const { setActiveFile, closeFile } = useFileTabsStore(state => state.actions)

    if (openFiles.length === 0) return null

    if (variant === 'header') {
        return (
            <div className="flex items-center overflow-x-auto scrollbar-hide">
                {openFiles.map((path, index) => {
                    const name = path.split('/').pop()
                    const isActive = path === activeFile || (activeFile != null && pathsReferToSameFile(path, activeFile))
                    return (
                        <div key={path} className="flex items-center">
                            {index > 0 && <div className="h-4 w-px bg-border/60 mx-1" />}
                            <button
                                className={cn(
                                    "group flex items-center h-7 px-3 text-xs cursor-pointer select-none gap-2 transition-colors",
                                    "rounded-md text-muted-foreground/80 hover:text-foreground hover:bg-muted/40",
                                    isActive && "rounded-full bg-secondary/80 text-secondary-foreground hover:bg-secondary font-medium"
                                )}
                                onClick={() => setActiveFile(projectId, path)}
                            >
                                <span className="shrink-0 flex items-center">{getFileIcon(name || '', { width: 14, height: 14 })}</span>
                                <span className="truncate max-w-[160px]">{name}</span>
                                <span
                                    className={cn(
                                        "ml-1 flex h-4 w-4 items-center justify-center rounded text-muted-foreground/70 hover:text-foreground hover:bg-muted-foreground/20 transition-opacity",
                                        isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                                    )}
                                    onClick={(e) => {
                                        e.stopPropagation()
                                        closeFile(projectId, path)
                                    }}
                                >
                                    <X className="h-3 w-3" />
                                </span>
                            </button>
                        </div>
                    )
                })}
            </div>
        )
    }

    return (
        <div className="flex flex-row overflow-x-auto bg-muted/20 border-b h-7 shrink-0 scrollbar-hide">
            {openFiles.map(path => {
                const name = path.split('/').pop()
                const isActive = path === activeFile || (activeFile != null && pathsReferToSameFile(path, activeFile))
                return (
                    <div
                        key={path}
                        className={cn(
                            "flex items-center h-full group min-w-[120px] max-w-[200px] border-r px-2.5 text-xs cursor-pointer select-none hover:bg-muted/50",
                            isActive && "bg-background font-medium border-t-2 border-t-primary"
                        )}
                        onClick={() => setActiveFile(projectId, path)}
                    >
                        <span className="shrink-0 flex items-center">{getFileIcon(name || '', { width: 14, height: 14 })}</span>
                        <span className="truncate flex-1 ml-1.5">{name}</span>
                        <button
                            className={cn(
                                "ml-2 opacity-0 group-hover:opacity-100 hover:bg-muted-foreground/20 rounded p-0.5",
                                isActive && "opacity-100"
                            )}
                            onClick={(e) => {
                                e.stopPropagation()
                                closeFile(projectId, path)
                            }}
                        >
                            <X className="h-3 w-3" />
                        </button>
                    </div>
                )
            })}
        </div>
    )
}
