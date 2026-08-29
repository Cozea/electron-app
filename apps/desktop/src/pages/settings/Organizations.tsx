import { useMemo, useState } from "react"
import { useMutation, useQuery } from "convex/react"

import { api } from "../../../../../convex/_generated/api"
import type { Id } from "../../../../../convex/_generated/dataModel"
import { useAuth } from "@/contexts/AuthContext"
import {
  SettingsGroup,
  SettingsPageBody,
  SettingsRow,
  SettingsRowControl,
  SettingsSectionDescription,
  SettingsSectionTitle,
} from "@/components/settings/SettingsChrome"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { useTranslation } from "@/lib/i18n"
import { useProjectWorkbenchStore } from "@/stores/useProjectWorkbenchStore"
import { DevAppIcon } from "@/features/devapps/components/DevAppIcon"
import { cn } from "@/lib/utils"
import {
  createOrganizationRecoveryCode,
  redeemOrganizationRecoveryCode,
} from "@/lib/deviceSession"

import { HugeiconsIcon } from "@hugeicons/react"
import { CheckmarkCircle02Icon as __CheckHugeIcon } from "@hugeicons/core-free-icons"

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
  const [deviceIdentityId, setDeviceIdentityId] = useState("")
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [recoveryCode, setRecoveryCode] = useState("")
  const [generatedRecoveryCode, setGeneratedRecoveryCode] = useState<string | null>(null)

  const orgs = useQuery(
    api.organizations.listMine,
    convexUserId ? {} : "skip",
  )
  const [selectedOrgId, setSelectedOrgId] = useState<Id<"organizations"> | null>(null)
  const activeOrgId = selectedOrgId ?? orgs?.[0]?.organizationId ?? null

  const members = useQuery(
    api.organizations.listMembers,
    convexUserId && activeOrgId
      ? { organizationId: activeOrgId }
      : "skip",
  )
  const activeOrgDetails = useQuery(
    api.organizations.get,
    convexUserId && activeOrgId ? { organizationId: activeOrgId } : "skip",
  )
  const devApps = useQuery(
    api.devApps.listForOrganization,
    convexUserId && activeOrgId
      ? { organizationId: activeOrgId }
      : "skip",
  )
  const incomingEnrollments = useQuery(
    api.organizations.listIncomingEnrollments,
    convexUserId ? {} : "skip",
  )
  const pendingEnrollments = useQuery(
    api.organizations.listEnrollments,
    convexUserId && activeOrgId && activeOrgId && orgs?.find((org) => org.organizationId === activeOrgId)?.role === "admin"
      ? { organizationId: activeOrgId }
      : "skip",
  )

  const createOrg = useMutation(api.organizations.create)
  const createDeviceEnrollment = useMutation(api.organizations.createDeviceEnrollment)
  const resolveDeviceEnrollment = useMutation(api.organizations.resolveDeviceEnrollment)
  const cancelDeviceEnrollment = useMutation(api.organizations.cancelDeviceEnrollment)
  const removeMember = useMutation(api.organizations.removeMember)
  const updateMemberRole = useMutation(api.organizations.updateMemberRole)
  const transferAdministration = useMutation(api.organizations.transferAdministration)
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

  const copyId = async (value: string) => {
    await navigator.clipboard.writeText(value)
    setCopiedId(value)
    window.setTimeout(() => setCopiedId((current) => (current === value ? null : current)), 2_000)
  }

  return (
    <SettingsPageBody surface={surface}>
      <section>
        <SettingsSectionTitle>{t("settings.organizations.title")}</SettingsSectionTitle>
        <SettingsSectionDescription>
          {t("settings.organizations.description")}
        </SettingsSectionDescription>
        {error ? <p className="mb-3 px-1 text-xs text-destructive">{error}</p> : null}

        <SettingsGroup>
          <SettingsRow isFirst>
            <div className="min-w-0 flex-1 pr-3">
              <Input
                value={orgName}
                onChange={(event) => setOrgName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && orgName.trim() && !busy && convexUserId) {
                    void run(async () => {
                      if (!convexUserId) return
                      const created = await createOrg({ name: orgName })
                      setOrgName("")
                      setSelectedOrgId(created.organizationId)
                    })
                  }
                }}
                placeholder={t("settings.organizations.createPlaceholder")}
                className="h-7 w-full border-0 border-none bg-transparent px-0 text-xs font-normal text-foreground shadow-none placeholder:text-muted-foreground/60 focus-visible:ring-0 dark:border-none dark:bg-transparent"
              />
            </div>
            <SettingsRowControl>
              <Button
                size="sm"
                className="h-7 text-[11px]"
                disabled={busy || !convexUserId || !orgName.trim()}
                onClick={() =>
                  void run(async () => {
                    if (!convexUserId) return
                    const created = await createOrg({ name: orgName })
                    setOrgName("")
                    setSelectedOrgId(created.organizationId)
                  })
                }
              >
                {t("settings.organizations.create")}
              </Button>
            </SettingsRowControl>
          </SettingsRow>
        </SettingsGroup>
      </section>

      {(incomingEnrollments ?? []).length > 0 ? (
        <section>
          <SettingsSectionTitle>Pending invitations</SettingsSectionTitle>
          <SettingsSectionDescription>Accept only groups you recognize. Membership grants access to that group’s projects.</SettingsSectionDescription>
          <SettingsGroup>
            {(incomingEnrollments ?? []).map((enrollment, index) => (
              <SettingsRow key={enrollment._id} isFirst={index === 0}>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium">{enrollment.organizationName}</p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">{enrollment.groupId}</p>
                </div>
                <SettingsRowControl className="gap-2">
                  <Button variant="outline" size="sm" className="h-7 text-[11px]" disabled={busy}
                    onClick={() => void run(async () => { await resolveDeviceEnrollment({ enrollmentId: enrollment._id, accept: false }) })}>
                    Reject
                  </Button>
                  <Button size="sm" className="h-7 text-[11px]" disabled={busy}
                    onClick={() => void run(async () => { await resolveDeviceEnrollment({ enrollmentId: enrollment._id, accept: true }) })}>
                    Accept
                  </Button>
                </SettingsRowControl>
              </SettingsRow>
            ))}
          </SettingsGroup>
        </section>
      ) : null}

      <section>
        <SettingsSectionTitle>Recover group access</SettingsSectionTitle>
        <SettingsSectionDescription>Redeem a one-time recovery code on this replacement device. It receives its own new device ID.</SettingsSectionDescription>
        <SettingsGroup>
          <SettingsRow isFirst>
            <div className="min-w-0 flex-1 pr-3">
              <Input
                value={recoveryCode}
                onChange={(event) => setRecoveryCode(event.target.value)}
                placeholder="czr_…"
                className="h-7 w-full border-0 border-none bg-transparent px-0 font-mono text-xs font-normal text-foreground shadow-none placeholder:text-muted-foreground/60 focus-visible:ring-0 dark:border-none dark:bg-transparent"
              />
            </div>
            <SettingsRowControl>
              <Button
                size="sm"
                className="h-7 text-[11px]"
                disabled={busy || !recoveryCode.trim()}
                onClick={() =>
                  void run(async () => {
                    await redeemOrganizationRecoveryCode(recoveryCode.trim())
                    setRecoveryCode("")
                  })
                }
              >
                Recover
              </Button>
            </SettingsRowControl>
          </SettingsRow>
        </SettingsGroup>
      </section>

      <section>
        <SettingsSectionTitle>{t("settings.organizations.yours")}</SettingsSectionTitle>
        {(orgs ?? []).length === 0 ? (
          <SettingsGroup>
            <SettingsRow isFirst>
              <p className="text-xs text-muted-foreground">{t("settings.organizations.empty")}</p>
            </SettingsRow>
          </SettingsGroup>
        ) : (
          <SettingsGroup>
            {(orgs ?? []).map((org, index) => {
              const isSelected = org.organizationId === activeOrgId
              return (
                <SettingsRow
                  key={org.organizationId}
                  isFirst={index === 0}
                  className={cn(
                    "cursor-pointer transition-colors hover:bg-foreground/[0.04]",
                    isSelected && "bg-foreground/[0.03]",
                  )}
                  onClick={() => setSelectedOrgId(org.organizationId)}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    {isSelected ? (
                      <HugeiconsIcon icon={__CheckHugeIcon} className="size-4 shrink-0 text-primary" />
                    ) : (
                      <div className="size-4 shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-foreground">{org.name}</p>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">{org.groupId}</p>
                    </div>
                  </div>
                  <SettingsRowControl>
                    <Badge variant="secondary" className="h-5 rounded-full px-2 text-[10px] font-normal">
                      {org.role === "admin"
                        ? t("settings.organizations.role.admin")
                        : t("settings.organizations.role.member")}
                    </Badge>
                  </SettingsRowControl>
                </SettingsRow>
              )
            })}
          </SettingsGroup>
        )}
      </section>

      {activeOrg ? (
        <>
          <section>
            <SettingsSectionTitle>{t("settings.organizations.groupId")}</SettingsSectionTitle>
            <SettingsSectionDescription>
              {t("settings.organizations.groupIdDescription")}
            </SettingsSectionDescription>
            <SettingsGroup>
              <SettingsRow isFirst className="items-center">
                <div className="min-w-0 flex-1">
                  <span className="text-xs font-medium text-foreground">{activeOrg.name}</span>
                  <p className="max-w-[34rem] truncate font-mono text-[11px] text-muted-foreground">
                    {activeOrg.groupId}
                  </p>
                </div>
                <SettingsRowControl>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={() => void copyId(activeOrg.groupId)}
                  >
                    {copiedId === activeOrg.groupId ? t("common.copied") : t("common.copy")}
                  </Button>
                </SettingsRowControl>
              </SettingsRow>
            </SettingsGroup>
          </section>

          <section>
            <SettingsSectionTitle>{t("settings.organizations.members")}</SettingsSectionTitle>
            <SettingsGroup>
              {(members ?? []).map((member, index) => (
                <SettingsRow key={member.membershipId} isFirst={index === 0}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-foreground">
                      {member.deviceLabel || t("settings.account.thisDevice")}
                    </p>
                    <p className="truncate font-mono text-[11px] text-muted-foreground">
                      {member.identityKey}
                    </p>
                  </div>
                  <SettingsRowControl className="gap-2">
                    <Badge variant="secondary" className="h-5 rounded-full px-2 text-[10px] font-normal">
                      {member.role === "admin"
                        ? t("settings.organizations.role.admin")
                        : t("settings.organizations.role.member")}
                    </Badge>
                    {isAdmin && convexUserId !== member.userId ? (
                      <>
                        <Button variant="outline" size="sm" className="h-7 text-[11px]" disabled={busy}
                          onClick={() => void run(async () => {
                            await updateMemberRole({ organizationId: activeOrg.organizationId, memberUserId: member.userId, role: member.role === "admin" ? "member" : "admin" })
                          })}>
                          {member.role === "admin" ? "Make member" : "Make admin"}
                        </Button>
                        {activeOrgDetails?.isCreator ? (
                          <Button variant="outline" size="sm" className="h-7 text-[11px]" disabled={busy}
                            onClick={() => void run(async () => {
                              await transferAdministration({ organizationId: activeOrg.organizationId, memberUserId: member.userId })
                            })}>
                            Transfer
                          </Button>
                        ) : null}
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-[11px] hover:text-destructive"
                          disabled={busy}
                          onClick={() => void run(async () => {
                            await removeMember({ organizationId: activeOrg.organizationId, memberUserId: member.userId })
                          })}
                        >
                          {t("settings.organizations.remove")}
                        </Button>
                      </>
                    ) : null}
                  </SettingsRowControl>
                </SettingsRow>
              ))}

              {isAdmin ? (
                <SettingsRow isFirst={(members ?? []).length === 0}>
                  <div className="min-w-0 flex-1 pr-3">
                    <Input
                      value={deviceIdentityId}
                      onChange={(event) => setDeviceIdentityId(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && deviceIdentityId.trim() && !busy && convexUserId) {
                          void run(async () => {
                            if (!convexUserId) return
                            await createDeviceEnrollment({
                              organizationId: activeOrg.organizationId,
                              identityKey: deviceIdentityId,
                              role: "member",
                            })
                            setDeviceIdentityId("")
                          })
                        }
                      }}
                      placeholder={t("settings.organizations.deviceIdPlaceholder")}
                      className="h-7 w-full border-0 border-none bg-transparent px-0 text-xs font-normal text-foreground shadow-none placeholder:text-muted-foreground/60 focus-visible:ring-0 dark:border-none dark:bg-transparent"
                    />
                  </div>
                  <SettingsRowControl>
                    <Button
                      size="sm"
                      className="h-7 text-[11px]"
                      disabled={busy || !deviceIdentityId.trim()}
                      onClick={() =>
                        void run(async () => {
                          if (!convexUserId) return
                          await createDeviceEnrollment({
                            organizationId: activeOrg.organizationId,
                            identityKey: deviceIdentityId,
                            role: "member",
                          })
                          setDeviceIdentityId("")
                        })
                      }
                    >
                      Invite device
                    </Button>
                  </SettingsRowControl>
                </SettingsRow>
              ) : null}
            </SettingsGroup>
            {isAdmin && (pendingEnrollments ?? []).length > 0 ? (
              <SettingsGroup className="mt-2">
                {(pendingEnrollments ?? []).map((enrollment, index) => (
                  <SettingsRow key={enrollment._id} isFirst={index === 0}>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium">Pending device</p>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">{enrollment.targetIdentityKey}</p>
                    </div>
                    <SettingsRowControl>
                      <Button variant="outline" size="sm" className="h-7 text-[11px]" disabled={busy}
                        onClick={() => void run(async () => { await cancelDeviceEnrollment({ enrollmentId: enrollment._id }) })}>
                        Cancel
                      </Button>
                    </SettingsRowControl>
                  </SettingsRow>
                ))}
              </SettingsGroup>
            ) : null}
          </section>

          {isAdmin ? (
            <section>
              <SettingsSectionTitle>Offline recovery</SettingsSectionTitle>
              <SettingsSectionDescription>Create one code, store it offline, and rotate it after use or suspected exposure.</SettingsSectionDescription>
              <SettingsGroup>
                <SettingsRow isFirst>
                  <p className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
                    {generatedRecoveryCode ?? "No recovery code shown"}
                  </p>
                  <SettingsRowControl>
                    <Button variant="outline" size="sm" className="h-7 text-[11px]" disabled={busy}
                      onClick={() => void run(async () => {
                        const result = await createOrganizationRecoveryCode(activeOrg.organizationId)
                        setGeneratedRecoveryCode(result.recoveryCode)
                      })}>
                      {generatedRecoveryCode ? "Rotate code" : "Create code"}
                    </Button>
                    {generatedRecoveryCode ? (
                      <Button variant="outline" size="sm" className="h-7 text-[11px]"
                        onClick={() => void copyId(generatedRecoveryCode)}>Copy</Button>
                    ) : null}
                  </SettingsRowControl>
                </SettingsRow>
              </SettingsGroup>
            </section>
          ) : null}

          <section>
            <SettingsSectionTitle>{t("settings.organizations.devApps")}</SettingsSectionTitle>
            {(devApps ?? []).length === 0 ? (
              <SettingsGroup>
                <SettingsRow isFirst>
                  <p className="text-xs text-muted-foreground">
                    {t("settings.organizations.noDevApps")}
                  </p>
                </SettingsRow>
              </SettingsGroup>
            ) : (
              <SettingsGroup>
                {(devApps ?? []).map((app, index) => (
                  <SettingsRow key={app.publicationId} isFirst={index === 0}>
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-background/50 p-1 border border-border/40">
                        <DevAppIcon
                          app={{
                            name: app.name,
                            icon: { src: app.logoDataUrl || "", alt: app.name },
                          }}
                          className="size-full"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-foreground">{app.name}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {t("settings.organizations.version")} {app.activeRelease.version}
                          {app.activeRelease.runtimeKind === "service"
                            ? ` · Service · ${app.activeRelease.framework}`
                            : " · Static"}
                        </p>
                      </div>
                    </div>
                    <SettingsRowControl className="gap-2">
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
                              orgDevAppRuntimeKind: app.activeRelease.runtimeKind,
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
                                publicationId: app.publicationId,
                              })
                            })
                          }
                        >
                          {t("settings.organizations.archiveDevApp")}
                        </Button>
                      ) : null}
                    </SettingsRowControl>
                  </SettingsRow>
                ))}
              </SettingsGroup>
            )}
          </section>
        </>
      ) : null}
    </SettingsPageBody>
  )
}
