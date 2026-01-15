import { Bot } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAssistantPanelStore } from '@/stores/useAssistantPanelStore'
import { cn } from '@/lib/utils'

export function AssistantToggleButton() {
  const { mode, togglePanel } = useAssistantPanelStore()
  const isOpen = mode !== 'closed'

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={togglePanel}
      className={cn(
        'h-6 w-6 text-muted-foreground',
        isOpen && 'bg-accent text-accent-foreground'
      )}
      aria-label={isOpen ? 'Close AI assistant panel' : 'Open AI assistant panel'}
    >
      <Bot className="h-3.5 w-3.5" />
    </Button>
  )
}
