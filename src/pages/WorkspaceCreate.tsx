import { useEffect } from 'react'
import { Navigate } from '@tanstack/react-router'
import { useCreateWorkspaceDialogStore } from '@/stores/useCreateWorkspaceDialogStore'

export function WorkspaceCreate() {
  const openCreateWorkspaceDialog = useCreateWorkspaceDialogStore(
    (state) => state.open
  )

  useEffect(() => {
    openCreateWorkspaceDialog()
  }, [openCreateWorkspaceDialog])

  return <Navigate to="/projects" replace />
}
