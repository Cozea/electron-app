import { useChatPanelStore } from "@/stores/useChatPanelStore"
import { cn } from "@/lib/utils"

export function ChatPanel() {
    const isOpen = useChatPanelStore((state) => state.isOpen)
    const mode = useChatPanelStore((state) => state.mode)

    if (!isOpen) return null

    return (
        <div className={cn(
            "bg-background flex flex-col transition-all duration-300 ease-in-out bdry-l relative sidebar-fade-border",
            mode === 'fullscreen' ? "w-full absolute inset-0 z-50" : "w-[400px]"
        )}>
            <div className="h-14 bdry-b flex items-center justify-between px-4">
                <span className="font-semibold">AI Chat</span>
            </div>
            <div className="flex-1 p-4">
                Chat Content Here
            </div>
        </div>
    )
}
