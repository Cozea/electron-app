import { Button } from '@/components/ui/button'
import { useSidebar } from '@/components/ui/sidebar'
import { useTerminalStore } from '@/stores/useTerminalStore'
import { useAssistantPanelStore } from '@/stores/useAssistantPanelStore'
import { cn } from '@/lib/utils'
import { useParams } from 'react-router-dom'
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

function PanelBottomIcon({ active = false, className, ...props }: PanelIconProps) {
    return (
        <svg viewBox="0 0 24 24" className={className} fill="none" {...props}>
            {active && <rect x="4" y="13" width="16" height="5" rx="1.2" fill="currentColor" />}
            <rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
            <line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" strokeWidth="1.8" />
        </svg>
    )
}

function PanelRightIcon({ active = false, className, ...props }: PanelIconProps) {
    return (
        <svg viewBox="0 0 24 24" className={className} fill="none" {...props}>
            {active && <rect x="14.5" y="6" width="5.5" height="12" rx="1.2" fill="currentColor" />}
            <rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
            <line x1="14" y1="6" x2="14" y2="18" stroke="currentColor" strokeWidth="1.8" />
        </svg>
    )
}

export function LayoutToggles() {
    const { toggleSidebar, state } = useSidebar()
    const toggleTerminal = useTerminalStore((state) => state.actions.togglePanel)
    const isTerminalOpen = useTerminalStore((state) => state.isPanelOpen)
    const hasTerminalSessions = useTerminalStore((state) => Object.keys(state.terminals).length > 0)
    const toggleAssistant = useAssistantPanelStore((state) => state.togglePanel)
    const isAssistantOpen = useAssistantPanelStore((state) => state.mode !== 'closed')

    const { slug } = useParams<{ slug: string }>()
    const isProjectContext = Boolean(slug)
    const canToggleTerminal = isProjectContext || hasTerminalSessions

    return (
        <div className="flex items-center gap-0.5">
            <Button
                variant="ghost"
                size="icon"
                className={cn('h-7 w-7 text-muted-foreground hover:text-foreground', state === 'expanded' && 'text-foreground')}
                onClick={toggleSidebar}
            >
                <PanelLeftIcon active={state === 'expanded'} className="h-4 w-4" />
            </Button>

            <Button
                variant="ghost"
                size="icon"
                disabled={!canToggleTerminal}
                className={cn('h-7 w-7 text-muted-foreground hover:text-foreground', isTerminalOpen && 'text-foreground')}
                onClick={toggleTerminal}
            >
                <PanelBottomIcon active={isTerminalOpen} className="h-4 w-4" />
            </Button>

            <Button
                variant="ghost"
                size="icon"
                className={cn('h-7 w-7 text-muted-foreground hover:text-foreground', isAssistantOpen && 'text-foreground')}
                onClick={toggleAssistant}
            >
                <PanelRightIcon active={isAssistantOpen} className="h-4 w-4" />
            </Button>
        </div>
    )
}
