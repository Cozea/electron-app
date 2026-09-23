import { useHeaderOverflow } from "./HeaderOverflowContext";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";

import { api } from "../../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../../convex/_generated/dataModel";
import { cleanConvexError as cleanError } from "@/lib/convexError"
import { appToast } from "@/lib/appToast"
import { formatCloneErrorMessage } from "@/lib/git/gitErrorFormatting"
import { useAuth } from "@/contexts/AuthContext";
import { useProjectTeam } from "@/hooks/useProjectTeam";
import { useOptionalProjectSyncContext } from "@/contexts/project/ProjectSyncContext";
import { LiveSessionShareSection } from "@/features/collaboration/ui/LiveSessionShareSection";
import { InviteDevicesField, type InviteTarget } from "@/features/projects/ui/InviteDevicesField";
import { StartCollaborationDialog } from "@/features/collaboration/ui/StartCollaborationDialog";
import { useGitDirtySnapshot } from "@/features/source-control/hooks/useGitDirtySnapshot";
import { buildProjectJoinUrl } from "@shared/projectShare";
import { MAX_PROJECT_USERS } from "@shared/seatLimits";
import { DeviceAvatar } from "@/components/ui/DeviceAvatar";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getUserColor } from "@/components/presence/PresenceAvatarGroup";
import { cn } from "@/lib/utils";
import { showDesktopContextMenu } from "@/lib/desktopBridgeClient";
import type { ContextMenuItem } from "@shared/assistant-contracts/ipc";
import type { LiveSessionMember } from "@/features/collaboration/live/liveSessionModel";

import { HugeiconsIcon } from '@hugeicons/react'
import {
  AddTeamIcon as __AddTeamHugeIcon,
  Copy01Icon as __CopyHugeIcon,
  GitBranchIcon as __GitBranchHugeIcon,
  Link01Icon as __LinkHugeIcon,
  Refresh01Icon as __RefreshHugeIcon,
  Delete02Icon as __DeleteHugeIcon,
  ArrowDown01Icon as __ChevronDownHugeIcon,
  PlayIcon as __PlayHugeIcon,
  SentIcon as __SentHugeIcon,
} from '@hugeicons/core-free-icons'
import type { LiveSessionContext, LiveSessionRecord } from "@/features/collaboration/live/useLiveSession";
import { useSwitchToSessionWorkbench } from "@/features/collaboration/live/useSwitchToSessionWorkbench";
import { findBranchSession } from "@/features/collaboration/collaborationGate";
import { SessionHubDialog } from "@/features/collaboration/ui/SessionHubDialog";

type ProjectRole = "project_manager" | "developer" | "designer" | "viewer";

const ROLE_OPTIONS: Array<{ value: ProjectRole; label: string }> = [
  { value: "developer", label: "Developer" },
  { value: "designer", label: "Designer" },
  { value: "viewer", label: "Viewer" },
  { value: "project_manager", label: "Project manager" },
];

const roleLabel = (role: ProjectRole) =>
  ROLE_OPTIONS.find((option) => option.value === role)?.label ?? "Developer";

/**
 * Roles are picked from the platform's own menu rather than an in-page popup, so
 * they match every other menu in the app. `extra` appends actions under them.
 */
async function pickRole(
  anchor: HTMLElement,
  current: ProjectRole,
  extra: readonly ContextMenuItem<string>[] = [],
): Promise<string | null> {
  const rect = anchor.getBoundingClientRect();
  const items: ContextMenuItem<string>[] = [
    ...ROLE_OPTIONS.map((option) => ({
      id: `role:${option.value}`,
      label: option.label,
      type: "radio" as const,
      checked: option.value === current,
    })),
    ...extra,
  ];
  return await showDesktopContextMenu(items, {
    x: Math.round(rect.left),
    y: Math.round(rect.bottom + 4),
  });
}

const roleFromMenuId = (id: string | null): ProjectRole | null =>
  id && id.startsWith("role:") ? (id.slice("role:".length) as ProjectRole) : null;

export function HeaderProjectShareButton({
  projectId,
  projectName,
  liveSessionMembers,
  liveSession,
  onlinePrincipalIds,
  sessions,
  activeBranch,
}: {
  projectId: Id<"projects"> | null;
  projectName?: string | null;
  liveSessionMembers?: LiveSessionMember[];
  liveSession?: LiveSessionContext | null;
  onlinePrincipalIds?: Set<string>;
  /** All non-hidden sessions in the project; lets the button show a live session this device hasn't joined. */
  sessions?: readonly LiveSessionRecord[];
  /** Branch the folder has checked out; the session button prefers its session. */
  activeBranch?: string | null;
}) {
  const { principalId, user } = useAuth();
  const syncContext = useOptionalProjectSyncContext();
  const { members, memberRole } = useProjectTeam(projectId);
  const pendingEnrollments = useQuery(
    api.projectDeviceEnrollments.listForProject,
    projectId && principalId && memberRole === "project_manager" ? { projectId } : "skip",
  );
  const joinLinkState = useQuery(
    api.projectJoinLinks.getForProject,
    projectId && principalId ? { projectId } : "skip",
  );

  const createEnrollment = useMutation(api.projectDeviceEnrollments.create);
  const cancelEnrollment = useMutation(api.projectDeviceEnrollments.cancel);
  const createJoinLink = useMutation(api.projectJoinLinks.createOrUpdateActiveLink);
  const rotateJoinLink = useMutation(api.projectJoinLinks.rotateLink);
  const revokeJoinLink = useMutation(api.projectJoinLinks.revokeLink);
  const updateMemberRole = useMutation(api.projectMembers.updateRole);
  const removeMember = useMutation(api.projectMembers.removeMember);

  const [open, setOpen] = useState(false);
  const [hubOpen, setHubOpen] = useState(false);
  const [startSessionOpen, setStartSessionOpen] = useState(false);
  // Read only while the Start dialog is open, to tell the creator what the session starts from.
  const dirtySnapshot = useGitDirtySnapshot(startSessionOpen ? syncContext?.workspaceId ?? null : null);
  const headerOverflow = useHeaderOverflow();
  const [inviteTargets, setInviteTargets] = useState<InviteTarget[]>([]);
  const [inviteRole, setInviteRole] = useState<ProjectRole>("developer");
  const [joinRole, setJoinRole] = useState<ProjectRole>("developer");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canManage = memberRole === "project_manager";
  // The server refuses past this; the field stops asking rather than failing late.
  const seatsLeft = Math.max(
    0,
    MAX_PROJECT_USERS - (members?.length ?? 0) - (pendingEnrollments ?? []).length,
  );
  const activeLink = joinLinkState?.activeLink ?? null;
  const roleCheckPending = Boolean(projectId && principalId && memberRole === undefined);
  const shareStatePending = Boolean(projectId && principalId && joinLinkState === undefined);

  useEffect(() => {
    if (activeLink?.role) setJoinRole(activeLink.role as ProjectRole);
  }, [activeLink?.role]);

  const flushCollaboration = useCallback(async () => {
    if (syncContext?.collaborationEnabled) await syncContext.triggerSync();
  }, [syncContext]);

  const run = useCallback(async (key: string, work: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await work();
    } catch (caught) {
      setError(cleanError(caught, "Could not update project access."));
    } finally {
      setBusy(null);
    }
  }, []);

  const inviteDevice = () => {
    if (!projectId || !canManage || inviteTargets.length === 0) return;
    const targets = inviteTargets;
    void run("invite", async () => {
      await flushCollaboration();
      for (const target of targets) {
        await createEnrollment({ projectId, identityKey: target.identityKey, role: inviteRole });
      }
      setInviteTargets([]);
      setNotice(
        targets.length === 1
          ? `Invitation created for ${targets[0].displayName}.`
          : `Invitations created for ${targets.length} devices.`,
      );
    });
  };

  const copyOrCreateLink = () => {
    if (!projectId || !canManage) return;
    void run("link", async () => {
      await flushCollaboration();
      const link = activeLink
        ? activeLink.role === joinRole
          ? activeLink
          : await createJoinLink({ projectId, role: joinRole })
        : await createJoinLink({ projectId, role: joinRole });
      const shareUrl = buildProjectJoinUrl(import.meta.env.VITE_SITE_URL as string | undefined, link.token);
      await navigator.clipboard.writeText(shareUrl);
      setNotice("Join link copied.");
    });
  };

  const rotateLink = () => {
    if (!projectId || !canManage) return;
    void run("rotate", async () => {
      const link = await rotateJoinLink({ projectId, role: joinRole });
      const shareUrl = buildProjectJoinUrl(import.meta.env.VITE_SITE_URL as string | undefined, link.token);
      await navigator.clipboard.writeText(shareUrl);
      setNotice("Join link rotated and copied.");
    });
  };

  const disableLink = () => {
    if (!projectId || !canManage) return;
    void run("disable", async () => {
      await revokeJoinLink({ projectId });
      setNotice("Join link disabled.");
    });
  };

  if (!projectId) return null;

  const isSelfInSession = Boolean(
    liveSession?.session &&
    (liveSession.membership === "active" || liveSession.membership === "none")
  );

  const inSession = useMemo<LiveSessionMember[]>(() => {
    const activeMembers = (liveSessionMembers ?? []).filter((m) => {
      if (m.status !== "active") return false;
      // Current user is always online if on this device
      if (m.isSelf) return true;
      // Heartbeat presence check in project
      if (onlinePrincipalIds?.has(String(m.principalId))) return true;
      // Media / voice / workbench presence check
      if (m.isWorkbenchActive === true) return true;
      if (m.microphoneState && m.microphoneState !== "off") return true;
      return false;
    });

    if (activeMembers.length > 0) return activeMembers;

    // Frame 0 fallback: if liveSession is active for this device, seed with self immediately
    if (isSelfInSession && principalId) {
      return [
        {
          principalId: String(principalId),
          displayName: user?.displayName ?? "This device",
          role: "developer",
          status: "active",
          isSelf: true,
          avatarUrl: user?.avatarUrl ?? null,
          microphoneState: liveSession?.media?.isMuted ? "muted" : "active",
          isWorkbenchActive: true,
        } as LiveSessionMember,
      ];
    }

    return activeMembers;
  }, [
    isSelfInSession,
    liveSession?.media?.isMuted,
    liveSessionMembers,
    onlinePrincipalIds,
    principalId,
    user?.avatarUrl,
    user?.displayName,
  ]);

  const hasActiveSession = inSession.length > 0;
  const MAX_AVATARS = 3;
  const visible = inSession.slice(0, MAX_AVATARS);
  const overflow = inSession.length - MAX_AVATARS;

  const isSessionHub = Boolean(hasActiveSession && liveSession?.session && projectId);

  // A session can be live on this branch while nobody is present (or this
  // device hasn't joined): the presence-based button above would still read
  // "Share". Surface the session itself with a one-click switch instead.
  const branchSession = useMemo<LiveSessionRecord | null>(() => {
    if (!sessions || sessions.length === 0) return null;
    if (activeBranch) {
      const match = findBranchSession(sessions, activeBranch);
      if (match) return match;
    }
    return sessions.find((candidate) => candidate.lifecycle !== "CLOSED") ?? null;
  }, [sessions, activeBranch]);

  const { openSessionWorkbench: switchToSessionWorkbench, switching } = useSwitchToSessionWorkbench({
    projectId: projectId ? String(projectId) : null,
    projectName,
    sourceWorkspaceId: syncContext?.workspaceId ?? null,
  });

  const handleSwitchToSession = (target: {
    sessionId: LiveSessionRecord["_id"]
    publicSessionId: string
    branchName: string
    repositoryUrl?: string | null
    viewerMembership?: string | null
  }) => {
    headerOverflow?.dismiss();
    void switchToSessionWorkbench(target).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : null;
      const formatted = formatCloneErrorMessage(message, target.repositoryUrl ?? null);
      appToast.error({
        title: "Could not open the Session Workbench",
        description:
          typeof formatted === "string"
            ? cleanError(error, "Could not open the Session Workbench")
            : formatted,
      });
    });
  };

  if (isSessionHub && liveSession?.session && projectId) {
    return (
      <>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              className="group inline-flex h-7 items-center justify-center rounded-md bg-transparent px-1 py-0 text-muted-foreground shadow-none hover:bg-accent hover:text-foreground titlebar-no-drag cursor-pointer transition-[background-color,color,transform] duration-150 active:scale-[0.98]"
              disabled={roleCheckPending || shareStatePending}
              aria-label={`Live session with ${inSession.length} participant${inSession.length === 1 ? "" : "s"}. Click to open Session Hub.`}
              onClick={() => {
                headerOverflow?.dismiss();
                setHubOpen(true);
              }}
            >
              <div className="flex items-center -space-x-1.5 px-0.5 shrink-0">
                {visible.map((member, index) => {
                  const isSpeaking = member.microphoneState === "speaking";

                  return (
                    <span
                      key={member.principalId}
                      className="relative inline-flex items-center transition-transform hover:scale-110 hover:z-20"
                      style={{ zIndex: visible.length - index }}
                    >
                      <DeviceAvatar
                        displayName={member.displayName}
                        avatarUrl={member.avatarUrl}
                        principalId={member.principalId}
                        className="size-6"
                        fallbackClassName="text-[10px] font-medium"
                        ringClassName={cn(
                          "border-2 transition-all duration-150",
                          isSpeaking
                            ? "border-emerald-500 ring-2 ring-emerald-500 ring-offset-1 ring-offset-background group-hover:ring-offset-accent"
                            : "border-background group-hover:border-accent",
                        )}
                      />
                    </span>
                  );
                })}
                {overflow > 0 ? (
                  <span
                    className="relative inline-flex items-center"
                    style={{ zIndex: 0 }}
                  >
                    <DeviceAvatar
                      overflowCount={overflow}
                      className="size-6"
                      fallbackClassName="text-[10px] font-medium"
                      ringClassName="border-2 border-background group-hover:border-accent bg-muted transition-colors duration-150"
                    />
                  </span>
                ) : null}
              </div>
            </Button>
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            align="end"
            className="flex flex-col gap-1.5 p-2.5 min-w-48 text-xs"
          >
            <div className="flex items-center justify-between border-b border-border/40 pb-1.5">
              <span className="font-semibold text-xs text-foreground">Live session</span>
              <span className="text-2xs text-muted-foreground">{inSession.length} active</span>
            </div>
            <div className="flex flex-col gap-1 py-0.5">
              {inSession.map((m) => {
                const isSpeaking = m.microphoneState === "speaking";
                const isMuted = m.microphoneState === "muted";
                const color = getUserColor(m.principalId);
                return (
                  <div key={m.principalId} className="flex items-center gap-2 text-xs">
                    <span
                      className="size-2 rounded-full shrink-0"
                      style={{ backgroundColor: color }}
                    />
                    <span className="font-medium text-foreground truncate max-w-[130px]">
                      {m.displayName} {m.isSelf ? <span className="text-muted-foreground font-normal">(you)</span> : ""}
                    </span>
                    <span className="text-muted-foreground text-2xs ml-auto">
                      {isSpeaking ? (
                        <span className="text-emerald-500 font-medium">Speaking</span>
                      ) : isMuted ? (
                        "Muted"
                      ) : (
                        m.role.replace(/_/g, " ")
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="text-2xs text-muted-foreground/80 pt-1.5 border-t border-border/40">
              Click to open Session Hub & call dashboard
            </div>
          </TooltipContent>
        </Tooltip>

        <SessionHubDialog
          open={hubOpen}
          onOpenChange={setHubOpen}
          session={liveSession.session}
          liveSession={liveSession}
          projectId={projectId}
          projectName={projectName}
          workspaceId={syncContext?.workspaceId}
          canManage={canManage}
        />

        <StartCollaborationDialog
          isOpen={startSessionOpen}
          onOpenChange={setStartSessionOpen}
          projectId={projectId}
          projectName={projectName || "this project"}
          currentBranch={syncContext?.activeBranch ?? null}
          sourceWorkspaceId={syncContext?.workspaceId ?? null}
          targetBranch={syncContext?.sharedBranch ?? "main"}
          hasGitRepo={Boolean(syncContext?.gitCwd)}
          uncommittedFileCount={dirtySnapshot?.changedFiles ?? 0}
        />
      </>
    );
  }

  return (
    <>
    {branchSession ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-transparent p-0 text-muted-foreground shadow-none hover:bg-muted/40 hover:text-foreground titlebar-no-drag transition-[background-color,color,transform] duration-150 active:scale-[0.92] cursor-pointer"
            disabled={switching}
            aria-label={
              branchSession.viewerMembership === "active"
                ? `Live session on ${branchSession.branchName}. Click to switch.`
                : `Live session on ${branchSession.branchName}. Click to join.`
            }
            title={
              branchSession.viewerMembership === "active"
                ? `Live session on ${branchSession.branchName} — click to switch`
                : `Live session on ${branchSession.branchName} — click to join`
            }
            onClick={() => {
              handleSwitchToSession({
                sessionId: branchSession._id,
                publicSessionId: branchSession.publicSessionId,
                branchName: branchSession.branchName,
                repositoryUrl: branchSession.repositoryUrl,
                viewerMembership: branchSession.viewerMembership,
              });
            }}
          >
            {switching ? (
              <Spinner size="sm" className="text-muted-foreground" />
            ) : (
              <span className="relative flex items-center justify-center">
                <HugeiconsIcon icon={__GitBranchHugeIcon} className="size-4 shrink-0" />
                <span
                  className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-emerald-500 ring-2 ring-background"
                  aria-hidden="true"
                />
              </span>
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end">
          {branchSession.viewerMembership === "active"
            ? `Live session on ${branchSession.branchName} — click to switch`
            : `Live session on ${branchSession.branchName} — click to join`}
        </TooltipContent>
      </Tooltip>
    ) : null}
    <Dialog open={open} onOpenChange={(next) => {
      setOpen(next);
      if (next) headerOverflow?.dismiss();
    }}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            {hasActiveSession ? (
              <Button
                variant="ghost"
                className="group inline-flex h-7 items-center justify-center rounded-md bg-transparent px-1 py-0 text-muted-foreground shadow-none hover:bg-accent hover:text-foreground titlebar-no-drag cursor-pointer transition-[background-color,color,transform] duration-150 active:scale-[0.98]"
                disabled={roleCheckPending || shareStatePending}
                aria-label={`Live session with ${inSession.length} participant${inSession.length === 1 ? "" : "s"}. Click to open session menu.`}
              >
                <div className="flex items-center -space-x-1.5 px-0.5 shrink-0">
                  {visible.map((member, index) => {
                    const isSpeaking = member.microphoneState === "speaking";

                    return (
                      <span
                        key={member.principalId}
                        className="relative inline-flex items-center transition-transform hover:scale-110 hover:z-20"
                        style={{ zIndex: visible.length - index }}
                      >
                        <DeviceAvatar
                          displayName={member.displayName}
                          avatarUrl={member.avatarUrl}
                          principalId={member.principalId}
                          className="size-6"
                          fallbackClassName="text-[10px] font-medium"
                          ringClassName={cn(
                            "border-2 transition-all duration-150",
                            isSpeaking
                              ? "border-emerald-500 ring-2 ring-emerald-500 ring-offset-1 ring-offset-background group-hover:ring-offset-accent"
                              : "border-background group-hover:border-accent",
                          )}
                        />
                      </span>
                    );
                  })}
                  {overflow > 0 ? (
                    <span
                      className="relative inline-flex items-center"
                      style={{ zIndex: 0 }}
                    >
                      <DeviceAvatar
                        overflowCount={overflow}
                        className="size-6"
                        fallbackClassName="text-[10px] font-medium"
                        ringClassName="border-2 border-background group-hover:border-accent bg-muted transition-colors duration-150"
                      />
                    </span>
                  ) : null}
                </div>
              </Button>
            ) : (
              <Button
                variant="ghost"
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-transparent p-0 text-muted-foreground shadow-none hover:bg-muted/40 hover:text-foreground titlebar-no-drag transition-[background-color,color,transform] duration-150 active:scale-[0.92]"
                disabled={roleCheckPending || shareStatePending}
                aria-label="Share project"
                title="Share project"
              >
                {roleCheckPending || shareStatePending ? (
                  <Spinner size="sm" className="text-muted-foreground" />
                ) : (
                  <HugeiconsIcon icon={__AddTeamHugeIcon} className="size-4 shrink-0" />
                )}
              </Button>
            )}
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="end"
          className={cn(
            hasActiveSession ? "flex flex-col gap-1.5 p-2.5 min-w-48 text-xs" : undefined,
          )}
        >
          {hasActiveSession ? (
            <>
              <div className="flex items-center justify-between border-b border-border/40 pb-1.5">
                <span className="font-semibold text-xs text-foreground">Live session</span>
                <span className="text-2xs text-muted-foreground">{inSession.length} active</span>
              </div>
              <div className="flex flex-col gap-1 py-0.5">
                {inSession.map((m) => {
                  const isSpeaking = m.microphoneState === "speaking";
                  const isMuted = m.microphoneState === "muted";
                  const color = getUserColor(m.principalId);
                  return (
                    <div key={m.principalId} className="flex items-center gap-2 text-xs">
                      <span
                        className="size-2 rounded-full shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <span className="font-medium text-foreground truncate max-w-[130px]">
                        {m.displayName} {m.isSelf ? <span className="text-muted-foreground font-normal">(you)</span> : ""}
                      </span>
                      <span className="text-muted-foreground text-2xs ml-auto">
                        {isSpeaking ? (
                          <span className="text-emerald-500 font-medium">Speaking</span>
                        ) : isMuted ? (
                          "Muted"
                        ) : (
                          m.role.replace(/_/g, " ")
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="text-2xs text-muted-foreground/80 pt-1.5 border-t border-border/40">
                Click to open session menu
              </div>
            </>
          ) : (
            "Share project"
          )}
        </TooltipContent>
      </Tooltip>

      <DialogContent
        finalFocus={headerOverflow?.returnFocus}
        showCloseButton={false}
        className="max-h-[82vh] max-w-lg overflow-y-auto"
      >
        <DialogHeader>
          <div className="flex items-center justify-between gap-3">
            <DialogTitle className="min-w-0 truncate">
              {hasActiveSession
                ? `Live session · ${projectName || "project"}`
                : `Share ${projectName || "project"}`}
            </DialogTitle>
            <Button
              variant="outline"
              size="sm"
              className="h-7 shrink-0 gap-1.5 text-xs"
              onClick={() => {
                setOpen(false);
                setStartSessionOpen(true);
              }}
            >
              <HugeiconsIcon icon={__PlayHugeIcon} className="size-3.5" />
              Group session
            </Button>
          </div>
        </DialogHeader>

        {error ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p> : null}
        {notice ? <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{notice}</p> : null}

        {!canManage ? (
          <div>
            <p className="rounded-md border border-border/60 px-3 py-3 text-sm text-muted-foreground">
              Your role is {memberRole?.replace(/_/g, " ") || "member"}. Only project managers can change access.
            </p>
          </div>
        ) : (
          <section className="space-y-2">
            <InviteDevicesField
              projectId={projectId}
              value={inviteTargets}
              onChange={setInviteTargets}
              disabled={busy !== null}
              maxTargets={seatsLeft}
              endAddon={
                inviteTargets.length > 0 ? (
                  <div className="inline-flex h-7 items-stretch overflow-hidden rounded-[calc(var(--radius-md)-1px)] bg-secondary text-secondary-foreground">
                    <Button
                      variant="ghost"
                      className="h-7 rounded-none pl-2.5 pr-2 text-xs shadow-none"
                      disabled={busy !== null}
                      aria-haspopup="menu"
                      aria-label={`Invite as ${roleLabel(inviteRole)}. Change the role for everyone on this invite.`}
                      onClick={async (event) => {
                        const picked = roleFromMenuId(await pickRole(event.currentTarget, inviteRole));
                        if (picked) setInviteRole(picked);
                      }}
                    >
                      {roleLabel(inviteRole)}
                      <HugeiconsIcon icon={__ChevronDownHugeIcon} className="ml-1 size-3" />
                    </Button>
                    <span aria-hidden="true" className="my-1 w-px bg-border" />
                    <Button
                      variant="ghost"
                      className="h-7 rounded-none px-2.5 text-xs shadow-none"
                      disabled={busy !== null}
                      onClick={inviteDevice}
                      aria-label={`Send ${inviteTargets.length === 1 ? "the invitation" : `${inviteTargets.length} invitations`} as ${roleLabel(inviteRole)}`}
                      title={`Send as ${roleLabel(inviteRole)}`}
                    >
                      {busy === "invite" ? (
                        <Spinner size="xs" />
                      ) : (
                        <HugeiconsIcon icon={__SentHugeIcon} className="size-3.5" />
                      )}
                    </Button>
                  </div>
                ) : null
              }
            />
          </section>
        )}

        <section className="space-y-2 pt-4">
          <p className="text-sm font-medium text-foreground">Devices with access</p>
          {members === undefined ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : members.length === 0 ? (
            <p className="text-sm text-muted-foreground">No project members.</p>
          ) : (
            <div className="space-y-1.5">
              {members.map((member) => {
                const self = principalId === member.principalId;
                const rowBusy = busy === `member:${String(member.principalId)}`;
                return (
                  <div key={member._id} className="flex items-center gap-2.5 rounded-lg border border-border/50 px-2.5 py-2">
                    <DeviceAvatar
                      displayName={member.displayName}
                      avatarUrl={member.avatarUrl}
                      useColor={false}
                      className="size-7"
                      fallbackClassName="text-xs font-medium"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{member.displayName}{self ? " · This device" : ""}</p>
                    </div>
                    {canManage && !self ? (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                          disabled={rowBusy}
                          aria-haspopup="menu"
                          aria-label={`${member.displayName} is ${roleLabel(member.role as ProjectRole)}. Change their role.`}
                          onClick={async (event) => {
                            const picked = roleFromMenuId(await pickRole(event.currentTarget, member.role as ProjectRole));
                            if (!picked || picked === member.role) return;
                            void run(`member:${String(member.principalId)}`, async () => {
                              await updateMemberRole({ projectId, actorPrincipalId: principalId!, memberPrincipalId: member.principalId, newRole: picked });
                            });
                          }}
                        >
                          {roleLabel(member.role as ProjectRole)}
                          <HugeiconsIcon icon={__ChevronDownHugeIcon} className="size-3" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          disabled={rowBusy}
                          onClick={() => void run(`member:${String(member.principalId)}`, async () => {
                            await removeMember({ projectId, actorPrincipalId: principalId!, memberPrincipalId: member.principalId });
                          })}
                          aria-label={`Remove ${member.displayName}`}
                        >
                          <HugeiconsIcon icon={__DeleteHugeIcon} className="size-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">{member.role.replace(/_/g, " ")}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {canManage && (pendingEnrollments ?? []).length > 0 ? (
          <section className="space-y-2 pt-4">
            <p className="text-sm font-medium text-foreground">Pending invitations</p>
            <div className="space-y-1.5">
              {(pendingEnrollments ?? []).map((enrollment) => (
                <div key={enrollment._id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{enrollment.targetIdentityKey}</span>
                  <span className="text-xs text-muted-foreground">{enrollment.role.replace(/_/g, " ")}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2.5 text-xs"
                    disabled={busy !== null}
                    onClick={() => void run(`cancel:${String(enrollment._id)}`, async () => {
                      await cancelEnrollment({ enrollmentId: enrollment._id });
                    })}
                  >
                    Cancel
                  </Button>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <LiveSessionShareSection
          projectId={projectId}
          projectMembers={members}
          canManageProject={canManage}
          className="pt-4"
        />

        <DialogFooter className="items-center gap-2 pt-4 sm:justify-between">
          <div className="flex items-center gap-2">
            {canManage ? (
              <div className="inline-flex h-7 items-stretch overflow-hidden rounded-[calc(var(--radius-md)-1px)] bg-secondary text-secondary-foreground">
                <Button
                  variant="ghost"
                  className="h-7 gap-1.5 rounded-none px-2.5 text-xs shadow-none"
                  disabled={busy !== null}
                  onClick={copyOrCreateLink}
                  title="Anyone with the link can authorize a Cozea device for this project"
                >
                  {busy === "link" ? (
                    <Spinner size="xs" />
                  ) : (
                    <HugeiconsIcon icon={activeLink ? __CopyHugeIcon : __LinkHugeIcon} className="size-3.5" />
                  )}
                  {activeLink ? "Copy link" : "Create link"}
                </Button>
                <span aria-hidden="true" className="my-1 w-px bg-border" />
                <Button
                  variant="ghost"
                  className="h-7 rounded-none px-2 text-xs shadow-none"
                  disabled={busy !== null}
                  aria-haspopup="menu"
                  aria-label={`Join link grants ${roleLabel(joinRole)}. Change it, or rotate and disable the link.`}
                  onClick={async (event) => {
                    const choice = await pickRole(
                      event.currentTarget,
                      joinRole,
                      activeLink
                        ? [
                            { id: "link:sep", type: "separator" },
                            { id: "link:rotate", label: "Rotate link" },
                            { id: "link:disable", label: "Disable link", destructive: true },
                          ]
                        : [],
                    );
                    if (choice === "link:rotate") return rotateLink();
                    if (choice === "link:disable") return disableLink();
                    const picked = roleFromMenuId(choice);
                    if (picked) setJoinRole(picked);
                  }}
                >
                  <HugeiconsIcon icon={__ChevronDownHugeIcon} className="size-3" />
                </Button>
              </div>
            ) : null}
          </div>
          <DialogClose asChild>
            <Button variant="outline" size="sm" className="h-8 text-sm">Done</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <StartCollaborationDialog
      isOpen={startSessionOpen}
      onOpenChange={setStartSessionOpen}
      projectId={projectId}
      projectName={projectName || "this project"}
      currentBranch={syncContext?.activeBranch ?? null}
      sourceWorkspaceId={syncContext?.workspaceId ?? null}
      targetBranch={syncContext?.sharedBranch ?? "main"}
      hasGitRepo={Boolean(syncContext?.gitCwd)}
      uncommittedFileCount={dirtySnapshot?.changedFiles ?? 0}
    />
    </>
  );
}
