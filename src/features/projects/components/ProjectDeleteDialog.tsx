import { useState, type ReactNode } from 'react'

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
  projectName,
  onConfirm,
  isDeleting = false,
  errorMessage = null,
  title = 'Delete Project',
  description,
  confirmLabel = 'Delete Project',
}: ProjectDeleteDialogProps) {
  const [keepLocalFiles, setKeepLocalFiles] = useState(true)

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && isDeleting) {
          return
        }
        if (!nextOpen) {
          setKeepLocalFiles(true)
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
                Delete {projectName} from Cozea? This removes the project and its cloud data.
                Local files on this machine are kept by default.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex items-start gap-3">
          <Checkbox
            id="keep-local-files"
            checked={keepLocalFiles}
            disabled={isDeleting}
            onCheckedChange={(checked) => {
              setKeepLocalFiles(checked === true)
            }}
            className="mt-0.5"
          />
          <div className="space-y-1">
            <Label htmlFor="keep-local-files" className="font-medium leading-none">
              Keep local files on this machine
            </Label>
            <p className="text-xs text-muted-foreground leading-5">
              Uncheck to move the project folder to Trash.
            </p>
          </div>
        </div>

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
