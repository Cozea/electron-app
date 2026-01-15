import { GitBranch, CheckCircle2 } from "lucide-react"

export function StatusBar() {
    return (
        <footer className="h-5 w-full shrink-0 flex items-center justify-between border-t border-border bg-muted/50 px-2 text-[10px] text-muted-foreground select-none relative z-50">
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
            <div className="flex items-center gap-2">
                <div className="hover:text-foreground transition-colors cursor-pointer">
                    Ln 1, Col 1
                </div>
                <div className="hover:text-foreground transition-colors cursor-pointer">
                    UTF-8
                </div>
                <div className="hover:text-foreground transition-colors cursor-pointer">
                    TypeScript React
                </div>
            </div>
        </footer>
    )
}
