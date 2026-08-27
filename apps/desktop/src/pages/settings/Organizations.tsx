import { useMemo, useState } from "react"
import { useMutation, useQuery } from "convex/react"

import { api } from "../../../../../convex/_generated/api"
import type { Id } from "../../../../../convex/_generated/dataModel"
import { useAuth } from "@/contexts/AuthContext"
import {
  SettingsGroup,
  SettingsPageBody,
  SettingsSectionDescription,
  SettingsSectionTitle,
} from "@/components/settings/SettingsChrome"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { useTranslation } from "@/lib/i18n"
import { useProjectWorkbenchStore } from "@/stores/useProjectWorkbenchStore"

interface OrganizationsProps {
  surface?: "page" | "drawer"
  route?: string
}

function cleanConvexError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : fallback
  return raw.replace(/^\[CONVEX.*?\]\s*/, "").replace(/\s*Called by client$/, "") || fallback
}

export function Organizations({ surface = "page", route: _route }: OrganizationsProps) {
  const { convexUserId } = useAuth()
  const { t } = useTranslation()
  const workbenchActions = useProjectWorkbenchStore((state) => state.actions)
  const [orgName, setOrgName] = useState("")
  const [inviteEmail, setInviteEmail] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const orgs = useQuery(
    api.organizations.listMine,
    convexUserId ? { userId: convexUserId } : "skip",
  )
  const pendingForMe = useQuery(
    api.organizationInvites.listPendingForMe,
    convexUserId ? { userId: convexUserId } : "skip",
  )
  const [selectedOrgId, setSelectedOrgId] = useState<Id<"organizations"> | null>(null)
  const activeOrgId = selectedOrgId ?? orgs?.[0]?.organizationId ?? null

  const members = useQuery(
    api.organizations.listMembers,
    convexUserId && activeOrgId
      ? { userId: convexUserId, organizationId: activeOrgId }
      : "skip",
  )
  const invites = useQuery(
    api.organizationInvites.listForOrganization,
    convexUserId && activeOrgId
      ? { userId: convexUserId, organizationId: activeOrgId }
      : "skip",
  )
  const devApps = useQuery(
    api.devApps.listForOrganization,
    convexUserId && activeOrgId
      ? { userId: convexUserId, organizationId: activeOrgId }
      : "skip",
  )

  const createOrg = useMutation(api.organizations.create)
  const inviteMember = useMutation(api.organizationInvites.inviteMember)
  const cancelInvite = useMutation(api.organizationInvites.cancelInvite)
  const acceptInvite = useMutation(api.organizationInvites.acceptInvite)
  const removeMember = useMutation(api.organizations.removeMember)
  const archiveDevApp = useMutation(api.devApps.archive)

  const activeOrg = useMemo(
    () => orgs?.find((org) => org.organizationId === activeOrgId) ?? null,
    [orgs, activeOrgId],
  )
  const isAdmin = activeOrg?.role === "admin"

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (caught) {
      setError(cleanConvexError(caught, t("settings.organizations.error")))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsPageBody surface={surface}>
      <section>
        <SettingsSectionTitle>{t("settings.organizations.title")}</SettingsSectionTitle>
        <SettingsSectionDescription>
          {t("settings.organizations.description")}
        </SettingsSectionDescription>
        {error ? <p className="mb-3 px-1 text-xs text-destructive">{error}</p> : null}

        {(pendingForMe ?? []).length > 0 ? (
          <SettingsGroup>
            <div className="space-y-2 px-4 py-3">
              <p className="text-xs font-medium text-foreground">
                {t("settings.organizations.pendingInvites")}
              </p>
              {pendingForMe?.map((invite) => (
                <div key={invite._id} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm">{invite.organization?.name ?? invite.email}</p>
                    <p className="text-[11px] text-muted-foreground">{invite.role}</p>
                  </div>
                  <Button
                    size="sm"
                    className="h-7 text-[11px]"
                    disabled={busy || !convexUserId}
                    onClick={() =>
                      void run(async () => {
                        if (!convexUserId) return
                        await acceptInvite({ userId: convexUserId, inviteId: invite._id })
                      })
                    }
                  >
                    {t("settings.organizations.acceptInvite")}
                  </Button>
                </div>
              ))}
            </div>
          </SettingsGroup>
        ) : null}

        <div className="mt-4 flex gap-2 px-1">
          <Input
            value={orgName}
            onChange={(event) => setOrgName(event.target.value)}
            placeholder={t("settings.organizations.createPlaceholder")}
            className="h-8"
          />
          <Button
            size="sm"
            className="h-8"
            disabled={busy || !convexUserId || !orgName.trim()}
            onClick={() =>
              void run(async () => {
                if (!convexUserId) return
                const created = await createOrg({ userId: convexUserId, name: orgName })
                setOrgName("")
                setSelectedOrgId(created.organizationId)
              })
            }
          >
            {t("settings.organizations.create")}
          </Button>
        </div>
      </section>

      <section>
        <SettingsSectionTitle>{t("settings.organizations.yours")}</SettingsSectionTitle>
        {(orgs ?? []).length === 0 ? (
          <p className="px-1 text-sm text-muted-foreground">{t("settings.organizations.empty")}</p>
        ) : (
          <SettingsGroup>
            {(orgs ?? []).map((org) => (
              <button
                key={org.organizationId}
                type="button"
                className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-muted/40"
                onClick={() => setSelectedOrgId(org.organizationId)}
              >
                <span className="text-sm font-medium">{org.name}</span>
                <Badge variant="secondary" className="h-6 rounded-full text-[11px] font-normal">
                  {org.role === "admin"
                    ? t("settings.organizations.role.admin")
                    : t("settings.organizations.role.member")}
                </Badge>
              </button>
            ))}
          </SettingsGroup>
        )}
      </section>

      {activeOrg ? (
        <>
          <section>
            <SettingsSectionTitle>{t("settings.organizations.members")}</SettingsSectionTitle>
            <SettingsGroup>
              {(members ?? []).map((member) => (
                <div key={member.membershipId} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm">
                      {[member.firstName, member.lastName].filter(Boolean).join(" ") || member.email}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">{member.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="h-6 rounded-full text-[11px] font-normal">
                      {member.role === "admin"
                        ? t("settings.organizations.role.admin")
                        : t("settings.organizations.role.member")}
                    </Badge>
                    {isAdmin && convexUserId !== member.userId ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-[11px]"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            if (!convexUserId) return
                            await removeMember({
                              userId: convexUserId,
                              organizationId: activeOrg.organizationId,
                              memberUserId: member.userId,
                            })
                          })
                        }
                      >
                        {t("settings.organizations.remove")}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </SettingsGroup>
            {isAdmin ? (
              <div className="mt-3 flex gap-2 px-1">
                <Input
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  placeholder={t("settings.organizations.inviteEmail")}
                  className="h-8"
                />
                <Button
                  size="sm"
                  className="h-8"
                  disabled={busy || !inviteEmail.trim()}
                  onClick={() =>
                    void run(async () => {
                      if (!convexUserId) return
                      await inviteMember({
                        userId: convexUserId,
                        organizationId: activeOrg.organizationId,
                        email: inviteEmail,
                        role: "member",
                      })
                      setInviteEmail("")
                    })
                  }
                >
                  {t("settings.organizations.invite")}
                </Button>
              </div>
            ) : null}
            {(invites ?? []).length > 0 ? (
              <div className="mt-3 space-y-2 px-1">
                {(invites ?? []).map((invite) => (
                  <div key={invite._id} className="flex items-center justify-between gap-3">
                    <p className="truncate text-xs text-muted-foreground">
                      {invite.email} · {t("settings.organizations.invitePending")}
                    </p>
                    {isAdmin ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-[11px]"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            if (!convexUserId) return
                            await cancelInvite({ userId: convexUserId, inviteId: invite._id })
                          })
                        }
                      >
                        {t("settings.organizations.cancelInvite")}
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          <section>
            <SettingsSectionTitle>{t("settings.organizations.devApps")}</SettingsSectionTitle>
            {(devApps ?? []).length === 0 ? (
              <p className="px-1 text-sm text-muted-foreground">
                {t("settings.organizations.noDevApps")}
              </p>
            ) : (
              <SettingsGroup>
                {(devApps ?? []).map((app) => {
                  return (
                    <div key={app.publicationId} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{app.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {t("settings.organizations.version")} {app.activeRelease.version}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          className="h-7 text-[11px]"
                          onClick={() => {
                            const workbenches = useProjectWorkbenchStore.getState().workbenches
                            const current = Object.values(workbenches)[0]
                            if (!current) return
                            workbenchActions.addTile(
                              current.projectId,
                              current.laneId,
                              "orgDevApp",
                              {
                                title: app.name,
                                orgDevAppPublicationId: app.publicationId,
                                orgDevAppOrganizationId: app.organizationId,
                                orgDevAppContentHash: app.activeRelease.contentHash,
                                orgDevAppEntryPath: app.activeRelease.entryPath,
                                orgDevAppLogoDataUrl: app.logoDataUrl,
                                storageScope: "orgDevApp",
                              },
                              current.workspaceId,
                            )
                          }}
                        >
                          {t("settings.organizations.openDevApp")}
                        </Button>
                        {isAdmin ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-[11px]"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                if (!convexUserId) return
                                await archiveDevApp({
                                  userId: convexUserId,
                                  publicationId: app.publicationId,
                                })
                              })
                            }
                          >
                            {t("settings.organizations.archiveDevApp")}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </SettingsGroup>
            )}
          </section>
        </>
      ) : null}
    </SettingsPageBody>
  )
}
