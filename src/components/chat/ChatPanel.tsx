import { useChatPanelStore } from "@/stores/useChatPanelStore"
import { cn } from "@/lib/utils"

export function ChatPanel() {
    const isOpen = useChatPanelStore((state) => state.isOpen)
    const mode = useChatPanelStore((state) => state.mode)

    if (!isOpen) return null

    return (
        <div className={cn(
            "bg-content-surface flex h-full flex-col transition-all duration-300 ease-in-out relative",
            mode === 'fullscreen' ? "min-w-0 flex-1" : "w-[400px] border-l border-border"
        )}>
            <div className="h-10 shrink-0" aria-hidden="true" />
            <div className="h-14 bdry-b flex items-center justify-between px-4">
                <span className="text-xs font-normal">AI Chat</span>
            </div>
            <div className="flex-1 p-4">
                Chat Content Here
            </div>
        </div>
    )
}
