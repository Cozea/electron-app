import { lazy, Suspense } from "react"

import { useCreateProjectDialogStore } from "@/stores/useCreateProjectDialogStore"

const LazyCreateProjectDialog = lazy(() =>
  import("@/features/projects/components/CreateProjectDialog").then((module) => ({
    default: module.CreateProjectDialog,
  })),
)

export function CreateProjectDialogHost() {
  const isOpen = useCreateProjectDialogStore((state) => state.isOpen)
  const mode = useCreateProjectDialogStore((state) => state.mode)
  const localFolderPath = useCreateProjectDialogStore((state) => state.localFolderPath)
  const close = useCreateProjectDialogStore((state) => state.close)

  if (!isOpen) {
    return null
  }

  return (
    <Suspense fallback={null}>
      <LazyCreateProjectDialog
        open={isOpen}
        mode={mode}
        initialLocalFolderPath={localFolderPath}
        onOpenChange={(open) => {
          if (!open) {
            close()
          }
        }}
      />
    </Suspense>
  )
}
