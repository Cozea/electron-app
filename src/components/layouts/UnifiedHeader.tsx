import {
  Fragment,
  type KeyboardEvent,
  type ReactNode,
  useId,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { Link } from "react-router-dom"
import {
  CheckCircle2,
  ChevronDown,
  Copy,
  Inbox,
  ListTodo,
  Link2,
  Loader2,
  MoreVertical,
  RefreshCw,
  Send,
  Share2,
  ShieldOff,
  Trash2,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { scheduleTask } from "@/lib/scheduler"
import { useWindowChrome } from "@/hooks/useWindowChrome"
import { useAssistantPanelStore } from "@/stores/useAssistantPanelStore"
import { useWindowsCaptionControlsWidth } from "@/hooks/useWindowsCaptionControlsWidth"
import { useAuth } from "@/contexts/AuthContext"
import { useScopedAppContext } from "@/hooks/useScopedAppContext"
import { buildProjectJoinUrl } from "@shared/projectShare"
import { useOptionalProjectSyncContext } from "@/features/projects/contexts/ProjectSyncContext"
import { buildProjectPath } from "@/features/projects/lib/projectRoutes"
import { GitDurabilityCoordinator } from "@/lib/git/GitDurabilityCoordinator"
import type { Id } from "../../../convex/_generated/dataModel"
import { useConvex, useMutation, useQuery } from "convex/react"
import { api } from "../../../convex/_generated/api"
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { CommandSearch } from "@/components/CommandSearch"
import { LayoutToggles } from "@/components/layouts/LayoutToggles"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface UnifiedHeaderProps {
  breadcrumbs: { label: string; href?: string }[]
  header?: ReactNode
  breadcrumbAddon?: ReactNode
  preSearchAddon?: ReactNode
  rightAddon?: ReactNode
  className?: string
  leftWindowControlsInset?: boolean
  contentInsetLeft?: number
  contentInsetRight?: number
  compactHeaderActions?: boolean
  hideInbox?: boolean
  projectInviteContext?: {
    projectId: Id<"projects"> | null
    projectName?: string | null
  } | null
}

type ProjectInviteRole = "project_manager" | "developer" | "designer" | "viewer"
type InviteLookupUser = {
  id: Id<"users">
  email: string
  firstName?: string | null
  lastName?: string | null
  profileImageUrl?: string | null
}

const PROJECT_INVITE_ROLE_OPTIONS: Array<{ value: ProjectInviteRole; label: string }> = [
  { value: "project_manager", label: "Project Manager" },
  { value: "developer", label: "Developer" },
  { value: "designer", label: "Designer" },
  { value: "viewer", label: "Viewer" },
]

function cleanConvexError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : fallback
  return raw.replace(/^\[CONVEX.*?\]\s*/, "").replace(/\s*Called by client$/, "") || fallback
}

function getLinkPermissionDescription(role: ProjectInviteRole): string {
  switch (role) {
    case "project_manager":
      return "Link members can edit everything and manage project members."
    case "developer":
      return "Link members can build and edit project code."
    case "designer":
      return "Link members can edit design-related project content."
    case "viewer":
      return "Link members can view the project only."
    default:
      return "Link members receive the selected role permissions."
  }
}

function formatInviteeDisplayName(email: string, user: InviteLookupUser | null | undefined): string {
  const first = user?.firstName?.trim() ?? ""
  const last = user?.lastName?.trim() ?? ""
  const fullName = `${first} ${last}`.trim()
  if (fullName) return fullName
  if (user?.email) return user.email
  return email
}

function getInitials(value: string): string {
  const source = value.trim()
  if (!source) return "?"
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase()
  }
  return source.slice(0, 2).toUpperCase()
}

function HeaderInboxButton() {
  const { convexUserId } = useAuth()
  const { personalScoped, convexOrganizationId: currentWorkspaceOrgId } = useScopedAppContext()
  const acceptInvite = useMutation(api.projectInvites.acceptInvite)
  const declineInvite = useMutation(api.projectInvites.declineInvite)
  const dismissInboxItems = useMutation(api.projectTasks.dismissInboxItems)
  const incomingInvites = useQuery(
    api.projectInvites.listIncomingForUser,
    personalScoped && convexUserId ? { userId: convexUserId } : "skip"
  )
  const taskInboxItems = useQuery(
    api.projectTasks.listInboxForUser,
    convexUserId
      ? {
          userId: convexUserId,
          organizationId: currentWorkspaceOrgId,
        }
      : "skip"
  )
  const [activeInviteAction, setActiveInviteAction] = useState<{
    inviteId: Id<"projectInvites">
    action: "accept" | "decline"
  } | null>(null)
  const [activeTaskDismissId, setActiveTaskDismissId] = useState<Id<"projectTaskNotifications"> | null>(null)
  const [inviteActionError, setInviteActionError] = useState<string | null>(null)
  const inboxHeadingId = useId()
  const taskHeadingId = useId()
  const invitesHeadingId = useId()
  const taskNotificationCount = taskInboxItems?.length ?? 0
  const inviteCount = incomingInvites?.length ?? 0
  const pendingCount = taskNotificationCount + inviteCount

  const formatRelativeTimestamp = useCallback((timestamp: number) => {
    const now = Date.now()
    const diff = now - timestamp
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)
    const weeks = Math.floor(diff / 604800000)

    if (minutes < 1) return 'just now'
    if (minutes < 60) return `${minutes}m`
    if (hours < 24) return `${hours}h`
    if (days < 7) return `${days}d`
    if (weeks < 52) return `${weeks}w`
    return new Date(timestamp).toLocaleDateString()
  }, [])

  const handleInviteAction = useCallback(
    async (inviteId: Id<"projectInvites">, action: "accept" | "decline") => {
      if (!convexUserId) return
      setInviteActionError(null)
      setActiveInviteAction({ inviteId, action })

      try {
        if (action === "accept") {
          await acceptInvite({ inviteId, userId: convexUserId })
        } else {
          await declineInvite({ inviteId, userId: convexUserId })
        }
      } catch (error) {
        setInviteActionError(
          error instanceof Error ? error.message : "Unable to process invite action."
        )
      } finally {
        setActiveInviteAction(null)
      }
    },
    [acceptInvite, convexUserId, declineInvite]
  )

  const handleDismissTaskItem = useCallback(
    async (notificationId: Id<"projectTaskNotifications">) => {
      if (!convexUserId) return
      setActiveTaskDismissId(notificationId)

      try {
        await dismissInboxItems({
          userId: convexUserId,
          notificationIds: [notificationId],
        })
      } finally {
        setActiveTaskDismissId(null)
      }
    },
    [convexUserId, dismissInboxItems]
  )

  const getWorkspaceInitial = useCallback((workspaceName: string | undefined | null) => {
    const source = (workspaceName ?? "?").trim()
    return source.charAt(0).toUpperCase() || "?"
  }, [])

  const formatActorName = useCallback((actor: {
    firstName?: string | null
    lastName?: string | null
    email?: string | null
  } | null | undefined) => {
    const first = actor?.firstName?.trim() ?? ""
    const last = actor?.lastName?.trim() ?? ""
    const fullName = `${first} ${last}`.trim()
    if (fullName) return fullName
    if (actor?.email) return actor.email
    return "Someone"
  }, [])

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="relative h-7 w-7 text-muted-foreground hover:text-foreground"
            >
              <Inbox className="h-4 w-4" />
              {pendingCount > 0 ? (
                <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary" />
              ) : null}
              <span className="sr-only">Inbox</span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Inbox</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-[24rem] p-0">
        <DropdownMenuLabel id={inboxHeadingId} className="px-3 py-2.5">
          Inbox
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="max-h-[30rem] overflow-y-auto" aria-labelledby={inboxHeadingId}>
          <div className="px-3 pb-2 pt-3">
            <div className="flex items-center justify-between gap-2">
              <p id={taskHeadingId} className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Tasks
              </p>
              {taskNotificationCount > 0 ? (
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {taskNotificationCount}
                </span>
              ) : null}
            </div>
          </div>

          {taskInboxItems === undefined ? (
            <div className="px-3 pb-3 text-xs text-muted-foreground">Loading task activity...</div>
          ) : taskNotificationCount === 0 ? (
            <div className="px-3 pb-3 text-xs text-muted-foreground">No task activity yet.</div>
          ) : (
            <div className="space-y-2 px-2.5 pb-2.5" role="list" aria-labelledby={taskHeadingId}>
              {taskInboxItems.map((notification, index, visibleNotifications) => {
                const actorName = formatActorName(notification.actor)
                const isAssigned = notification.kind === "assigned"
                const isDismissing = activeTaskDismissId === notification._id
                const destination = buildProjectPath(String(notification.project.id), "tasks")
                const NotificationIcon = isAssigned ? ListTodo : CheckCircle2

                return (
                  <div
                    key={String(notification._id)}
                    role="listitem"
                    className={`px-1 py-2 ${
                      index < visibleNotifications.length - 1 ? "border-b border-border/60" : ""
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                        <NotificationIcon className="h-4 w-4" />
                      </div>

                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex min-w-0 items-baseline gap-1">
                          <p className="min-w-0 truncate text-sm font-semibold leading-5 text-foreground">
                            {notification.taskTitle}
                          </p>
                          <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                            &middot; {formatRelativeTimestamp(notification.createdAt)}
                          </span>
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          {isAssigned
                            ? `${notification.project.name} · assigned${notification.actor ? ` by ${actorName}` : ""}`
                            : `${notification.project.name} · completed by ${actorName}`}
                        </p>
                        <Link
                          to={destination}
                          className="inline-flex text-xs font-medium text-foreground/80 transition-colors hover:text-foreground"
                          onClick={() => {
                            void handleDismissTaskItem(notification._id)
                          }}
                        >
                          Open task board
                        </Link>
                      </div>

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="shrink-0 rounded-full"
                        disabled={isDismissing}
                        onClick={() => {
                          void handleDismissTaskItem(notification._id)
                        }}
                        aria-label="Dismiss task notification"
                      >
                        {isDismissing ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {personalScoped ? (
            <>
              <DropdownMenuSeparator />
              <div className="px-3 pb-2 pt-3">
                <div className="flex items-center justify-between gap-2">
                  <p id={invitesHeadingId} className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    Project Invites
                  </p>
                  {inviteCount > 0 ? (
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {inviteCount}
                    </span>
                  ) : null}
                </div>
              </div>

              {incomingInvites === undefined ? (
                <div className="px-3 pb-3 text-xs text-muted-foreground">Loading invites...</div>
              ) : inviteCount === 0 ? (
                <div className="px-3 pb-3 text-xs text-muted-foreground">No pending project invites.</div>
              ) : (
                <div className="space-y-2 px-2.5 pb-2.5" role="list" aria-labelledby={invitesHeadingId}>
                  {incomingInvites.slice(0, 8).map((invite, index, visibleInvites) => {
                    const isAccepting =
                      activeInviteAction?.inviteId === invite._id && activeInviteAction.action === "accept"
                    const isDeclining =
                      activeInviteAction?.inviteId === invite._id && activeInviteAction.action === "decline"
                    const isBusy = isAccepting || isDeclining

                    return (
                      <div
                        key={String(invite._id)}
                        role="listitem"
                        className={`px-1 py-2 ${
                          index < visibleInvites.length - 1 ? "border-b border-border/60" : ""
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <Avatar className="mt-0.5 h-8 w-8 rounded-full bg-background">
                            <AvatarImage
                              src={invite.ownerUser?.profileImageUrl ?? undefined}
                              alt={invite.ownerWorkspace?.name ?? "Owner"}
                            />
                            <AvatarFallback className="text-xs font-semibold">
                              {getWorkspaceInitial(invite.ownerWorkspace?.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex min-w-0 items-baseline gap-1">
                              <p className="min-w-0 truncate text-sm font-semibold leading-5 text-foreground">
                                {invite.project?.name ?? "Unknown Project"}
                              </p>
                              <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                                &middot; {formatRelativeTimestamp(invite.invitedAt)}
                              </span>
                            </div>
                            <p className="truncate text-xs text-muted-foreground">
                              {invite.ownerWorkspace?.name ?? "Unknown owner"}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5 self-start">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 rounded-full px-3 text-xs transition-colors hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                              disabled={isBusy || activeInviteAction !== null}
                              onClick={() => {
                                void handleInviteAction(invite._id, "decline")
                              }}
                            >
                              {isDeclining ? "Declining..." : "Decline"}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              className="h-7 rounded-full px-3 text-xs"
                              disabled={isBusy || activeInviteAction !== null}
                              onClick={() => {
                                void handleInviteAction(invite._id, "accept")
                              }}
                            >
                              {isAccepting ? "Accepting..." : "Accept"}
                            </Button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                  {inviteActionError ? (
                    <p className="px-1 pt-1 text-xs text-destructive" role="status">
                      {inviteActionError}
                    </p>
                  ) : null}
                </div>
              )}
            </>
          ) : null}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function HeaderProjectShareButton({
  projectId,
  projectName,
}: {
  projectId: Id<"projects"> | null
  projectName?: string | null
}) {
  const { convexUserId } = useAuth()
  const convex = useConvex()
  const syncContext = useOptionalProjectSyncContext()
  const inviteMember = useMutation(api.projectInvites.inviteMember)
  const createOrUpdateActiveLink = useMutation(api.projectJoinLinks.createOrUpdateActiveLink)
  const rotateJoinLink = useMutation(api.projectJoinLinks.rotateLink)
  const revokeJoinLink = useMutation(api.projectJoinLinks.revokeLink)
  const memberRole = useQuery(
    api.projectMembers.getMemberRole,
    projectId && convexUserId ? { projectId, userId: convexUserId } : "skip"
  )
  const joinLinkState = useQuery(
    api.projectJoinLinks.getForProject,
    projectId && convexUserId ? { projectId, userId: convexUserId } : "skip"
  )
  const [isInviteOpen, setIsInviteOpen] = useState(false)
  const [emailInput, setEmailInput] = useState("")
  const [inviteMembers, setInviteMembers] = useState<
    Array<{ email: string; role: ProjectInviteRole }>
  >([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteNotice, setInviteNotice] = useState<string | null>(null)
  const [joinLinkRole, setJoinLinkRole] = useState<ProjectInviteRole>("developer")
  const [joinLinkError, setJoinLinkError] = useState<string | null>(null)
  const [joinLinkNotice, setJoinLinkNotice] = useState<string | null>(null)
  const [joinLinkAction, setJoinLinkAction] = useState<"copy" | "rotate" | "disable" | null>(null)
  const inviteEmailCandidates = useMemo(
    () =>
      Array.from(
        new Set(
          inviteMembers
            .map((member) => member.email.trim().toLowerCase())
            .filter((email) => email.length > 0)
        )
      ),
    [inviteMembers]
  )
  const inviteLookup = useQuery(
    api.users.getByEmails,
    inviteEmailCandidates.length > 0 ? { emails: inviteEmailCandidates } : "skip"
  )
  const inviteLookupByEmail = useMemo(() => {
    const next = new Map<string, InviteLookupUser>()
    for (const entry of inviteLookup ?? []) {
      next.set(entry.email, entry.user)
    }
    return next
  }, [inviteLookup])
  const roleCheckPending = Boolean(projectId && convexUserId && memberRole === undefined)
  const shareStatePending = Boolean(projectId && convexUserId && joinLinkState === undefined)
  const canInvite = Boolean(projectId && convexUserId && memberRole === "project_manager")
  const isPersonalProject = joinLinkState?.isPersonalProject ?? false
  const activeJoinLink = joinLinkState?.activeLink ?? null
  const canSendProjectInvites = canInvite && isPersonalProject
  const canManageJoinLinks = canInvite && isPersonalProject

  const flushProjectBeforeShare = useCallback(async () => {
    if (!projectId || !convexUserId || !syncContext?.projectPath) return

    const coordinator = GitDurabilityCoordinator.acquireShared({
      projectId,
      projectPath: syncContext.projectPath,
      convex,
      userId: convexUserId,
    })

    try {
      await coordinator.flushNow()
    } finally {
      coordinator.release()
    }
  }, [convex, convexUserId, projectId, syncContext?.projectPath])

  useEffect(() => {
    if (!isInviteOpen || !activeJoinLink) return
    setJoinLinkRole(activeJoinLink.role)
  }, [activeJoinLink, isInviteOpen])

  const queueInviteEmail = useCallback((rawEmail: string) => {
    const email = rawEmail.trim().toLowerCase()
    if (!email) return
    if (!email.includes("@")) {
      setInviteError(`Invalid email: ${rawEmail.trim()}`)
      return
    }

    setInviteMembers((current) => {
      if (current.some((member) => member.email === email)) return current
      return [...current, { email, role: "developer" }]
    })
  }, [])

  const handleAddEmail = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter" && event.key !== ",") return
      event.preventDefault()
      const segments = emailInput
        .split(",")
        .map((segment) => segment.trim())
        .filter(Boolean)
      if (!segments.length) return

      setInviteError(null)
      segments.forEach((segment) => queueInviteEmail(segment))
      setEmailInput("")
    },
    [emailInput, queueInviteEmail]
  )

  const handleRemoveFromInviteList = useCallback((index: number) => {
    setInviteMembers((current) => current.filter((_, i) => i !== index))
  }, [])

  const handleUpdateRole = useCallback((index: number, role: ProjectInviteRole) => {
    setInviteMembers((current) =>
      current.map((member, i) => (i === index ? { ...member, role } : member))
    )
  }, [])

  const handleInviteOpenChange = useCallback((open: boolean) => {
    setIsInviteOpen(open)
    if (!open) {
      setEmailInput("")
      setInviteMembers([])
      setInviteError(null)
      setInviteNotice(null)
      setIsSubmitting(false)
      setJoinLinkError(null)
      setJoinLinkNotice(null)
      setJoinLinkAction(null)
    }
  }, [])

  const handleSendInvites = useCallback(async () => {
    if (!projectId || !convexUserId || !canSendProjectInvites || inviteMembers.length === 0) return

    setIsSubmitting(true)
    setInviteError(null)
    setInviteNotice(null)

    try {
      await flushProjectBeforeShare()
      const failed: Array<{ email: string; error: string }> = []
      let deliveryNotConfiguredCount = 0

      for (const member of inviteMembers) {
        try {
          const result = await inviteMember({
            projectId,
            email: member.email,
            role: member.role,
            invitedBy: convexUserId,
          })
          if (result.emailDelivery === "not_configured") {
            deliveryNotConfiguredCount += 1
          }
        } catch (error) {
          failed.push({
            email: member.email,
            error: cleanConvexError(error, "Failed to send invite"),
          })
        }
      }

      if (failed.length === 0) {
        if (deliveryNotConfiguredCount > 0) {
          setInviteMembers([])
          setEmailInput("")
          setInviteNotice(
            deliveryNotConfiguredCount === inviteMembers.length
              ? "Invites were created, but no Resend integration is connected for this workspace, so no email was sent."
              : "Some invites were created without email delivery because no Resend integration is connected for this workspace."
          )
          return
        }
        handleInviteOpenChange(false)
        return
      }

      const failedSet = new Set(failed.map((entry) => entry.email))
      setInviteMembers((current) => current.filter((member) => failedSet.has(member.email)))
      setInviteError(failed.map((entry) => `${entry.email}: ${entry.error}`).join(" | "))
    } finally {
      setIsSubmitting(false)
    }
  }, [
    canSendProjectInvites,
    convexUserId,
    flushProjectBeforeShare,
    handleInviteOpenChange,
    inviteMember,
    inviteMembers,
    projectId,
  ])

  const handleCopyJoinLink = useCallback(async () => {
    if (!projectId || !convexUserId || !canManageJoinLinks) return
    setJoinLinkAction("copy")
    setJoinLinkError(null)
    setJoinLinkNotice(null)

    try {
      await flushProjectBeforeShare()
      const link = await createOrUpdateActiveLink({
        projectId,
        actorUserId: convexUserId,
        role: joinLinkRole,
      })
      const shareUrl = buildProjectJoinUrl(
        import.meta.env.VITE_SITE_URL as string | undefined,
        link.token
      )
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard is not available")
      }
      await navigator.clipboard.writeText(shareUrl)
      setJoinLinkNotice("Invite link copied to clipboard.")
    } catch (error) {
      setJoinLinkError(cleanConvexError(error, "Failed to copy invite link"))
    } finally {
      setJoinLinkAction(null)
    }
  }, [
    canManageJoinLinks,
    convexUserId,
    createOrUpdateActiveLink,
    flushProjectBeforeShare,
    joinLinkRole,
    projectId,
  ])

  const handleRotateJoinLink = useCallback(async () => {
    if (!projectId || !convexUserId || !canManageJoinLinks) return
    setJoinLinkAction("rotate")
    setJoinLinkError(null)
    setJoinLinkNotice(null)

    try {
      await rotateJoinLink({
        projectId,
        actorUserId: convexUserId,
        role: joinLinkRole,
      })
      setJoinLinkNotice("Invite link rotated.")
    } catch (error) {
      setJoinLinkError(cleanConvexError(error, "Failed to rotate invite link"))
    } finally {
      setJoinLinkAction(null)
    }
  }, [canManageJoinLinks, convexUserId, joinLinkRole, projectId, rotateJoinLink])

  const handleDisableJoinLink = useCallback(async () => {
    if (!projectId || !convexUserId || !canManageJoinLinks) return
    setJoinLinkAction("disable")
    setJoinLinkError(null)
    setJoinLinkNotice(null)

    try {
      await revokeJoinLink({
        projectId,
        actorUserId: convexUserId,
      })
      setJoinLinkNotice("Invite link disabled.")
    } catch (error) {
      setJoinLinkError(cleanConvexError(error, "Failed to disable invite link"))
    } finally {
      setJoinLinkAction(null)
    }
  }, [canManageJoinLinks, convexUserId, projectId, revokeJoinLink])

  return (
    <Dialog open={isInviteOpen} onOpenChange={handleInviteOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              className="h-7 gap-1.5 rounded-full px-2 text-xs text-muted-foreground hover:text-foreground"
              disabled={!projectId || roleCheckPending || shareStatePending}
            >
              {roleCheckPending || shareStatePending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Share2 className="h-3.5 w-3.5" />
              )}
              Share
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Share project</TooltipContent>
      </Tooltip>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Share project</DialogTitle>
          <DialogDescription>
            Invite collaborators to <span className="font-medium text-foreground">{projectName ?? "this project"}</span>.
          </DialogDescription>
        </DialogHeader>

        {!canInvite ? (
          <div className="rounded-md border border-border/60 bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground">
            Only project managers can invite collaborators.
          </div>
        ) : shareStatePending ? (
          <div className="rounded-md border border-border/60 bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground">
            Loading project sharing settings…
          </div>
        ) : (
          <>
            {joinLinkError ? (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {joinLinkError}
              </div>
            ) : null}
            {inviteError ? (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {inviteError}
              </div>
            ) : null}
            {inviteNotice ? (
              <div className="rounded-md border border-border/60 bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                {inviteNotice}
              </div>
            ) : null}
            {joinLinkNotice ? (
              <div className="rounded-md border border-border/60 bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                {joinLinkNotice}
              </div>
            ) : null}

            {!isPersonalProject ? (
              <div className="rounded-xl border border-border/60 bg-muted/40 px-3 py-3 text-sm text-muted-foreground">
                Workspace projects do not support per-project invites. Invite people to the workspace first, then add them to the project from the workspace flow.
              </div>
            ) : (
              <>
                <Input
                  type="email"
                  placeholder="Enter email addresses..."
                  value={emailInput}
                  onChange={(event) => {
                    setEmailInput(event.target.value)
                  }}
                  onKeyDown={handleAddEmail}
                  disabled={isSubmitting}
                />

                {inviteMembers.length > 0 ? (
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-4 bg-gradient-to-b from-background to-transparent" />
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-4 bg-gradient-to-t from-background to-transparent" />
                    <div className="app-scrollbar max-h-64 space-y-1 overflow-y-auto py-2">
                      {inviteMembers.map((member, index) => {
                        const inviteeUser = inviteLookupByEmail.get(member.email)
                        const inviteeName = formatInviteeDisplayName(member.email, inviteeUser)
                        return (
                        <div key={member.email} className="flex items-center justify-between px-1 py-2">
                          <div className="flex items-center gap-3">
                            <Avatar className="h-10 w-10">
                              <AvatarImage
                                src={inviteeUser?.profileImageUrl ?? undefined}
                                alt={inviteeName}
                              />
                              <AvatarFallback className="text-sm">
                                {getInitials(inviteeName)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <span className="block max-w-[220px] truncate font-medium">{inviteeName}</span>
                              {inviteeUser ? (
                                <span className="block max-w-[220px] truncate text-xs text-muted-foreground">
                                  {member.email}
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 gap-1 px-2 text-xs text-muted-foreground"
                                  disabled={isSubmitting}
                                >
                                  {PROJECT_INVITE_ROLE_OPTIONS.find(
                                    (option) => option.value === member.role
                                  )?.label ?? "Role"}
                                  <ChevronDown className="h-3.5 w-3.5" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {PROJECT_INVITE_ROLE_OPTIONS.map((option) => (
                                  <DropdownMenuItem
                                    key={option.value}
                                    onClick={() => {
                                      handleUpdateRole(index, option.value)
                                    }}
                                  >
                                    {option.label}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive"
                              onClick={() => {
                                handleRemoveFromInviteList(index)
                              }}
                              disabled={isSubmitting}
                            >
                              <Trash2 className="h-4 w-4" />
                              <span className="sr-only">Remove invite</span>
                            </Button>
                          </div>
                        </div>
                        )
                      })}
                    </div>
                  </div>
                ) : null}

                <div className="flex items-center justify-between pt-1">
                  <span className="text-sm text-muted-foreground">
                    <span className="font-semibold text-foreground">{inviteMembers.length}</span> members added
                  </span>
                  <Button
                    type="button"
                    onClick={() => {
                      void handleSendInvites()
                    }}
                    disabled={inviteMembers.length === 0 || isSubmitting}
                  >
                    {isSubmitting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="mr-2 h-4 w-4" />
                    )}
                    Send invites
                  </Button>
                </div>

                <div className="rounded-xl bg-background/60 p-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <Link2 className="h-4 w-4" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <Select
                        value={joinLinkRole}
                        onValueChange={(value) => setJoinLinkRole(value as ProjectInviteRole)}
                        disabled={joinLinkAction !== null}
                      >
                        <SelectTrigger className="h-10 w-full rounded-full border-0 bg-muted/50 text-sm shadow-none">
                          <SelectValue placeholder="Select role" />
                        </SelectTrigger>
                        <SelectContent>
                          {PROJECT_INVITE_ROLE_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0 rounded-full bg-muted/40 text-muted-foreground hover:bg-muted/60"
                      onClick={() => {
                        void handleCopyJoinLink()
                      }}
                      disabled={joinLinkAction !== null || !canManageJoinLinks}
                      title="Copy link"
                    >
                      {joinLinkAction === "copy" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      <span className="sr-only">Copy link</span>
                    </Button>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 shrink-0 rounded-full bg-muted/40 text-muted-foreground hover:bg-muted/60"
                          disabled={joinLinkAction !== null || !canManageJoinLinks}
                          title="Link options"
                        >
                          <MoreVertical className="h-4 w-4" />
                          <span className="sr-only">Link options</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          disabled={joinLinkAction !== null || !canManageJoinLinks}
                          onClick={() => {
                            void handleRotateJoinLink()
                          }}
                        >
                          {joinLinkAction === "rotate" ? (
                            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="mr-2 h-3.5 w-3.5" />
                          )}
                          Rotate link
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={joinLinkAction !== null || !canManageJoinLinks || !activeJoinLink}
                          onClick={() => {
                            void handleDisableJoinLink()
                          }}
                          className="text-destructive focus:text-destructive"
                        >
                          {joinLinkAction === "disable" ? (
                            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <ShieldOff className="mr-2 h-3.5 w-3.5" />
                          )}
                          Disable link
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <p className="mt-2 pl-[52px] text-xs text-muted-foreground">
                    {getLinkPermissionDescription(joinLinkRole)}
                  </p>
                </div>
              </>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function UnifiedHeader({
  breadcrumbs,
  header,
  breadcrumbAddon,
  preSearchAddon,
  rightAddon,
  className,
  leftWindowControlsInset = false,
  contentInsetLeft = 0,
  contentInsetRight = 0,
  compactHeaderActions = true,
  hideInbox = false,
  projectInviteContext = null,
}: UnifiedHeaderProps) {
  const { personalScoped } = useScopedAppContext()
  const windowChrome = useWindowChrome()
  const isAssistantOpen = useAssistantPanelStore((state) => state.mode !== "closed")
  const shouldShowWindowsCaptionSpacer = windowChrome.isWindows && !isAssistantOpen
  const windowsCaptionSpacerWidth = useWindowsCaptionControlsWidth()
  const shouldApplyLeftWindowControlsInset = leftWindowControlsInset && windowChrome.isMac
  const headerBackdropClassName = windowChrome.isWindows
    ? "bg-background/60 backdrop-blur-md supports-[backdrop-filter]:bg-background/45"
    : "bg-transparent backdrop-blur-md"

  const [visibleBreadcrumbStartIndex, setVisibleBreadcrumbStartIndex] = useState(0)
  const breadcrumbContainerRef = useRef<HTMLDivElement | null>(null)
  const breadcrumbViewportRef = useRef<HTMLDivElement | null>(null)
  const breadcrumbMeasureRef = useRef<HTMLDivElement | null>(null)
  const breadcrumbAddonRef = useRef<HTMLDivElement | null>(null)

  const windowControlsInsetPadding = shouldApplyLeftWindowControlsInset
    ? { paddingLeft: windowChrome.compactLeftInset }
    : undefined
  const rightFrameInset = shouldShowWindowsCaptionSpacer ? 0 : contentInsetRight
  const headerFrameStyle = {
    ...windowControlsInsetPadding,
    left: contentInsetLeft,
    right: rightFrameInset,
  }
  const visibleBreadcrumbs = useMemo(
    () =>
      breadcrumbs.slice(visibleBreadcrumbStartIndex).map((crumb, index) => ({
        crumb,
        originalIndex: visibleBreadcrumbStartIndex + index,
      })),
    [breadcrumbs, visibleBreadcrumbStartIndex]
  )
  const hasCollapsedLeftBreadcrumbs = visibleBreadcrumbStartIndex > 0

  const recomputeVisibleBreadcrumbs = useCallback(() => {
    if (!breadcrumbs.length) {
      setVisibleBreadcrumbStartIndex(0)
      return
    }

    const viewport = breadcrumbViewportRef.current
    const container = breadcrumbContainerRef.current
    const measure = breadcrumbMeasureRef.current
    const addon = breadcrumbAddonRef.current

    if (!viewport || !measure) return

    const addonWidth = breadcrumbAddon ? (addon?.getBoundingClientRect().width ?? 0) + 8 : 0
    const availableWidth = Math.max(
      0,
      (container?.clientWidth ?? viewport.clientWidth) - addonWidth
    )
    if (availableWidth <= 0) return

    const crumbNodes = Array.from(
      measure.querySelectorAll<HTMLElement>("[data-breadcrumb-measure-crumb]")
    )
    const separatorNode = measure.querySelector<HTMLElement>(
      "[data-breadcrumb-measure-separator]"
    )
    const ellipsisNode = measure.querySelector<HTMLElement>(
      "[data-breadcrumb-measure-ellipsis]"
    )

    if (!crumbNodes.length) {
      setVisibleBreadcrumbStartIndex(0)
      return
    }

    const crumbWidths = crumbNodes.map((node) => node.getBoundingClientRect().width)
    const separatorWidth = separatorNode?.getBoundingClientRect().width ?? 10
    const ellipsisWidth = ellipsisNode?.getBoundingClientRect().width ?? 20

    const allCrumbsWidth =
      crumbWidths.reduce((acc, width) => acc + width, 0) +
      Math.max(0, crumbWidths.length - 1) * separatorWidth

    if (allCrumbsWidth <= availableWidth) {
      setVisibleBreadcrumbStartIndex(0)
      return
    }

    let startIndex = crumbWidths.length - 1

    for (let candidate = 1; candidate < crumbWidths.length; candidate += 1) {
      const remainingCrumbsWidth = crumbWidths
        .slice(candidate)
        .reduce((acc, width) => acc + width, 0)
      const remainingSeparatorsWidth =
        Math.max(0, crumbWidths.length - candidate - 1) * separatorWidth
      const candidateWidth =
        ellipsisWidth + separatorWidth + remainingCrumbsWidth + remainingSeparatorsWidth

      if (candidateWidth <= availableWidth) {
        startIndex = candidate
        break
      }
    }

    setVisibleBreadcrumbStartIndex(startIndex)
  }, [breadcrumbAddon, breadcrumbs])

  const [prevBreadcrumbsLength, setPrevBreadcrumbsLength] = useState(breadcrumbs.length)
  if (breadcrumbs.length !== prevBreadcrumbsLength) {
    setPrevBreadcrumbsLength(breadcrumbs.length)
    if (!breadcrumbs.length) {
      setVisibleBreadcrumbStartIndex(0)
    }
  }

  useEffect(() => {
    if (!breadcrumbs.length) {
      return
    }

    const viewport = breadcrumbViewportRef.current
    const container = breadcrumbContainerRef.current
    if (!viewport || !container) return

    const scheduleRecompute = () => {
      void scheduleTask(() => {
        recomputeVisibleBreadcrumbs()
      }, 'background')
    }

    const frame = window.requestAnimationFrame(() => {
      scheduleRecompute()
    })

    const observer = new ResizeObserver(() => {
      scheduleRecompute()
    })
    observer.observe(container)
    observer.observe(viewport)
    if (breadcrumbAddonRef.current) {
      observer.observe(breadcrumbAddonRef.current)
    }

    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [breadcrumbAddon, breadcrumbs.length, recomputeVisibleBreadcrumbs])

  const isTabsPrimaryLayout =
    breadcrumbs.length === 0 && !breadcrumbAddon && Boolean(header)
  const collaborationControl = personalScoped
    ? projectInviteContext
      ? (
          <HeaderProjectShareButton
            projectId={projectInviteContext.projectId}
            projectName={projectInviteContext.projectName}
          />
        )
      : !hideInbox ? <HeaderInboxButton /> : null
    : null

  if (isTabsPrimaryLayout) {
    return (
      <div
        className={cn(
          "absolute top-0 left-0 right-0 z-40 h-10 flex items-center px-2 titlebar-drag-region transition-[left,right,padding] duration-200 ease-out",
          headerBackdropClassName,
          className
        )}
        style={headerFrameStyle}
      >
        <div className="flex items-center w-full gap-0.5">
          <div className="flex items-center min-w-0 flex-1">
            {compactHeaderActions ? (
              <div className="shared-header-action-pills titlebar-no-drag inline-flex min-w-0 items-center">
                {header}
              </div>
            ) : (
              <div className="titlebar-no-drag flex w-full min-w-0 max-w-full items-center">
                {header}
              </div>
            )}
          </div>
          {preSearchAddon && (
            <div className="flex items-center titlebar-no-drag shrink-0">{preSearchAddon}</div>
          )}
          {(header || preSearchAddon) && (
            <div className="mx-0.5 h-4 w-px shrink-0 bg-border/70" />
          )}
          <div className="flex items-center gap-0 titlebar-no-drag shrink-0">
            <CommandSearch />
            {collaborationControl}
            <LayoutToggles />
            {rightAddon && (
              <>
                <div className="mx-1 h-4 w-px shrink-0 bg-border/70" />
                <div className="flex items-center">{rightAddon}</div>
              </>
            )}
            {shouldShowWindowsCaptionSpacer && (
              <>
                <div className="mx-1 h-4 w-px shrink-0 bg-border/70" />
                <div
                  aria-hidden="true"
                  className="h-7 shrink-0 flex-none"
                  style={{ width: windowsCaptionSpacerWidth }}
                />
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "absolute top-0 left-0 right-0 z-40 h-10 flex items-center px-4 titlebar-drag-region transition-[left,right,padding] duration-200 ease-out",
        headerBackdropClassName,
        className
      )}
      style={headerFrameStyle}
    >
      <div className="flex items-center w-full gap-3">
        <div
          ref={breadcrumbContainerRef}
          className="flex min-w-0 flex-1 items-center gap-2"
        >
          {breadcrumbs.length > 0 && (
            <>
              <div ref={breadcrumbViewportRef} className="titlebar-no-drag min-w-0 max-w-full overflow-hidden">
                <Breadcrumb className="min-w-0">
                  <BreadcrumbList className="min-w-0 flex-nowrap overflow-hidden">
                    {hasCollapsedLeftBreadcrumbs && (
                      <>
                        <BreadcrumbItem className="shrink-0">
                          <BreadcrumbEllipsis className="size-6" />
                        </BreadcrumbItem>
                        <BreadcrumbSeparator className="shrink-0" />
                      </>
                    )}
                    {visibleBreadcrumbs.map(({ crumb, originalIndex }, index) => {
                      const isLast = originalIndex === breadcrumbs.length - 1

                      return (
                        <Fragment key={`${crumb.label}-${originalIndex}`}>
                          <BreadcrumbItem className="min-w-0">
                            {crumb.href && !isLast ? (
                              <BreadcrumbLink
                                asChild
                                className="inline-block max-w-[240px] truncate align-bottom"
                              >
                                <Link to={crumb.href}>{crumb.label}</Link>
                              </BreadcrumbLink>
                            ) : (
                              <BreadcrumbPage className="inline-block max-w-[260px] truncate align-bottom text-muted-foreground/80">
                                {crumb.label}
                              </BreadcrumbPage>
                            )}
                          </BreadcrumbItem>
                          {index < visibleBreadcrumbs.length - 1 && (
                            <BreadcrumbSeparator className="shrink-0" />
                          )}
                        </Fragment>
                      )
                    })}
                  </BreadcrumbList>
                </Breadcrumb>
              </div>

              {/* Hidden measuring row used to calculate responsive left-ellipsis behavior */}
              <div
                ref={breadcrumbMeasureRef}
                className="pointer-events-none absolute -z-10 opacity-0"
                aria-hidden="true"
              >
                <Breadcrumb>
                  <BreadcrumbList className="flex-nowrap">
                    <BreadcrumbItem className="shrink-0">
                      <BreadcrumbEllipsis
                        className="size-6"
                        data-breadcrumb-measure-ellipsis
                      />
                    </BreadcrumbItem>
                    <BreadcrumbSeparator
                      className="shrink-0"
                      data-breadcrumb-measure-separator
                    />
                    {breadcrumbs.map((crumb, index) => (
                      <BreadcrumbItem
                        key={`measure-${crumb.label}-${index}`}
                        className="shrink-0"
                        data-breadcrumb-measure-crumb
                      >
                        <span className="inline-block whitespace-nowrap">
                          {crumb.label}
                        </span>
                      </BreadcrumbItem>
                    ))}
                  </BreadcrumbList>
                </Breadcrumb>
              </div>
            </>
          )}
          {breadcrumbAddon && (
            <div ref={breadcrumbAddonRef} className="titlebar-no-drag flex shrink-0 items-center gap-2">
              {breadcrumbAddon}
            </div>
          )}
        </div>
        <div className="flex min-w-0 shrink-0 items-center gap-0.5 titlebar-no-drag">
          {compactHeaderActions ? (
            <div className="shared-header-action-pills flex min-w-0 items-center">
              {header}
            </div>
          ) : (
            header
          )}
          {preSearchAddon && (
            <div className="flex items-center shrink-0">{preSearchAddon}</div>
          )}
          {(header || preSearchAddon) && (
            <div className="mx-1.5 h-4 w-px shrink-0 bg-border/70" />
          )}
          <div className="flex items-center gap-0.5">
            <CommandSearch />
            {collaborationControl}
            <LayoutToggles />
            {rightAddon && (
              <>
                <div className="mx-1 h-4 w-px shrink-0 bg-border/70" />
                <div className="flex items-center">{rightAddon}</div>
              </>
            )}
            {shouldShowWindowsCaptionSpacer && (
              <>
                <div className="mx-1 h-4 w-px shrink-0 bg-border/70" />
                <div
                  aria-hidden="true"
                  className="h-7 shrink-0 flex-none"
                  style={{ width: windowsCaptionSpacerWidth }}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
