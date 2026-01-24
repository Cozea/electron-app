import { Play, Save, Settings, PanelTop, TerminalSquare } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useEditorStore } from "@/stores/useEditorStore"
import { useFileTabsStore } from "@/stores/useFileTabsStore"
import { useParams } from "react-router-dom"

export function EditorToolbar() {
    const { slug } = useParams<{ slug: string }>()
    const projectId = slug // Using slug as ID for now or need real ID

    const activeFile = useFileTabsStore(state => projectId ? state.projectTabs[projectId]?.activeFile : null)
    const saveFile = useEditorStore(state => state.actions.saveFile)
    const isDirty = useEditorStore(state => activeFile ? state.models[activeFile]?.isDirty : false)

    const handleSave = () => {
        if (activeFile) {
            saveFile(activeFile)
        }
    }

    return (
        <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/40 h-10 shrink-0">
            <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground font-mono">
                    {activeFile || 'No file selected'}
                </span>
                {isDirty && (
                    <div className="h-1.5 w-1.5 rounded-full bg-yellow-500" />
                )}
            </div>

            <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleSave} disabled={!activeFile}>
                    <Save className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7">
                    <Play className="h-4 w-4" />
                </Button>
                <div className="w-px h-4 bg-border mx-1" />
                <Button variant="ghost" size="icon" className="h-7 w-7">
                    <TerminalSquare className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7">
                    <PanelTop className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7">
                    <Settings className="h-4 w-4" />
                </Button>
            </div>
        </div>
    )
}
