import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Loader2, X } from 'lucide-react'

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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useAuth } from '@/contexts/AuthContext'
import type { WorkspaceIdentityInput } from '@shared/workspaceIdentity.ts'
import { WorkspaceIdentityPicker } from '@/components/workspaces/WorkspaceIdentityPicker'
import { getDefaultWorkspaceName } from '@/lib/workspaces/defaultWorkspaceName'

interface CreateWorkspaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: () => void | Promise<void>
}

export function CreateWorkspaceDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateWorkspaceDialogProps) {
  const {
    user,
    createOrganizationWorkspace,
    checkOrganizationWorkspaceNameAvailability,
  } = useAuth()
  const defaultWorkspaceName = useMemo(
    () => getDefaultWorkspaceName(user?.email, user?.firstName),
    [user?.email, user?.firstName]
  )

  const [workspaceName, setWorkspaceName] = useState(defaultWorkspaceName)
  const [identity, setIdentity] = useState<WorkspaceIdentityInput>({})
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [hasEditedWorkspaceName, setHasEditedWorkspaceName] = useState(false)
  const [availability, setAvailability] = useState<{
    status: 'idle' | 'checking' | 'available' | 'unavailable'
    message: string | null
  }>({
    status: 'idle',
    message: null,
  })
  const availabilityRequestRef = useRef(0)
  const lastResolvedNameRef = useRef<string | null>(null)

  useEffect(() => {
    if (!open) return
    setWorkspaceName(defaultWorkspaceName)
    setIdentity({})
    setCreateError(null)
    setHasEditedWorkspaceName(false)
    setAvailability({ status: 'idle', message: null })
    lastResolvedNameRef.current = null
  }, [defaultWorkspaceName, open])

  useEffect(() => {
    if (!open) return

    const trimmedName = workspaceName.trim()
    if (!hasEditedWorkspaceName || !trimmedName) {
      availabilityRequestRef.current += 1
      setAvailability({ status: 'idle', message: null })
      return
    }

    if (lastResolvedNameRef.current === trimmedName) {
      return
    }

    const requestId = availabilityRequestRef.current + 1
    availabilityRequestRef.current = requestId

    const timeoutId = window.setTimeout(() => {
      setAvailability({
        status: 'checking',
        message: 'Checking workspace name availability',
      })
      void checkOrganizationWorkspaceNameAvailability(trimmedName)
        .then((result) => {
          if (availabilityRequestRef.current !== requestId) return
          lastResolvedNameRef.current = trimmedName
          setAvailability(
            result.available
              ? {
                  status: 'available',
                  message: 'Workspace name is available',
                }
              : {
                  status: 'unavailable',
                  message:
                    result.reason || 'Workspace name is unavailable',
                }
          )
        })
        .catch((error) => {
          if (availabilityRequestRef.current !== requestId) return
          lastResolvedNameRef.current = trimmedName
          setAvailability({
            status: 'unavailable',
            message:
              error instanceof Error
                ? error.message
                : 'Failed to check workspace name availability',
          })
        })
    }, 350)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [
    checkOrganizationWorkspaceNameAvailability,
    hasEditedWorkspaceName,
    open,
    workspaceName,
  ])

  const handleCreateWorkspace = async () => {
    if (
      !workspaceName.trim() ||
      isCreating ||
      availability.status === 'checking' ||
      availability.status === 'unavailable'
    ) {
      return
    }

    setIsCreating(true)
    setCreateError(null)

    try {
      await createOrganizationWorkspace(workspaceName.trim(), identity)
      onOpenChange(false)
      await onCreated?.()
    } catch (error) {
      console.error('Failed to create workspace:', error)
      setCreateError(
        error instanceof Error ? error.message : 'Failed to create workspace'
      )
    } finally {
      setIsCreating(false)
    }
  }

  const availabilityIndicator =
    availability.status === 'idle' ? null : (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="absolute inset-y-0 right-3 flex items-center">
            {availability.status === 'checking' ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : availability.status === 'available' ? (
              <span className="flex size-[18px] items-center justify-center rounded-full bg-emerald-500 text-white">
                <Check className="size-2.5" />
              </span>
            ) : (
              <span className="flex size-[18px] items-center justify-center rounded-full bg-destructive text-white">
                <X className="size-2.5" />
              </span>
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent side="left">
          {availability.message}
        </TooltipContent>
      </Tooltip>
    )

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (isCreating && !nextOpen) return
        onOpenChange(nextOpen)
      }}
    >
    <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-xl" showCloseButton={false}>
        <div className="px-6 pt-6">
          <DialogHeader className="items-start text-left">
            <DialogTitle>Create workspace</DialogTitle>
            <DialogDescription>
              Create another workspace for members, permissions, and shared
              settings.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="space-y-5 px-6 py-6">
          <div className="space-y-2">
            <Label htmlFor="create-workspace-name">Workspace name</Label>
            <div className="relative">
              <Input
                id="create-workspace-name"
                autoFocus
                placeholder="My Workspace"
                value={workspaceName}
                onChange={(event) => {
                  lastResolvedNameRef.current = null
                  setHasEditedWorkspaceName(true)
                  setWorkspaceName(event.target.value)
                  setCreateError(null)
                  setAvailability({ status: 'idle', message: null })
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && workspaceName.trim()) {
                    void handleCreateWorkspace()
                  }
                }}
                className="pr-10"
                disabled={isCreating}
              />
              {availabilityIndicator}
            </div>
          </div>

          <WorkspaceIdentityPicker
            workspaceType="organization"
            workspaceName={workspaceName.trim() || 'Workspace'}
            value={identity}
            onChange={setIdentity}
            disabled={isCreating}
          />

          {createError ? (
            <p className="text-sm text-destructive">{createError}</p>
          ) : null}
        </div>

        <DialogFooter className="border-t border-border/60 px-6 py-4 sm:justify-between">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isCreating}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void handleCreateWorkspace()}
            disabled={
              !workspaceName.trim() ||
              isCreating ||
              availability.status === 'checking' ||
              availability.status === 'unavailable'
            }
          >
            {isCreating ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Creating...
              </>
            ) : (
              'Create workspace'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
