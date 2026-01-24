import * as React from "react"
import { useChatPanelStore } from "@/stores/useChatPanelStore"
import { cn } from "@/lib/utils"
import { X } from "lucide-react"
import { Button } from "@/components/ui/button"

export function ChatPanel() {
    const { isOpen, mode } = useChatPanelStore()
    const { close } = useChatPanelStore(state => state.actions)

    if (!isOpen) return null

    return (
        <div className={cn(
            "border-l bg-background flex flex-col transition-all duration-300 ease-in-out",
            mode === 'fullscreen' ? "w-full absolute inset-0 z-50" : "w-[400px]"
        )}>
            <div className="h-14 border-b flex items-center justify-between px-4">
                <span className="font-semibold">AI Chat</span>
                <Button variant="ghost" size="icon" onClick={close}>
                    <X className="h-4 w-4" />
                </Button>
            </div>
            <div className="flex-1 p-4">
                Chat Content Here
            </div>
        </div>
    )
}
