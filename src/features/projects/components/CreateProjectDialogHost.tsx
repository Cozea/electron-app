import { CreateProjectDialog } from "@/features/projects/components/CreateProjectDialog"
import { useCreateProjectDialogStore } from "@/stores/useCreateProjectDialogStore"

export function CreateProjectDialogHost() {
  const isOpen = useCreateProjectDialogStore((state) => state.isOpen)
  const mode = useCreateProjectDialogStore((state) => state.mode)
  const localFolderPath = useCreateProjectDialogStore((state) => state.localFolderPath)
  const close = useCreateProjectDialogStore((state) => state.close)

  return (
    <CreateProjectDialog
      open={isOpen}
      mode={mode}
      initialLocalFolderPath={localFolderPath}
      onOpenChange={(open) => {
        if (!open) {
          close()
        }
      }}
    />
  )
}
