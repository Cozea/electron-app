import { Button } from '@/components/ui/button'
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/components/ui/tooltip'
import { useOptionalSidebar } from '@/components/ui/sidebar'
import { useLocation } from '@/lib/router'
import { cn } from '@/lib/utils'
import type { SVGProps } from 'react'

interface PanelIconProps extends SVGProps<SVGSVGElement> {
    active?: boolean
}

function PanelLeftIcon({ active = false, className, ...props }: PanelIconProps) {
    return (
        <svg viewBox="0 0 24 24" className={className} fill="none" {...props}>
            {active && <rect x="4" y="6" width="5.5" height="12" rx="1.2" fill="currentColor" />}
            <rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
            <line x1="10" y1="6" x2="10" y2="18" stroke="currentColor" strokeWidth="1.8" />
        </svg>
    )
}

/** Left-rail sidebar show/hide; hidden on workbench (toggle lives in workbench toolbar) and per-project settings chrome. */
export function SidebarInsetToggle() {
    const location = useLocation()
    const sidebar = useOptionalSidebar()
    const sidebarState = sidebar?.state ?? 'collapsed'
    const pathname = location.pathname
    const sidebarToggleInWorkbenchHeader = pathname.endsWith('/workbench')
    const sidebarToggleInProjectSettingsHeader = /\/projects\/(?:p\/[^/]+|[^/]+)\/settings(?:\/|$)/.test(
        pathname,
    )
    /** The sidebar's own chrome carries the collapse control. */
    const sidebarToggleInSharedShellLeft =
        /^\/projects\/(?:settings|workspace|teams|store|skills)(\/|$)/.test(pathname) ||
        /^\/projects\/?$/.test(pathname)

    if (
        !sidebar ||
        sidebarToggleInWorkbenchHeader ||
        sidebarToggleInProjectSettingsHeader ||
        sidebarToggleInSharedShellLeft
    ) {
        return null
    }

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                        'h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground',
                        sidebarState === 'expanded' && 'text-foreground',
                    )}
                    onClick={sidebar.toggleSidebar}
                    aria-label={sidebarState === 'expanded' ? 'Hide sidebar' : 'Show sidebar'}
                >
                    <PanelLeftIcon active={sidebarState === 'expanded'} className="h-4 w-4" />
                </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
                {sidebarState === 'expanded' ? 'Hide sidebar' : 'Show sidebar'}
            </TooltipContent>
        </Tooltip>
    )
}

/** Reserved for additional layout controls; sidebar toggle is rendered in `UnifiedHeader` (left cluster). */
export function LayoutToggles() {
    return null
}
