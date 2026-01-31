import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import { useFileTabsStore, pathsReferToSameFile } from "@/stores/useFileTabsStore"
import { useParams } from "react-router-dom"
import { useShallow } from 'zustand/react/shallow'
import { getFileIcon } from "@/lib/fileExplorer/fileIcons"

const EMPTY_ARRAY: string[] = []

export function EditorTabs() {
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
