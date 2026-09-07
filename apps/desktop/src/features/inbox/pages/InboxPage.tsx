import { useCallback, useState } from "react"
import { useMutation, useQuery } from "convex/react"

import { api } from "../../../../../../convex/_generated/api"
import type { Id } from "../../../../../../convex/_generated/dataModel"
import { useAuth } from "@/contexts/AuthContext"
import { useProjectHeader } from "@/lib/useProjectHeader"
import { useTranslation } from "@/lib/i18n"
import { useViewTransitionNavigate } from "@/lib/navigation"
import { buildProjectPath } from "@/contexts/project/projectRoutes"
import { appToast } from "@/lib/appToast"

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

function cleanConvexError(error: unknown, fallback = "Could not update this invitation."): string {
  const raw = error instanceof Error ? error.message : fallback
  return raw.replace(/^\[CONVEX.*?\]\s*/, "").replace(/\s*Called by client$/, "") || fallback
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

export function InboxPage() {
  const { t } = useTranslation()
  const { principalId } = useAuth()
  const navigate = useViewTransitionNavigate()

  const incoming = useQuery(
    api.projectDeviceEnrollments.listIncoming,
    principalId ? {} : "skip",
  )
  const resolveEnrollment = useMutation(api.projectDeviceEnrollments.resolve)

  const [activeAction, setActiveAction] = useState<{
    enrollmentId: Id<"projectDeviceEnrollments">
    accept: boolean
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recentlyAccepted, setRecentlyAccepted] = useState<
    Map<string, { projectId: string; projectName: string }>
  >(new Map())

  useProjectHeader(null, null, { hideShare: true })

  const handleResolve = useCallback(
    async (enrollmentId: Id<"projectDeviceEnrollments">, accept: boolean, projectName: string) => {
      setError(null)
      setActiveAction({ enrollmentId, accept })
      try {
        const result = await resolveEnrollment({ enrollmentId, accept })
        if (accept && result?.accepted && result.projectId) {
          const acceptedProjectId = String(result.projectId)
          setRecentlyAccepted((prev) => {
            const next = new Map(prev)
            next.set(String(enrollmentId), { projectId: acceptedProjectId, projectName })
            return next
          })
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
        const cleanMsg = cleanConvexError(caught)
        setError(cleanMsg)
        appToast.error({
          title: "Action failed",
          description: cleanMsg,
        })
      } finally {
        setActiveAction(null)
      }
    },
    [resolveEnrollment, t],
  )

  const handleOpenProject = useCallback(
    (projectId: string) => {
      navigate(buildProjectPath(projectId, "workbench"))
    },
    [navigate],
  )

  const isLoading = incoming === undefined

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
          ) : incoming.length === 0 && recentlyAccepted.size === 0 ? (
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
            <div className="space-y-3">
              {/* Recently accepted items */}
              {Array.from(recentlyAccepted.entries()).map(([id, info]) => (
                <div
                  key={`accepted-${id}`}
                  className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                      <HugeiconsIcon icon={__CheckCircleHugeIcon} className="size-5" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{info.projectName}</p>
                      <p className="text-xs text-muted-foreground">{t("inbox.accepted")}</p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="gap-1.5"
                    onClick={() => handleOpenProject(info.projectId)}
                  >
                    <span>{t("inbox.openProject")}</span>
                    <HugeiconsIcon icon={__ArrowRightHugeIcon} className="size-3.5" />
                  </Button>
                </div>
              ))}

              {/* Pending invitations */}
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
                          <h2 className="truncate text-sm font-medium text-foreground">
                            {enrollment.projectName}
                          </h2>
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
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
