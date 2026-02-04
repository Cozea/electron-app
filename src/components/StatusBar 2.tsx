import { GitBranch, CheckCircle2 } from "lucide-react"

export function StatusBar() {
    return (
        <footer className="h-6 w-full shrink-0 flex items-center justify-between border-t border-sidebar-border bg-sidebar px-2 text-[11px] text-sidebar-foreground/70 select-none relative z-50">
            <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 hover:text-foreground transition-colors cursor-pointer">
                    <GitBranch className="h-2.5 w-2.5" />
                    <span>main</span>
                </div>
                <div className="flex items-center gap-1.5 hover:text-foreground transition-colors cursor-pointer">
                    <CheckCircle2 className="h-2.5 w-2.5" />
                    <span>No Issues</span>
                </div>
            </div>
            <div className="flex items-center">
                <span>Cozea 0.9.5 Beta</span>
            </div>
        </footer>
    )
}
