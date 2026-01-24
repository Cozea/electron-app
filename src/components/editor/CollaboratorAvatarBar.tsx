import { useCollaborators } from '@/hooks/useCollaborators'
import { useYjsProject } from '@/contexts/YjsProjectContext'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from '@/components/ui/tooltip'
import { Bot, Users } from 'lucide-react'

/**
 * Get initials from a name string.
 */
function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

/**
 * CollaboratorAvatarBar - Shows collaborators currently editing the project.
 *
 * Displays a row of avatars with tooltips showing name, current file,
 * and agent status. Only visible when there are other collaborators.
 */
export function CollaboratorAvatarBar() {
  const { awareness } = useYjsProject()
  const collaborators = useCollaborators(awareness)

  // Don't render if no collaborators
  if (collaborators.length === 0) return null

  return (
    <TooltipProvider>
      <div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/30">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          <span>
            {collaborators.length} collaborator
            {collaborators.length > 1 ? 's' : ''}
          </span>
        </div>

        <div className="flex -space-x-2">
          {collaborators.map((collab) => (
            <Tooltip key={collab.id}>
              <TooltipTrigger asChild>
                <Avatar
                  className="h-6 w-6 border-2 border-background cursor-pointer transition-transform hover:scale-110 hover:z-10"
                  style={{ borderColor: collab.color }}
                >
                  <AvatarFallback
                    className="text-[10px] font-medium"
                    style={{ backgroundColor: collab.color, color: 'white' }}
                  >
                    {collab.isAgent ? (
                      <Bot className="h-3 w-3" />
                    ) : (
                      getInitials(collab.name)
                    )}
                  </AvatarFallback>
                </Avatar>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="flex flex-col gap-0.5">
                <p className="font-medium">{collab.name}</p>
                {collab.cursor && (
                  <p className="text-xs text-muted-foreground">
                    Editing: {collab.cursor.filePath}
                  </p>
                )}
                {collab.isAgent && (
                  <p className="text-xs text-blue-400">AI Agent</p>
                )}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </div>
    </TooltipProvider>
  )
}
