/**
 * Live session invitation card for the Inbox.
 *
 * Master Specification: Section 6.3
 * Phase: P15
 *
 * Accepting joins the session and grants project access in one step on the server.
 * The Inbox then makes sure this Mac has a copy of the project (sessionCopy.ts), and
 * the folder starts syncing once the invitee opens the project on the session branch.
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
import { cleanConvexError } from "@/lib/convexError"
import { useTranslation } from "@/lib/i18n"

export interface SessionInvitationItem {
  invitationId: Id<"collaborationSessionInvitations">
  sessionId: Id<"collaborationSessions">
  publicSessionId: string
  projectId: Id<"projects">
  projectName: string
  branchName: string
  targetBranch: string
  /** The Git remote the session recorded; cloned when this Mac has no copy of the project. */
  repositoryUrl: string | null
  /** Whether the session shares the project's env files. */
  shareEnvironmentFiles: boolean
  role: string
  sessionLifecycle: string
  inviterName: string
  expiresAt: number
  createdAt: number
}

function formatRole(role: string): string {
  return role
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

export function SessionInvitationCard({
  item,
  onAccepted,
}: {
  item: SessionInvitationItem
  onAccepted?: (result: {
    projectId: string
    sessionId: string
    publicSessionId: string
    branchName: string
    repositoryUrl: string | null
  }) => void
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null)
  const resolveInvitation = useMutation(api.collaborationSessions.resolveInvitation)

  const handleAction = async (accept: boolean) => {
    setBusy(accept ? "accept" : "decline")
    try {
      // The server resolves the invitation for the authenticated device.
      const res = await resolveInvitation({ invitationId: item.invitationId, accept })
      if (!res.accepted && res.reason === "expired") {
        appToast.error({
          title: "Invitation expired",
          description: `Ask for a new invitation to ${item.projectName}.`,
        })
      } else if (res.accepted) {
        const branchName = res.branchName ?? item.branchName
        appToast.success({
          title: "Joined the live session",
          description: `You're in the live session on ${branchName} in ${item.projectName}.`,
        })
        onAccepted?.({
          projectId: String(res.projectId),
          sessionId: String(res.sessionId),
          publicSessionId: item.publicSessionId,
          branchName,
          repositoryUrl: res.repositoryUrl ?? item.repositoryUrl,
        })
      } else {
        appToast.info({
          title: t("inbox.declined"),
          description: `Declined the live session on ${item.branchName} in ${item.projectName}.`,
        })
      }
    } catch (err) {
      appToast.error({
        title: "Action failed",
        description: cleanConvexError(err, "Could not update this invitation."),
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-card/60 p-4 transition-colors hover:border-border/90 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3 sm:items-center">
        <Avatar className="size-10 shrink-0 rounded-lg">
          <AvatarFallback className="rounded-lg text-xs font-medium">
            {item.projectName.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-medium text-foreground">{item.projectName}</h3>
            <Badge variant="secondary" shape="pill" size="sm" className="font-mono">
              {item.branchName}
            </Badge>
            <Badge variant="outline" shape="pill" size="sm">
              {formatRole(item.role)}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {item.inviterName} invited you to the live session on {item.branchName}
            {item.targetBranch !== item.branchName ? `, which merges into ${item.targetBranch}` : ""}.
            {item.shareEnvironmentFiles ? " It shares the project's .env files with you." : ""}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 pt-1 sm:pt-0">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 text-xs font-normal"
          onClick={() => void handleAction(false)}
          disabled={busy !== null}
        >
          {busy === "decline" ? <Spinner size="xs" className="mr-1.5" /> : null}
          {t("inbox.decline")}
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-8 text-xs font-medium"
          onClick={() => void handleAction(true)}
          disabled={busy !== null}
        >
          {busy === "accept" ? <Spinner size="xs" className="mr-1.5 text-primary-foreground" /> : null}
          Join session
        </Button>
      </div>
    </div>
  )
}
