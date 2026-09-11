/**
 * Start Collaboration Dialog (Section 6.1).
 *
 * Master Specification: Section 6.1
 * Phase: P14
 */

import { useState } from "react"
import { useQuery } from "convex/react"

import { api } from "../../../../../../convex/_generated/api"
import type { Id } from "../../../../../../convex/_generated/dataModel"
import { useAuth } from "@/contexts/AuthContext"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { useCreateCollaborationSession } from "../hooks/useCreateCollaborationSession"

export interface StartCollaborationDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  projectId: Id<"projects">
  projectName: string
  currentBranch?: string | null
  repositoryBindingId?: string
  hasGitRepo?: boolean
  isDirty?: boolean
  onSessionStarted?: (result: { sessionId: string; publicSessionId: string }) => void
}

export function StartCollaborationDialog({
  isOpen,
  onOpenChange,
  projectId,
  projectName,
  currentBranch = "main",
  repositoryBindingId = "repo_default",
  hasGitRepo = true,
  isDirty = false,
  onSessionStarted,
}: StartCollaborationDialogProps) {
  const { principalId } = useAuth()

  const [branchMode, setBranchMode] = useState<"current" | "new">("current")
  const [newBranchName, setNewBranchName] = useState("")
  const [includeDirty, setIncludeDirty] = useState(true)
  const [accessMode, setAccessMode] = useState<"invite_only" | "organization_available">("invite_only")

  const { stage, error, startCollaboration, reset } = useCreateCollaborationSession()

  // Preflight check for existing non-closed session on selected branch
  const activeBranch = branchMode === "current" ? (currentBranch ?? "main") : newBranchName.trim()
  const existingSessions = useQuery(api.collaborationSessions.listByProject, { projectId })
  const duplicateSession = existingSessions?.find(
    (s) => s.branchName === activeBranch && s.lifecycle !== "CLOSED",
  )

  const handleStart = async () => {
    if (!principalId) return
    if (branchMode === "new" && !newBranchName.trim()) return

    try {
      const res = await startCollaboration({
        projectId,
        repositoryBindingId,
        branchName: activeBranch,
        targetBranch: "main",
        includeDirtyChanges: isDirty ? includeDirty : false,
        accessMode,
      })

      onSessionStarted?.({
        sessionId: res.sessionId,
        publicSessionId: res.publicSessionId,
      })
      onOpenChange(false)
    } catch {
      // Error handled by hook
    }
  }

  const isSubmitting = stage !== "idle" && stage !== "error" && stage !== "ready"

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!isSubmitting) {
          reset()
          onOpenChange(open)
        }
      }}
    >
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Start collaboration</DialogTitle>
          <DialogDescription>
            Collaborate on <strong>{projectName}</strong> in real-time across devices.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Step 1: Repository preflight */}
          {!hasGitRepo && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-md text-sm text-amber-600 dark:text-amber-400">
              No remote GitHub repository attached. Connect a repository in Project Settings before enabling remote collaboration.
            </div>
          )}

          {/* Step 2: Branch selection */}
          <div className="space-y-2">
            <Label className="text-xs font-medium">Session Branch</Label>
            <div className="flex gap-2 text-sm">
              <Button
                type="button"
                variant={branchMode === "current" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setBranchMode("current")}
                disabled={isSubmitting}
              >
                Current branch ({currentBranch ?? "main"})
              </Button>
              <Button
                type="button"
                variant={branchMode === "new" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setBranchMode("new")}
                disabled={isSubmitting}
              >
                New branch
              </Button>
            </div>

            {branchMode === "new" && (
              <Input
                placeholder="e.g. feature/live-collab"
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                disabled={isSubmitting}
                className="mt-2"
              />
            )}

            {duplicateSession && (
              <p className="text-xs text-rose-500">
                A collaboration session is already active on branch &apos;{activeBranch}&apos; ({duplicateSession.publicSessionId}).
              </p>
            )}
          </div>

          {/* Step 3: Local dirty state option */}
          {isDirty && (
            <div className="flex items-center space-x-2 pt-1">
              <Checkbox
                id="include-dirty"
                checked={includeDirty}
                onCheckedChange={(c) => setIncludeDirty(Boolean(c))}
                disabled={isSubmitting}
              />
              <label
                htmlFor="include-dirty"
                className="text-sm font-normal leading-none cursor-pointer"
              >
                Include current uncommitted changes in the new session
              </label>
            </div>
          )}

          {/* Step 4: Access mode */}
          <div className="space-y-2 pt-1">
            <Label className="text-xs font-medium">Access Policy</Label>
            <div className="flex gap-3 text-sm">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="accessMode"
                  checked={accessMode === "invite_only"}
                  onChange={() => setAccessMode("invite_only")}
                  disabled={isSubmitting}
                />
                <span>Invite people</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="accessMode"
                  checked={accessMode === "organization_available"}
                  onChange={() => setAccessMode("organization_available")}
                  disabled={isSubmitting}
                />
                <span>Available to organization</span>
              </label>
            </div>
          </div>

          {/* Progress / Error */}
          {error && (
            <div className="p-2.5 bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-md">
              {error}
            </div>
          )}

          {isSubmitting && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground pt-1">
              <Spinner className="h-4 w-4" />
              <span>
                {stage === "creating_session" && "Creating cloud session..."}
              </span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleStart}
            disabled={
              isSubmitting ||
              !hasGitRepo ||
              Boolean(duplicateSession) ||
              (branchMode === "new" && !newBranchName.trim())
            }
          >
            {isSubmitting ? "Starting..." : "Start collaboration"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
