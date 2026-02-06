import { PanelLeft, PanelBottom, PanelRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSidebar } from '@/components/ui/sidebar'
import { useTerminalStore } from '@/stores/useTerminalStore'
import { useAssistantPanelStore } from '@/stores/useAssistantPanelStore'
import { cn } from '@/lib/utils'
import { useParams } from 'react-router-dom'

export function LayoutToggles() {
    const { toggleSidebar, state } = useSidebar()
    const toggleTerminal = useTerminalStore((state) => state.actions.togglePanel)
    const isTerminalOpen = useTerminalStore((state) => state.isPanelOpen)
    const toggleAssistant = useAssistantPanelStore((state) => state.togglePanel)
    const isAssistantOpen = useAssistantPanelStore((state) => state.mode !== 'closed')

    const { slug } = useParams<{ slug: string }>()
    const isProjectContext = Boolean(slug)

    return (
        <div className="flex items-center gap-1">
            <Button
                variant="ghost"
                size="icon"
                className={cn('h-7 w-7 text-muted-foreground', state === 'expanded' && 'bg-accent text-accent-foreground')}
                onClick={toggleSidebar}
            >
                <PanelLeft className="h-4 w-4" />
            </Button>

            <Button
                variant="ghost"
                size="icon"
                disabled={!isProjectContext}
                className={cn('h-7 w-7 text-muted-foreground', isTerminalOpen && 'bg-accent text-accent-foreground')}
                onClick={toggleTerminal}
            >
                <PanelBottom className="h-4 w-4" />
            </Button>

            <Button
                variant="ghost"
                size="icon"
                className={cn('h-7 w-7 text-muted-foreground', isAssistantOpen && 'bg-accent text-accent-foreground')}
                onClick={toggleAssistant}
            >
                <PanelRight className="h-4 w-4" />
            </Button>
        </div>
    )
}
