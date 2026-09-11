/**
 * Collaboration Session Invitation card for Inbox (Section 6.3).
 *
 * Master Specification: Section 6.3
 * Phase: P15
 */

import { useState } from "react"
import { useMutation } from "convex/react"

import { api } from "../../../../../../convex/_generated/api"
import type { Id } from "../../../../../../convex/_generated/dataModel"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { appToast } from "@/lib/appToast"

export interface SessionInvitationItem {
  invitationId: Id<"collaborationSessionInvitations">
  sessionId: Id<"collaborationSessions">
  publicSessionId: string
  projectId: Id<"projects">
  projectName: string
  branchName: string
  targetBranch: string
  role: string
  sessionLifecycle: string
  inviterName: string
  expiresAt: number
  createdAt: number
}

export function SessionInvitationCard({
  item,
  onAccepted,
}: {
  item: SessionInvitationItem
  onAccepted?: (result: { projectId: string; sessionId: string; branchName: string }) => void
}) {
  const [isBusy, setIsBusy] = useState(false)
  const resolveInvitation = useMutation(api.collaborationSessions.resolveInvitation)

  const handleAction = async (accept: boolean) => {
    setIsBusy(true)
    try {
      // The server resolves the invitation for the authenticated device.
      const res = await resolveInvitation({
        invitationId: item.invitationId,
        accept,
      })

      if (!res.accepted && res.reason === "expired") {
        appToast.error({
          title: "Invitation expired",
          description: `Ask for a new invitation to ${item.projectName}.`,
        })
      } else if (res.accepted) {
        appToast.success({
          title: "Invitation accepted",
          description: `You joined collaboration session for ${item.projectName} on branch ${item.branchName}.`,
        })
        onAccepted?.({
          projectId: String(res.projectId),
          sessionId: String(res.sessionId),
          branchName: res.branchName ?? item.branchName,
        })
      } else {
        appToast.info({
          title: "Invitation declined",
          description: `Declined session invitation for ${item.projectName}.`,
        })
      }
    } catch (err: any) {
      appToast.error({
        title: "Action failed",
        description: err.message ?? "Failed to update invitation",
      })
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-card p-4 shadow-xs">
      <div className="flex items-start space-x-3 min-w-0">
        <Avatar className="h-9 w-9 shrink-0">
          <AvatarFallback>{item.projectName.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm truncate">{item.projectName}</span>
            <Badge variant="secondary" className="text-xs">
              {item.branchName}
            </Badge>
            <Badge variant="outline" className="text-xs capitalize">
              {item.role.replace("_", " ")}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Invited by <strong className="text-foreground">{item.inviterName}</strong> to collaborate on branch &apos;{item.branchName}&apos; (target: {item.targetBranch}).
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0 ml-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => handleAction(false)}
          disabled={isBusy}
        >
          Decline
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => handleAction(true)}
          disabled={isBusy}
        >
          {isBusy ? <Spinner className="h-3.5 w-3.5 mr-1" /> : null}
          Accept & Join
        </Button>
      </div>
    </div>
  )
}
