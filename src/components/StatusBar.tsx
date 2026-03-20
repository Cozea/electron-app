import type { ReactNode } from "react"
import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

interface StatusBarItem {
    label: string
    icon?: LucideIcon
}

interface StatusBarProps {
    leftAddon?: ReactNode
    leftItems?: StatusBarItem[]
    rightItems?: StatusBarItem[]
    className?: string
}

function StatusBarItems({ items }: { items: StatusBarItem[] }) {
    return (
        <div className="flex min-w-0 items-center gap-0.5">
            {items.map((item) => {
                const Icon = item.icon
                return (
                    <div
                        key={`${item.label}-${Icon?.displayName ?? "text"}`}
                        className="flex min-w-0 items-center gap-1.5 rounded px-1.5 py-0.5"
                    >
                        {Icon ? <Icon className="h-3 w-3 shrink-0" /> : null}
                        <span className="truncate">{item.label}</span>
                    </div>
                )
            })}
        </div>
    )
}

export function StatusBar({
    leftAddon,
    leftItems = [],
    rightItems = [],
    className,
}: StatusBarProps) {
    return (
        <footer
            className={cn(
                "h-6 w-full shrink-0 select-none border-t border-border bg-[var(--content-surface)] px-2 text-[11px] text-muted-foreground",
                "relative z-50 flex items-center justify-between gap-3 overflow-hidden",
                className
            )}
        >
            <div className="flex min-w-0 flex-1 items-center overflow-hidden">
                {leftAddon ? (
                    <>
                        <div className="shrink-0">{leftAddon}</div>
                        <div className="mx-1.5 h-3 w-px shrink-0 bg-border" aria-hidden="true" />
                    </>
                ) : null}
                <StatusBarItems items={leftItems} />
            </div>
            <div className="min-w-0 shrink-0 overflow-hidden">
                <StatusBarItems items={rightItems} />
            </div>
        </footer>
    )
}
