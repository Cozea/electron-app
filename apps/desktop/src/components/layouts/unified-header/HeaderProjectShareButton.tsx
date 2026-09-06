import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";

import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { useAuth } from "@/contexts/AuthContext";
import { useOptionalProjectSyncContext } from "@/contexts/project/ProjectSyncContext";
import { buildProjectJoinUrl } from "@shared/projectShare";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
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

import { HugeiconsIcon } from '@hugeicons/react'
import {
  AddTeamIcon as __AddTeamHugeIcon,
  Copy01Icon as __CopyHugeIcon,
  Link01Icon as __LinkHugeIcon,
  Refresh01Icon as __RefreshHugeIcon,
  Delete02Icon as __DeleteHugeIcon,
} from '@hugeicons/core-free-icons'

type ProjectRole = "project_manager" | "developer" | "designer" | "viewer";

const ROLE_OPTIONS: Array<{ value: ProjectRole; label: string }> = [
  { value: "developer", label: "Developer" },
  { value: "designer", label: "Designer" },
  { value: "viewer", label: "Viewer" },
  { value: "project_manager", label: "Project manager" },
];

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "D";
}

function cleanError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : fallback;
  return raw.replace(/^\[CONVEX.*?\]\s*/, "").replace(/\s*Called by client$/, "") || fallback;
}

export function HeaderProjectShareButton({
  projectId,
  projectName,
}: {
  projectId: Id<"projects"> | null;
  projectName?: string | null;
}) {
  const { principalId } = useAuth();
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
  const [identityKey, setIdentityKey] = useState("");
  const [inviteRole, setInviteRole] = useState<ProjectRole>("developer");
  const [joinRole, setJoinRole] = useState<ProjectRole>("developer");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canManage = memberRole === "project_manager";
  const activeLink = joinLinkState?.activeLink ?? null;

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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Share project">
              <HugeiconsIcon icon={__AddTeamHugeIcon} className="size-4" />
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>Share project</TooltipContent>
      </Tooltip>

      <DialogContent className="max-h-[82vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Share {projectName || "project"}</DialogTitle>
          <DialogDescription>
            Project access belongs to individual Cozea device identities. Invite a device ID or share a join link.
          </DialogDescription>
        </DialogHeader>

        {error ? <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p> : null}
        {notice ? <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">{notice}</p> : null}

        {!canManage ? (
          <p className="rounded-md border border-border/60 px-3 py-3 text-xs text-muted-foreground">
            Your role is {memberRole?.replace(/_/g, " ") || "member"}. Only project managers can change access.
          </p>
        ) : (
          <>
            <section className="space-y-2">
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
                      <AvatarFallback className="rounded-lg text-[9px]">{initials(member.displayName)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{member.displayName}{self ? " · This device" : ""}</p>
                      <p className="truncate font-mono text-[10px] text-muted-foreground">{member.identityKey}</p>
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
  );
}
