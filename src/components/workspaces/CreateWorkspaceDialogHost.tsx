import { useViewTransitionNavigate } from '@/lib/navigation'
import { useCreateWorkspaceDialogStore } from '@/stores/useCreateWorkspaceDialogStore'
import { CreateWorkspaceDialog } from '@/components/workspaces/CreateWorkspaceDialog'

export function CreateWorkspaceDialogHost() {
  const navigate = useViewTransitionNavigate()
  const isOpen = useCreateWorkspaceDialogStore((state) => state.isOpen)
  const redirectTo = useCreateWorkspaceDialogStore((state) => state.redirectTo)
  const close = useCreateWorkspaceDialogStore((state) => state.close)

  return (
    <CreateWorkspaceDialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          close()
        }
      }}
      onCreated={() => {
        close()
        navigate(redirectTo || '/projects')
      }}
    />
  )
}
