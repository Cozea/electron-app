import * as React from 'react'

export interface ProjectDeleteConfirmOptions {
  keepLocalFiles: boolean
}

export interface ConfirmProjectDeletionOptions {
  projectId: string
  projectName: string
}

/**
 * Native OS confirmation dialog for project deletion.
 * Preflights whether the project has managed local workspace files,
 * presenting a native checkbox for file retention if applicable.
 */
export async function confirmProjectDeletion(options: ConfirmProjectDeletionOptions): Promise<{
  confirmed: boolean
  keepLocalFiles: boolean
}> {
  let hasManagedLocalWorkspace = false
  try {
    const workspaces = await window.electronAPI.workspace?.listForProject(options.projectId)
    hasManagedLocalWorkspace =
      workspaces?.some((workspace) => workspace.storageOwnership === 'managed') ?? false
  } catch {
    hasManagedLocalWorkspace = false
  }

  const boxOptions: Parameters<typeof window.electronAPI.dialog.showMessageBox>[0] = {
    type: 'warning',
    title: 'Delete Project',
    message: `Delete “${options.projectName}” from Cozea?`,
    detail: hasManagedLocalWorkspace
      ? 'This removes the project from your account and sync. Local files are kept by default unless unselected.'
      : 'Attached folders stay on disk. Deleting this project only removes Cozea cloud data and local app bindings.',
    buttons: ['Delete Project', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  }

  if (hasManagedLocalWorkspace) {
    boxOptions.checkboxLabel = 'Keep managed local files'
    boxOptions.checkboxChecked = true
  }

  try {
    const result = await window.electronAPI.dialog.showMessageBox(boxOptions)

    if (result.response !== 0) {
      return { confirmed: false, keepLocalFiles: true }
    }

    const keepLocalFiles = hasManagedLocalWorkspace ? (result.checkboxChecked ?? true) : true
    return { confirmed: true, keepLocalFiles }
  } catch (error) {
    console.error('[confirmProjectDeletion] showMessageBox failed:', error)
    return { confirmed: false, keepLocalFiles: true }
  }
}

export interface ProjectDeleteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  projectName: string
  onConfirm: (options: ProjectDeleteConfirmOptions) => void | Promise<void>
  isDeleting?: boolean
  errorMessage?: string | null
  title?: string
  description?: React.ReactNode
  confirmLabel?: string
}

/**
 * Declarative component adapter for confirmProjectDeletion.
 */
export function ProjectDeleteDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
  onConfirm,
}: ProjectDeleteDialogProps) {
  const hasTriggeredRef = React.useRef(false)

  React.useEffect(() => {
    if (open && !hasTriggeredRef.current) {
      hasTriggeredRef.current = true
      void confirmProjectDeletion({ projectId, projectName }).then(({ confirmed, keepLocalFiles }) => {
        hasTriggeredRef.current = false
        if (confirmed) {
          void onConfirm({ keepLocalFiles })
        } else {
          onOpenChange(false)
        }
      })
    }
  }, [onConfirm, onOpenChange, open, projectId, projectName])

  return null
}
