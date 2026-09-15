import { useHeaderOverflow } from "./HeaderOverflowContext";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { cleanConvexError as cleanError } from "@/lib/convexError"
import { useAuth } from "@/contexts/AuthContext";
import { useOptionalProjectSyncContext } from "@/contexts/project/ProjectSyncContext";
import { LiveSessionShareSection } from "@/features/collaboration/ui/LiveSessionShareSection";
import { StartCollaborationDialog } from "@/features/collaboration/ui/StartCollaborationDialog";
import { useGitDirtySnapshot } from "@/features/source-control/hooks/useGitDirtySnapshot";
import { buildProjectJoinUrl } from "@shared/projectShare";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getUserColor } from "@/components/presence/PresenceAvatarGroup";
import { cn } from "@/lib/utils";
import type { LiveSessionMember } from "@/features/collaboration/live/liveSessionModel";

import { HugeiconsIcon } from '@hugeicons/react'
import {
  AddTeamIcon as __AddTeamHugeIcon,
  Copy01Icon as __CopyHugeIcon,
  Link01Icon as __LinkHugeIcon,
  Refresh01Icon as __RefreshHugeIcon,
  Delete02Icon as __DeleteHugeIcon,
} from '@hugeicons/core-free-icons'
import type { LiveSessionContext } from "@/features/collaboration/live/useLiveSession";
import { SessionHubDialog } from "@/features/collaboration/ui/SessionHubDialog";

type ProjectRole = "project_manager" | "developer" | "designer" | "viewer";

const ROLE_OPTIONS: Array<{ value: ProjectRole; label: string }> = [
  { value: "developer", label: "Developer" },
  { value: "designer", label: "Designer" },
  { value: "viewer", label: "Viewer" },
  { value: "project_manager", label: "Project manager" },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}



export function HeaderProjectShareButton({
  projectId,
  projectName,
  liveSessionMembers,
  liveSession,
  onlinePrincipalIds,
}: {
  projectId: Id<"projects"> | null;
  projectName?: string | null;
  liveSessionMembers?: LiveSessionMember[];
  liveSession?: LiveSessionContext | null;
  onlinePrincipalIds?: Set<string>;
}) {
  const { principalId, user } = useAuth();
  const syncContext = useOptionalProjectSyncContext();
  const memberRole = useQuery(
    api.projectMembers.getMemberRole,
    projectId && principalId ? { projectId, principalId: principalId } : "skip",
  );
  const members = useQuery(
    api.projectMembers.listMembers,
    projectId && principalId ? { projectId, viewerPrincipalId: principalId } : "skip",
  );
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
  const [identityKey, setIdentityKey] = useState("");
  const [inviteRole, setInviteRole] = useState<ProjectRole>("developer");
  const [joinRole, setJoinRole] = useState<ProjectRole>("developer");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canManage = memberRole === "project_manager";
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
    if (!projectId || !canManage || !identityKey.trim()) return;
    void run("invite", async () => {
      await flushCollaboration();
      await createEnrollment({ projectId, identityKey: identityKey.trim(), role: inviteRole });
      setIdentityKey("");
      setNotice("Invitation created for that device.");
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

  if (isSessionHub && liveSession?.session && projectId) {
    return (
      <>
        <Tooltip open={hubOpen ? false : undefined}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              className="inline-flex h-7 items-center justify-center rounded-md bg-transparent px-1 py-0 text-muted-foreground shadow-none hover:bg-muted/40 hover:text-foreground titlebar-no-drag cursor-pointer transition-[background-color,color,transform] duration-150 active:scale-[0.98]"
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
                  const color = getUserColor(member.principalId);

                  return (
                    <span
                      key={member.principalId}
                      className="relative inline-flex items-center transition-transform hover:scale-110 hover:z-20"
                      style={{ zIndex: visible.length - index }}
                    >
                      <Avatar
                        className={cn(
                          "size-6 border-2 border-background rounded-[6px] transition-all",
                          isSpeaking && "ring-2 ring-emerald-500 ring-offset-1 border-emerald-500",
                        )}
                      >
                        {member.avatarUrl ? (
                          <AvatarImage src={member.avatarUrl} alt={member.displayName} />
                        ) : null}
                        <AvatarFallback
                          className="text-[10px] font-medium"
                          style={{ backgroundColor: color, color: "white" }}
                        >
                          {initials(member.displayName)}
                        </AvatarFallback>
                      </Avatar>
                    </span>
                  );
                })}
                {overflow > 0 ? (
                  <span
                    className="relative inline-flex items-center"
                    style={{ zIndex: 0 }}
                  >
                    <Avatar className="size-6 border-2 border-background rounded-[6px] bg-muted">
                      <AvatarFallback className="text-[10px] font-medium text-muted-foreground">
                        +{overflow}
                      </AvatarFallback>
                    </Avatar>
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
          onStartSession={() => {
            setHubOpen(false);
            setStartSessionOpen(true);
          }}
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
    <Dialog open={open} onOpenChange={(next) => {
      setOpen(next);
      if (next) headerOverflow?.dismiss();
    }}>
      <Tooltip open={open ? false : undefined}>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            {hasActiveSession ? (
              <Button
                variant="ghost"
                className="inline-flex h-7 items-center justify-center rounded-md bg-transparent px-1 py-0 text-muted-foreground shadow-none hover:bg-muted/40 hover:text-foreground titlebar-no-drag cursor-pointer transition-[background-color,color,transform] duration-150 active:scale-[0.98]"
                disabled={roleCheckPending || shareStatePending}
                aria-label={`Live session with ${inSession.length} participant${inSession.length === 1 ? "" : "s"}. Click to open session menu.`}
              >
                <div className="flex items-center -space-x-1.5 px-0.5 shrink-0">
                  {visible.map((member, index) => {
                    const isSpeaking = member.microphoneState === "speaking";
                    const color = getUserColor(member.principalId);

                    return (
                      <span
                        key={member.principalId}
                        className="relative inline-flex items-center transition-transform hover:scale-110 hover:z-20"
                        style={{ zIndex: visible.length - index }}
                      >
                        <Avatar
                          className={cn(
                            "size-6 border-2 border-background rounded-[6px] transition-all",
                            isSpeaking && "ring-2 ring-emerald-500 ring-offset-1 border-emerald-500",
                          )}
                        >
                          {member.avatarUrl ? (
                            <AvatarImage src={member.avatarUrl} alt={member.displayName} />
                          ) : null}
                          <AvatarFallback
                            className="text-[10px] font-medium"
                            style={{ backgroundColor: color, color: "white" }}
                          >
                            {initials(member.displayName)}
                          </AvatarFallback>
                        </Avatar>
                      </span>
                    );
                  })}
                  {overflow > 0 ? (
                    <span
                      className="relative inline-flex items-center"
                      style={{ zIndex: 0 }}
                    >
                      <Avatar className="size-6 border-2 border-background rounded-[6px] bg-muted">
                        <AvatarFallback className="text-[10px] font-medium text-muted-foreground">
                          +{overflow}
                        </AvatarFallback>
                      </Avatar>
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

      <DialogContent finalFocus={headerOverflow?.returnFocus} className="max-h-[82vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {hasActiveSession
              ? `Live session · ${projectName || "project"}`
              : `Share ${projectName || "project"}`}
          </DialogTitle>
          <DialogDescription>
            {hasActiveSession
              ? `Edit this branch together in a live session, or give other Cozea devices access to the project.`
              : `Edit this branch together in a live session, or give other Cozea devices access to the project.`}
          </DialogDescription>
        </DialogHeader>

        {error ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p> : null}
        {notice ? <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{notice}</p> : null}

        <LiveSessionShareSection
          projectId={projectId}
          projectMembers={members}
          canManageProject={canManage}
          onStartSession={() => {
            setOpen(false);
            setStartSessionOpen(true);
          }}
        />

        {!canManage ? (
          <div className="border-t border-border/60 pt-4">
            <p className="rounded-md border border-border/60 px-3 py-3 text-xs text-muted-foreground">
              Your role is {memberRole?.replace(/_/g, " ") || "member"}. Only project managers can change access.
            </p>
          </div>
        ) : (
          <>
            <section className="space-y-2 border-t border-border/60 pt-4">
              <div>
                <p className="text-xs font-medium">Invite a device</p>
                <p className="text-[11px] text-muted-foreground">Paste the other device&apos;s public czd_… identity.</p>
              </div>
              <div className="flex gap-2">
                <Input
                  value={identityKey}
                  onChange={(event) => setIdentityKey(event.target.value)}
                  placeholder="czd_…"
                  className="h-8 flex-1 font-mono text-xs"
                  onKeyDown={(event) => { if (event.key === "Enter") inviteDevice(); }}
                />
                <Select value={inviteRole} onValueChange={(value) => setInviteRole(value as ProjectRole)}>
                  <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((role) => <SelectItem key={role.value} value={role.value}>{role.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button size="sm" className="h-8" disabled={!identityKey.trim() || busy !== null} onClick={inviteDevice}>Invite</Button>
              </div>
            </section>

            <section className="space-y-2 border-t border-border/60 pt-4">
              <div>
                <p className="text-xs font-medium">Join link</p>
                <p className="text-[11px] text-muted-foreground">Anyone with the link can authorize the current Cozea device for this project.</p>
              </div>
              <div className="flex gap-2">
                <Select value={joinRole} onValueChange={(value) => setJoinRole(value as ProjectRole)}>
                  <SelectTrigger className="h-8 flex-1 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((role) => <SelectItem key={role.value} value={role.value}>{role.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" className="h-8 gap-1.5" disabled={busy !== null} onClick={copyOrCreateLink}>
                  <HugeiconsIcon icon={activeLink ? __CopyHugeIcon : __LinkHugeIcon} className="size-3.5" />
                  {activeLink ? "Copy" : "Create"}
                </Button>
                {activeLink ? (
                  <>
                    <Button size="icon" variant="ghost" className="h-8 w-8" disabled={busy !== null} onClick={rotateLink} aria-label="Rotate link">
                      <HugeiconsIcon icon={__RefreshHugeIcon} className="size-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8" disabled={busy !== null} onClick={disableLink} aria-label="Disable link">
                      <HugeiconsIcon icon={__DeleteHugeIcon} className="size-3.5" />
                    </Button>
                  </>
                ) : null}
              </div>
            </section>
          </>
        )}

        <section className="space-y-2 border-t border-border/60 pt-4">
          <p className="text-xs font-medium">Devices with access</p>
          {members === undefined ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : members.length === 0 ? (
            <p className="text-xs text-muted-foreground">No project members.</p>
          ) : (
            <div className="space-y-1.5">
              {members.map((member) => {
                const self = principalId === member.principalId;
                const rowBusy = busy === `member:${String(member.principalId)}`;
                return (
                  <div key={member._id} className="flex items-center gap-2.5 rounded-lg border border-border/50 px-2.5 py-2">
                    <Avatar className="size-7 rounded-lg">
                      {member.avatarUrl ? <AvatarImage src={member.avatarUrl} alt={member.displayName} /> : null}
                      <AvatarFallback className="rounded-lg text-xs font-medium">{initials(member.displayName)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{member.displayName}{self ? " · This device" : ""}</p>
                      <p className="truncate font-mono text-2xs text-muted-foreground">{member.identityKey}</p>
                    </div>
                    {canManage && !self ? (
                      <div className="flex items-center gap-1">
                        <Select
                          value={member.role}
                          disabled={rowBusy}
                          onValueChange={(value) => void run(`member:${String(member.principalId)}`, async () => {
                            await updateMemberRole({ projectId, actorPrincipalId: principalId!, memberPrincipalId: member.principalId, newRole: value as ProjectRole });
                          })}
                        >
                          <SelectTrigger className="h-7 w-32 text-[10px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {ROLE_OPTIONS.map((role) => <SelectItem key={role.value} value={role.value}>{role.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
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
                      <span className="text-[10px] text-muted-foreground">{member.role.replace(/_/g, " ")}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {canManage && (pendingEnrollments ?? []).length > 0 ? (
          <section className="space-y-2 border-t border-border/60 pt-4">
            <p className="text-xs font-medium">Pending invitations</p>
            <div className="space-y-1.5">
              {(pendingEnrollments ?? []).map((enrollment) => (
                <div key={enrollment._id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs">
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px]">{enrollment.targetIdentityKey}</span>
                  <span className="text-[10px] text-muted-foreground">{enrollment.role.replace(/_/g, " ")}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[10px]"
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
