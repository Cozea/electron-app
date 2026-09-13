import { useCallback, useState } from "react"
import { useMutation, useQuery } from "convex/react"

import { api } from "../../../../../../convex/_generated/api"
import type { Id } from "../../../../../../convex/_generated/dataModel"
import { cleanConvexError } from "@/lib/convexError"
import { useAuth } from "@/contexts/AuthContext"
import { useProjectHeader } from "@/lib/useProjectHeader"
import { useTranslation } from "@/lib/i18n"
import { useViewTransitionNavigate } from "@/lib/navigation"
import { buildProjectPath } from "@/contexts/project/projectRoutes"
import { buildProjectRouteNavigationState } from "@/contexts/project/projectNavigationState"
import { appToast } from "@/lib/appToast"
import { SessionInvitationCard, type SessionInvitationItem } from "@/features/inbox/components/SessionInvitationCard"
import { describeInviteeCopy, ensureInviteeCopy, type InviteeCopyOutcome } from "@/features/inbox/sessionCopy"
import { invalidateProjectWorkspaceResolution } from "@/features/workspace/useProjectWorkspaceResolution"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"

import { HugeiconsIcon } from "@hugeicons/react"
import {
  InboxIcon as __InboxHugeIcon,
  CheckmarkCircle02Icon as __CheckCircleHugeIcon,
  ArrowRight01Icon as __ArrowRightHugeIcon,
  Clock01Icon as __ClockHugeIcon,
} from "@hugeicons/core-free-icons"

function initial(value: string): string {
  return value.trim().charAt(0).toUpperCase() || "?"
}



function formatExpiryDays(expiresAt: number): string {
  const ms = expiresAt - Date.now()
  if (ms <= 0) return "Expired"
  const days = Math.ceil(ms / (1000 * 60 * 60 * 24))
  return days === 1 ? "Expires in 1 day" : `Expires in ${days} days`
}

function formatRole(role: string): string {
  return role
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

interface AcceptedInvitation {
  projectId: string
  projectName: string
  workspaceId?: string | null
  /** What happens next, when there is more to say than "Invitation accepted". */
  detail: string | null
  /** True while Cozea is still setting up a copy of the project on this Mac. */
  settingUp?: boolean
  /**
   * The bootstrap request retained after acceptance, so a failed setup can be
   * retried without re-accepting (S10). Re-running it reuses the same Session
   * Workbench; it never duplicates it.
   */
  setupRequest?: {
    publicSessionId: string
    branchName: string
    repositoryUrl: string | null
  }
  /** True when the last setup attempt failed and retry is offered. */
  setupFailed?: boolean
}

/** The retained accepted-invitation row: hook-free so its states stay directly testable. */
export function AcceptedSetupCard({
  projectName,
  detail,
  acceptedLabel,
  settingUp,
  canRetry,
  retryLabel,
  openLabel,
  onOpen,
  onRetry,
}: {
  projectName: string
  detail: string | null
  acceptedLabel: string
  settingUp?: boolean
  canRetry?: boolean
  retryLabel?: string
  openLabel: string
  onOpen: () => void
  onRetry?: () => void
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          <HugeiconsIcon icon={__CheckCircleHugeIcon} className="size-5" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">{projectName}</p>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {settingUp ? <Spinner size="xs" /> : null}
            <span>{detail ?? acceptedLabel}</span>
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {canRetry ? (
          <Button size="sm" variant="outline" className="gap-1.5" disabled={settingUp} onClick={onRetry}>
            <span>{retryLabel ?? "Retry setup"}</span>
          </Button>
        ) : null}
        <Button size="sm" className="gap-1.5" disabled={settingUp} onClick={onOpen}>
          <span>{openLabel}</span>
          <HugeiconsIcon icon={__ArrowRightHugeIcon} className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}

const NO_SESSION_INVITATIONS: SessionInvitationItem[] = []

/** A clone can take a while, so its result is also announced for anyone who left the Inbox. */
function announceInviteeCopy(copy: InviteeCopyOutcome, projectName: string): void {
  switch (copy.kind) {
    case "ready":
      appToast.success({ title: `${projectName} is ready`, description: "Your Session Workbench is ready to open." })
      return
    case "no_repository":
      appToast.info({ title: `Link your copy of ${projectName}`, description: "The session hasn't recorded its Git remote." })
      return
    case "failed":
      appToast.error({ title: `No copy of ${projectName} was set up`, description: copy.message })
      return
  }
}

export function InboxPage() {
  const { t } = useTranslation()
  const { principalId } = useAuth()
  const navigate = useViewTransitionNavigate()

  const incoming = useQuery(
    api.projectDeviceEnrollments.listIncoming,
    principalId ? {} : "skip",
  )
  const sessionInvitations: SessionInvitationItem[] =
    useQuery(api.collaborationSessions.listIncomingInvitations, principalId ? {} : "skip") ??
    NO_SESSION_INVITATIONS
  const resolveEnrollment = useMutation(api.projectDeviceEnrollments.resolve)

  const [activeAction, setActiveAction] = useState<{
    enrollmentId: Id<"projectDeviceEnrollments">
    accept: boolean
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recentlyAccepted, setRecentlyAccepted] = useState<Map<string, AcceptedInvitation>>(new Map())

  useProjectHeader(null, null, { hideShare: true })

  const rememberAccepted = useCallback((key: string, accepted: AcceptedInvitation) => {
    setRecentlyAccepted((prev) => {
      const next = new Map(prev)
      next.set(key, accepted)
      return next
    })
  }, [])

  const handleResolve = useCallback(
    async (enrollmentId: Id<"projectDeviceEnrollments">, accept: boolean, projectName: string) => {
      setError(null)
      setActiveAction({ enrollmentId, accept })
      try {
        const result = await resolveEnrollment({ enrollmentId, accept })
        if (accept && result?.accepted && result.projectId) {
          rememberAccepted(String(enrollmentId), { projectId: String(result.projectId), projectName, detail: null })
          appToast.success({
            title: t("inbox.accepted"),
            description: `You now have access to ${projectName}.`,
          })
        } else if (!accept) {
          appToast.info({
            title: t("inbox.declined"),
            description: `Declined invitation for ${projectName}.`,
          })
        }
      } catch (caught) {
        const cleanMsg = cleanConvexError(caught, "Could not update this invitation.")
        setError(cleanMsg)
        appToast.error({
          title: "Action failed",
          description: cleanMsg,
        })
      } finally {
        setActiveAction(null)
      }
    },
    [rememberAccepted, resolveEnrollment, t],
  )

  const runInviteeSetup = useCallback(
    (
      key: string,
      base: { projectId: string; projectName: string },
      request: { publicSessionId: string; branchName: string; repositoryUrl: string | null },
    ) => {
      rememberAccepted(key, {
        ...base,
        workspaceId: null,
        detail: `You're in the live session on ${request.branchName}. Setting up ${base.projectName} on this Mac…`,
        settingUp: true,
        setupRequest: request,
        setupFailed: false,
      })
      void ensureInviteeCopy(
        {
          projectId: base.projectId,
          projectName: base.projectName,
          publicSessionId: request.publicSessionId,
          branchName: request.branchName,
          repositoryUrl: request.repositoryUrl,
        },
        window.electronAPI.workspace,
        window.electronAPI.projectd.workbenches,
      )
        .catch((error: unknown): InviteeCopyOutcome => ({ kind: "failed", message: cleanConvexError(error, "Setup failed.") }))
        .then((copy) => {
          if (copy.kind === "ready") invalidateProjectWorkspaceResolution(base.projectId)
          rememberAccepted(key, {
            ...base,
            workspaceId: copy.kind === "ready" ? copy.workspaceId : null,
            detail: describeInviteeCopy(copy, request.branchName),
            settingUp: false,
            setupRequest: request,
            setupFailed: copy.kind === "failed",
          })
          announceInviteeCopy(copy, base.projectName)
        })
    },
    [rememberAccepted],
  )

  const handleSessionAccepted = useCallback(
    (item: SessionInvitationItem, accepted: {
      projectId: string
      publicSessionId: string
      branchName: string
      repositoryUrl: string | null
    }) => {
      const key = `session:${String(item.invitationId)}`
      runInviteeSetup(key, { projectId: accepted.projectId, projectName: item.projectName }, accepted)
    },
    [runInviteeSetup],
  )

  const handleOpenProject = useCallback(
    (projectId: string, workspaceId?: string | null) => {
      navigate(buildProjectPath(projectId, "workbench"), {
        state: buildProjectRouteNavigationState({ projectId, preferredWorkspaceId: workspaceId ?? null }),
      })
    },
    [navigate],
  )

  const isLoading = incoming === undefined
  const isEmpty =
    incoming !== undefined && incoming.length === 0 && sessionInvitations.length === 0 && recentlyAccepted.size === 0

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <ScrollArea scrollFade fadeSize="2rem" className="h-full min-h-0 flex-1" viewportClassName="flex flex-col">
        <div className="mx-auto flex min-h-full w-full max-w-[960px] flex-1 flex-col space-y-6 px-6 pt-4 pb-12">
          {error ? (
            <div
              className="flex items-center justify-between rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive"
              role="alert"
            >
              <span>{error}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Dismiss"
                onClick={() => setError(null)}
              >
                ×
              </Button>
            </div>
          ) : null}

          <header className="shrink-0">
            <h1 className="text-[26px] leading-tight font-medium tracking-[-0.03em] text-foreground">
              {t("inbox.title")}
            </h1>
          </header>

          {isLoading ? (
            <div className="space-y-3 pt-2">
              {[1, 2].map((key) => (
                <div
                  key={key}
                  className="flex animate-pulse items-center justify-between rounded-xl border border-border/50 bg-card/40 p-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="size-10 rounded-lg bg-muted" />
                    <div className="space-y-1.5">
                      <div className="h-4 w-36 rounded bg-muted" />
                      <div className="h-3 w-48 rounded bg-muted" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <div className="h-8 w-18 rounded-md bg-muted" />
                    <div className="h-8 w-18 rounded-md bg-muted" />
                  </div>
                </div>
              ))}
            </div>
          ) : isEmpty ? (
            <div className="flex flex-1 items-center justify-center pb-16">
              <Empty className="py-0">
                <EmptyHeader>
                  <EmptyMedia className="h-auto w-auto rounded-none bg-transparent [&>svg]:size-8 [&>svg]:text-muted-foreground/75">
                    <HugeiconsIcon icon={__InboxHugeIcon} />
                  </EmptyMedia>
                  <EmptyTitle>{t("inbox.emptyTitle")}</EmptyTitle>
                  <EmptyDescription>{t("inbox.emptyDescription")}</EmptyDescription>
                </EmptyHeader>
              </Empty>
            </div>
          ) : (
            <div className="space-y-6">
              {recentlyAccepted.size > 0 ? (
                <div className="space-y-3">
                  {Array.from(recentlyAccepted.entries()).map(([id, info]) => (
                    <AcceptedSetupCard
                      key={`accepted-${id}`}
                      projectName={info.projectName}
                      detail={info.detail}
                      acceptedLabel={t("inbox.accepted")}
                      settingUp={info.settingUp}
                      canRetry={info.setupFailed && !info.settingUp && info.setupRequest !== undefined}
                      retryLabel={t("inbox.retrySetup")}
                      openLabel={t("inbox.openProject")}
                      onOpen={() => handleOpenProject(info.projectId, info.workspaceId)}
                      onRetry={
                        info.setupRequest
                          ? () =>
                              runInviteeSetup(
                                id,
                                { projectId: info.projectId, projectName: info.projectName },
                                info.setupRequest!,
                              )
                          : undefined
                      }
                    />
                  ))}
                </div>
              ) : null}

              {sessionInvitations.length > 0 ? (
                <section className="space-y-3" aria-label={t("inbox.liveSessions")}>
                  <h2 className="text-xs font-medium text-muted-foreground">{t("inbox.liveSessions")}</h2>
                  {sessionInvitations.map((item) => (
                    <SessionInvitationCard
                      key={String(item.invitationId)}
                      item={item}
                      onAccepted={(result) => handleSessionAccepted(item, result)}
                    />
                  ))}
                </section>
              ) : null}

              {incoming && incoming.length > 0 ? (
                <section className="space-y-3" aria-label={t("inbox.deviceInvitations")}>
                  {sessionInvitations.length > 0 ? (
                    <h2 className="text-xs font-medium text-muted-foreground">{t("inbox.deviceInvitations")}</h2>
                  ) : null}
                  {incoming.map((enrollment) => {
                    const isBusy = activeAction?.enrollmentId === enrollment._id
                    const isAccepting = isBusy && activeAction?.accept === true
                    const isDeclining = isBusy && activeAction?.accept === false

                    return (
                      <div
                        key={enrollment._id}
                        className="group flex flex-col gap-3 rounded-xl border border-border/60 bg-card/60 p-4 transition-colors hover:border-border/90 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex items-start gap-3 sm:items-center">
                          <Avatar className="size-10 shrink-0 rounded-lg">
                            <AvatarFallback className="rounded-lg text-xs font-medium">
                              {initial(enrollment.projectName)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="truncate text-sm font-medium text-foreground">
                                {enrollment.projectName}
                              </h3>
                              <Badge variant="secondary" shape="pill" size="sm">
                                {formatRole(enrollment.role)}
                              </Badge>
                            </div>
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                              <span>
                                {t("inbox.invitedBy")} {enrollment.inviterName}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="inline-flex items-center gap-1">
                                <HugeiconsIcon icon={__ClockHugeIcon} className="size-3 text-muted-foreground/75" />
                                {formatExpiryDays(enrollment.expiresAt)}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-end gap-2 shrink-0 pt-1 sm:pt-0">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={isBusy}
                            className="h-8 text-xs font-normal"
                            onClick={() =>
                              void handleResolve(enrollment._id, false, enrollment.projectName)
                            }
                          >
                            {isDeclining ? <Spinner size="xs" className="mr-1.5" /> : null}
                            {t("inbox.decline")}
                          </Button>
                          <Button
                            size="sm"
                            disabled={isBusy}
                            className="h-8 text-xs font-medium"
                            onClick={() =>
                              void handleResolve(enrollment._id, true, enrollment.projectName)
                            }
                          >
                            {isAccepting ? <Spinner size="xs" className="mr-1.5 text-primary-foreground" /> : null}
                            {t("inbox.accept")}
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </section>
              ) : null}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
