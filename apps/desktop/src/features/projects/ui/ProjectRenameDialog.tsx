import { Button } from '@/components/ui/button'
import { UnifiedModal, UnifiedModalField } from '@/components/ui/unified-modal'

import { HugeiconsIcon } from '@hugeicons/react'
import { Alert01Icon as __AlertTriangleHugeIcon } from '@hugeicons/core-free-icons'

interface ProjectRenameDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentName: string
  value: string
  onValueChange: (value: string) => void
  onConfirm: (name: string) => void | Promise<void>
  isSaving?: boolean
  errorMessage?: string | null
}

export function ProjectRenameDialog({
  open,
  onOpenChange,
  currentName,
  value,
  onValueChange,
  onConfirm,
  isSaving = false,
  errorMessage = null,
}: ProjectRenameDialogProps) {
  const trimmedValue = value.trim()
  const isUnchanged = trimmedValue === currentName.trim()

  return (
    <UnifiedModal
      open={open}
      onOpenChange={onOpenChange}
      title="Rename Project"
      size="md"
      dismissable={!isSaving}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              void onConfirm(trimmedValue)
            }}
            disabled={isSaving || !trimmedValue || isUnchanged}
          >
            {isSaving ? 'Saving...' : 'Save Name'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Update the project name shown across your workspace. Existing access and project data
          stay the same.
        </p>

        <UnifiedModalField
          id="project-rename-name"
          label="Project Name"
          value={value}
          onChange={onValueChange}
          autoFocus
        />

        {errorMessage ? (
          <div className="flex items-start gap-3 rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <HugeiconsIcon icon={__AlertTriangleHugeIcon} className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="leading-6">{errorMessage}</p>
          </div>
        ) : null}
      </div>
    </UnifiedModal>
  )
}
