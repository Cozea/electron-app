import { Button } from '@/components/ui/button'
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/components/ui/tooltip'
import { useOptionalSidebar } from '@/components/ui/sidebar'
import { useTerminalStore } from '@/stores/useTerminalStore'
import { cn } from '@/lib/utils'
import { useLocation } from '@/lib/router'
import type { SVGProps } from 'react'
import { parseProjectRoute } from '@/features/projects/lib/projectRoutes'

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

function PanelBottomIcon({ active = false, className, ...props }: PanelIconProps) {
    return (
        <svg viewBox="0 0 24 24" className={className} fill="none" {...props}>
            {active && <rect x="4" y="13" width="16" height="5" rx="1.2" fill="currentColor" />}
            <rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
            <line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" strokeWidth="1.8" />
        </svg>
    )
}

export function LayoutToggles() {
    const sidebar = useOptionalSidebar()
    const toggleTerminal = useTerminalStore((state) => state.actions.togglePanel)
    const isTerminalOpen = useTerminalStore((state) => state.isPanelOpen)
    const hasTerminalSessions = useTerminalStore((state) =>
        Object.values(state.terminals).some((terminal) => terminal.surface !== 'assistant')
    )

    const location = useLocation()
    const routeProject = parseProjectRoute(location.pathname)
    const normalizedPath = location.pathname.replace(/\/+$/, '')
    const isProjectContext = Boolean(routeProject.projectId || routeProject.slug)
    const isProjectBuildRoute = isProjectContext && normalizedPath.endsWith('/build')
    const canToggleTerminal = !isProjectBuildRoute && (isProjectContext || hasTerminalSessions)
    const sidebarState = sidebar?.state ?? 'collapsed'

    return (
        <div className="flex items-center gap-0.5">
            {sidebar ? (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className={cn('h-7 w-7 text-muted-foreground hover:text-foreground', sidebarState === 'expanded' && 'text-foreground')}
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
            ) : null}

            {/* Terminal button: only visible where terminal is available; collapse animates spacing */}
            <div
                className={cn(
                    'overflow-hidden transition-[width,opacity] duration-200 ease-out',
                    canToggleTerminal ? 'w-7 opacity-100' : 'w-0 min-w-0 opacity-0'
                )}
            >
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className={cn('h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground', isTerminalOpen && 'text-foreground')}
                            onClick={toggleTerminal}
                            aria-label={isTerminalOpen ? 'Hide bottom panel' : 'Show bottom panel'}
                        >
                            <PanelBottomIcon active={isTerminalOpen} className="h-4 w-4" />
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">
                        {isTerminalOpen ? 'Hide bottom panel' : 'Show bottom panel'}
                    </TooltipContent>
                </Tooltip>
            </div>
        </div>
    )
}
