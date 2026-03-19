import { AlertTriangle, Pencil } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4" />
            Rename Project
          </DialogTitle>
          <DialogDescription>
            Update the project name shown across your workspace. Existing access and project data
            stay the same.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="project-rename-name">Project Name</Label>
          <Input
            id="project-rename-name"
            value={value}
            onChange={(event) => {
              onValueChange(event.target.value)
            }}
            placeholder={currentName}
            autoFocus
          />
        </div>

        {errorMessage ? (
          <div className="flex items-start gap-3 rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p className="leading-6">{errorMessage}</p>
          </div>
        ) : null}

        <DialogFooter>
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
