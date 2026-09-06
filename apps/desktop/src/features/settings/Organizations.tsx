import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react"
import { useMutation, useQuery } from "convex/react"

import { api } from "../../../../../convex/_generated/api"
import type { Id } from "../../../../../convex/_generated/dataModel"
import { useAuth } from "@/contexts/AuthContext"
import {
  SettingsGroup,
  SettingsPageBody,
  SettingsPageHeader,
  SettingsRow,
  SettingsRowControl,
  SettingsSectionDescription,
  SettingsSectionTitle,
  settingsNativeSelectClass,
} from "@/features/settings/ui/SettingsChrome"
import { PublicIdDisclosure } from "@/features/settings/ui/PublicIdDisclosure"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import type { ContextMenuItem } from "@shared/assistant-contracts/ipc"
import { showDesktopContextMenu } from "@/lib/desktopBridgeClient"
import { getNativeMenuIcon } from "@/lib/nativeMenuIcons"
import { useTranslation } from "@/lib/i18n"
import { useSearchParams } from "@/lib/router"
import { useProjectWorkbenchStore } from "@/lib/workbenchStore"
import { buildWorkbenchScopeKey } from "@/lib/workbenchScopeKey"
import {
  useActiveWorkbenchScope,
  type ActiveWorkbenchScope,
} from "@/contexts/project/useActiveWorkbenchScope"
import { PublishedDevAppIcon } from "@/features/devapps/components/PublishedDevAppIcon"
import { formatDevAppRef } from "@shared/devAppRef"
import { cn } from "@/lib/utils"
import {
  createOrganizationRecoveryCode,
  redeemOrganizationRecoveryCode,
} from "@/lib/deviceSession"

import { HugeiconsIcon } from "@hugeicons/react"
import {
  CheckmarkCircle02Icon as __CheckHugeIcon,
  MoreHorizontalIcon as __MoreHorizontalHugeIcon,
  PlusSignIcon as __PlusHugeIcon,
} from "@hugeicons/core-free-icons"

interface OrganizationsProps {
  surface?: "page" | "drawer"
  route?: string
}

const ORGANIZATION_SETTINGS_TABS = [
  { id: "details", labelKey: "settings.organizations.tabs.details" },
  { id: "members", labelKey: "settings.organizations.tabs.members" },
  { id: "devApps", labelKey: "settings.organizations.tabs.devApps" },
] as const

export type OrganizationSettingsTab = (typeof ORGANIZATION_SETTINGS_TABS)[number]["id"]

const useClientLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect

interface OrganizationSettingsTabsProps {
  activeTab: OrganizationSettingsTab
  onTabChange: (tab: OrganizationSettingsTab) => void
}

export function OrganizationSettingsTabs({
  activeTab,
  onTabChange,
}: OrganizationSettingsTabsProps) {
  const { t } = useTranslation()
  const tabListRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<Partial<Record<OrganizationSettingsTab, HTMLButtonElement>>>({})
  const [indicator, setIndicator] = useState({ left: 0, width: 0, ready: false })

  useClientLayoutEffect(() => {
    const tabList = tabListRef.current
    const activeButton = tabRefs.current[activeTab]
    if (!tabList || !activeButton) return

    const updateIndicator = () => {
      const indicatorInset = 8
      const nextIndicator = {
        left: activeButton.offsetLeft + indicatorInset,
        width: Math.max(activeButton.offsetWidth - indicatorInset * 2, 0),
        ready: true,
      }

      setIndicator((current) => (
        current.left === nextIndicator.left
          && current.width === nextIndicator.width
          && current.ready
          ? current
          : nextIndicator
      ))
    }

    updateIndicator()

    if (typeof ResizeObserver === "undefined") return

    const resizeObserver = new ResizeObserver(updateIndicator)
    resizeObserver.observe(tabList)
    for (const tab of ORGANIZATION_SETTINGS_TABS) {
      const button = tabRefs.current[tab.id]
      if (button) resizeObserver.observe(button)
    }

    return () => resizeObserver.disconnect()
  }, [activeTab])

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    let nextIndex: number | null = null

    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % ORGANIZATION_SETTINGS_TABS.length
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + ORGANIZATION_SETTINGS_TABS.length)
        % ORGANIZATION_SETTINGS_TABS.length
    } else if (event.key === "Home") {
      nextIndex = 0
    } else if (event.key === "End") {
      nextIndex = ORGANIZATION_SETTINGS_TABS.length - 1
    }

    if (nextIndex === null) return

    event.preventDefault()
    const nextTab = ORGANIZATION_SETTINGS_TABS[nextIndex]
    onTabChange(nextTab.id)
    requestAnimationFrame(() => {
      document.getElementById(`organization-settings-tab-${nextTab.id}`)?.focus()
    })
  }

  return (
    <div className="overflow-x-auto px-1">
      <div
        ref={tabListRef}
        role="tablist"
        aria-label={t("settings.organizations.tabs.label")}
        className="relative flex min-w-max items-center gap-1 border-b border-border/50"
      >
        {ORGANIZATION_SETTINGS_TABS.map((tab, index) => {
          const isActive = activeTab === tab.id
          return (
            <Button
              key={tab.id}
              ref={(element) => {
                tabRefs.current[tab.id] = element ?? undefined
              }}
              id={`organization-settings-tab-${tab.id}`}
              type="button"
              role="tab"
              variant="ghost"
              size="sm"
              className={cn(
                "relative h-9 rounded-none border-0 bg-transparent px-3 text-xs font-medium text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground",
                isActive && "text-foreground",
              )}
              aria-controls={`organization-settings-panel-${tab.id}`}
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onTabChange(tab.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              {t(tab.labelKey)}
            </Button>
          )
        })}
        <span
          aria-hidden="true"
          data-organization-tab-indicator
          className={cn(
            "pointer-events-none absolute -bottom-px left-0 h-0.5 rounded-full bg-primary opacity-0",
            "will-change-transform transition-[transform,width,opacity] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
            indicator.ready && "opacity-100",
          )}
          style={{
            width: `${indicator.width}px`,
            transform: `translateX(${indicator.left}px)`,
          }}
        />
      </div>
    </div>
  )
}

function cleanConvexError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : fallback
  return raw.replace(/^\[CONVEX.*?\]\s*/, "").replace(/\s*Called by client$/, "") || fallback
}

interface WorkbenchTarget {
  projectId: string
  laneId: string
  workspaceId: string | null
}

/**
 * Which bench a published DevApp opens into.
 *
 * Opened from the settings drawer there is a project on screen, and that is the
 * answer — this used to take the first entry of the persisted record instead,
 * which is insertion order, so with two projects open the DevApp could land in
 * the one the user was not looking at and appear to do nothing.
 *
 * The standalone settings page sits above any project, so there is no scope to
 * read. The bench the user was last in is the next best answer and an honest
 * one; a single open bench after that is unambiguous. Beyond those it is a
 * guess, and the button does nothing rather than opening somewhere invisible.
 */
export function resolveWorkbenchTarget(
  scope: ActiveWorkbenchScope,
  open: readonly WorkbenchTarget[],
  lastActiveScopeKey: string | null,
): WorkbenchTarget | null {
  if (scope.projectId && !scope.laneResolutionPending) {
    return { projectId: scope.projectId, laneId: scope.laneId, workspaceId: scope.workspaceId }
  }

  const lastActive = lastActiveScopeKey
    ? open.find(
        (bench) =>
          buildWorkbenchScopeKey(bench.projectId, bench.laneId, bench.workspaceId) ===
          lastActiveScopeKey,
      )
    : undefined

  return lastActive ?? (open.length === 1 ? (open[0] ?? null) : null)
}

export function Organizations({ surface = "page", route: _route }: OrganizationsProps) {
  const { convexUserId } = useAuth()
  const { t } = useTranslation()
  const workbenchActions = useProjectWorkbenchStore((state) => state.actions)
  const activeWorkbench = useActiveWorkbenchScope()
  const [isCreatingOrg, setIsCreatingOrg] = useState(false)
  const [isInvitingDevice, setIsInvitingDevice] = useState(false)
  const [orgName, setOrgName] = useState("")
  const [deviceIdentityId, setDeviceIdentityId] = useState("")
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [recoveryCode, setRecoveryCode] = useState("")
  const [generatedRecoveryCode, setGeneratedRecoveryCode] = useState<string | null>(null)
  // `?tab=` so the DevApps Store (and any other deep link) can land on a
  // specific tab instead of always opening on Details.
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab: OrganizationSettingsTab =
    ORGANIZATION_SETTINGS_TABS.find((tab) => tab.id === searchParams.get("tab"))?.id ?? "details"
  const setActiveTab = useCallback(
    (tab: OrganizationSettingsTab) => {
      const next = new URLSearchParams(searchParams)
      if (tab === "details") next.delete("tab")
      else next.set("tab", tab)
      setSearchParams(next, { replace: true })
    },
    [searchParams, setSearchParams],
  )

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
    convexUserId && activeOrgId && orgs?.find((org) => org.organizationId === activeOrgId)?.role === "admin"
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

  const inviteDevice = () => {
    const identityKey = deviceIdentityId.trim()
    if (!convexUserId || !activeOrg || !identityKey || busy) return

    void run(async () => {
      await createDeviceEnrollment({
        organizationId: activeOrg.organizationId,
        identityKey,
        role: "member",
      })
      setDeviceIdentityId("")
      setIsInvitingDevice(false)
    })
  }

  const groupAccessRecovery = (
    <section>
      <SettingsSectionTitle>Recover group access</SettingsSectionTitle>
      <SettingsSectionDescription>
        Redeem a one-time recovery code on this replacement device to rejoin your organization.
      </SettingsSectionDescription>
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
  )

  return (
    <SettingsPageBody surface={surface}>
      <SettingsPageHeader
        title={t("settings.nav.organizations")}
        description={t("settings.organizations.description")}
      />

      {error ? <p className="mb-3 px-1 text-xs text-destructive">{error}</p> : null}

      {/* 1. Pending Incoming Invitations */}
      {(incomingEnrollments ?? []).length > 0 ? (
        <section>
          <SettingsSectionTitle>Pending invitations</SettingsSectionTitle>
          <SettingsSectionDescription>
            Accept only groups you recognize. Membership grants access to that group’s projects and DevApps.
          </SettingsSectionDescription>
          <SettingsGroup>
            {(incomingEnrollments ?? []).map((enrollment, index) => (
              <SettingsRow key={enrollment._id} isFirst={index === 0}>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground">{enrollment.organizationName}</p>
                  <PublicIdDisclosure
                    value={enrollment.groupId}
                    label={t("settings.organizations.groupId")}
                  />
                </div>
                <SettingsRowControl className="gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px]"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await resolveDeviceEnrollment({ enrollmentId: enrollment._id, accept: false })
                      })
                    }
                  >
                    Reject
                  </Button>
                  <Button
                    size="sm"
                    className="h-7 text-[11px]"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await resolveDeviceEnrollment({ enrollmentId: enrollment._id, accept: true })
                      })
                    }
                  >
                    Accept
                  </Button>
                </SettingsRowControl>
              </SettingsRow>
            ))}
          </SettingsGroup>
        </section>
      ) : null}

      {/* 2. Organizations Selector & List */}
      <section>
        <div className="mb-2 flex items-center justify-between px-1">
          <SettingsSectionTitle className="mb-0">{t("settings.organizations.title")}</SettingsSectionTitle>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
            onClick={() => setIsCreatingOrg((prev) => !prev)}
          >
            <HugeiconsIcon icon={__PlusHugeIcon} className="size-3.5" />
            <span>New organization</span>
          </Button>
        </div>

        {isCreatingOrg ? (
          <SettingsGroup className="mb-3">
            <SettingsRow isFirst>
              <div className="min-w-0 flex-1 pr-3">
                <Input
                  value={orgName}
                  onChange={(event) => setOrgName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && orgName.trim() && !busy && convexUserId) {
                      void run(async () => {
                        if (!convexUserId) return
                        const created = await createOrg({ name: orgName.trim() })
                        setOrgName("")
                        setIsCreatingOrg(false)
                        setSelectedOrgId(created.organizationId)
                      })
                    }
                  }}
                  placeholder={t("settings.organizations.createPlaceholder")}
                  className="h-7 w-full border-0 border-none bg-transparent px-0 text-xs font-normal text-foreground shadow-none placeholder:text-muted-foreground/60 focus-visible:ring-0 dark:border-none dark:bg-transparent"
                  autoFocus
                />
              </div>
              <SettingsRowControl className="gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[11px]"
                  disabled={busy}
                  onClick={() => {
                    setIsCreatingOrg(false)
                    setOrgName("")
                  }}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-[11px]"
                  disabled={busy || !convexUserId || !orgName.trim()}
                  onClick={() =>
                    void run(async () => {
                      if (!convexUserId) return
                      const created = await createOrg({ name: orgName.trim() })
                      setOrgName("")
                      setIsCreatingOrg(false)
                      setSelectedOrgId(created.organizationId)
                    })
                  }
                >
                  {t("settings.organizations.create")}
                </Button>
              </SettingsRowControl>
            </SettingsRow>
          </SettingsGroup>
        ) : null}

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
                      <PublicIdDisclosure
                        value={org.groupId}
                        label={t("settings.organizations.groupId")}
                      />
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

      {/* 3. Active Organization Tabs */}
      {activeOrg ? (
        <div className="space-y-5">
          <OrganizationSettingsTabs activeTab={activeTab} onTabChange={setActiveTab} />

          {activeTab === "details" ? (
            <div
              id="organization-settings-panel-details"
              role="tabpanel"
              aria-labelledby="organization-settings-tab-details"
              tabIndex={0}
              className="space-y-7 outline-none"
            >
              <section>
                <SettingsSectionTitle>{t("settings.organizations.groupId")}</SettingsSectionTitle>
                <SettingsSectionDescription>
                  {t("settings.organizations.groupIdDescription")}
                </SettingsSectionDescription>
                <SettingsGroup>
                  <SettingsRow isFirst className="items-center">
                    <div className="min-w-0 flex-1">
                      <span className="text-xs font-medium text-foreground">{activeOrg.name}</span>
                      <PublicIdDisclosure
                        value={activeOrg.groupId}
                        label={t("settings.organizations.groupId")}
                        className="max-w-[42rem]"
                      />
                    </div>
                  </SettingsRow>
                </SettingsGroup>
              </section>

              {isAdmin ? (
                <section>
                  <SettingsSectionTitle>Offline recovery</SettingsSectionTitle>
                  <SettingsSectionDescription>
                    Create one recovery code, store it offline, and rotate it after use or suspected exposure.
                  </SettingsSectionDescription>
                  <SettingsGroup>
                    <SettingsRow isFirst>
                      <p className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
                        {generatedRecoveryCode ?? "No recovery code shown"}
                      </p>
                      <SettingsRowControl className="gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-[11px]"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              const result = await createOrganizationRecoveryCode(activeOrg.organizationId)
                              setGeneratedRecoveryCode(result.recoveryCode)
                            })
                          }
                        >
                          {generatedRecoveryCode ? "Rotate code" : "Create code"}
                        </Button>
                        {generatedRecoveryCode ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-[11px]"
                            onClick={() => void copyId(generatedRecoveryCode)}
                          >
                            {copiedId === generatedRecoveryCode ? t("common.copied") : t("common.copy")}
                          </Button>
                        ) : null}
                      </SettingsRowControl>
                    </SettingsRow>
                  </SettingsGroup>
                </section>
              ) : null}

              {groupAccessRecovery}
            </div>
          ) : null}

          {activeTab === "members" ? (
            <div
              id="organization-settings-panel-members"
              role="tabpanel"
              aria-labelledby="organization-settings-tab-members"
              tabIndex={0}
              className="outline-none"
            >
              <section>
                <div className="mb-2 flex items-center justify-between gap-3 px-1">
                  <SettingsSectionTitle className="mb-0 px-0">
                    {t("settings.organizations.members")}
                  </SettingsSectionTitle>
                  {isAdmin ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      data-organization-members-invite-action
                      className="h-7 gap-1 px-2 text-xs font-medium text-muted-foreground hover:text-foreground"
                      aria-controls="organization-members-invite-form"
                      aria-expanded={isInvitingDevice}
                      disabled={isInvitingDevice}
                      onClick={() => setIsInvitingDevice(true)}
                    >
                      <HugeiconsIcon icon={__PlusHugeIcon} className="size-3.5" />
                      <span>{t("settings.organizations.inviteDevice")}</span>
                    </Button>
                  ) : null}
                </div>

                {isAdmin && isInvitingDevice ? (
                  <form
                    id="organization-members-invite-form"
                    className="mb-3"
                    onSubmit={(event) => {
                      event.preventDefault()
                      inviteDevice()
                    }}
                  >
                    <SettingsGroup>
                      <SettingsRow isFirst>
                        <div className="min-w-0 flex-1 pr-3">
                          <Input
                            value={deviceIdentityId}
                            onChange={(event) => setDeviceIdentityId(event.target.value)}
                            placeholder={t("settings.organizations.deviceIdPlaceholder")}
                            className="h-7 w-full border-0 border-none bg-transparent px-0 text-xs font-normal text-foreground shadow-none placeholder:text-muted-foreground/60 focus-visible:ring-0 dark:border-none dark:bg-transparent"
                            autoFocus
                          />
                        </div>
                        <SettingsRowControl className="gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 text-[11px]"
                            disabled={busy}
                            onClick={() => {
                              setIsInvitingDevice(false)
                              setDeviceIdentityId("")
                            }}
                          >
                            {t("common.cancel")}
                          </Button>
                          <Button
                            type="submit"
                            size="sm"
                            className="h-7 text-[11px]"
                            disabled={busy || !deviceIdentityId.trim()}
                          >
                            {t("settings.organizations.invite")}
                          </Button>
                        </SettingsRowControl>
                      </SettingsRow>
                    </SettingsGroup>
                  </form>
                ) : null}

                <div data-organization-members-list>
                  <SettingsGroup>
                    {(members ?? []).map((member, index) => (
                      <SettingsRow key={member.membershipId} isFirst={index === 0}>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-foreground">
                            {member.deviceLabel || t("settings.account.thisDevice")}
                          </p>
                          <PublicIdDisclosure
                            value={member.identityKey}
                            label={t("settings.account.deviceIdentity")}
                          />
                        </div>
                        <SettingsRowControl className="gap-2">
                          {isAdmin && convexUserId !== member.userId ? (
                            <>
                              <select
                                className={cn(settingsNativeSelectClass, "h-7 text-xs font-normal py-0")}
                                value={member.role}
                                disabled={busy}
                                onChange={(e) => {
                                  const nextRole = e.target.value as "admin" | "member"
                                  void run(async () => {
                                    await updateMemberRole({
                                      organizationId: activeOrg.organizationId,
                                      memberUserId: member.userId,
                                      role: nextRole,
                                    })
                                  })
                                }}
                              >
                                <option value="member">{t("settings.organizations.role.member")}</option>
                                <option value="admin">{t("settings.organizations.role.admin")}</option>
                              </select>

                              <Button
                                variant="ghost"
                                size="sm"
                                className="size-7 rounded-lg p-0 text-muted-foreground hover:text-foreground"
                                disabled={busy}
                                aria-label="Member options"
                                onClick={async (event) => {
                                  event.preventDefault()
                                  event.stopPropagation()
                                  const rect = event.currentTarget.getBoundingClientRect()
                                  const position = { x: Math.round(rect.left), y: Math.round(rect.bottom + 4) }

                                  const items: ContextMenuItem<string>[] = []
                                  if (activeOrgDetails?.isCreator) {
                                    items.push({
                                      id: "transfer",
                                      label: "Transfer ownership",
                                      icon: getNativeMenuIcon("crown"),
                                    })
                                  }
                                  items.push({
                                    id: "remove",
                                    label: t("settings.organizations.remove"),
                                    destructive: true,
                                    icon: getNativeMenuIcon("delete"),
                                  })

                                  const action = await showDesktopContextMenu(items, position)
                                  if (!action) return

                                  if (action === "transfer") {
                                    void run(async () => {
                                      await transferAdministration({
                                        organizationId: activeOrg.organizationId,
                                        memberUserId: member.userId,
                                      })
                                    })
                                   } else if (action === "remove") {
                                     const confirmation = await window.electronAPI.dialog.showMessageBox({
                                       type: "warning",
                                       title: t("settings.organizations.remove"),
                                       message: `${t("settings.organizations.remove")}?`,
                                       detail: "This member will lose access to organization projects and shared resources.",
                                       buttons: [t("settings.organizations.remove"), t("common.cancel")],
                                       defaultId: 0,
                                       cancelId: 1,
                                       noLink: true,
                                     })
                                     if (confirmation.response !== 0) return

                                     void run(async () => {
                                       await removeMember({
                                         organizationId: activeOrg.organizationId,
                                         memberUserId: member.userId,
                                       })
                                     })
                                   }
                                }}
                              >
                                <HugeiconsIcon icon={__MoreHorizontalHugeIcon} className="size-4" />
                              </Button>
                            </>
                          ) : (
                            <Badge variant="secondary" className="h-6 rounded-lg px-2.5 text-xs font-normal">
                              {member.role === "admin"
                                ? t("settings.organizations.role.admin")
                                : t("settings.organizations.role.member")}
                            </Badge>
                          )}
                        </SettingsRowControl>
                      </SettingsRow>
                    ))}
                  </SettingsGroup>
                </div>

                {isAdmin && (pendingEnrollments ?? []).length > 0 ? (
                  <SettingsGroup className="mt-2">
                    {(pendingEnrollments ?? []).map((enrollment, index) => (
                      <SettingsRow key={enrollment._id} isFirst={index === 0}>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-foreground">Pending device</p>
                          <PublicIdDisclosure
                            value={enrollment.targetIdentityKey}
                            label={t("settings.account.deviceIdentity")}
                          />
                        </div>
                        <SettingsRowControl>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-[11px]"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                await cancelDeviceEnrollment({ enrollmentId: enrollment._id })
                              })
                            }
                          >
                            Cancel
                          </Button>
                        </SettingsRowControl>
                      </SettingsRow>
                    ))}
                  </SettingsGroup>
                ) : null}
              </section>
            </div>
          ) : null}

          {activeTab === "devApps" ? (
            <div
              id="organization-settings-panel-devApps"
              role="tabpanel"
              aria-labelledby="organization-settings-tab-devApps"
              tabIndex={0}
              className="outline-none"
            >
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
                          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border/40 bg-background/50 p-1">
                            <PublishedDevAppIcon
                              name={app.name}
                              logoDataUrl={app.logoDataUrl}
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
                              const workbench = useProjectWorkbenchStore.getState()
                              const target = resolveWorkbenchTarget(
                                activeWorkbench,
                                Object.values(workbench.workbenches),
                                workbench.lastActiveScopeKey,
                              )
                              if (!target) return
                              workbenchActions.addTile(
                                target.projectId,
                                target.laneId,
                                "orgDevApp",
                                {
                                  title: app.name,
                                  devAppRef: formatDevAppRef({
                                    kind: "publication",
                                    organizationId: app.organizationId,
                                    publicationId: app.publicationId,
                                    version: "latest",
                                  }),
                                  orgDevAppPublicationId: app.publicationId,
                                  orgDevAppOrganizationId: app.organizationId,
                                  orgDevAppContentHash: app.activeRelease.contentHash,
                                  orgDevAppEntryPath: app.activeRelease.entryPath,
                                  orgDevAppRuntimeKind: app.activeRelease.runtimeKind,
                                  orgDevAppLogoDataUrl: app.logoDataUrl,
                                  storageScope: "orgDevApp",
                                },
                                target.workspaceId,
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
            </div>
          ) : null}
        </div>
      ) : (
        groupAccessRecovery
      )}
    </SettingsPageBody>
  )
}
