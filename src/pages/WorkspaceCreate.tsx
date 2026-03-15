import { useEffect } from 'react'
import { Navigate } from 'react-router-dom'
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
