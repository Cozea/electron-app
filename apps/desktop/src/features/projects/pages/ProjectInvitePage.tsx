import { useCallback, useMemo, useState } from "react"
import { useMutation, useQuery } from "convex/react"
import { useParams } from "@/lib/router"

import { api } from "../../../../../../convex/_generated/api"
import type { Id } from "../../../../../../convex/_generated/dataModel"
import { useAuth } from "@/contexts/AuthContext"
import { useTranslation } from '@/lib/i18n'
import { useViewTransitionNavigate } from "@/lib/navigation"
import { buildProjectPath } from "@/features/projects/lib/projectRoutes"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

import { HugeiconsIcon } from "@hugeicons/react"
import {
  AlertCircleIcon as __AlertCircleHugeIcon,
  UserAdd01Icon as __UserPlusHugeIcon,
} from "@hugeicons/core-free-icons"

function cleanConvexError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : fallback
  return raw.replace(/^\[CONVEX.*?\]\s*/, "").replace(/\s*Called by client$/, "") || fallback
}

function formatName(input: {
  firstName?: string | null
  lastName?: string | null
  email?: string | null
} | null | undefined, t: any): string {
  const first = input?.firstName?.trim() ?? ""
  const last = input?.lastName?.trim() ?? ""
  const fullName = `${first} ${last}`.trim()
  return fullName || input?.email?.trim() || t('invite.fallback.name')
}

function isLikelyConvexId(value: string): boolean {
  return /^[a-z0-9]+$/i.test(value)
}

export function ProjectInvitePage() {
  const navigate = useViewTransitionNavigate()
  const { t } = useTranslation()
  const { inviteId: inviteIdParam } = useParams()
  const { convexUserId, isLoading } = useAuth()
  const acceptInvite = useMutation(api.projectInvites.acceptInvite)
  const declineInvite = useMutation(api.projectInvites.declineInvite)

  const inviteId = useMemo(() => {
    const candidate = inviteIdParam?.trim() ?? ""
    return candidate && isLikelyConvexId(candidate)
      ? (candidate as Id<"projectInvites">)
      : null
  }, [inviteIdParam])

  const invite = useQuery(api.projectInvites.get, inviteId ? { inviteId } : "skip")

  const [isSubmitting, setIsSubmitting] = useState<"accept" | "decline" | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const projectHref = invite?.project ? buildProjectPath(String(invite.project.id)) : "/projects"

  const handleAccept = useCallback(async () => {
    if (!inviteId || !convexUserId || !invite?.project) return
    setIsSubmitting("accept")
    setActionError(null)
    try {
      const deviceIdentity = await window.electronAPI.collab.ensureDeviceIdentity()
      await acceptInvite({
        inviteId,
        userId: convexUserId,
        deviceId: deviceIdentity.deviceId,
        deviceLabel: deviceIdentity.deviceLabel,
        platform: deviceIdentity.platform,
        fingerprint: deviceIdentity.fingerprint,
      })
      navigate(buildProjectPath(String(invite.project.id), "workbench"), { replace: true })
    } catch (error) {
      setActionError(cleanConvexError(error, t('invite.error.accept')))
    } finally {
      setIsSubmitting(null)
    }
  }, [acceptInvite, convexUserId, invite?.project, inviteId, navigate])

  const handleDecline = useCallback(async () => {
    if (!inviteId) return
    setIsSubmitting("decline")
    setActionError(null)
    try {
      await declineInvite({
        inviteId,
      })
      navigate("/projects", { replace: true })
    } catch (error) {
      setActionError(cleanConvexError(error, t('invite.error.decline')))
    } finally {
      setIsSubmitting(null)
    }
  }, [declineInvite, inviteId, navigate])

  if (!inviteId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-lg">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
              <HugeiconsIcon icon={__AlertCircleHugeIcon} className="h-7 w-7 text-destructive" />
            </div>
            <CardTitle>{t('invite.invalid.title')}</CardTitle>
            <CardDescription>{t('invite.invalid.desc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => navigate("/projects", { replace: true })}>
              {t('invite.action.goToProjects')}
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (invite === undefined || isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-lg">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <div className="loader text-primary" />
            </div>
            <CardTitle>{t('invite.loading.title')}</CardTitle>
            <CardDescription>{t('invite.loading.desc')}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  if (!invite || !invite.project) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-lg">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
              <HugeiconsIcon icon={__AlertCircleHugeIcon} className="h-7 w-7 text-destructive" />
            </div>
            <CardTitle>{t('invite.unavailable.title')}</CardTitle>
            <CardDescription>
              {t('invite.unavailable.desc')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => navigate("/projects", { replace: true })}>
              {t('invite.action.goToProjects')}
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!convexUserId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-lg">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <div className="loader text-primary" />
            </div>
            <CardTitle>{t('invite.setup.title')}</CardTitle>
            <CardDescription>{t('invite.setup.desc')}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  if (invite.status !== "pending") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-lg">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-muted/70">
              <HugeiconsIcon icon={__UserPlusHugeIcon} className="h-7 w-7 text-muted-foreground" />
            </div>
            <CardTitle>{t('invite.processed.title')}</CardTitle>
            <CardDescription>
              {t('invite.processed.desc')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => navigate(projectHref, { replace: true })}>
              {t('invite.action.openProject')}
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <HugeiconsIcon icon={__UserPlusHugeIcon} className="h-7 w-7 text-primary" />
          </div>
          <CardTitle>{invite.project.name}</CardTitle>
          <CardDescription>
            {t('invite.details.invitedYou')
              .replace('{name}', formatName(invite.inviter, t))
              .replace('{role}', invite.role.replace(/_/g, " "))}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border border-border/60 bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
            {t('invite.details.address')} <span className="font-medium text-foreground">{invite.email}</span>.
            {t('invite.details.authorize')}
          </div>

          {actionError ? (
            <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {actionError}
            </div>
          ) : null}

          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                void handleDecline()
              }}
              disabled={isSubmitting !== null}
            >
              {isSubmitting === "decline" ? (
                <div className="loader mr-2" />
              ) : null}
              {t('invite.action.decline')}
            </Button>
            <Button
              className="flex-1"
              onClick={() => {
                void handleAccept()
              }}
              disabled={isSubmitting !== null}
            >
              {isSubmitting === "accept" ? (
                <div className="loader mr-2" />
              ) : null}
              {t('invite.action.accept')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
