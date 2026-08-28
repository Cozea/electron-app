import { useEffect, useState, type ReactNode } from 'react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'

import { HugeiconsIcon } from '@hugeicons/react'
import { Alert01Icon as __AlertTriangleHugeIcon } from '@hugeicons/core-free-icons'

export interface ProjectDeleteConfirmOptions {
  keepLocalFiles: boolean
}

interface ProjectDeleteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  projectName: string
  onConfirm: (options: ProjectDeleteConfirmOptions) => void | Promise<void>
  isDeleting?: boolean
  errorMessage?: string | null
  title?: string
  description?: ReactNode
  confirmLabel?: string
}

export function ProjectDeleteDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
  onConfirm,
  isDeleting = false,
  errorMessage = null,
  title = 'Delete Project',
  description,
  confirmLabel = 'Delete Project',
}: ProjectDeleteDialogProps) {
  // Keep local files by default; user must opt out to send the folder to Trash.
  const [keepLocalFiles, setKeepLocalFiles] = useState(true)
  const [hasManagedLocalWorkspace, setHasManagedLocalWorkspace] = useState(false)

  useEffect(() => {
    if (open) {
      setKeepLocalFiles(true)
      setHasManagedLocalWorkspace(false)

      let cancelled = false
      void window.electronAPI.workspace
        ?.listForProject(projectId)
        .then((workspaces) => {
          if (!cancelled) {
            setHasManagedLocalWorkspace(
              workspaces.some((workspace) => workspace.storageOwnership === 'managed'),
            )
          }
        })
        .catch(() => {
          if (!cancelled) setHasManagedLocalWorkspace(false)
        })

      return () => {
        cancelled = true
      }
    }
  }, [open, projectId])

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isDeleting) {
          return
        }
        onOpenChange(nextOpen)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            {description ?? (
              <>
                Delete {projectName} from Cozea? This removes the project from your account and
                sync. Local files are kept by default.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {hasManagedLocalWorkspace ? (
          <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-muted/30 px-3 py-3">
            <Checkbox
              id="keep-local-files"
              checked={keepLocalFiles}
              disabled={isDeleting}
              onCheckedChange={(checked) => {
                setKeepLocalFiles(checked === true)
              }}
            />
            <div className="space-y-1">
              <Label htmlFor="keep-local-files" className="text-sm font-medium leading-none">
                Keep managed local files
              </Label>
              <p className="text-xs leading-5 text-muted-foreground">
                {keepLocalFiles
                  ? 'Cozea-created and cloned folders stay on disk. Attached folders always stay on disk.'
                  : 'Move only Cozea-managed folders to Trash. Attached folders always stay on disk.'}
              </p>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-border/60 bg-muted/30 px-3 py-3 text-xs leading-5 text-muted-foreground">
            Attached folders stay on disk. Deleting this project only removes Cozea cloud data and local app bindings.
          </div>
        )}

        {errorMessage ? (
          <div className="flex items-start gap-3 rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <HugeiconsIcon icon={__AlertTriangleHugeIcon} className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="leading-6">{errorMessage}</p>
          </div>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault()
              void onConfirm({ keepLocalFiles })
            }}
            disabled={isDeleting}
            className="bg-destructive text-white hover:bg-destructive/90 disabled:bg-destructive/70 disabled:text-white disabled:opacity-100"
          >
            {isDeleting ? 'Deleting...' : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
